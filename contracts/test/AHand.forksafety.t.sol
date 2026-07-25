// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: fork safety — the domain separator follows the
        chain, so no signed artifact survives a chain split
//////////////////////////////////////////////////////////////*/

contract AHandForkSafetyTest is AHandTestBase {
    uint256 constant HOME_CHAIN = 31337;
    uint256 constant FORK_CHAIN = 424242;

    /*──────────────── separator behavior ────────────────*/

    function test_DomainSeparator_MatchesCanonicalDerivation() public view {
        // AHandSig.domainSeparator computes with the test's block.chainid —
        // byte-for-byte the value the core cached at deployment.
        assertEq(core.DOMAIN_SEPARATOR(), AHandSig.domainSeparator(address(core)), "cached == canonical");
    }

    /// The separator is cached for the deployment chain and recomputed on any
    /// other chainid; flipping back restores the cached value exactly.
    function test_DomainSeparator_ChangesOnFork() public {
        bytes32 home = core.DOMAIN_SEPARATOR();

        vm.chainId(FORK_CHAIN);
        bytes32 forked = core.DOMAIN_SEPARATOR();
        assertTrue(forked != home, "fork must rename the domain");
        assertEq(forked, AHandSig.domainSeparator(address(core)), "recompute path is canonical too");

        vm.chainId(HOME_CHAIN);
        assertEq(core.DOMAIN_SEPARATOR(), home, "cached separator restored");
    }

    /*──────────────── pre-fork artifacts die post-fork ────────────────*/

    /// A Shake signed under the home domain recovers a different signer under
    /// the forked domain: the capability proof fails on the first hop.
    function test_PreForkShakeSig_FailsPostFork() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000); // signed under HOME_CHAIN
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.chainId(FORK_CHAIN);
        vm.expectRevert(CapabilityProof.selector);
        doThank(h, r, g, gs, ga);
    }

    /// Route identity is chain-scoped through handRef: on a zero-shake route
    /// no signature is even reached — the pre-fork routeHash no longer names
    /// the route, so the Give fails its binding first.
    function test_PreForkRouteHash_MismatchesPostFork() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(); // zero-shake: terminal cap is the root
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline()); // handRef @ HOME_CHAIN
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        vm.chainId(FORK_CHAIN);
        vm.expectRevert(RouteHashMismatch.selector);
        doThank(h, r, g, gs, ga);
    }

    /// Isolate the Give signature: routeHash recomputed for the forked chain,
    /// but the signature made under the stale separator — CapabilityProof.
    function test_StaleDomainGiveSig_FailsPostFork() public {
        uint256 h = makeRaise();
        bytes32 staleDs = core.DOMAIN_SEPARATOR();

        vm.chainId(FORK_CHAIN);
        RouteBuild memory r = newRoute();
        Give memory g = Give({
            handId: h,
            routeHash: routeHashOf(h, r), // correct for the fork
            giver: giver,
            solutionHash: keccak256("solution"),
            finalClaimBps: 10_000,
            deadline: defaultDeadline()
        });
        bytes memory gs = signStructWithDomain(E0, staleDs, AHandSig.hashGive(g));
        bytes memory ga = signGiverAcceptance(GIVER_PK, g); // live domain — fine

        vm.expectRevert(CapabilityProof.selector);
        doThank(h, r, g, gs, ga);
    }

    /// Isolate the GiverAcceptance: everything signed under the forked domain
    /// except the acceptance — GiverAcceptanceInvalid.
    function test_StaleDomainGiverAcceptance_FailsPostFork() public {
        uint256 h = makeRaise();
        bytes32 staleDs = core.DOMAIN_SEPARATOR();

        vm.chainId(FORK_CHAIN);
        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000); // signed live
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline()); // signed live
        bytes memory ga = signStructWithDomain(GIVER_PK, staleDs, AHandSig.hashGiverAcceptance(AHandSig.hashGive(g)));

        vm.expectRevert(GiverAcceptanceInvalid.selector);
        doThank(h, r, g, gs, ga);
    }

    /*──────────────── the fork itself stays livable ────────────────*/

    /// After the flip, artifacts built against the recomputed separator and
    /// the fork-scoped routeHash settle normally: the Hand is not bricked,
    /// only the stale signatures are.
    function test_PostForkSignatures_Succeed() public {
        uint256 h = makeRaise();
        vm.chainId(FORK_CHAIN);

        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000); // helpers read DOMAIN_SEPARATOR() live
        uint256 giverBefore = usd.balanceOf(giver);
        settle(h, r);

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled), "fork settles fresh artifacts");
        assertEq(usd.balanceOf(giver) - giverBefore, 90e6, "residual pushed on the fork");
        assertEq(core.claims(address(usd), giver), 0, "successful push leaves no claim");
    }
}
