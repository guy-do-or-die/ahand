// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: windows — thank/reclaim boundaries, artifact
        deadlines, permissionless expiry settlement
//////////////////////////////////////////////////////////////*/

contract AHandWindowsTest is AHandTestBase {
    /*──────────────── smoke: simple thank happy path ────────────────*/

    /// One zero-margin self hop E0 -> E1: charity takes its cut, the giver
    /// residual absorbs the whole distributable pool. The full settlement
    /// matrix lives elsewhere — this is the base-fixture smoke.
    function test_Smoke_SimpleThank_SelfHop() public {
        uint256 h = makeRaise();
        uint256 charityBefore = usd.balanceOf(charity);
        uint256 giverBefore = usd.balanceOf(giver);
        settleSimple(h);

        Hand memory hand = core.getHand(h);
        assertEq(uint8(hand.status), uint8(Status.Settled));
        assertEq(hand.creditedReward, DEPOSIT, "snapshot never zeroed");
        assertTrue(hand.thankSignalSourceHash != bytes32(0), "commitment stored");

        // Hybrid push: allocations land directly in recipient wallets.
        uint256 charityPaid = usd.balanceOf(charity) - charityBefore;
        uint256 giverPaid = usd.balanceOf(giver) - giverBefore;
        assertEq(charityPaid, 10e6, "charity 10% pushed");
        assertEq(giverPaid, 90e6, "giver residual pushed");
        assertEq(charityPaid + giverPaid, uint256(DEPOSIT), "pushes conserve the pool");
        assertEq(core.claims(address(usd), charity), 0, "successful push leaves no claim");
        assertEq(core.claims(address(usd), giver), 0, "successful push leaves no claim");
    }

    /*──────────────── thank window: strictly before expiry ────────────────*/

    function test_Thank_AtExpiryMinusOne_Succeeds() public {
        uint256 h = makeRaise();
        uint40 expiry = core.getHand(h).expiry;
        vm.warp(expiry - 1);

        RouteBuild memory r = newRoute();
        addHop(r, h, E1, vm.addr(E0), 0, 10_000, expiry); // deadline == expiry is legal
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, expiry);
        doThank(h, r, g, gs, signGiverAcceptance(GIVER_PK, g));

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled), "last valid second");
    }

    /// Expiry itself belongs to reclaim: thank at exactly expiry is Expired.
    function test_Thank_AtExpiry_Expired() public {
        uint256 h = makeRaise();
        uint40 expiry = core.getHand(h).expiry;

        RouteBuild memory r = newRoute();
        addHop(r, h, E1, vm.addr(E0), 0, 10_000, expiry);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, expiry);
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.warp(expiry);
        vm.expectRevert(Expired.selector);
        doThank(h, r, g, gs, ga);
    }

    function test_Thank_AfterExpiry_Expired() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.warp(core.getHand(h).expiry + 3 days);
        vm.expectRevert(Expired.selector);
        doThank(h, r, g, gs, ga);
    }

    /*──────────────── reclaim window: at or after expiry ────────────────*/

    function test_Reclaim_AtExpiry_Succeeds() public {
        uint256 h = makeRaise();
        vm.warp(core.getHand(h).expiry); // first valid second
        core.reclaim(h);
        assertEq(uint8(core.getHand(h).status), uint8(Status.Reclaimed));
    }

    function test_Reclaim_BeforeExpiry_NotExpired() public {
        uint256 h = makeRaise();
        vm.warp(core.getHand(h).expiry - 1);
        vm.expectRevert(NotExpired.selector);
        core.reclaim(h);
    }

    /// Anyone may pay the finalization gas; the refund can only land on the
    /// raiser's claim. Events: Reclaimed then PayoutAllocated(RaiserRefund, pos 0).
    function test_Reclaim_PermissionlessByStranger() public {
        uint256 h = makeRaise();
        vm.warp(core.getHand(h).expiry);

        uint256 raiserBefore = usd.balanceOf(raiser);
        vm.expectEmit();
        emit AHandCore.Reclaimed(h, raiser, address(usd), DEPOSIT);
        vm.expectEmit();
        emit AHandCore.PayoutAllocated(h, address(usd), raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        vm.expectEmit();
        emit AHandCore.PayoutPushed(h, address(usd), raiser, DEPOSIT);
        vm.prank(stranger);
        core.reclaim(h);

        // Refund is pushed to the raiser's wallet, never the caller's.
        assertEq(usd.balanceOf(raiser) - raiserBefore, DEPOSIT, "refund to raiser, not caller");
        assertEq(core.claims(address(usd), raiser), 0, "successful push leaves no claim");
        assertEq(usd.balanceOf(stranger), 0, "caller earns nothing");
    }

    /// Success-only charity: expiry refunds the FULL pool, zero charity cut,
    /// and the Hand keeps its snapshot with no signal commitment.
    function test_Reclaim_FullRefund_ZeroCharity() public {
        uint256 h = makeRaise();
        uint256 raiserBefore = usd.balanceOf(raiser);
        vm.warp(core.getHand(h).expiry + 7 days);
        core.reclaim(h);

        Hand memory hand = core.getHand(h);
        assertEq(usd.balanceOf(raiser) - raiserBefore, hand.creditedReward, "full pool pushed to raiser");
        assertEq(core.claims(address(usd), raiser), 0, "successful push leaves no claim");
        assertEq(usd.balanceOf(charity), 0, "zero charity on reclaim");
        assertEq(hand.creditedReward, DEPOSIT, "snapshot intact");
        assertEq(hand.thankSignalSourceHash, bytes32(0), "stays zero on Reclaim");
    }

    /*──────────────── settle-once across the boundary ────────────────*/

    function test_Reclaim_Twice_NotActive() public {
        uint256 h = makeRaise();
        vm.warp(core.getHand(h).expiry);
        core.reclaim(h);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
    }

    function test_Reclaim_AfterThank_NotActive() public {
        uint256 h = makeRaise();
        settleSimple(h);
        vm.warp(core.getHand(h).expiry);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
    }

    /// Status gates before the clock: a reclaimed hand is NotActive to thank
    /// even though the window error would also apply.
    function test_Thank_AfterReclaim_NotActive() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.warp(core.getHand(h).expiry);
        core.reclaim(h);
        vm.expectRevert(NotActive.selector);
        doThank(h, r, g, gs, ga);
    }

    function test_Reclaim_UnknownHand_NotActive() public {
        vm.expectRevert(NotActive.selector);
        core.reclaim(999);
    }

    /*──────────────── shake deadlines ────────────────*/

    /// A hop deadline past the Hand expiry is malformed regardless of the
    /// clock: DeadlineExceedsExpiry.
    function test_ShakeDeadline_ExceedsExpiry() public {
        uint256 h = makeRaise();
        uint40 expiry = core.getHand(h).expiry;

        RouteBuild memory r = newRoute();
        addHop(r, h, E1, vm.addr(E0), 0, 10_000, expiry + 1);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.expectRevert(DeadlineExceedsExpiry.selector);
        doThank(h, r, g, gs, ga);
    }

    function test_ShakeDeadline_Passed_TicketExpired() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addHop(r, h, E1, vm.addr(E0), 0, 10_000, uint40(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 1 hours + 1); // now > deadline, still well before expiry
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.expectRevert(TicketExpired.selector);
        doThank(h, r, g, gs, ga);
    }

    /// now == deadline is the last valid second for a ticket (strict >).
    function test_ShakeDeadline_AtNow_Succeeds() public {
        uint256 h = makeRaise();
        uint40 deadline = uint40(block.timestamp + 1 hours);
        RouteBuild memory r = newRoute();
        addHop(r, h, E1, vm.addr(E0), 0, 10_000, deadline);
        vm.warp(deadline);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, deadline);
        doThank(h, r, g, gs, signGiverAcceptance(GIVER_PK, g));

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled));
    }

    /*──────────────── give deadlines ────────────────*/

    function test_GiveDeadline_ExceedsExpiry() public {
        uint256 h = makeRaise();
        uint40 expiry = core.getHand(h).expiry;

        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, expiry + 1);
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.expectRevert(DeadlineExceedsExpiry.selector);
        doThank(h, r, g, gs, ga);
    }

    function test_GiveDeadline_Passed_TicketExpired() public {
        uint256 h = makeRaise();
        uint40 expiry = core.getHand(h).expiry;

        RouteBuild memory r = newRoute();
        addHop(r, h, E1, vm.addr(E0), 0, 10_000, expiry); // hop ticket stays live
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, uint40(block.timestamp + 1 hours));
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(TicketExpired.selector);
        doThank(h, r, g, gs, ga);
    }
}
