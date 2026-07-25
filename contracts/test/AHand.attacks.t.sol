// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: attacks — adversarial route construction.
        Adapted from the pre-revamp suite: the surviving families
        are truncation (trio), mid-chain start, telescopic claim
        forgery, deadline abuse, malleability, settle-once, route
        binding via routeHash, escrow bookkeeping, and the
        self-insertion coalition bound.
//////////////////////////////////////////////////////////////*/

contract AHandAttacksTest is AHandTestBase {
    uint256 constant THIEF_PK = 0x7EEFaa;
    address thief;

    function setUp() public override {
        super.setUp();
        thief = vm.addr(THIEF_PK);
    }

    function claimOf(address a) internal view returns (uint256) {
        return core.claims(address(usd), a);
    }

    /// @dev Where settled value now lands: a residual/margin captured by an
    ///      address is a push to its wallet, not a claims entry (MockUSD never
    ///      defers). Same amounts as the pre-hybrid claims, different destination.
    function paidOf(address a) internal view returns (uint256) {
        return usd.balanceOf(a);
    }

    /// Canonical honest chain: root E0 -> E1 (shaker A, margin 10%)
    /// -> E2 (shaker B, margin 5%), terminal claim 85%.
    function honestChain(uint256 h) internal view returns (RouteBuild memory r) {
        r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_000);
        addExplicitHop(r, h, E2, shakerB, SHAKER_B_PK, 8_500);
    }

    /*──────────────── truncation trio ────────────────*/

    /// (a) Compliant payload: the giver holds only the TERMINAL capability
    /// E2. A truncated route ends at E1, and no key they possess — nor a
    /// random one — can sign its Give. The full-route Give is equally
    /// useless against the cut: routeHash pins it.
    function test_SoloTruncation_Reverts_CompliantPayload() public {
        uint256 h = makeRaise();
        RouteBuild memory full = honestChain(h);

        RouteBuild memory cut = newRoute();
        addExplicitHop(cut, h, E1, shakerA, SHAKER_A_PK, 9_000); // identical hop 0

        // Give bound to the truncated route, signed with the key the giver has: E2.
        Give memory g = Give({
            handId: h,
            routeHash: routeHashOf(h, cut),
            giver: giver,
            solutionHash: keccak256("solution"),
            finalClaimBps: 9_000,
            deadline: defaultDeadline()
        });
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        bytes memory gsTerminal = signGive(E2, g);
        vm.expectRevert(CapabilityProof.selector);
        doThank(h, cut, g, gsTerminal, ga);

        // A random key is no better.
        bytes memory gsRandom = signGive(0xBAD, g);
        vm.expectRevert(CapabilityProof.selector);
        doThank(h, cut, g, gsRandom, ga);

        // And the legitimate full-route Give cannot ride the truncated route:
        // its routeHash names all two hops.
        (Give memory gFull, bytes memory gsFull) = buildGive(h, full, giver, defaultDeadline());
        bytes memory gaFull = signGiverAcceptance(GIVER_PK, gFull);
        vm.expectRevert(RouteHashMismatch.selector);
        doThank(h, cut, gFull, gsFull, gaFull);
    }

    /// (b) Leaked parent key: with E1 in hand, truncation IS possible — by
    /// design. The capability boundary is exactly the honestly enforceable
    /// one; key custody, not the contract, protects the tail.
    function test_Truncation_WithLeakedParentKey_Succeeds_ByDesign() public {
        uint256 h = makeRaise();
        honestChain(h); // the full payload exists; the attacker strips it

        RouteBuild memory cut = newRoute();
        addExplicitHop(cut, h, E1, shakerA, SHAKER_A_PK, 9_000);
        // buildGive signs with the route tail — E1, the leaked key.
        (Give memory g, bytes memory gs) = buildGive(h, cut, thief, defaultDeadline());
        uint256 thiefBefore = usd.balanceOf(thief);
        doThank(h, cut, g, gs, signGiverAcceptance(THIEF_PK, g));

        assertEq(usd.balanceOf(thief) - thiefBefore, 81e6, "leaked key captures the tail residual");
    }

    /// (c) Personal-capability anchor: when a hop's child capability is the
    /// recipient's own wallet, nobody without that wallet's key can settle
    /// past it. Truncation stops at the anchor.
    function test_PersonalAnchor_BlocksTruncationBeyond() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_000);
        addExplicitHop(r, h, GIVER_PK, shakerB, SHAKER_B_PK, 8_000); // child = giver's wallet

        Give memory bad = Give({
            handId: h,
            routeHash: routeHashOf(h, r),
            giver: thief,
            solutionHash: keccak256("solution"),
            finalClaimBps: 8_000,
            deadline: defaultDeadline()
        });
        bytes memory badGiveSig = signGive(0xBAD, bad);
        bytes memory badAcceptance = signGiverAcceptance(THIEF_PK, bad);
        vm.expectRevert(CapabilityProof.selector);
        doThank(h, r, bad, badGiveSig, badAcceptance);

        // Only the anchored wallet itself continues: giver == terminal capability.
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        uint256 giverBefore = usd.balanceOf(giver);
        doThank(h, r, g, gs, signGiverAcceptance(GIVER_PK, g));
        assertEq(usd.balanceOf(giver) - giverBefore, 72e6, "personal anchor passes for its owner");
    }

    /*──────────────── route validity ────────────────*/

    /// The first hop must be signed by the ROOT capability: a chain entered
    /// mid-way never verifies.
    function test_MidChainStart_Impossible() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        r.parentPk = E1; // skip the root: hop signed by E1 instead of E0
        addAnonymousHop(r, h, E2, 10_000);

        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);
        vm.expectRevert(CapabilityProof.selector);
        doThank(h, r, g, gs, ga);
    }

    function test_ClaimMustNotGrow_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addAnonymousHop(r, h, E1, 10_500); // child claim above parent

        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);
        vm.expectRevert(ClaimMustNotGrow.selector);
        doThank(h, r, g, gs, ga);
    }

    /// Hop i+1 must open with exactly the claim hop i closed at — a signed
    /// but discontinuous telescope is rejected.
    function test_ParentClaimMismatch_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 9_000);
        r.claim = 8_888; // forge the continuity: next hop opens at 8888 != 9000
        addSelfHop(r, h, E2, 8_000);

        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);
        vm.expectRevert(ClaimMismatch.selector);
        doThank(h, r, g, gs, ga);
    }

    function test_ExpiredShakeDeadline_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addHop(r, h, E1, vm.addr(E0), 0, 10_000, uint40(block.timestamp + 7 days));

        vm.warp(block.timestamp + 8 days); // hand still live (30d), ticket dead
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);
        vm.expectRevert(TicketExpired.selector);
        doThank(h, r, g, gs, ga);
    }

    /// The giver floor binds EVERY hop, not just the terminal claim: an
    /// interior dip below minGiverClaimBps kills the route even if later
    /// hops could never restore it.
    function test_ClaimBelowFloor_PerHop() public {
        RaiseParams memory p = defaultParams();
        p.minGiverClaimBps = 9_000;
        uint256 h = makeRaise(p);

        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 9_500); // fine: above floor
        addSelfHop(r, h, E2, 8_999); // interior dip below the floor

        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);
        vm.expectRevert(ClaimBelowFloor.selector);
        doThank(h, r, g, gs, ga);
    }

    /// MAX_SHAKES is 6: a seventh hop is rejected before any signature work.
    function test_RouteTooLong_SevenHops() public {
        uint256 h = makeRaise();
        Shake[] memory shakes = new Shake[](7);
        bytes[] memory sigs = new bytes[](7);
        bytes[] memory acceptances = new bytes[](7);
        for (uint256 i; i < 7; ++i) {
            shakes[i].handId = h;
        }
        Give memory g;

        vm.expectRevert(RouteTooLong.selector);
        vm.prank(raiser);
        core.thank(h, shakes, sigs, acceptances, g, "", "");
    }

    /// A high-s twin of a valid signature (r, N - s, flipped v) recovers the
    /// same key on the raw precompile but must be rejected wholesale.
    function test_Malleability_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addAnonymousHop(r, h, E1, 10_000);

        bytes memory orig = r.sigs[0];
        bytes32 sigR;
        uint256 sigS;
        uint8 sigV;
        assembly {
            sigR := mload(add(orig, 0x20))
            sigS := mload(add(orig, 0x40))
            sigV := byte(0, mload(add(orig, 0x60)))
        }
        uint256 N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        r.sigs[0] = abi.encodePacked(sigR, bytes32(N - sigS), sigV == 27 ? uint8(28) : uint8(27));

        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);
        vm.expectRevert(CapabilityProof.selector);
        doThank(h, r, g, gs, ga);
    }

    /*──────────────── lifecycle ────────────────*/

    function test_SettleOnce() public {
        uint256 h = makeRaise();
        RouteBuild memory r = honestChain(h);
        Give memory g = settle(h, r);

        // Replaying the identical settlement bundle fails on status.
        bytes memory gs = signGive(E2, g);
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);
        vm.expectRevert(NotActive.selector);
        doThank(h, r, g, gs, ga);

        // And expiry cannot reopen a settled hand.
        vm.warp(core.getHand(h).expiry);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
    }

    /// The Give names the WHOLE route: swapping the tail hop for a different
    /// (properly signed) one orphans the Give.
    function test_GiveBindsRoute_TailSwap_RouteHashMismatch() public {
        uint256 h = makeRaise();

        RouteBuild memory routeA = newRoute();
        addSelfHop(routeA, h, E1, 9_500);
        addSelfHop(routeA, h, E2, 9_000);
        (Give memory g, bytes memory gs) = buildGive(h, routeA, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        RouteBuild memory routeB = newRoute();
        addSelfHop(routeB, h, E1, 9_500);  // identical hop 0
        addSelfHop(routeB, h, E3, 9_000);  // different tail, validly signed by E1

        vm.expectRevert(RouteHashMismatch.selector);
        doThank(h, routeB, g, gs, ga);
    }

    /*──────────────── escrow bookkeeping ────────────────*/

    /// Settling one hand touches only that hand's escrow: h1's distributed value
    /// leaves the contract (pushed to recipients), while the sibling h2 stays
    /// fully escrowed and reclaimable. Isolation now shows as a bounded balance
    /// drop, not an untouched balance.
    function test_EscrowIsolation() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        uint256 charityBefore = usd.balanceOf(charity);
        uint256 giverBefore = usd.balanceOf(giver);
        settleSimple(h1);

        Hand memory hand2 = core.getHand(h2);
        assertEq(uint8(hand2.status), uint8(Status.Active), "sibling untouched");
        assertEq(hand2.creditedReward, DEPOSIT, "sibling snapshot intact");
        // h1's pool left the contract; only h2's escrow remains.
        assertEq(usd.balanceOf(address(core)), uint256(DEPOSIT), "only the sibling's escrow remains");
        assertEq(
            (usd.balanceOf(charity) - charityBefore) + (usd.balanceOf(giver) - giverBefore),
            uint256(DEPOSIT),
            "h1's pool was distributed to its recipients"
        );

        uint256 raiserBefore = usd.balanceOf(raiser);
        vm.warp(hand2.expiry);
        core.reclaim(h2);
        assertEq(usd.balanceOf(raiser) - raiserBefore, DEPOSIT, "sibling reclaims its full pool");
        assertEq(usd.balanceOf(address(core)), 0, "escrow fully drained");
    }

    /// Force-sent tokens are ghost balance: they change no hand, join no pool,
    /// and cannot be swept. Settlement pushed the pool straight to recipients,
    /// so after distribution only the stranded junk remains in the contract.
    function test_ForceSend_Bookkeeping() public {
        uint256 h = makeRaise();
        uint256 giverBefore = usd.balanceOf(giver);
        uint256 charityBefore = usd.balanceOf(charity);
        settleSimple(h);
        usd.mint(address(core), 500e6); // force-send analog

        assertEq(core.getHand(h).creditedReward, DEPOSIT, "snapshot unaffected");

        // The pool was delivered by push, not parked as claims.
        assertEq(usd.balanceOf(giver) - giverBefore, 90e6, "giver paid exactly, no ghost leakage");
        assertEq(usd.balanceOf(charity) - charityBefore, 10e6, "charity paid exactly");
        assertEq(claimOf(giver), 0, "no claim to sweep");
        assertEq(claimOf(charity), 0, "no claim to sweep");

        // The junk is unreachable: no claim keys to it, withdraw finds nothing.
        assertEq(usd.balanceOf(address(core)), 500e6, "ghost stays stranded");
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), giver);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), charity);
    }

    /*──────────────── self-insertion coalition ────────────────*/

    /// A giver inserting a sybil hop inside their own claim cannot profit:
    /// the coalition (sybil margin + giver residual) never exceeds what the
    /// honest route pays the giver alone, and flooring dust still lands on
    /// the giver side. (The spec claims the bound, not exact equality.)
    function testFuzz_SelfInsertion_CoalitionBound(uint16 split) public {
        split = uint16(bound(split, 0, 4_000)); // keep the sybil claim above the 50% floor

        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        // Honest: root -> E1 (shaker A, 10%), giver claims 90%. Value is pushed
        // to the giver's wallet, so the honest baseline is a balance delta.
        RouteBuild memory r1 = newRoute();
        addExplicitHop(r1, h1, E1, shakerA, SHAKER_A_PK, 9_000);
        uint256 giverPreHonest = usd.balanceOf(giver);
        settle(h1, r1);
        uint256 honest = usd.balanceOf(giver) - giverPreHonest;

        // Coalition: same head, then a sybil hop E1 -> E3 carving `split`
        // out of the giver's own claim. Sybil margin is pushed to vm.addr(E1).
        RouteBuild memory r2 = newRoute();
        addExplicitHop(r2, h2, E1, shakerA, SHAKER_A_PK, 9_000);
        addSelfHop(r2, h2, E3, 9_000 - split);
        uint256 giverBefore = usd.balanceOf(giver);
        uint256 sybilBefore = usd.balanceOf(vm.addr(E1));
        settle(h2, r2);
        uint256 giverPart = usd.balanceOf(giver) - giverBefore;
        uint256 coalition = giverPart + (usd.balanceOf(vm.addr(E1)) - sybilBefore);

        assertLe(coalition, honest, "self-insertion never beats the honest route");

        uint256 D = uint256(DEPOSIT) - 10e6; // 10% charity
        assertGe(giverPart, (D * (9_000 - split)) / 10_000, "flooring dust lands on the giver");
    }
}
