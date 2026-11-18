// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore, Shake, Give, SignedShake, SignedGive} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {shakeStructHash, giveStructHash, digestOf, HandView, handOf, ThankView, thankOf} from "./Helpers.sol";
import {EventIndexer} from "./EventIndexer.sol";

/// Random raises, extensions, fundings, thanks (direct or through one Shake with a random margin),
/// reclaims, blocks, withdrawals and time jumps by three actors over two tokens; the second token
/// can block any actor, so payouts stay pending and get withdrawn. Actions pick among the open Hands and the
/// payees with something pending, so few calls are wasted.
contract Handler is Test {
    AHandCore public core;
    MockUSD[2] public tokens;
    uint256[3] keys = [0xA11CE, 0xB0B, 0xCA401];
    address[3] public actors;
    uint256 constant ROOT_PK = 0xA0A0; // every Hand's link starts here
    uint256 constant NEXT_PK = 0xB0B0; // the key a Shake passes the Hand to

    mapping(address => uint256) public open; // token => sum of open rewards, kept independently of Core
    mapping(address => uint256) public paidIn; // token => every reward ever raised
    uint256 public closed; // Hands this handler closed
    uint256[] internal openIds; // Hands raised and not yet closed
    EventIndexer public indexer; // reads every action's logs, knowing nothing else of Core

    constructor(AHandCore core_, MockUSD a, MockUSD b) {
        core = core_;
        tokens = [a, b];
        actors = [vm.addr(keys[0]), vm.addr(keys[1]), vm.addr(keys[2])];
        indexer = new EventIndexer(address(core_));
    }

    /// Each action is one transaction: its logs go to the indexer with the time of its block.
    modifier logged() {
        vm.recordLogs();
        _;
        indexer.ingest(vm.getRecordedLogs(), block.timestamp);
    }

    function raise(uint256 who, uint256 which, uint256 reward, uint256 ahead) external logged {
        address actor = actors[who % 3];
        MockUSD token = tokens[which % 2];
        reward = bound(reward, 0, 1e30);
        token.mint(actor, reward);
        vm.startPrank(actor);
        token.approve(address(core), reward);
        uint256 id = core.raise(
            address(token),
            reward,
            uint40(block.timestamp + bound(ahead, 1, 90 days)),
            vm.addr(ROOT_PK),
            0,
            200,
            bytes32(reward)
        );
        vm.stopPrank();
        openIds.push(id);
        open[address(token)] += reward;
        paidIn[address(token)] += reward;
    }

    /// The raiser of an open Hand moves its expiry later, up to the cap; past its expiry nothing happens.
    function extend(uint256 seed, uint256 by) external logged {
        if (openIds.length == 0) return;
        uint256 id = openIds[seed % openIds.length];
        HandView memory h = handOf(core, id);
        if (block.timestamp >= h.expiry) return;
        uint256 latest = block.timestamp + core.MAX_TERM();
        if (h.expiry >= latest) return;
        vm.prank(h.raiser);
        core.extend(id, uint40(bound(by, h.expiry + 1, latest)));
    }

    /// The raiser of an open Hand adds to its reward; past its expiry nothing happens.
    function fund(uint256 seed, uint256 amount) external logged {
        if (openIds.length == 0) return;
        uint256 id = openIds[seed % openIds.length];
        HandView memory h = handOf(core, id);
        if (block.timestamp >= h.expiry) return;
        amount = bound(amount, 0, 1e30);
        MockUSD token = MockUSD(h.token);
        token.mint(h.raiser, amount);
        vm.startPrank(h.raiser);
        token.approve(address(core), amount);
        core.fund(id, amount);
        vm.stopPrank();
        open[h.token] += amount;
        paidIn[h.token] += amount;
    }

    /// Any open Hand: time first moves to its expiry, so the call is never wasted.
    function reclaim(uint256 seed) external logged {
        if (openIds.length == 0) return;
        uint256 id = openIds[seed % openIds.length];
        HandView memory h = handOf(core, id);
        if (block.timestamp < h.expiry) vm.warp(h.expiry);
        core.reclaim(id);
        _closed(id, h.token, h.reward);
    }

    /// `via` odd: one Shake first, its margin to one of the actors (the raiser included).
    /// `to` odd: the raiser states something with the thanks.
    function thank(uint256 seed, uint256 to, uint256 via, uint256 next) external logged {
        if (openIds.length == 0) return;
        uint256 id = openIds[seed % openIds.length];
        HandView memory h = handOf(core, id);
        if (block.timestamp >= h.expiry) return; // too late to thank: only reclaim closes it now
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
            bytes32 shakeHash = shakeStructHash(core, id, shakes[0].shake);
            shakes[0].keySig = _sign(ROOT_PK, digestOf(address(core), shakeHash));
            routeHash = keccak256(abi.encode(bytes32(0), shakeHash));
            lastKey = NEXT_PK;
        }
        Give memory g = Give(actors[pick], actors[pick], claim, routeHash, keccak256(abi.encode(seed)));
        bytes32 digest = digestOf(address(core), giveStructHash(core, id, g));
        bytes memory keySig = _sign(lastKey, digest);
        bytes memory giverSig = _sign(keys[pick], digest);
        bytes32 stated = to % 2 == 0 ? bytes32(0) : bytes32(to);
        vm.prank(h.raiser);
        core.thank(id, shakes, SignedGive(g, keySig, giverSig), stated);
        _closed(id, h.token, h.reward);
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(key, digest);
        return abi.encodePacked(r, sv, v);
    }

    function _closed(uint256 id, address token, uint256 reward) private {
        open[token] -= reward;
        ++closed;
        for (uint256 i; i < openIds.length; ++i) {
            if (openIds[i] == id) {
                openIds[i] = openIds[openIds.length - 1];
                openIds.pop();
                return;
            }
        }
    }

    function block_(uint256 who, bool blocked) external {
        BlacklistToken(address(tokens[1])).setBlocked(actors[who % 3], blocked);
    }

    /// The first (token, payee) pair with something pending, from a random start.
    function withdraw_(uint256 who, uint256 dest, uint256 by) external logged {
        for (uint256 k; k < 6; ++k) {
            uint256 j = (who % 6 + k) % 6;
            MockUSD token = tokens[j % 2];
            address payee = actors[j / 2];
            if (core.pending(address(token), payee) == 0) continue;
            address to = actors[dest % 3];
            if (j % 2 == 1 && BlacklistToken(address(token)).blocked(to)) return;
            // anyone may send what is pending to its payee; only the payee may send it elsewhere
            vm.prank(to == payee ? actors[by % 3] : payee);
            core.withdraw(address(token), payee, to);
            return;
        }
    }

    /// Closes every open Hand and delivers everything pending: afterwards Core holds nothing.
    function drain() external logged {
        uint256 latest = block.timestamp;
        for (uint256 i; i < openIds.length; ++i) {
            uint40 expiry = handOf(core, openIds[i]).expiry;
            if (expiry > latest) latest = expiry;
        }
        vm.warp(latest);
        while (openIds.length > 0) {
            uint256 id = openIds[openIds.length - 1];
            HandView memory h = handOf(core, id);
            core.reclaim(id);
            _closed(id, h.token, h.reward);
        }
        for (uint256 i; i < 3; ++i) {
            BlacklistToken(address(tokens[1])).setBlocked(actors[i], false);
        }
        for (uint256 j; j < 6; ++j) {
            address token = address(tokens[j % 2]);
            address payee = actors[j / 2];
            if (core.pending(token, payee) > 0) core.withdraw(token, payee, payee);
        }
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
        bytes4[] memory notAnAction = new bytes4[](1);
        notAnAction[0] = Handler.drain.selector;
        excludeSelector(FuzzSelector({addr: address(handler), selectors: notAnAction}));
    }

    /// After every run: close every open Hand, unblock everyone and withdraw everything pending.
    /// Then Core holds nothing, and the actors hold exactly what was raised: whatever was left
    /// pending could really be withdrawn.
    function afterInvariant() public {
        handler.drain();
        invariant_stateRebuildsFromEvents();
        assertEq(a.balanceOf(address(core)), 0);
        assertEq(b.balanceOf(address(core)), 0);
        assertEq(handler.paidIn(address(a)), handler.held(address(a)));
        assertEq(handler.paidIn(address(b)), handler.held(address(b)));
    }

    /// Core's balance of each token is exactly its open rewards plus what is pending: not a unit
    /// more or less.
    function invariant_balanceEqualsOpenRewardsPlusPending() public view {
        assertEq(a.balanceOf(address(core)), handler.open(address(a)) + handler.pendingTotal(address(a)));
        assertEq(b.balanceOf(address(core)), handler.open(address(b)) + handler.pendingTotal(address(b)));
    }

    /// Nothing is created or lost: every unit raised is in Core or with an actor.
    function invariant_moneyIsConserved() public view {
        assertEq(handler.paidIn(address(a)), a.balanceOf(address(core)) + handler.held(address(a)));
        assertEq(handler.paidIn(address(b)), b.balanceOf(address(core)) + handler.held(address(b)));
    }

    /// Everything Core keeps can be rebuilt from its events and the times of their blocks: every
    /// Hand and every thank field by field (`giveHash` from the Give, under the Hand's own terms),
    /// everything pending, what each actor holds, and Core's balance of each token.
    function invariant_stateRebuildsFromEvents() public view {
        EventIndexer indexer = handler.indexer();
        assertEq(indexer.handsCount(), core.handsCount());
        assertEq(indexer.thanksCount(), core.thanksCount());
        assertEq(indexer.reclaimsCount(), core.reclaimsCount());
        for (uint256 id = 1; id <= core.handsCount(); ++id) {
            assertEq(abi.encode(indexer.hand(id)), abi.encode(handOf(core, id)));
            assertEq(abi.encode(indexer.thank(id)), abi.encode(thankOf(core, id)));
        }
        _moneyFromEvents(indexer, a);
        _moneyFromEvents(indexer, b);
    }

    /// For one token: what waits and what each actor holds, then Core's balance as the open
    /// rewards plus everything pending — all of it read from the events.
    function _moneyFromEvents(EventIndexer indexer, MockUSD token) internal view {
        uint256 total;
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actors(i);
            uint256 waits = indexer.pending(address(token), actor);
            assertEq(waits, core.pending(address(token), actor));
            assertEq(indexer.received(address(token), actor), token.balanceOf(actor));
            total += waits;
        }
        for (uint256 id = 1; id <= indexer.handsCount(); ++id) {
            HandView memory h = indexer.hand(id);
            if (h.token == address(token) && h.closedAt == 0) total += h.reward;
        }
        assertEq(total, token.balanceOf(address(core)));
    }

    /// Every raised Hand has the time it was opened and is not closed before it; only a closed Hand
    /// keeps a thank, and a thank that keeps a statement keeps its Give.
    function invariant_timesAreConsistent() public view {
        for (uint256 id = 1; id <= core.handsCount(); ++id) {
            HandView memory h = handOf(core, id);
            ThankView memory t = thankOf(core, id);
            assertGt(h.openedAt, 0);
            if (h.closedAt != 0) assertGe(h.closedAt, h.openedAt);
            if (t.giveHash != bytes32(0)) assertGt(h.closedAt, 0);
            if (t.dataHash != bytes32(0)) assertTrue(t.giveHash != bytes32(0));
        }
    }

    /// A closed Hand stays closed: Core keeps exactly the Hands the handler closed, and its two
    /// counts are the closed Hands that keep a thank and those that keep none.
    function invariant_closedHandsStayClosed() public view {
        uint256 thanked;
        uint256 reclaimed;
        for (uint256 id = 1; id <= core.handsCount(); ++id) {
            if (handOf(core, id).closedAt == 0) continue;
            if (thankOf(core, id).giveHash != bytes32(0)) ++thanked;
            else ++reclaimed;
        }
        assertEq(thanked + reclaimed, handler.closed());
        assertEq(core.thanksCount(), thanked);
        assertEq(core.reclaimsCount(), reclaimed);
    }
}
