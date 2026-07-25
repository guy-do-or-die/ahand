// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: routehash — the route identity.
        routeHash = keccak256(abi.encode(handRef, shakeHashes))
        with handRef = keccak256(abi.encode(chainid, core, handId)):
        derived ONLY from the ordered Shake struct hashes under the
        Hand reference. Signature bytes are excluded by design, the
        empty route is a first-class identity, and the Give binds to
        exactly one such hash — tail substitution is impossible.
//////////////////////////////////////////////////////////////*/

contract AHandRouteHashTest is AHandTestBase {
    function claimOf(address a) internal view returns (uint256) {
        return core.claims(address(usd), a);
    }

    /// @dev The on-chain routeHash as settlement emitted it (Settled data
    ///      field 2 — works for zero-hop routes too, which emit no
    ///      RouteHopSettled to read the indexed copy from).
    function settledRouteHash(Vm.Log[] memory logs) internal returns (bytes32 routeHash) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != AHandCore.Settled.selector) continue;
            (, routeHash) = abi.decode(logs[i].data, (bytes32, bytes32));
            return routeHash;
        }
        fail();
    }

    /*──────────────── zero-shake route ────────────────*/

    /// The empty route is a legal, settleable identity: the terminal
    /// capability is the root itself, the final claim is exactly 10000, and
    /// the routeHash commits to an EMPTY shake-hash array under the handRef.
    function test_ZeroShake_HappyPath_FinalClaim10000() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(); // no hops: tail == root E0, claim == 10000

        vm.recordLogs();
        Give memory g = settle(h, r); // Give signed by E0, finalClaimBps 10000
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled));
        assertEq(g.finalClaimBps, 10_000, "zero-shake final claim is exactly 10000");
        assertEq(claimOf(charity), 10e6, "charity cut");
        assertEq(claimOf(giver), 90e6, "whole distributable to the giver");

        bytes32 expected = AHandSig.hashRoute(AHandSig.handRef(address(core), h), new bytes32[](0));
        assertEq(g.routeHash, expected, "Give binds the empty-route identity");
        assertEq(settledRouteHash(logs), expected, "core derived the same empty-route hash");
    }

    /*──────────────── tail substitution ────────────────*/

    /// The Give names the WHOLE route. A validly signed sibling tail produces
    /// a different routeHash, so the original Give cannot ride the swapped
    /// route — RouteHashMismatch before any give-signature work.
    function test_TailSwap_Reverts_RouteHashMismatch() public {
        uint256 h = makeRaise();

        RouteBuild memory routeA = newRoute();
        addSelfHop(routeA, h, E1, 9_500);
        addSelfHop(routeA, h, E2, 9_000);
        (Give memory g, bytes memory gs) = buildGive(h, routeA, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        RouteBuild memory routeB = newRoute();
        addSelfHop(routeB, h, E1, 9_500); // identical head
        addSelfHop(routeB, h, E3, 9_000); // different tail, validly signed by E1

        assertTrue(routeHashOf(h, routeA) != routeHashOf(h, routeB), "distinct tails, distinct identities");

        vm.expectRevert(RouteHashMismatch.selector);
        doThank(h, routeB, g, gs, ga);
    }

    /*──────────────── signature-representation independence ────────────────*/

    /// The identity is a function of the Shake STRUCTS alone. Re-building and
    /// re-signing the same route — or swapping every signature byte for
    /// garbage — cannot rename it, and the on-chain settlement derives the
    /// very same hash.
    function test_RouteHash_IndependentOfSignatureBytes() public {
        uint256 h = makeRaise();

        RouteBuild memory r1 = newRoute();
        addExplicitHop(r1, h, E1, shakerA, SHAKER_A_PK, 9_500);
        addSelfHop(r1, h, E2, 9_000);

        // Independent second build of the same logical route.
        RouteBuild memory r2 = newRoute();
        addExplicitHop(r2, h, E1, shakerA, SHAKER_A_PK, 9_500);
        addSelfHop(r2, h, E2, 9_000);
        bytes32 identity = routeHashOf(h, r1);
        assertEq(routeHashOf(h, r2), identity, "same route re-signed, same routeHash");

        // Mangle every signature and acceptance byte: the identity is untouched.
        for (uint256 i; i < r2.sigs.length; ++i) {
            r2.sigs[i] = hex"deadbeef";
            r2.acceptances[i] = hex"bad0";
        }
        assertEq(routeHashOf(h, r2), identity, "signature bytes are not part of the identity");

        // Ground truth: the core computes the identical hash at settlement.
        vm.recordLogs();
        Give memory g = settle(h, r1);
        assertEq(g.routeHash, identity);
        assertEq(settledRouteHash(vm.getRecordedLogs()), identity, "on-chain derivation matches");
    }

    /*──────────────── derivation lock ────────────────*/

    /// Locks the routeHash derivation end-to-end for the empty, one-hop and
    /// two-hop routes: expected values are recomputed from raw typehash
    /// primitives, matched against the AHandSig helpers, and the two-hop
    /// value is confirmed against what settlement actually emits.
    function test_RouteHashDerivation_Locked() public {
        uint256 h = makeRaise();

        // handRef: keccak256(abi.encode(chainid, core, handId)).
        bytes32 ref = keccak256(abi.encode(block.chainid, address(core), h));
        assertEq(AHandSig.handRef(address(core), h), ref, "handRef derivation");

        // (1) Empty route: keccak over the ref and an empty bytes32[].
        bytes32 expectedEmpty = keccak256(abi.encode(ref, new bytes32[](0)));
        assertEq(AHandSig.hashRoute(ref, new bytes32[](0)), expectedEmpty, "empty-route hash");
        assertEq(routeHashOf(h, newRoute()), expectedEmpty);

        // Build the two hops the remaining vectors commit to.
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_500);
        addSelfHop(r, h, E2, 9_000);

        // Shake struct hashes from the raw typehash — field for field.
        bytes32[] memory hashes = new bytes32[](2);
        for (uint256 i; i < 2; ++i) {
            Shake memory s = r.shakes[i];
            hashes[i] = keccak256(
                abi.encode(
                    keccak256(
                        "Shake(uint256 handId,address childCapability,address shaker,uint16 parentClaimBps,uint16 childClaimBps,bytes32 hopDataHash,uint40 deadline)"
                    ),
                    s.handId,
                    s.childCapability,
                    s.shaker,
                    s.parentClaimBps,
                    s.childClaimBps,
                    s.hopDataHash,
                    s.deadline
                )
            );
            assertEq(AHandSig.hashShake(s), hashes[i], "shake struct hash derivation");
        }

        // (2) One-hop route.
        bytes32[] memory one = new bytes32[](1);
        one[0] = hashes[0];
        bytes32 expectedOne = keccak256(abi.encode(ref, one));
        assertEq(AHandSig.hashRoute(ref, one), expectedOne, "one-hop route hash");
        {
            RouteBuild memory r1 = newRoute();
            addExplicitHop(r1, h, E1, shakerA, SHAKER_A_PK, 9_500);
            assertEq(routeHashOf(h, r1), expectedOne);
        }

        // (3) Two-hop route, confirmed against the emitted settlement facts.
        bytes32 expectedTwo = keccak256(abi.encode(ref, hashes));
        assertEq(AHandSig.hashRoute(ref, hashes), expectedTwo, "two-hop route hash");
        assertEq(routeHashOf(h, r), expectedTwo);
        assertTrue(expectedEmpty != expectedOne && expectedOne != expectedTwo, "each length is a distinct identity");

        vm.recordLogs();
        settle(h, r);
        assertEq(settledRouteHash(vm.getRecordedLogs()), expectedTwo, "core emits the locked derivation");
    }
}
