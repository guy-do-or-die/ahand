// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Test.sol";
import "../src/AHandTypes.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {StaticAnchor} from "../src/StaticAnchor.sol";
import {MockERC20} from "./AHand.attacks.t.sol";

contract AHandHandler is Test {
    AHandCore public core;
    MockERC20 public usd;
    address public charity;
    address public raiser;
    address public maint;

    uint256[] public activeHandIds;

    uint256 constant E0 = 0xE0aa;
    uint256 constant E1 = 0xE1aa;
    uint256 constant E2 = 0xE2aa;
    uint256 constant SOLVER_PK = 0x50aa;
    address public solver;

    constructor(AHandCore _core, MockERC20 _usd, address _charity, address _raiser, address _maint) {
        core = _core;
        usd = _usd;
        charity = _charity;
        raiser = _raiser;
        maint = _maint;
        solver = vm.addr(SOLVER_PK);
    }

    function _removeHandId(uint256 handId) internal {
        for (uint256 i = 0; i < activeHandIds.length; ++i) {
            if (activeHandIds[i] == handId) {
                activeHandIds[i] = activeHandIds[activeHandIds.length - 1];
                activeHandIds.pop();
                break;
            }
        }
    }

    function _sign(bytes32 structHash, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, AHandSig.digest(core.DOMAIN_SEPARATOR(), structHash));
        return abi.encodePacked(r, s, v);
    }

    function raise(
        uint96 amount,
        uint40 expiryOffset,
        uint16 charityFeeBps,
        uint16 maintFeeBps,
        uint16 minSolverClaimBps
    ) external {
        amount = uint96(bound(amount, 100, 10_000e6));
        expiryOffset = uint40(bound(expiryOffset, 1 days + 1, 180 days - 1));
        charityFeeBps = uint16(bound(charityFeeBps, 1_00, 5_00)); // 1% to 5%
        maintFeeBps = uint16(bound(maintFeeBps, 0, 10_00)); // up to 10%
        minSolverClaimBps = uint16(bound(minSolverClaimBps, 20_00, 70_00)); // 20% to 70%

        if (uint256(charityFeeBps) + maintFeeBps >= 100_00 - minSolverClaimBps) {
            charityFeeBps = 1_00;
            maintFeeBps = 1_00;
        }

        uint40 expiry = uint40(block.timestamp + expiryOffset);

        usd.mint(raiser, amount);
        vm.startPrank(raiser);
        usd.approve(address(core), amount);

        uint256 nextHandId = core.handsCount() + 1;
        uint256 handId = core.raise(
            address(usd),
            amount,
            expiry,
            charityFeeBps,
            maintFeeBps,
            minSolverClaimBps,
            charity,
            vm.addr(E0),
            keccak256(abi.encodePacked(nextHandId))
        );
        vm.stopPrank();

        activeHandIds.push(handId);
    }

    function thank(uint256 handIndexSeed, uint8 hops, uint96 topUp) external {
        if (activeHandIds.length == 0) return;
        uint256 handId = activeHandIds[handIndexSeed % activeHandIds.length];

        hops = uint8(bound(hops, 0, 2));
        topUp = uint96(bound(topUp, 0, 1_000e6));

        (, , , , , , uint16 minSolverClaimBps, , , , ) = core.hands(handId);

        if (topUp > 0) {
            usd.mint(raiser, topUp);
            vm.prank(raiser);
            usd.approve(address(core), topUp);
        }

        Shake[] memory shakes = new Shake[](hops);
        bytes[] memory sigs = new bytes[](hops);

        uint16 currClaim = 10_000;
        uint256 currPk = E0;

        for (uint256 i = 0; i < hops; ++i) {
            uint256 nextPk = E0 + i + 1;
            address child = vm.addr(nextPk);

            uint16 maxMargin = (currClaim - minSolverClaimBps) / uint16(hops - i);
            uint16 margin = maxMargin > 100 ? 100 : maxMargin;
            uint16 nextClaim = currClaim - margin;

            shakes[i] = Shake(handId, child, raiser, currClaim, nextClaim, uint40(block.timestamp + 7 days));
            sigs[i] = _sign(AHandSig.hashShake(shakes[i]), currPk);

            currClaim = nextClaim;
            currPk = nextPk;
        }

        Give memory give = Give(handId, solver, keccak256("solution"));
        bytes memory giveSig = _sign(AHandSig.hashGive(give), currPk);

        vm.prank(raiser);
        core.thank(handId, shakes, sigs, give, giveSig, topUp);

        _removeHandId(handId);
    }

    function finalize(uint256 handIndexSeed, uint40 timeDelta) external {
        if (activeHandIds.length == 0) return;
        uint256 handId = activeHandIds[handIndexSeed % activeHandIds.length];

        (, , , uint40 expiry, , , , , , , ) = core.hands(handId);

        if (block.timestamp < expiry) {
            timeDelta = uint40(bound(timeDelta, 0, expiry - block.timestamp));
            vm.warp(expiry + timeDelta + 1);
        }

        core.finalize(handId);
        _removeHandId(handId);
    }

    function withdrawTo(uint8 userIndexSeed) external {
        address user;
        if (userIndexSeed % 3 == 0) user = raiser;
        else if (userIndexSeed % 3 == 1) user = solver;
        else user = maint;

        uint96 amt = core.pending(user, address(usd));
        if (amt > 0) {
            vm.prank(user);
            core.withdrawTo(address(usd), raiser);
        }
    }

    uint256 public junkTotal;   // ghost: amount of junk token manually minted to core

    function donateJunk(uint96 amount) external {
        amount = uint96(bound(amount, 1, 1_000e6));
        junkTotal += amount;
        usd.mint(address(core), amount);
    }
}

contract AHandInvariantTest is Test {
    AHandCore public core;
    AHandSignals public signals;
    StaticAnchor public anchor;
    MockERC20 public usd;
    AHandHandler public handler;

    address raiser = makeAddr("raiser");
    address charity = makeAddr("charity");
    address maint = makeAddr("maint");

    function setUp() public {
        address[] memory ch = new address[](1);
        ch[0] = charity;
        core = new AHandCore(ch, maint);
        signals = new AHandSignals(address(core));
        core.setSignals(address(signals));
        anchor = new StaticAnchor();
        signals.setAnchor(address(anchor));

        usd = new MockERC20("USD");
        anchor.setRate(address(usd), 1e12);

        handler = new AHandHandler(core, usd, charity, raiser, maint);
        targetContract(address(handler));
    }

    function sumOfActiveEscrows() public view returns (uint256 sum) {
        uint256 count = core.handsCount();
        for (uint256 i = 1; i <= count; ++i) {
            (, , uint96 remaining, , , , , Status st, , ,) = core.hands(i);
            if (st == Status.Active) {
                sum += remaining;
            }
        }
    }

    function sumOfPending() public view returns (uint256) {
        return core.pending(raiser, address(usd)) +
               core.pending(handler.solver(), address(usd)) +
               core.pending(maint, address(usd)) +
               core.pending(charity, address(usd));
    }

    /// @custom:invariant I-2: balance is always sufficient to cover obligations (junk is only extra)
    function invariant_TelescopicConservation() public view {
        uint256 actualBal = usd.balanceOf(address(core));
        uint256 expectedObligations = sumOfActiveEscrows() + sumOfPending();
        assertGe(actualBal, expectedObligations, "Conservation invariant broken: balance < obligations");
    }

    /// @custom:invariant I-1 strict: ghost accounting of junk converts >= to ==
    function invariant_StrictConservation() public view {
        assertEq(
            usd.balanceOf(address(core)),
            sumOfActiveEscrows() + sumOfPending() + handler.junkTotal(),
            "strict conservation broken"
        );
    }

    /// @custom:invariant I-16: non-Active hand must hold exactly zero escrow
    function invariant_SettledZeroRemaining() public view {
        uint256 count = core.handsCount();
        for (uint256 i = 1; i <= count; ++i) {
            (, , uint96 remaining, , , , , Status st, , ,) = core.hands(i);
            if (st != Status.Active) assertEq(remaining, 0, "settled hand holds escrow");
        }
    }
}
