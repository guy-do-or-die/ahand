// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore, Shake, Give, SignedShake} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {shakeStructHash, giveStructHash, digestOf, HandView, handOf} from "./Helpers.sol";

/// Random raises, thanks (direct or through one Shake with a random margin), reclaims, blocks,
/// withdrawals and time jumps by three actors over two tokens; the second token can block any
/// actor, so payments stay pending and get withdrawn.
contract Handler is Test {
    AHandCore public core;
    MockUSD[2] public tokens;
    uint256[3] keys = [0xA11CE, 0xB0B, 0xCA401];
    address[3] public actors;
    uint256 constant ROOT_PK = 0xA0A0; // every Hand's link starts here
    uint256 constant NEXT_PK = 0xB0B0; // the key a Shake passes the Hand to

    mapping(address => uint256) public open; // token => sum of Active pots, kept independently of Core
    mapping(address => uint256) public paidIn; // token => all deposits
    uint256 public closed; // Hands this handler closed

    constructor(AHandCore core_, MockUSD a, MockUSD b) {
        core = core_;
        tokens = [a, b];
        actors = [vm.addr(keys[0]), vm.addr(keys[1]), vm.addr(keys[2])];
    }

    function raise(uint256 who, uint256 which, uint256 amount, uint256 ahead) external {
        address actor = actors[who % 3];
        MockUSD token = tokens[which % 2];
        amount = bound(amount, 0, 1e30);
        token.mint(actor, amount);
        vm.startPrank(actor);
        token.approve(address(core), amount);
        core.raise(
            address(token),
            amount,
            uint40(block.timestamp + bound(ahead, 1, 90 days)),
            vm.addr(ROOT_PK),
            0,
            200,
            bytes32(amount)
        );
        vm.stopPrank();
        open[address(token)] += amount;
        paidIn[address(token)] += amount;
    }

    function reclaim(uint256 seed) external {
        uint256 count = core.handsCount();
        if (count == 0) return;
        uint256 id = seed % count + 1;
        HandView memory h = handOf(core, id);
        if (!_open(h) || block.timestamp < h.expiry) return;
        core.reclaim(id);
        _closed(h.token, h.amount);
    }

    /// `via` odd: one Shake first, its margin to one of the actors (the raiser included).
    function thank(uint256 seed, uint256 to, uint256 via, uint256 next) external {
        uint256 count = core.handsCount();
        if (count == 0) return;
        uint256 id = seed % count + 1;
        HandView memory h = handOf(core, id);
        if (!_open(h) || block.timestamp >= h.expiry) return;
        uint256 pick = to % 3;
        if (actors[pick] == h.raiser) pick = (pick + 1) % 3;

        SignedShake[] memory shakes;
        bytes32 routeHash;
        uint16 claim = 10_000;
        uint256 lastKey = ROOT_PK;
        if (via % 2 == 1) {
            claim = uint16(bound(next, 0, 10_000));
            shakes = new SignedShake[](1);
            shakes[0].shake = Shake(vm.addr(NEXT_PK), actors[via % 3], 10_000, claim, bytes32(seed));
            bytes32 shakeHash = shakeStructHash(id, shakes[0].shake);
            shakes[0].keySig = _sign(ROOT_PK, digestOf(address(core), shakeHash));
            routeHash = keccak256(abi.encode(bytes32(0), shakeHash));
            lastKey = NEXT_PK;
        }
        Give memory g = Give(routeHash, actors[pick], actors[pick], claim, keccak256(abi.encode(seed)));
        bytes32 digest = digestOf(address(core), giveStructHash(id, g));
        bytes memory keySig = _sign(lastKey, digest);
        bytes memory giverSig = _sign(keys[pick], digest);
        vm.prank(h.raiser);
        core.thank(id, shakes, g, keySig, giverSig);
        _closed(h.token, h.amount);
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(key, digest);
        return abi.encodePacked(r, sv, v);
    }

    function _open(HandView memory h) private pure returns (bool) {
        return h.thankedAt == 0 && h.reclaimedAt == 0;
    }

    function _closed(address token, uint256 amount) private {
        open[token] -= amount;
        ++closed;
    }

    function block_(uint256 who, bool blocked) external {
        BlacklistToken(address(tokens[1])).setBlocked(actors[who % 3], blocked);
    }

    function withdraw_(uint256 who, uint256 which, uint256 dest, uint256 by) external {
        MockUSD token = tokens[which % 2];
        address payee = actors[who % 3];
        if (core.pending(address(token), payee) == 0) return;
        address to = actors[dest % 3];
        if (which % 2 == 1 && BlacklistToken(address(token)).blocked(to)) return;
        // anyone may send what is pending to its payee; only the payee may send it elsewhere
        vm.prank(to == payee ? actors[by % 3] : payee);
        core.withdraw(address(token), payee, to);
    }

    function pendingTotal(address token) public view returns (uint256 sum) {
        for (uint256 i; i < 3; ++i) {
            sum += core.pending(token, actors[i]);
        }
    }

    function held(address token) public view returns (uint256 sum) {
        for (uint256 i; i < 3; ++i) {
            sum += MockUSD(token).balanceOf(actors[i]);
        }
    }

    function warp(uint256 by) external {
        vm.warp(block.timestamp + bound(by, 1, 30 days));
    }
}

contract CoreInvariantTest is Test {
    AHandCore core;
    MockUSD a;
    MockUSD b;
    Handler handler;

    function setUp() public {
        core = new AHandCore();
        a = new MockUSD();
        b = new BlacklistToken();
        handler = new Handler(core, a, b);
        targetContract(address(handler));
    }

    /// Core's balance of each token is exactly its open pots plus what is pending: not a unit
    /// more or less.
    function invariant_balanceEqualsOpenPotsPlusPending() public view {
        assertEq(a.balanceOf(address(core)), handler.open(address(a)) + handler.pendingTotal(address(a)));
        assertEq(b.balanceOf(address(core)), handler.open(address(b)) + handler.pendingTotal(address(b)));
    }

    /// Nothing is created or lost: every deposited unit is in Core or with an actor.
    function invariant_moneyIsConserved() public view {
        assertEq(handler.paidIn(address(a)), a.balanceOf(address(core)) + handler.held(address(a)));
        assertEq(handler.paidIn(address(b)), b.balanceOf(address(core)) + handler.held(address(b)));
    }

    /// Every raised Hand has its raise time; no Hand is both thanked and reclaimed.
    function invariant_timesAreConsistent() public view {
        for (uint256 id = 1; id <= core.handsCount(); ++id) {
            HandView memory h = handOf(core, id);
            assertGt(h.raisedAt, 0);
            assertFalse(h.thankedAt != 0 && h.reclaimedAt != 0);
        }
    }

    /// A closed Hand stays closed: Core counts exactly the Hands the handler closed.
    function invariant_closedHandsStayClosed() public view {
        uint256 closed;
        for (uint256 id = 1; id <= core.handsCount(); ++id) {
            HandView memory h = handOf(core, id);
            if (h.thankedAt != 0 || h.reclaimedAt != 0) ++closed;
        }
        assertEq(closed, handler.closed());
    }
}
