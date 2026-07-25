// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: acceptance — the consent authorization matrix.
        Attribution modes per hop: anonymous (shaker == 0),
        self (shaker == the capability that SIGNED that hop's
        Shake, i.e. the parent capability), explicit (any other
        non-zero account, must co-sign a ShakerAcceptance).
        GiverAcceptance is ALWAYS required — even when the giver
        IS the terminal capability.
//////////////////////////////////////////////////////////////*/

contract AHandAcceptanceTest is AHandTestBase {
    function claimOf(address a) internal view returns (uint256) {
        return core.claims(address(usd), a);
    }

    /// @dev Route with a single default hop E0 -> E1 built by the caller,
    ///      settled to the default giver. Wraps the boilerplate around
    ///      per-test acceptance mutations.
    function thankExpecting(bytes4 err, uint256 h, RouteBuild memory r) internal {
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);
        vm.expectRevert(err);
        doThank(h, r, g, gs, ga);
    }

    /*──────────────── anonymous: zero shaker ────────────────*/

    /// Zero-margin anonymous hop is legal: no consent needed because nothing
    /// is attributed and nothing is paid.
    function test_Anonymous_ZeroMargin_Succeeds() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addAnonymousHop(r, h, E1, 10_000);
        settle(h, r);

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled));
        assertEq(claimOf(address(0)), 0, "nothing ever credited to zero");
        assertEq(claimOf(giver), 90e6, "full distributable to giver");
    }

    /// A paid hop must have a payable, attributed shaker.
    function test_Anonymous_WithMargin_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addAnonymousHop(r, h, E1, 9_000); // margin 10% with shaker == 0
        thankExpecting(AnonymousShakerWithMargin.selector, h, r);
    }

    /// Acceptance bytes on an anonymous hop are malformed input, whatever
    /// they contain.
    function test_Anonymous_RedundantAcceptance_UnexpectedAcceptance() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addAnonymousHop(r, h, E1, 10_000);
        r.acceptances[0] = hex"01";
        thankExpecting(UnexpectedAcceptance.selector, h, r);
    }

    /*──────────────── self: shaker == signing parent capability ────────────────*/

    /// The Shake signature IS the consent when the shaker is the signing
    /// capability itself: no acceptance, margin flows to that address.
    function test_Self_WithMargin_NoAcceptance_Succeeds() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 9_000); // shaker = vm.addr(E0), margin 10%
        settle(h, r);

        assertEq(claimOf(vm.addr(E0)), 9e6, "margin to the self-attributed capability");
        assertEq(claimOf(giver), 81e6, "giver residual");
    }

    /// Even a technically VALID acceptance signature is rejected on a self
    /// hop — the matrix is strict, not merely permissive.
    function test_Self_ValidRedundantAcceptance_UnexpectedAcceptance() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 9_000);
        r.acceptances[0] = signShakerAcceptance(E0, AHandSig.hashShake(r.shakes[0]));
        thankExpecting(UnexpectedAcceptance.selector, h, r);
    }

    /// "Self" means the PARENT capability that signed the hop. The child
    /// capability as shaker is a distinct account and therefore explicit:
    /// it must co-sign.
    function test_ChildAsShaker_IsExplicit_NeedsAcceptance() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addHop(r, h, E1, vm.addr(E1), 0, 9_000, defaultDeadline()); // shaker = child, no acceptance
        thankExpecting(ShakerAcceptanceInvalid.selector, h, r);

        RouteBuild memory ok = newRoute();
        addHop(ok, h, E1, vm.addr(E1), E1, 9_000, defaultDeadline()); // child co-signs
        settle(h, ok);
        assertEq(claimOf(vm.addr(E1)), 9e6, "margin to the consenting child account");
    }

    /*──────────────── explicit: distinct shaker must co-sign ────────────────*/

    function test_Explicit_WithMargin_ValidAcceptance_Succeeds() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_000);
        settle(h, r);

        assertEq(claimOf(shakerA), 9e6, "margin to the consenting shaker");
        assertEq(claimOf(giver), 81e6);
    }

    /// Attribution is consensual even when unpaid: a zero-margin explicit
    /// shaker still signs.
    function test_Explicit_ZeroMargin_ValidAcceptance_Succeeds() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 10_000);
        settle(h, r);

        assertEq(claimOf(shakerA), 0, "attributed but unpaid");
        assertEq(claimOf(giver), 90e6);
    }

    function test_Explicit_ZeroMargin_MissingAcceptance_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addHop(r, h, E1, shakerA, 0, 10_000, defaultDeadline()); // empty acceptance bytes
        thankExpecting(ShakerAcceptanceInvalid.selector, h, r);
    }

    function test_Explicit_WithMargin_MissingAcceptance_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addHop(r, h, E1, shakerA, 0, 9_000, defaultDeadline());
        thankExpecting(ShakerAcceptanceInvalid.selector, h, r);
    }

    function test_Explicit_GarbageAcceptance_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_000);
        r.acceptances[0] = hex"deadbeef";
        thankExpecting(ShakerAcceptanceInvalid.selector, h, r);
    }

    function test_Explicit_WrongSigner_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        // Acceptance over the right shakeHash but signed by shaker B for shaker A.
        addHop(r, h, E1, shakerA, SHAKER_B_PK, 9_000, defaultDeadline());
        thankExpecting(ShakerAcceptanceInvalid.selector, h, r);
    }

    function test_Explicit_WrongShakeHash_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_000);
        r.acceptances[0] = signShakerAcceptance(SHAKER_A_PK, keccak256("not this shake"));
        thankExpecting(ShakerAcceptanceInvalid.selector, h, r);
    }

    /// The shakeHash embeds the handId, so consent given on one hand can
    /// never authorize the structurally identical hop of another.
    function test_Explicit_ReplayFromOtherHand_Reverts() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        RouteBuild memory r1 = newRoute();
        addExplicitHop(r1, h1, E1, shakerA, SHAKER_A_PK, 9_000);

        RouteBuild memory r2 = newRoute();
        addExplicitHop(r2, h2, E1, shakerA, SHAKER_A_PK, 9_000);
        r2.acceptances[0] = r1.acceptances[0]; // consent replayed across hands
        thankExpecting(ShakerAcceptanceInvalid.selector, h2, r2);
    }

    /// Same shaker, same hand, different hop: the acceptance binds to one
    /// specific shakeHash and cannot migrate along the route.
    function test_Explicit_ReplayFromOtherHop_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_500);
        addExplicitHop(r, h, E2, shakerA, SHAKER_A_PK, 9_000);
        r.acceptances[1] = r.acceptances[0]; // hop 0 consent reused for hop 1
        thankExpecting(ShakerAcceptanceInvalid.selector, h, r);
    }

    /*──────────────── giver acceptance: always required ────────────────*/

    function test_GiverAcceptance_Missing_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        vm.expectRevert(GiverAcceptanceInvalid.selector);
        doThank(h, r, g, gs, "");
    }

    function test_GiverAcceptance_Garbage_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        vm.expectRevert(GiverAcceptanceInvalid.selector);
        doThank(h, r, g, gs, hex"33");
    }

    function test_GiverAcceptance_WrongSigner_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(SHAKER_A_PK, g); // not the giver's key
        vm.expectRevert(GiverAcceptanceInvalid.selector);
        doThank(h, r, g, gs, ga);
    }

    function test_GiverAcceptance_WrongGiveHash_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());

        // Deep copy — a memory struct assignment would alias g and corrupt the
        // submitted Give itself (failing earlier, at the give CapabilityProof).
        Give memory other = Give({
            handId: g.handId,
            routeHash: g.routeHash,
            giver: g.giver,
            solutionHash: keccak256("a different solution"),
            finalClaimBps: g.finalClaimBps,
            deadline: g.deadline
        });
        bytes memory ga = signGiverAcceptance(GIVER_PK, other); // right key, wrong giveHash
        vm.expectRevert(GiverAcceptanceInvalid.selector);
        doThank(h, r, g, gs, ga);
    }

    /// The giveHash embeds handId and routeHash: acceptance signed for one
    /// hand's Give never validates on another's.
    function test_GiverAcceptance_CrossHand_Reverts() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        RouteBuild memory r1 = newRoute();
        addSelfHop(r1, h1, E1, 10_000);
        (Give memory g1,) = buildGive(h1, r1, giver, defaultDeadline());

        RouteBuild memory r2 = newRoute();
        addSelfHop(r2, h2, E1, 10_000);
        (Give memory g2, bytes memory gs2) = buildGive(h2, r2, giver, defaultDeadline());

        bytes memory ga1 = signGiverAcceptance(GIVER_PK, g1);
        vm.expectRevert(GiverAcceptanceInvalid.selector);
        doThank(h2, r2, g2, gs2, ga1);
    }

    /// No self-mode shortcut for the giver: even when the giver IS the
    /// terminal capability, the acceptance must be present.
    function test_Giver_IsTerminalCapability_MissingAcceptance_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(); // zero-shake: terminal capability == root E0
        (Give memory g, bytes memory gs) = buildGive(h, r, vm.addr(E0), defaultDeadline());
        vm.expectRevert(GiverAcceptanceInvalid.selector);
        doThank(h, r, g, gs, "");
    }

    function test_Giver_IsTerminalCapability_WithAcceptance_Succeeds() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        (Give memory g, bytes memory gs) = buildGive(h, r, vm.addr(E0), defaultDeadline());
        bytes memory ga = signGiverAcceptance(E0, g); // same key signs Give AND acceptance
        doThank(h, r, g, gs, ga);

        assertEq(claimOf(vm.addr(E0)), 90e6, "residual to the capability-giver");
    }

    /*──────────────── margin flooring ────────────────*/

    /// A positive claim delta whose token allocation floors to zero is a
    /// malformed route: the hop would promise payment and deliver none.
    function test_MarginRoundsToZero_Reverts() public {
        RaiseParams memory p = defaultParams();
        p.amount = 10; // C = 1, D = 9: any margin < 1112 bps floors to zero
        uint256 h = makeRaise(p);

        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 9_999); // margin 1 bps -> floor(9 * 1 / 10000) == 0
        thankExpecting(MarginRoundsToZero.selector, h, r);
    }
}
