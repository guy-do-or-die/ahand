// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {stdError} from "forge-std/StdError.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {AHandTestBase} from "./AHandTestBase.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {
    AllocationKind,
    GiverAcceptanceInvalid,
    Hand,
    HandExpired,
    HandNotExpired,
    IAHandFacts,
    InsufficientGas,
    NotActive,
    RaiseParams,
    Status,
    Terminal,
    TransferInexact,
    ZeroClaim
} from "../src/AHandTypes.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {PausableToken} from "./mocks/PausableToken.sol";
import {HookToken} from "./mocks/HookToken.sol";
import {TransferThenFalseToken} from "./mocks/ReturnShapeTokens.sol";
import {LateSenderFeeToken} from "./mocks/FeeTokens.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: exit — reclaim, expiry and withdraw (DESIGN §8; I-1, I-2, I-10).

        Reclaim: the second terminal transition. Permissionless, at or after
        expiry only, refund destination fixed to the stored raiser, 100 % of the
        pool with no charity, no settlementHash, closedAt set. Terminal once in
        either direction; the status check precedes the clock, so the loser of
        the expiry race always sees NotActive.

        Withdraw: the exit for deferred value. Whole aggregate claim, fixed
        destination, anyone pays the gas, zeroed before the transfer, and the
        whole call reverts (restoring the claim) on every failure shape —
        bubbled token revert, SafeERC20FailedOperation, TransferInexact,
        ReentrancyGuardReentrantCall. The two documented stops (a token that
        blocks the beneficiary; a token that turns a sender fee on after entry)
        are asserted as outcomes, not hidden.
//////////////////////////////////////////////////////////////*/

contract AHandV2ExitTest is AHandTestBase {
    /// @dev Every hop of the long route delegates to vm.addr(LONG_ROUTE_PK_BASE + i).
    uint256 constant LONG_ROUTE_PK_BASE = 0xC000;

    /*//////////////////// fixtures ////////////////////*/

    /// @dev A Hand escrowed in `bl` with its raiser blocked: the reclaim refund
    ///      is guaranteed to park as `claims[bl][raiser]`.
    function raiseDeferredRefund(BlacklistToken bl) internal returns (uint256 h) {
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        h = makeRaise();
        bl.setBlocked(raiser, true);
        warpToExpiry(h);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(claimOf(address(bl), raiser), DEPOSIT, "fixture: refund parked");
    }

    /// @dev A Hand escrowed in `hk` whose raiser is hooked: HookToken calls
    ///      `onTokenReceived` on a hooked recipient, and a hooked EOA has no code
    ///      to answer, so the token's own call reverts and the refund parks. The
    ///      hook is removed again so the token is plain for the withdraw under test.
    function raiseDeferredRefundHooked(HookToken hk) internal returns (uint256 h) {
        useToken(address(hk));
        fund(address(hk), raiser, 1_000e6);
        h = makeRaise();
        hk.setHooked(raiser, true);
        warpToExpiry(h);
        core.reclaim(h);
        assertEq(claimOf(address(hk), raiser), DEPOSIT, "fixture: refund parked");
        hk.setHooked(raiser, false);
    }

    /// @dev A valid `n`-hop zero-margin self route rooted at E0.
    function longRoute(uint256 h, uint256 n) internal view returns (RouteBuild memory r) {
        r = newRoute(h);
        for (uint256 i; i < n; ++i) {
            addSelfHop(r, LONG_ROUTE_PK_BASE + i, 10_000);
        }
    }

    /*//////////////////////////////////////////////////////////
                    reclaim window (I-2): now ≥ expiry
    //////////////////////////////////////////////////////////*/

    function test_Reclaim_AtExpiryMinusOne_HandNotExpired() public {
        uint256 h = makeRaise();
        vm.warp(core.facts(h).expiry - 1);
        vm.expectRevert(HandNotExpired.selector);
        core.reclaim(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Active), "still Active");
    }

    /// Expiry itself is the first reclaimable second.
    function test_Reclaim_AtExpiry_Succeeds() public {
        uint256 h = makeRaise();
        uint40 expiry = core.facts(h).expiry;
        vm.warp(expiry);
        core.reclaim(h);
        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Reclaimed));
        assertEq(f.closedAt, expiry, "closedAt == the reclaim timestamp");
    }

    function test_Reclaim_LongAfterExpiry_Succeeds() public {
        uint256 h = makeRaise();
        uint256 raiserBefore = balanceOf(address(usd), raiser);
        vm.warp(core.facts(h).expiry + 400 days);
        core.reclaim(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Reclaimed));
        assertEq(balanceOf(address(usd), raiser) - raiserBefore, DEPOSIT, "refund is never forfeited by lateness");
    }

    /// The window is a single final timestamp: strictly before it reclaim is
    /// HandNotExpired, from it on reclaim succeeds and records that very second.
    function testFuzz_Reclaim_Window(uint256 when) public {
        uint256 h = makeRaise();
        uint40 expiry = core.facts(h).expiry;
        when = bound(when, block.timestamp, uint256(expiry) + 400 days);
        vm.warp(when);
        if (when < expiry) {
            vm.expectRevert(HandNotExpired.selector);
            core.reclaim(h);
            assertEq(uint8(statusOf(h)), uint8(Status.Active));
        } else {
            core.reclaim(h);
            IAHandFacts.HandFacts memory f = core.facts(h);
            assertEq(uint8(f.status), uint8(Status.Reclaimed));
            assertEq(f.closedAt, uint40(when));
        }
    }

    /*//////////////////////////////////////////////////////////
          reclaim authority and destination (I-10): anyone calls,
          only h.raiser is refunded
    //////////////////////////////////////////////////////////*/

    /// A stranger pays the gas; the refund lands on the raiser's wallet in one
    /// push. Events in order: Reclaimed, PayoutAllocated(RaiserRefund, 0, P),
    /// PayoutPushed(RaiserRefund, 0, P).
    function test_Reclaim_ByStranger_RefundsRaiserInFull() public {
        uint256 h = makeRaise();
        warpToExpiry(h);
        uint256 raiserBefore = balanceOf(address(usd), raiser);

        vm.expectEmit(address(core));
        emit AHandCore.Reclaimed(h, raiser, address(usd), DEPOSIT);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutAllocated(h, address(usd), raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h, address(usd), raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        vm.prank(stranger);
        core.reclaim(h);

        assertEq(balanceOf(address(usd), raiser) - raiserBefore, DEPOSIT, "100 % to the raiser");
        assertEq(balanceOf(address(usd), stranger), 0, "the caller earns nothing");
        assertEq(claimOf(address(usd), raiser), 0, "a delivered push leaves no claim");
        assertEq(balanceOf(address(usd), address(core)), 0, "custody drained of this Hand");
    }

    /// Any account may finalize an expired Hand — including the raiser — and the
    /// destination never follows the caller.
    function testFuzz_Reclaim_AnyCaller_DestinationIsRaiser(address caller) public {
        vm.assume(caller != raiser);
        uint256 h = makeRaise();
        warpToExpiry(h);
        uint256 raiserBefore = balanceOf(address(usd), raiser);
        uint256 callerBefore = balanceOf(address(usd), caller);

        vm.prank(caller);
        core.reclaim(h);

        assertEq(balanceOf(address(usd), raiser) - raiserBefore, DEPOSIT);
        assertEq(balanceOf(address(usd), caller), callerBefore, "caller balance unchanged");
        assertEq(claimOf(address(usd), caller), 0, "no claim keyed on the caller");
    }

    /// Success-only donation: the full pool refunds, the charity sees nothing,
    /// the pool stays recorded, settlementHash stays zero, closedAt is set.
    function test_Reclaim_FullRefund_NoCharity_FactsShape() public {
        uint256 h = makeRaise();
        uint256 charityBefore = balanceOf(address(usd), charity);
        vm.warp(core.facts(h).expiry + 7 days);
        uint40 when = uint40(vm.getBlockTimestamp());
        core.reclaim(h);

        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Reclaimed));
        assertEq(f.pool, DEPOSIT, "pool never zeroed; liability keys on status");
        assertEq(f.settlementHash, bytes32(0), "settlementHash != 0 iff Settled");
        assertEq(f.closedAt, when, "closedAt != 0 iff terminal");
        assertEq(balanceOf(address(usd), charity), charityBefore, "zero charity on reclaim");
        assertEq(claimOf(address(usd), charity), 0, "no charity claim either");

        Hand memory hand = core.getHand(h);
        assertEq(uint8(hand.status), uint8(f.status));
        assertEq(hand.closedAt, f.closedAt, "getHand and facts agree");
        assertEq(hand.settlementHash, bytes32(0));
    }

    /// A zero-pot Hand flips status and closedAt only: no token call, no payout
    /// events — exactly one log, `Reclaimed` with a zero token and zero refund.
    function test_Reclaim_ZeroPot_FlipsStatusOnly() public {
        uint256 h = makeRaise(zeroPotParams());
        warpToExpiry(h);

        vm.recordLogs();
        core.reclaim(h);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 1, "Reclaimed only");
        assertEq(logs[0].emitter, address(core));
        assertEq(logs[0].topics[0], AHandCore.Reclaimed.selector);
        assertEq(logs[0].topics[1], bytes32(h));
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(raiser))));
        (address tokenLogged, uint256 refund) = abi.decode(logs[0].data, (address, uint256));
        assertEq(tokenLogged, address(0));
        assertEq(refund, 0);

        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Reclaimed));
        assertEq(f.closedAt, uint40(vm.getBlockTimestamp()));
    }

    /// A deferred refund is keyed on the raiser, never on the caller, with the
    /// RaiserRefund kind at position 0.
    function test_Reclaim_BlockedRaiser_RefundParksOnRaiser() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h = makeRaise();
        bl.setBlocked(raiser, true);
        warpToExpiry(h);

        vm.expectEmit(address(core));
        emit AHandCore.PayoutAllocated(h, address(bl), raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(bl), raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        vm.prank(stranger);
        core.reclaim(h);

        assertEq(uint8(statusOf(h)), uint8(Status.Reclaimed), "the Hand is terminal regardless of delivery");
        assertEq(claimOf(address(bl), raiser), DEPOSIT, "parked on the raiser");
        assertEq(claimOf(address(bl), stranger), 0, "nothing on the caller");
        assertEq(balanceOf(address(bl), address(core)), DEPOSIT, "custody == the parked claim");
    }

    /// I-9 on the reclaim side: a stranger cannot park the raiser's refund by
    /// calling with too little gas — the whole call reverts, nothing is deferred,
    /// the Hand stays Active, and a properly funded call then pushes.
    function test_Reclaim_LowGas_InsufficientGas_NothingParked() public {
        uint256 h = makeRaise();
        warpToExpiry(h);

        vm.prank(stranger);
        vm.expectRevert(InsufficientGas.selector);
        core.reclaim{gas: 150_000}(h);

        assertEq(uint8(statusOf(h)), uint8(Status.Active), "the guard reverts the whole transition");
        assertEq(claimOf(address(usd), raiser), 0, "nothing parked");

        uint256 raiserBefore = balanceOf(address(usd), raiser);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(balanceOf(address(usd), raiser) - raiserBefore, DEPOSIT, "pushed once funded");
    }

    /*//////////////////////////////////////////////////////////
                  terminal once (I-1): the two terminals exclude
                  each other, and status gates before the clock
    //////////////////////////////////////////////////////////*/

    function test_Reclaim_Twice_NotActive() public {
        uint256 h = makeRaise();
        warpToExpiry(h);
        core.reclaim(h);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
    }

    /// No reclaim after settle — before expiry (NotActive, not HandNotExpired:
    /// the status check comes first) and at expiry alike.
    function test_Reclaim_AfterThank_NotActive() public {
        uint256 h = makeRaise();
        settleSimple(h);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
        warpToExpiry(h);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "stays Settled");
    }

    /// No thank after reclaim: a reclaimed Hand answers NotActive to thank even
    /// though the window error would also apply.
    function test_Thank_AfterReclaim_NotActive() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r);

        warpToExpiry(h);
        core.reclaim(h);
        expectThankRevert(abi.encodeWithSelector(NotActive.selector), r, t);
        assertEq(core.facts(h).settlementHash, bytes32(0), "never settled");
    }

    function test_Reclaim_UnknownHand_NotActive() public {
        vm.expectRevert(NotActive.selector);
        core.reclaim(0);
        vm.expectRevert(NotActive.selector);
        core.reclaim(999);
    }

    /*//////////////////////////////////////////////////////////
                    closedAt on both terminals
    //////////////////////////////////////////////////////////*/

    function test_ClosedAt_ZeroWhileActive_SetByThank() public {
        uint256 h = makeRaise();
        assertEq(core.facts(h).closedAt, 0, "zero while Active");
        assertEq(core.facts(h).settlementHash, bytes32(0));

        vm.warp(vm.getBlockTimestamp() + 3 days);
        uint40 when = uint40(vm.getBlockTimestamp());
        settleSimple(h);

        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Settled));
        assertEq(f.closedAt, when, "closedAt == the thank timestamp, not expiry");
        assertTrue(f.settlementHash != bytes32(0), "settlementHash set by thank");
        assertEq(core.getHand(h).closedAt, when);
    }

    function test_ClosedAt_SetByReclaim_NoSettlementHash() public {
        uint256 h = makeRaise();
        vm.warp(core.facts(h).expiry + 12 hours);
        uint40 when = uint40(vm.getBlockTimestamp());
        core.reclaim(h);

        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Reclaimed));
        assertEq(f.closedAt, when, "closedAt == the reclaim timestamp");
        assertEq(f.settlementHash, bytes32(0), "stays zero on reclaim");
        assertEq(core.getHand(h).closedAt, when);
    }

    /*//////////////////////////////////////////////////////////
                    the expiry race (I-2): same block, two callers
    //////////////////////////////////////////////////////////*/

    /// At expiry − 1 the block belongs to thank: reclaim loses with
    /// HandNotExpired, thank wins, and a reclaim in the same block then sees
    /// NotActive.
    function test_Race_BlockBeforeExpiry_ThankWins() public {
        uint256 h = makeRaise();
        uint40 expiry = core.facts(h).expiry;
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, vm.addr(E0), 0, 10_000, expiry); // deadline == expiry is legal
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, expiry);

        vm.warp(expiry - 1);
        vm.prank(stranger);
        vm.expectRevert(HandNotExpired.selector);
        core.reclaim(h);

        doThank(r, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "thank in the last valid second");

        vm.prank(stranger);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
    }

    /// At expiry the block belongs to reclaim: thank loses with HandExpired,
    /// reclaim wins, and a thank in the same block then sees NotActive.
    function test_Race_BlockAtExpiry_ReclaimWins() public {
        uint256 h = makeRaise();
        uint40 expiry = core.facts(h).expiry;
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, vm.addr(E0), 0, 10_000, expiry);
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, expiry);

        vm.warp(expiry);
        expectThankRevert(abi.encodeWithSelector(HandExpired.selector), r, t);

        uint256 raiserBefore = balanceOf(address(usd), raiser);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(balanceOf(address(usd), raiser) - raiserBefore, DEPOSIT, "refund in the first reclaimable second");

        expectThankRevert(abi.encodeWithSelector(NotActive.selector), r, t);
        assertEq(balanceOf(address(usd), giver), 0, "the giver is never paid after reclaim");
    }

    /*//////////////////////////////////////////////////////////
          reclaim is O(1): a failed long thank leaves no trace
    //////////////////////////////////////////////////////////*/

    /// A 257-hop route that fails on the very last check (the giver's
    /// acceptance) burns the submitter's gas and nothing else: no Hand write, no
    /// claim, and the reclaim that follows costs no more than the reclaim of a
    /// Hand that never saw a thank attempt. (The fresh Hand is reclaimed first,
    /// so the long Hand's reclaim runs with warm token slots — a route-sized cost
    /// would still be hundreds of thousands of gas away.)
    function test_Reclaim_AfterFailed257HopThank_IsO1() public {
        uint256 hFresh = makeRaise();
        uint256 hLong = makeRaise();

        RouteBuild memory r = longRoute(hLong, 257);
        Terminal memory t = buildTerminal(r, giver, 0, DEFAULT_SOLUTION, defaultDeadline()); // no acceptance
        expectThankRevert(abi.encodeWithSelector(GiverAcceptanceInvalid.selector), r, t);

        IAHandFacts.HandFacts memory f = core.facts(hLong);
        assertEq(uint8(f.status), uint8(Status.Active), "the failed thank wrote nothing");
        assertEq(f.closedAt, 0);
        assertEq(f.settlementHash, bytes32(0));
        assertEq(claimOf(address(usd), giver), 0);

        warpToExpiry(hLong);
        uint256 gasFresh = measureReclaim(core, stranger, hFresh);
        uint256 gasLong = measureReclaim(core, stranger, hLong);

        assertLe(gasLong, gasFresh, "reclaim cost is independent of the route attempted");
        assertLt(gasLong, 100_000, "reclaim is a constant-size transition");
        assertEq(uint8(statusOf(hLong)), uint8(Status.Reclaimed));
        assertEq(balanceOf(address(usd), raiser), 1_000_000e6, "both pools back in full");
    }

    /*//////////////////////////////////////////////////////////
          withdraw: whole claim, fixed destination, anyone pays
    //////////////////////////////////////////////////////////*/

    function test_Withdraw_WholeClaim_FixedDestination_StrangerPays() public {
        BlacklistToken bl = new BlacklistToken();
        uint256 h = raiseDeferredRefund(bl);
        bl.setBlocked(raiser, false);
        uint256 raiserBefore = balanceOf(address(bl), raiser);

        vm.expectEmit(address(core));
        emit AHandCore.PayoutWithdrawn(address(bl), raiser, DEPOSIT);
        vm.prank(stranger);
        core.withdraw(address(bl), raiser);

        assertEq(balanceOf(address(bl), raiser) - raiserBefore, DEPOSIT, "whole claim to the beneficiary");
        assertEq(balanceOf(address(bl), stranger), 0, "the payer cannot redirect");
        assertEq(claimOf(address(bl), raiser), 0, "ledger zeroed");
        assertEq(balanceOf(address(bl), address(core)), 0, "custody drained");
        assertEq(core.facts(h).pool, DEPOSIT, "the Hand's record is untouched by the ledger");
    }

    /// Any raise amount parks whole and withdraws whole: one claim, one transfer.
    function testFuzz_Withdraw_WholeClaim_AnyAmount(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, amount);
        RaiseParams memory p = noCharityParams();
        p.amount = amount;
        uint256 h = makeRaise(p);

        bl.setBlocked(raiser, true);
        warpToExpiry(h);
        core.reclaim(h);
        assertEq(claimOf(address(bl), raiser), amount);

        bl.setBlocked(raiser, false);
        core.withdraw(address(bl), raiser);
        assertEq(balanceOf(address(bl), raiser), amount, "exact");
        assertEq(claimOf(address(bl), raiser), 0);
    }

    /// `claims[token][beneficiary]` aggregates across Hands: two deferred refunds
    /// become one claim and one transfer.
    function test_Withdraw_AggregatesAcrossHands() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();
        bl.setBlocked(raiser, true);
        warpToExpiry(h2);
        core.reclaim(h1);
        core.reclaim(h2);
        assertEq(claimOf(address(bl), raiser), 2 * DEPOSIT, "deferred refunds aggregate");

        bl.setBlocked(raiser, false);
        uint256 before = balanceOf(address(bl), raiser);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutWithdrawn(address(bl), raiser, 2 * DEPOSIT);
        core.withdraw(address(bl), raiser);
        assertEq(balanceOf(address(bl), raiser) - before, 2 * DEPOSIT, "one transfer, full sum");
        assertEq(balanceOf(address(bl), address(core)), 0);
    }

    /// Aggregation is per (token, beneficiary), not per kind: a charity share
    /// deferred by a thank and a refund deferred by a reclaim (the same account
    /// raised the second Hand) land in one claim; per-Hand attribution is in the
    /// PayoutDeferred events, not in the ledger.
    function test_Withdraw_AggregatesAcrossKinds() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        fund(address(bl), charity, 1_000e6);
        uint256 hThank = makeRaise();
        uint256 hRefund = makeRaiseAs(charity, core, defaultParams(), DEFAULT_REF, noTags());

        bl.setBlocked(charity, true);
        settleSimple(hThank); // charity's 10e6 defers; the giver's 90e6 pushes
        warpToExpiry(hRefund);
        core.reclaim(hRefund); // charity's own refund defers
        assertEq(claimOf(address(bl), charity), 10e6 + DEPOSIT, "Charity + RaiserRefund in one claim");
        assertEq(balanceOf(address(bl), giver), 90e6, "unrelated pushes delivered");

        bl.setBlocked(charity, false);
        core.withdraw(address(bl), charity);
        assertEq(balanceOf(address(bl), charity), 1_000e6 - DEPOSIT + 10e6 + DEPOSIT, "whole aggregate");
        assertEq(claimOf(address(bl), charity), 0);
    }

    /// Claims are keyed per token: two blocked refunds in two tokens are two
    /// claims, drained independently; a third token with a delivered push holds
    /// nothing.
    function test_Withdraw_MultiToken_ClaimsIndependent() public {
        BlacklistToken blA = new BlacklistToken();
        BlacklistToken blB = new BlacklistToken();
        fund(address(blA), raiser, 1_000e6);
        fund(address(blB), raiser, 1_000e6);
        useToken(address(blA));
        uint256 hA = makeRaise();
        useToken(address(blB));
        uint256 hB = makeRaise();
        useToken(address(usd));
        uint256 hU = makeRaise();

        blA.setBlocked(raiser, true);
        blB.setBlocked(raiser, true);
        warpToExpiry(hU);
        core.reclaim(hA);
        core.reclaim(hB);
        core.reclaim(hU);
        assertEq(claimOf(address(blA), raiser), DEPOSIT);
        assertEq(claimOf(address(blB), raiser), DEPOSIT);
        assertEq(claimOf(address(usd), raiser), 0, "pushed, never parked");

        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), raiser);

        blA.setBlocked(raiser, false);
        core.withdraw(address(blA), raiser);
        assertEq(claimOf(address(blA), raiser), 0);
        assertEq(claimOf(address(blB), raiser), DEPOSIT, "the other token's claim is untouched");
        assertEq(balanceOf(address(blB), address(core)), DEPOSIT);

        vm.expectRevert(bytes("BLACKLISTED"));
        core.withdraw(address(blB), raiser);
        blB.setBlocked(raiser, false);
        core.withdraw(address(blB), raiser);
        assertEq(balanceOf(address(blB), raiser), 1_000e6);
    }

    /*//////////////////////////////////////////////////////////
                              ZeroClaim
    //////////////////////////////////////////////////////////*/

    function test_Withdraw_NoClaim_ZeroClaim() public {
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), stranger);
    }

    /// Nothing is ever credited to the zero beneficiary; the same guard covers it.
    function test_Withdraw_ZeroBeneficiary_ZeroClaim() public {
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), address(0));
    }

    /// An unknown token — even a codeless address — fails on the ledger read,
    /// before any call.
    function test_Withdraw_UnknownToken_ZeroClaim() public {
        BlacklistToken bl = new BlacklistToken();
        raiseDeferredRefund(bl);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(0xdead), raiser);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(0), raiser);
    }

    function test_Withdraw_SuccessfulPush_LeavesNoClaim() public {
        uint256 h = makeRaise();
        settleSimple(h);
        assertEq(claimOf(address(usd), giver), 0);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), giver);
    }

    function test_Withdraw_Twice_ZeroClaim() public {
        BlacklistToken bl = new BlacklistToken();
        raiseDeferredRefund(bl);
        bl.setBlocked(raiser, false);
        core.withdraw(address(bl), raiser);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(bl), raiser);
    }

    /*//////////////////////////////////////////////////////////
                  zeroed before transfer; re-entry is locked
    //////////////////////////////////////////////////////////*/

    /// The token's `transfer` hook reads `claims` mid-withdraw and sees zero:
    /// the ledger is written before the first external call.
    function test_Withdraw_ClaimZeroedBeforeTransfer() public {
        HookToken hk = new HookToken();
        raiseDeferredRefundHooked(hk);
        hk.setReentry(address(core), abi.encodeCall(core.claims, (address(hk), raiser)), false, true, true);

        core.withdraw(address(hk), raiser);

        assertTrue(hk.lastReentryOk(), "the view call went through");
        assertEq(abi.decode(hk.lastReentryReturn(), (uint256)), 0, "claim already zero during the transfer");
        assertEq(balanceOf(address(hk), raiser), 1_000e6, "and the transfer landed");
    }

    /// A re-entering `withdraw` from inside the token's `transfer` hits the lock;
    /// the token bubbles that revert, so the outer withdraw reverts
    /// ReentrancyGuardReentrantCall and the claim is restored intact.
    function test_Withdraw_ReenterWithdraw_ReentrancyGuardReentrantCall() public {
        HookToken hk = new HookToken();
        raiseDeferredRefundHooked(hk);
        hk.setReentry(address(core), abi.encodeCall(AHandCore.withdraw, (address(hk), raiser)), false, true, true);

        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        core.withdraw(address(hk), raiser);

        assertEq(claimOf(address(hk), raiser), DEPOSIT, "the revert restores the claim");
        assertEq(balanceOf(address(hk), address(core)), DEPOSIT, "nothing moved");

        hk.setReentry(address(0), "", false, false, false);
        core.withdraw(address(hk), raiser);
        assertEq(balanceOf(address(hk), raiser), 1_000e6, "drains once the token behaves");
    }

    /// The lock covers every entry point: a `reclaim` of another expired Hand
    /// attempted from inside a withdraw's transfer is refused. When the token
    /// swallows that failure the outer withdraw completes; the other Hand is
    /// untouched and the recorded answer is the lock's error.
    function test_Withdraw_ReenterReclaim_Locked_OtherHandUntouched() public {
        HookToken hk = new HookToken();
        raiseDeferredRefundHooked(hk);
        uint256 hOther = makeRaise(); // already past its raise time; expiry is 30 days from now
        warpToExpiry(hOther);
        hk.setReentry(address(core), abi.encodeCall(AHandCore.reclaim, (hOther)), false, true, false);

        core.withdraw(address(hk), raiser);

        assertFalse(hk.lastReentryOk(), "re-entry refused");
        assertEq(
            hk.lastReentryReturn(),
            abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector),
            "by the transient lock"
        );
        assertEq(uint8(statusOf(hOther)), uint8(Status.Active), "the other Hand is still Active");
        assertEq(claimOf(address(hk), raiser), 0, "the outer withdraw completed");
        assertEq(balanceOf(address(hk), raiser), 1_000e6 - DEPOSIT, "its transfer landed");
    }

    /*//////////////////////////////////////////////////////////
          withdraw reverts whole on every failure shape, claim restored
    //////////////////////////////////////////////////////////*/

    /// A reverting token bubbles its own data; the claim survives and the same
    /// call drains once the token allows it.
    function test_Withdraw_TokenReverts_BubblesAndRestoresClaim() public {
        BlacklistToken bl = new BlacklistToken();
        raiseDeferredRefund(bl);

        vm.expectRevert(bytes("BLACKLISTED"));
        core.withdraw(address(bl), raiser);
        assertEq(claimOf(address(bl), raiser), DEPOSIT, "claim intact");
        assertEq(balanceOf(address(bl), address(core)), DEPOSIT, "custody intact");

        bl.setBlocked(raiser, false);
        core.withdraw(address(bl), raiser);
        assertEq(balanceOf(address(bl), raiser), 1_000e6, "retry pays in full");
    }

    /// S1: a token that MOVES the funds and then returns false. Inside the push
    /// frame the false word reverts the frame, so nothing stays moved and exactly
    /// the share parks; the top-level withdraw reverts SafeERC20FailedOperation
    /// with the claim and custody intact.
    function test_Withdraw_TransferThenFalse_SafeERC20FailedOperation() public {
        TransferThenFalseToken ttf = new TransferThenFalseToken();
        useToken(address(ttf));
        fund(address(ttf), raiser, 1_000e6);
        uint256 h = makeRaise();
        ttf.setFalseTo(giver, true);

        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(ttf), giver, AllocationKind.GiverResidual, 0, 90e6);
        settleSimple(h);
        assertEq(balanceOf(address(ttf), giver), 0, "the frame rolled the move back");
        assertEq(balanceOf(address(ttf), charity), 10e6, "the honest push landed");
        assertEq(claimOf(address(ttf), giver), 90e6, "exactly the share parked");
        assertEq(balanceOf(address(ttf), address(core)), 90e6, "custody == the claim");

        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(ttf)));
        core.withdraw(address(ttf), giver);
        assertEq(claimOf(address(ttf), giver), 90e6, "claim restored by the revert");
        assertEq(balanceOf(address(ttf), giver), 0, "and no funds leaked");

        ttf.setFalseTo(giver, false);
        core.withdraw(address(ttf), giver);
        assertEq(balanceOf(address(ttf), giver), 90e6);
    }

    /// Total stop (a): a sender-side fee switched on AFTER entry. The refund of
    /// the first Hand debits custody inexactly (the neighbour's escrow is what
    /// makes the delta inexact rather than an underflow), so the push defers; the
    /// withdraw reverts TransferInexact; the second refund parks too, and the
    /// aggregate withdraw fails on the token's own arithmetic. 100 % of that
    /// token's escrow stays in Core; nobody exits. Asserted as the documented
    /// outcome, confined to the token: the fee going off again frees everything.
    function test_Withdraw_LateSenderFee_RefundParksAndIsStuck_TotalStop() public {
        LateSenderFeeToken late = new LateSenderFeeToken();
        useToken(address(late));
        fund(address(late), raiser, 1_000e6);
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();
        late.setFeeOn(true);
        warpToExpiry(h2);

        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h1, address(late), raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        core.reclaim(h1);
        assertEq(uint8(statusOf(h1)), uint8(Status.Reclaimed));
        assertEq(claimOf(address(late), raiser), DEPOSIT, "refund parked");
        assertEq(balanceOf(address(late), address(core)), 2 * DEPOSIT, "frame rolled back: both pools intact");

        vm.expectRevert(TransferInexact.selector);
        core.withdraw(address(late), raiser);
        assertEq(claimOf(address(late), raiser), DEPOSIT, "claim restored");
        assertEq(balanceOf(address(late), address(core)), 2 * DEPOSIT, "custody untouched");

        core.reclaim(h2);
        assertEq(claimOf(address(late), raiser), 2 * DEPOSIT, "second refund parked too");

        // custody == claims == 200e6; the fee needs 220e6: the token's own underflow bubbles
        vm.expectRevert(stdError.arithmeticError);
        core.withdraw(address(late), raiser);
        assertEq(claimOf(address(late), raiser), 2 * DEPOSIT, "stuck, nominal number intact");
        assertEq(balanceOf(address(late), raiser), 1_000e6 - 2 * DEPOSIT, "the raiser got nothing back");

        late.setFeeOn(false);
        core.withdraw(address(late), raiser);
        assertEq(balanceOf(address(late), raiser), 1_000e6, "the stop was the token's, not Core's");
    }

    /// Total stop (b), the pause flavour: a token paused after entry parks the
    /// refund and refuses the withdraw with its own reason; unpausing frees it.
    function test_Withdraw_PausedToken_RefundParksUntilUnpaused() public {
        PausableToken pt = new PausableToken();
        useToken(address(pt));
        fund(address(pt), raiser, 1_000e6);
        uint256 h = makeRaise();
        pt.setPaused(true);
        warpToExpiry(h);

        core.reclaim(h);
        assertEq(claimOf(address(pt), raiser), DEPOSIT, "refund parked under pause");

        vm.expectRevert(bytes("PAUSED"));
        core.withdraw(address(pt), raiser);
        assertEq(claimOf(address(pt), raiser), DEPOSIT);

        pt.setPaused(false);
        core.withdraw(address(pt), raiser);
        assertEq(balanceOf(address(pt), raiser), 1_000e6);
    }

    /// Known limitation, asserted: a beneficiary the token blocks stays
    /// unwithdrawable for as long as the block lasts; there is no redirect, no
    /// rescue and no way for anyone else to take the claim.
    function test_Withdraw_BlacklistedBeneficiary_StaysStuck_NoRedirect() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h = makeRaise();
        bl.setBlocked(giver, true);
        settleSimple(h);
        assertEq(claimOf(address(bl), giver), 90e6, "residual parked");

        vm.expectRevert(bytes("BLACKLISTED"));
        core.withdraw(address(bl), giver);
        vm.prank(giver);
        vm.expectRevert(bytes("BLACKLISTED"));
        core.withdraw(address(bl), giver);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(bl), stranger);
        vm.prank(policyAdmin);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(bl), policyAdmin);

        assertEq(claimOf(address(bl), giver), 90e6, "stranded, nominal number intact");
        assertEq(balanceOf(address(bl), address(core)), 90e6, "custody holds exactly the claim");
    }

    /*//////////////////////////////////////////////////////////
                    no periphery is needed for any exit
    //////////////////////////////////////////////////////////*/

    /// A Core deployed alone with a plain token raises, reclaims and withdraws
    /// with no other contract in the picture: every log comes from the Core or
    /// the token.
    function test_Exit_WorksWithNoPeripheryDeployed() public {
        MockUSD solo = new MockUSD();
        AHandCore lone = deployCore(charity, policyAdmin);
        fundFor(lone, address(solo), raiser, 1_000e6);
        useToken(address(solo));
        uint256 h = makeRaiseAs(raiser, lone, defaultParams(), DEFAULT_REF, noTags());
        vm.warp(lone.facts(h).expiry);

        vm.recordLogs();
        vm.prank(stranger);
        lone.reclaim(h);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertTrue(logs.length > 0);
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter == address(lone) || logs[i].emitter == address(solo), "Core and token only");
        }
        assertEq(uint8(lone.facts(h).status), uint8(Status.Reclaimed));
        assertEq(solo.balanceOf(raiser), 1_000e6, "refunded through Core alone");
        vm.expectRevert(ZeroClaim.selector);
        lone.withdraw(address(solo), raiser);
    }
}
