// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Vm} from "forge-std/Test.sol";
import {AHandTestBase} from "./AHandTestBase.sol";
import {
    AnonymousShakerWithMargin,
    ArtifactExpired,
    CapabilityProof,
    ClaimBelowFloor,
    ClaimMismatch,
    ClaimMustNotGrow,
    DeadlineExceedsExpiry,
    Give,
    GiverAcceptanceInvalid,
    Hop,
    MarginRoundsToZero,
    RaiseParams,
    RouteHashMismatch,
    Shake,
    ShakerAcceptanceInvalid,
    Status,
    Terminal,
    UnexpectedAcceptance,
    WrongHand,
    ZeroCapability,
    ZeroGiver
} from "../src/AHandTypes.sol";
import {AHandSig} from "../src/AHandSig.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSettlement} from "../src/AHandFacts.sol";
import {SmartWallet1271, WrongMagic1271} from "./mocks/SmartWallet1271.sol";
import {AlwaysValid1271, Revocable1271Signer} from "./mocks/Signers1271.sol";
import {SafeLikeSigner} from "./mocks/SafeLikeSigner.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: routing and consent (DESIGN §6, I-11..I-15)

        A. the capability chain from the stored root: authority,
           telescoping claims, hop-indexed errors in walk order
        B. the consent matrix per hop: anonymous / self / explicit,
           margins, MarginRoundsToZero, UnexpectedAcceptance
        C. the Give: GiverAcceptance always, _verifyGive error order,
           route binding (prefix / tail substitution)
        D. the 3×3 consent matrix: EOA · trivially-accepting ERC-1271 ·
           Safe approved hash × empty / valid / garbage bytes, in every
           family (Shake, ShakerAcceptance, Give, GiverAcceptance)
        E. dynamic consent: the Revocable1271Signer hostage scenario
        F. EIP-712: domain "aHand"/"3", ERC-5267, type strings, pinned
           vectors (incl. a zero shaker mid-route and 32-byte-padded
           array hashing), fork recompute, replay across Hands / Cores /
           chains, strict ECDSA (high-s, bad v, 64-byte), 7702 own key
//////////////////////////////////////////////////////////////*/

contract AHandV2RoutingTest is AHandTestBase {
    /// Owner keys of contract signers; distinct from every base key.
    uint256 constant OWNER_PK = 0x0Aaa1;
    uint256 constant OWNER_B_PK = 0x0Bbb1;
    /// A valid secp256k1 key whose ECDSA signatures recover to an EOA that is
    /// never a contract signer: forces the ERC-1271 fallthrough deterministically.
    uint256 constant JUNK_PK = 0xBAD1;
    /// secp256k1 group order.
    uint256 constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 constant HOME_CHAIN = 31337;
    uint256 constant FORK_CHAIN = 424242;

    /*//////////////////// local helpers ////////////////////*/

    /// @dev A Shake extending the route's tail with the default deadline and no hop data.
    function shakeOf(RouteBuild memory r, address child, address shaker, uint16 childClaim)
        internal
        view
        returns (Shake memory)
    {
        return Shake({
            handId: r.handId,
            childCapability: child,
            shaker: shaker,
            parentClaimBps: r.claim,
            childClaimBps: childClaim,
            hopDataHash: bytes32(0),
            deadline: defaultDeadline()
        });
    }

    /// @dev Append `s` signed by the current tail key, with `acceptance` as given,
    ///      and move the tail to (`childSignerPk`, `s.childCapability`).
    function pushSigned(RouteBuild memory r, Shake memory s, uint256 childSignerPk, bytes memory acceptance)
        internal
        view
    {
        bytes memory capSig = signStructOn(r.core, r.parentPk, AHandSig.hashShake(s));
        addRawHop(r, Hop({shake: s, capabilitySig: capSig, shakerAcceptanceSig: acceptance}));
        r.parentPk = childSignerPk;
        r.parentCap = s.childCapability;
    }

    /// @dev Append a hop with arbitrary bytes and move the tail to (`childSignerPk`, child).
    function pushRaw(
        RouteBuild memory r,
        Shake memory s,
        bytes memory capSig,
        bytes memory acceptance,
        uint256 childSignerPk
    ) internal pure {
        addRawHop(r, Hop({shake: s, capabilitySig: capSig, shakerAcceptanceSig: acceptance}));
        r.parentPk = childSignerPk;
        r.parentCap = s.childCapability;
    }

    /// @dev A one-hop route E0 → E1 carrying exactly `hop` (any bytes), tail key E1.
    function oneHop(uint256 handId, Hop memory hop) internal view returns (RouteBuild memory r) {
        r = newRoute(handId);
        pushRaw(r, hop.shake, hop.capabilitySig, hop.shakerAcceptanceSig, E1);
    }

    /// @dev `thank` by the raiser expecting `revertData`, with the default terminal built over `r`.
    function expectWalkRevert(bytes memory revertData, RouteBuild memory r) internal {
        expectThankRevert(revertData, r, buildTerminal(r));
    }

    /// @dev Deep copy — a memory struct assignment would alias the submitted Give.
    function cloneGive(Give memory g) internal pure returns (Give memory) {
        return Give({
            handId: g.handId,
            routeHash: g.routeHash,
            giver: g.giver,
            solutionHash: g.solutionHash,
            finalClaimBps: g.finalClaimBps,
            deadline: g.deadline
        });
    }

    /// @dev Safe's non-empty path: the owner's ECDSA over the Safe-wrapped hash.
    function safeWrappedSig(SafeLikeSigner safe, uint256 ownerPk, bytes32 digest) internal view returns (bytes memory) {
        return signDigest(ownerPk, safe.getMessageHash(digest));
    }

    /// @dev Flip a 65-byte signature into its high-s twin (same r, N − s, flipped v).
    function highSTwin(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s, uint8 v) = splitSig(sig);
        return abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
    }

    function splitSig(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "sig65");
        assembly ("memory-safe") {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
    }

    /// @dev The routeHash `Settled` emitted for `handId` (works for zero-hop routes too).
    function settledRouteHash(Vm.Log[] memory logs, uint256 handId) internal pure returns (bytes32 routeHash) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != AHandCore.Settled.selector || logs[i].topics[1] != bytes32(handId)) continue;
            (,,,,,, routeHash) =
                abi.decode(logs[i].data, (address, uint256, address, uint256, uint256, uint256, bytes32));
            return routeHash;
        }
        revert("no Settled log");
    }

    /*//////////////////////////////////////////////////////////
        A. the capability chain (I-11): authority and telescoping
    //////////////////////////////////////////////////////////*/

    /// The empty route is a first-class identity: the stored root signs the Give
    /// at 10 000 and the giver takes the whole distributable pool.
    function test_ZeroShakeRoute_RootSignsGive_Settles() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        vm.recordLogs();
        Terminal memory t = settle(r);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(t.give.finalClaimBps, 10_000, "zero-shake final claim is the root's 10 000");
        assertEq(balanceOf(address(usd), giver), 90e6, "D to the giver");
        assertEq(balanceOf(address(usd), charity), 10e6, "C to the charity");
        bytes32 expected = AHandSig.hashRoute(AHandSig.handRef(address(core), h), new bytes32[](0));
        assertEq(t.give.routeHash, expected, "Give binds the empty-route identity");
        assertEq(settledRouteHash(vm.getRecordedLogs(), h), expected, "Core derived the same identity");
    }

    /// A chain entered mid-way never verifies: hop 0 must be signed by the stored root.
    function test_MidChainStart_CapabilityProof0() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRouteOn(core, h, E1); // E1 is not the Hand's root
        addSelfHop(r, E2, 9_000);
        expectWalkRevert(err(CapabilityProof.selector, 0), r);
    }

    /// signer_i == child_{i−1}: a hop signed by any other key fails at its own index.
    function test_HopSignedByWrongCapability_CapabilityProofAtTherr() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_500); // E0 → E1, fine
        r.parentPk = E0; // forge a hop "from" E1 signed by E0
        addSelfHop(r, E2, 9_000);
        expectWalkRevert(err(CapabilityProof.selector, 1), r);
    }

    /// Capability authority is bearer: whoever holds the child key continues the
    /// chain, including a contract capability validating through ERC-1271.
    function test_ChainThroughSmartWalletCapability_Settles() public {
        SmartWallet1271 wallet = newSmartWallet(OWNER_PK);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addHopTo(r, address(wallet), OWNER_PK, address(0), 0, 10_000, bytes32(0), defaultDeadline()); // E0 → wallet
        addAnonymousHop(r, E2, 10_000); // the wallet signs hop 1 through its owner key (1271 path)
        settle(r);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "smart-wallet capability continues the chain");
        assertEq(balanceOf(address(usd), giver), 90e6);
    }

    /// Dead-end hop: a zero child capability is rejected at the hop, before any
    /// signature work, so the error names the hop and not a later symptom.
    function test_ZeroCapability_RejectedBeforeSignature() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_500);
        Shake memory s = shakeOf(r, address(0), address(0), 9_500);
        pushRaw(r, s, hex"deadbeef", "", E2); // garbage signature too: ZeroCapability wins
        expectWalkRevert(err(ZeroCapability.selector, 1), r);
    }

    /// Telescoping: parent_i must equal child_{i−1} exactly.
    function test_ClaimMismatch_DiscontinuousTelescope() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_500);
        Shake memory s = shakeOf(r, vm.addr(E2), address(0), 9_000);
        s.parentClaimBps = 9_600; // signed, but discontinuous
        pushSigned(r, s, E2, "");
        expectWalkRevert(err(ClaimMismatch.selector, 1), r);
    }

    /// child ≤ parent: a claim may never grow along the route.
    function test_ClaimMustNotGrow() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        pushSigned(r, shakeOf(r, vm.addr(E2), address(0), 9_001), E2, "");
        expectWalkRevert(err(ClaimMustNotGrow.selector, 1), r);
    }

    /// child ≥ floor binds EVERY hop: an interior dip below minGiverClaimBps
    /// kills the route even though no later hop could ever restore it.
    function test_ClaimBelowFloor_PerHop() public {
        uint256 h = makeRaise(); // floor 5 000
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 4_999);
        addSelfHop(r, E2, 4_999);
        expectWalkRevert(err(ClaimBelowFloor.selector, 0), r);

        RouteBuild memory ok = newRoute(h);
        addSelfHop(ok, E1, 5_000); // exactly the floor is legal
        settle(ok);
        assertEq(balanceOf(address(usd), vm.addr(E0)), 45e6, "50 % margin from D = 90e6");
        assertEq(balanceOf(address(usd), giver), 45e6, "giver exactly at the floor");
    }

    /// A floor of 10 000 forbids every margin: the first basis point below it fails.
    function test_FullFloor_AnyMarginBelowFloor() public {
        RaiseParams memory p = defaultParams();
        p.minGiverClaimBps = 10_000;
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_999);
        expectWalkRevert(err(ClaimBelowFloor.selector, 0), r);
    }

    /// Hop deadlines: now ≤ deadline (ArtifactExpired) and deadline ≤ expiry
    /// (DeadlineExceedsExpiry), each named at its hop.
    function test_HopDeadlines_ExpiredAndBeyondExpiry() public {
        uint256 h = makeRaise();
        uint40 expiry = core.facts(h).expiry;

        RouteBuild memory late = newRoute(h);
        addHop(late, E1, address(0), 0, 10_000, uint40(block.timestamp)); // valid at `now`
        addHop(late, E2, address(0), 0, 10_000, uint40(block.timestamp - 1)); // already past
        expectWalkRevert(err(ArtifactExpired.selector, 1), late);

        RouteBuild memory far = newRoute(h);
        addHop(far, E1, address(0), 0, 10_000, expiry); // deadline == expiry is legal for the artifact
        addHop(far, E2, address(0), 0, 10_000, expiry + 1);
        expectWalkRevert(err(DeadlineExceedsExpiry.selector, 1), far);
    }

    /// The walk order of hop checks (DESIGN §6.2), proven by peeling one
    /// violation at a time off a hop that breaks every rule at once:
    /// WrongHand → ZeroCapability → CapabilityProof → ClaimMismatch →
    /// ClaimMustNotGrow → ClaimBelowFloor → ArtifactExpired →
    /// DeadlineExceedsExpiry → AnonymousShakerWithMargin → ShakerAcceptanceInvalid → settles.
    function test_HopErrorOrder_PeeledInWalkOrder() public {
        uint256 h = makeRaise();
        uint256 other = makeRaise();
        uint40 expiry = core.facts(h).expiry;

        Shake memory s = Shake({
            handId: other,
            childCapability: address(0),
            shaker: address(0),
            parentClaimBps: 9_000,
            childClaimBps: 10_001,
            hopDataHash: bytes32(0),
            deadline: uint40(block.timestamp - 1)
        });
        Hop memory hop = Hop({shake: s, capabilitySig: hex"deadbeef", shakerAcceptanceSig: ""});

        expectWalkRevert(err(WrongHand.selector, 0), oneHop(h, hop));
        hop.shake.handId = h;
        expectWalkRevert(err(ZeroCapability.selector, 0), oneHop(h, hop));
        hop.shake.childCapability = vm.addr(E1);
        expectWalkRevert(err(CapabilityProof.selector, 0), oneHop(h, hop));
        hop.capabilitySig = signShake(E0, hop.shake);
        expectWalkRevert(err(ClaimMismatch.selector, 0), oneHop(h, hop));
        hop.shake.parentClaimBps = 10_000;
        hop.capabilitySig = signShake(E0, hop.shake);
        expectWalkRevert(err(ClaimMustNotGrow.selector, 0), oneHop(h, hop));
        hop.shake.childClaimBps = 4_999;
        hop.capabilitySig = signShake(E0, hop.shake);
        expectWalkRevert(err(ClaimBelowFloor.selector, 0), oneHop(h, hop));
        hop.shake.childClaimBps = 9_000;
        hop.capabilitySig = signShake(E0, hop.shake);
        expectWalkRevert(err(ArtifactExpired.selector, 0), oneHop(h, hop));
        hop.shake.deadline = expiry + 1;
        hop.capabilitySig = signShake(E0, hop.shake);
        expectWalkRevert(err(DeadlineExceedsExpiry.selector, 0), oneHop(h, hop));
        hop.shake.deadline = expiry;
        hop.capabilitySig = signShake(E0, hop.shake);
        expectWalkRevert(err(AnonymousShakerWithMargin.selector, 0), oneHop(h, hop));
        hop.shake.shaker = shakerA;
        hop.capabilitySig = signShake(E0, hop.shake);
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), oneHop(h, hop));
        hop.shakerAcceptanceSig = signShakerAcceptance(SHAKER_A_PK, AHandSig.hashShake(hop.shake));
        RouteBuild memory r = oneHop(h, hop);
        settle(r);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "every rule satisfied: settles");
        assertEq(balanceOf(address(usd), shakerA), 9e6, "10 % margin from D = 90e6");
    }

    /// Positions are exact: the failing hop of a long route is named, not hop 0.
    function test_IndexedError_NamesTheFailingHop() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_500);
        addAnonymousHop(r, E2, 9_500);
        addExplicitHop(r, E3, shakerA, SHAKER_A_PK, 9_000);
        r.hops[2].shakerAcceptanceSig = hex"00";
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 2), r);
    }

    /// Positive margins telescope: each A_i is floored from D independently and
    /// the giver absorbs the dust; every party is paid in the same transaction.
    function test_PositiveMargins_ThreeHops_ExactSplit() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000); // E0: 1 000 bps
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_500); // 500 bps
        addExplicitHop(r, E3, shakerB, SHAKER_B_PK, 7_000); // 1 500 bps
        uint16[] memory margins = new uint16[](3);
        (margins[0], margins[1], margins[2]) = (1_000, 500, 1_500);
        (uint256 C,, uint256[] memory A, uint256 G) = expectedSplit(h, margins);
        Terminal memory t = settle(r);
        assertEq(t.give.finalClaimBps, 7_000);
        assertEq(balanceOf(address(usd), charity), C);
        assertEq(balanceOf(address(usd), vm.addr(E0)), A[0]);
        assertEq(balanceOf(address(usd), shakerA), A[1]);
        assertEq(balanceOf(address(usd), shakerB), A[2]);
        assertEq(balanceOf(address(usd), giver), G);
        assertEq(C + A[0] + A[1] + A[2] + G, DEPOSIT, "P = C + sum A_i + G");
    }

    /// Any descending claim pair within [floor, 10 000] settles; payouts equal
    /// the floor formula, the giver never falls below its signed floor and the
    /// Give carries the terminal claim.
    function testFuzz_TelescopingClaims_SplitAndFloor(uint16 c1, uint16 c2) public {
        c1 = uint16(bound(c1, 5_000, 10_000));
        c2 = uint16(bound(c2, 5_000, c1));
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, c1);
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, c2);
        uint16[] memory margins = new uint16[](2);
        (margins[0], margins[1]) = (10_000 - c1, c1 - c2);
        (uint256 C, uint256 D, uint256[] memory A, uint256 G) = expectedSplit(h, margins);
        Terminal memory t = settle(r);
        assertEq(t.give.finalClaimBps, c2);
        assertEq(balanceOf(address(usd), vm.addr(E0)), A[0]);
        assertEq(balanceOf(address(usd), shakerA), A[1]);
        assertEq(balanceOf(address(usd), giver), G);
        assertGe(G, D * c2 / 10_000, "giver never below the signed floor");
        assertEq(C + A[0] + A[1] + G, DEPOSIT);
    }

    /*//////////////////////////////////////////////////////////
        B. the consent matrix per hop (I-12): anonymous / self / explicit
    //////////////////////////////////////////////////////////*/

    /// Pass: an anonymous zero-margin hop needs no wallet and no consent.
    function test_Anonymous_ZeroMargin_Settles() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addAnonymousHop(r, E1, 10_000);
        settle(r);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(claimOf(address(usd), address(0)), 0, "nothing is ever credited to zero");
        assertEq(balanceOf(address(usd), giver), 90e6);
    }

    /// A paid hop names its payee: anonymous with margin is rejected — on a funded
    /// Hand and on a zero-pot Hand alike (attribution is a fact even when money is not).
    function test_Anonymous_WithMargin_Reverts_FundedAndZeroPot() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addAnonymousHop(r, E1, 9_000);
        expectWalkRevert(err(AnonymousShakerWithMargin.selector, 0), r);

        uint256 z = makeRaise(zeroPotParams());
        RouteBuild memory rz = newRoute(z);
        addAnonymousHop(rz, E1, 9_000);
        expectWalkRevert(err(AnonymousShakerWithMargin.selector, 0), rz);
    }

    /// Acceptance bytes on an anonymous hop are malformed input, whatever they hold.
    function test_Anonymous_AcceptanceBytes_UnexpectedAcceptance() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addAnonymousHop(r, E1, 10_000);
        r.hops[0].shakerAcceptanceSig = hex"01";
        expectWalkRevert(err(UnexpectedAcceptance.selector, 0), r);
    }

    /// Self: the Shake signature is the consent; the margin flows to the signer.
    function test_Self_WithMargin_NoAcceptance_Settles() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        settle(r);
        assertEq(balanceOf(address(usd), vm.addr(E0)), 9e6, "margin to the self-attributed capability");
        assertEq(balanceOf(address(usd), giver), 81e6);
    }

    /// "Name me at 0 %": a self-attributed zero-margin hop is legal and unpaid.
    function test_Self_ZeroMargin_AttributedUnpaid() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        vm.recordLogs();
        settle(r);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h);
        assertEq(p.occShakers[0], vm.addr(E0), "attributed");
        assertEq(p.occAllocations[0], 0, "unpaid");
        assertEq(balanceOf(address(usd), vm.addr(E0)), 0);
    }

    /// Even a VALID acceptance on a self hop is rejected: the matrix is strict.
    function test_Self_ValidRedundantAcceptance_UnexpectedAcceptance() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        r.hops[0].shakerAcceptanceSig = signShakerAcceptance(E0, AHandSig.hashShake(r.hops[0].shake));
        expectWalkRevert(err(UnexpectedAcceptance.selector, 0), r);
    }

    /// "Self" means the capability that SIGNED the hop. The child named as shaker
    /// is a distinct account, hence explicit: it must co-sign.
    function test_ChildAsShaker_IsExplicit() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, vm.addr(E1), 0, 9_000, defaultDeadline());
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), r);

        RouteBuild memory ok = newRoute(h);
        addHop(ok, E1, vm.addr(E1), E1, 9_000, defaultDeadline());
        settle(ok);
        assertEq(balanceOf(address(usd), vm.addr(E1)), 9e6, "margin to the consenting child account");
    }

    /// Explicit with margin: the consenting shaker is paid.
    function test_Explicit_WithMargin_Settles() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        settle(r);
        assertEq(balanceOf(address(usd), shakerA), 9e6);
        assertEq(balanceOf(address(usd), giver), 81e6);
    }

    /// Attributed zero margin: attribution is consensual even when unpaid.
    function test_Explicit_ZeroMargin_NeedsAcceptance() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, shakerA, 0, 10_000, defaultDeadline());
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), r);

        RouteBuild memory ok = newRoute(h);
        addExplicitHop(ok, E1, shakerA, SHAKER_A_PK, 10_000);
        settle(ok);
        assertEq(balanceOf(address(usd), shakerA), 0, "attributed but unpaid");
        assertEq(balanceOf(address(usd), giver), 90e6);
    }

    /// The acceptance is bound to one shakeHash and one shaker: garbage, another
    /// key, another Shake, another Hand or another hop never validate.
    function test_Explicit_AcceptanceBinding_Rejections() public {
        uint256 h = makeRaise();
        uint256 h2 = makeRaise();

        RouteBuild memory garbage = newRoute(h);
        addExplicitHop(garbage, E1, shakerA, SHAKER_A_PK, 9_000);
        garbage.hops[0].shakerAcceptanceSig = hex"deadbeef";
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), garbage);

        RouteBuild memory wrongKey = newRoute(h);
        addHop(wrongKey, E1, shakerA, SHAKER_B_PK, 9_000, defaultDeadline());
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), wrongKey);

        RouteBuild memory wrongShake = newRoute(h);
        addExplicitHop(wrongShake, E1, shakerA, SHAKER_A_PK, 9_000);
        wrongShake.hops[0].shakerAcceptanceSig = signShakerAcceptance(SHAKER_A_PK, keccak256("not this shake"));
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), wrongShake);

        RouteBuild memory r1 = newRoute(h);
        addExplicitHop(r1, E1, shakerA, SHAKER_A_PK, 9_000);
        RouteBuild memory crossHand = newRoute(h2);
        addExplicitHop(crossHand, E1, shakerA, SHAKER_A_PK, 9_000);
        crossHand.hops[0].shakerAcceptanceSig = r1.hops[0].shakerAcceptanceSig; // structurally identical hop, other Hand
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), crossHand);

        RouteBuild memory crossHop = newRoute(h);
        addExplicitHop(crossHop, E1, shakerA, SHAKER_A_PK, 9_500);
        addExplicitHop(crossHop, E2, shakerA, SHAKER_A_PK, 9_000);
        crossHop.hops[1].shakerAcceptanceSig = crossHop.hops[0].shakerAcceptanceSig; // same shaker, same Hand, other hop
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 1), crossHop);
    }

    /// A positive margin that floors to zero token units is rejected at its hop
    /// (a paid hop that pays nothing is a false fact); on a zero-pot Hand D == 0
    /// and the rule is not checked — the attribution settles with zero amounts.
    function test_MarginRoundsToZero_FundedOnly() public {
        RaiseParams memory p = defaultParams();
        p.amount = 10; // C = 1, D = 9: any margin below 1 112 bps floors to zero
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000); // 1 000 bps → floor(9 · 1000 / 10 000) == 0
        expectWalkRevert(err(MarginRoundsToZero.selector, 0), r);

        uint256 z = makeRaise(zeroPotParams());
        RouteBuild memory rz = newRoute(z);
        addSelfHop(rz, E1, 9_000);
        addExplicitHop(rz, E2, shakerA, SHAKER_A_PK, 8_000);
        vm.recordLogs();
        settle(rz);
        AHandSettlement.SettlementPreimage memory pre = preimageFromLogsOn(core, vm.getRecordedLogs(), z);
        assertEq(uint8(statusOf(z)), uint8(Status.Settled), "zero-pot Hand settles with margins");
        assertEq(pre.occClaimDeltas[0], 1_000);
        assertEq(pre.occClaimDeltas[1], 1_000);
        assertEq(pre.occAllocations[0] + pre.occAllocations[1] + pre.giverAllocation, 0, "no money anywhere");
    }

    /// The same shaker on two hops is two occurrences: two allocations, both pushed.
    function test_SameShakerTwoHops_TwoOccurrences() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_500);
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 9_000);
        vm.recordLogs();
        settle(r);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h);
        assertEq(p.occShakers[0], shakerA);
        assertEq(p.occShakers[1], shakerA);
        assertEq(p.occAllocations[0], 4_500_000);
        assertEq(p.occAllocations[1], 4_500_000);
        assertEq(balanceOf(address(usd), shakerA), 9e6, "both occurrences delivered");
    }

    /*//////////////////////////////////////////////////////////
        C. the Give (I-13): acceptance always, error order, route binding
    //////////////////////////////////////////////////////////*/

    /// No self-mode shortcut for the giver: even when the giver IS the terminal
    /// capability, both the Give and the GiverAcceptance must be present.
    function test_GiverIsTerminalCapability_AcceptanceStillRequired() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h); // zero-shake: terminal == root E0
        Terminal memory t = buildTerminal(r, vm.addr(E0), 0, DEFAULT_SOLUTION, defaultDeadline());
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, t);

        Terminal memory ok = buildTerminal(r, vm.addr(E0), E0, DEFAULT_SOLUTION, defaultDeadline());
        doThank(r, ok);
        assertEq(balanceOf(address(usd), vm.addr(E0)), 90e6, "residual to the capability-giver");
    }

    /// The giver's acceptance is bound to the giver and to the exact giveHash.
    function test_GiverAcceptance_Binding_Rejections() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r);
        bytes memory good = t.giverAcceptanceSig;

        t.giverAcceptanceSig = "";
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, t);
        t.giverAcceptanceSig = hex"33";
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, t);
        t.giverAcceptanceSig = signGiverAcceptance(SHAKER_A_PK, t.give); // not the giver's key
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, t);
        Give memory other = cloneGive(t.give);
        other.solutionHash = keccak256("a different solution");
        t.giverAcceptanceSig = signGiverAcceptance(GIVER_PK, other); // right key, wrong giveHash
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, t);

        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newRoute(h2);
        addSelfHop(r2, E1, 10_000);
        Terminal memory t2 = buildTerminal(r2);
        t2.giverAcceptanceSig = good; // acceptance of h's Give on h2's
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r2, t2);

        t.giverAcceptanceSig = good;
        doThank(r, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
    }

    /// The _verifyGive check order (DESIGN §6.2), peeled on a two-hop route so
    /// every indexed error names n = 2: WrongHand(n) → RouteHashMismatch →
    /// ClaimMismatch(n) → ZeroGiver → ArtifactExpired(n) → DeadlineExceedsExpiry(n)
    /// → CapabilityProof(n) → GiverAcceptanceInvalid → settles.
    function test_VerifyGive_ErrorOrder_Peeled() public {
        uint256 h = makeRaise();
        uint256 other = makeRaise();
        uint40 expiry = core.facts(h).expiry;
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_500);
        addAnonymousHop(r, E2, 9_500);
        uint256 n = 2;

        Terminal memory t;
        t.give = Give({
            handId: other,
            routeHash: keccak256("wrong route"),
            giver: address(0),
            solutionHash: DEFAULT_SOLUTION,
            finalClaimBps: 9_000,
            deadline: uint40(block.timestamp - 1)
        });
        t.capabilitySig = hex"deadbeef";
        t.giverAcceptanceSig = hex"deadbeef";

        expectThankRevert(err(WrongHand.selector, n), r, t);
        t.give.handId = h;
        expectThankRevert(err(RouteHashMismatch.selector), r, t);
        t.give.routeHash = routeHashOf(r);
        expectThankRevert(err(ClaimMismatch.selector, n), r, t);
        t.give.finalClaimBps = 9_500;
        expectThankRevert(err(ZeroGiver.selector), r, t);
        t.give.giver = giver;
        expectThankRevert(err(ArtifactExpired.selector, n), r, t);
        t.give.deadline = expiry + 1;
        expectThankRevert(err(DeadlineExceedsExpiry.selector, n), r, t);
        t.give.deadline = expiry;
        expectThankRevert(err(CapabilityProof.selector, n), r, t);
        t.capabilitySig = signGive(E1, t.give); // E0 is not the terminal: still CapabilityProof
        expectThankRevert(err(CapabilityProof.selector, n), r, t);
        t.capabilitySig = signGive(E2, t.give);
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, t);
        t.giverAcceptanceSig = signGiverAcceptance(GIVER_PK, t.give);
        doThank(r, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(balanceOf(address(usd), vm.addr(E0)), 4_500_000);
        assertEq(balanceOf(address(usd), giver), 85_500_000);
    }

    /// The Give names the WHOLE route: a validly signed sibling tail, a dropped
    /// tail (prefix) and a reordered body all produce another identity.
    function test_RouteBinding_TailSwap_Prefix_Reorder() public {
        uint256 h = makeRaise();
        RouteBuild memory routeA = newRoute(h);
        addSelfHop(routeA, E1, 9_500);
        addSelfHop(routeA, E2, 9_000);
        Terminal memory t = buildTerminal(routeA);

        RouteBuild memory tailSwap = newRoute(h);
        addSelfHop(tailSwap, E1, 9_500);
        addSelfHop(tailSwap, E3, 9_000); // validly signed by E1, different child
        assertTrue(routeHashOf(tailSwap) != t.give.routeHash, "distinct tails, distinct identities");
        expectThankRevert(err(RouteHashMismatch.selector), tailSwap, t);

        RouteBuild memory prefix = newRoute(h);
        addSelfHop(prefix, E1, 9_500); // E1 is the terminal now; the Give was for E2's route
        expectThankRevert(err(RouteHashMismatch.selector), prefix, t);

        RouteBuild memory reordered = newRoute(h);
        addRawHop(reordered, routeA.hops[1]);
        addRawHop(reordered, routeA.hops[0]); // the chain itself rejects it first: hop 0 is not signed by the root
        expectThankRevert(err(CapabilityProof.selector, 0), reordered, t);

        doThank(routeA, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "the bound route settles");
    }

    /// The route identity is a function of the Shake STRUCTS alone: re-signing or
    /// mangling every signature byte cannot rename it, and Core emits the same hash.
    function test_RouteHash_IndependentOfSignatureBytes_DerivationLocked() public {
        uint256 h = makeRaise();
        RouteBuild memory r1 = newRoute(h);
        addExplicitHop(r1, E1, shakerA, SHAKER_A_PK, 9_500);
        addSelfHop(r1, E2, 9_000);
        RouteBuild memory r2 = newRoute(h);
        addExplicitHop(r2, E1, shakerA, SHAKER_A_PK, 9_500);
        addSelfHop(r2, E2, 9_000);
        bytes32 identity = routeHashOf(r1);
        assertEq(routeHashOf(r2), identity, "same route re-signed, same identity");
        for (uint256 i; i < r2.hops.length; ++i) {
            r2.hops[i].capabilitySig = hex"deadbeef";
            r2.hops[i].shakerAcceptanceSig = hex"bad0";
        }
        assertEq(routeHashOf(r2), identity, "signature bytes are outside the identity");

        // Derivation from raw primitives.
        bytes32 ref = keccak256(abi.encode(block.chainid, address(core), h));
        assertEq(AHandSig.handRef(address(core), h), ref);
        bytes32[] memory hashes = new bytes32[](2);
        for (uint256 i; i < 2; ++i) {
            Shake memory s = r1.hops[i].shake;
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
            assertEq(AHandSig.hashShake(s), hashes[i]);
        }
        assertEq(identity, keccak256(abi.encode(ref, hashes)), "routeHash = H(handRef, shakeHashes[])");

        vm.recordLogs();
        settle(r1);
        assertEq(settledRouteHash(vm.getRecordedLogs(), h), identity, "Core emits the locked derivation");
    }

    /*//////////////////////////////////////////////////////////
        D. the 3×3 consent matrix: EOA · trivially-accepting 1271 ·
           Safe approved hash  ×  empty · valid · garbage bytes
    //////////////////////////////////////////////////////////*/

    /// EOA shaker: only a 65-byte signature by that key validates; empty bytes
    /// never do (tryRecoverCalldata → InvalidSignatureLength, no code to ask).
    function test_Matrix_EoaShaker() public {
        uint256 h = makeRaise();
        RouteBuild memory empty = newRoute(h);
        addHop(empty, E1, shakerA, 0, 9_000, defaultDeadline());
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), empty);

        RouteBuild memory garbage = newRoute(h);
        addExplicitHop(garbage, E1, shakerA, SHAKER_A_PK, 9_000);
        garbage.hops[0].shakerAcceptanceSig = hex"deadbeef";
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), garbage);

        RouteBuild memory valid = newRoute(h);
        addExplicitHop(valid, E1, shakerA, SHAKER_A_PK, 9_000);
        settle(valid);
        assertEq(balanceOf(address(usd), shakerA), 9e6);
    }

    /// Trivially-accepting ERC-1271 shaker: its verifier decides, so empty bytes
    /// pass (pinned: S11), as do garbage bytes — consent lives in its code.
    function test_Matrix_TrivialAccepting1271Shaker_EmptyBytesPass() public {
        AlwaysValid1271 acceptor = new AlwaysValid1271();
        uint256 h = makeRaise();
        RouteBuild memory empty = newRoute(h);
        addHop(empty, E1, address(acceptor), 0, 9_500, defaultDeadline()); // empty acceptance on a paid explicit hop
        settle(empty);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "empty acceptance validated by code");
        assertEq(balanceOf(address(usd), address(acceptor)), 4_500_000, "margin pushed to the contract");

        uint256 h2 = makeRaise();
        RouteBuild memory garbage = newRoute(h2);
        addHop(garbage, E1, address(acceptor), 0, 9_500, defaultDeadline());
        garbage.hops[0].shakerAcceptanceSig = hex"deadbeef";
        settle(garbage);
        assertEq(balanceOf(address(usd), address(acceptor)), 9e6, "garbage bytes are the contract's business");
    }

    /// Safe approved hash as shaker: empty bytes validate iff the digest was
    /// pre-approved on-chain; the owner's ECDSA over the Safe-wrapped hash is the
    /// non-empty path; the owner's ECDSA over the RAW aHand digest is not.
    function test_Matrix_SafeShaker_ApprovedHash() public {
        SafeLikeSigner safe = newSafe(OWNER_PK);
        uint256 h = makeRaise();

        RouteBuild memory notApproved = newRoute(h);
        addHop(notApproved, E1, address(safe), 0, 9_500, defaultDeadline());
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), notApproved);

        bytes32 shakeHash = AHandSig.hashShake(notApproved.hops[0].shake);
        bytes32 acceptanceDigest = digestOf(AHandSig.hashShakerAcceptance(shakeHash));

        RouteBuild memory rawOwnerSig = newRoute(h);
        addHop(rawOwnerSig, E1, address(safe), OWNER_PK, 9_500, defaultDeadline()); // ECDSA over the raw digest
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), rawOwnerSig);

        RouteBuild memory wrapped = newRoute(h);
        addHop(wrapped, E1, address(safe), 0, 9_500, defaultDeadline());
        wrapped.hops[0].shakerAcceptanceSig = safeWrappedSig(safe, OWNER_PK, acceptanceDigest);
        Terminal memory tw = buildTerminal(wrapped);
        uint256 snap = vm.snapshotState();
        doThank(wrapped, tw);
        assertEq(balanceOf(address(usd), address(safe)), 4_500_000, "Safe-wrapped owner signature validates");
        vm.revertToState(snap);

        safeApprove(safe, OWNER_PK, acceptanceDigest);
        settle(notApproved); // same hop, now with the hash approved: empty bytes validate
        assertEq(balanceOf(address(usd), address(safe)), 4_500_000, "approved hash + empty bytes settles");
    }

    /// Safe approved-hash consent is irrevocable: `signedMessages` has no un-approve
    /// (no such selector, no fallback), so the Hand still settles afterwards.
    function test_SafeApprovedHash_CannotBeUnapproved() public {
        SafeLikeSigner safe = newSafe(OWNER_PK);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, address(safe), 0, 9_500, defaultDeadline());
        bytes32 digest = digestOf(AHandSig.hashShakerAcceptance(AHandSig.hashShake(r.hops[0].shake)));
        safeApprove(safe, OWNER_PK, digest);
        bytes32 wrapped = safe.getMessageHash(digest);
        assertEq(safe.signedMessages(wrapped), 1, "approved");

        vm.prank(vm.addr(OWNER_PK));
        (bool ok,) = address(safe).call(abi.encodeWithSignature("unsignMessage(bytes32)", digest));
        assertFalse(ok, "no un-approve path exists");
        assertEq(safe.signedMessages(wrapped), 1, "still approved");
        settle(r);
        assertEq(balanceOf(address(usd), address(safe)), 4_500_000);
    }

    /// The same three signer kinds as the GIVER (GiverAcceptance family).
    function test_Matrix_Giver_Eoa_Trivial_Safe() public {
        // EOA: empty / garbage reject, valid settles — covered by binding tests; pin empty here.
        uint256 h1 = makeRaise();
        RouteBuild memory r1 = newRoute(h1);
        addSelfHop(r1, E1, 10_000);
        expectThankRevert(
            err(GiverAcceptanceInvalid.selector),
            r1,
            buildTerminal(r1, giver, 0, DEFAULT_SOLUTION, defaultDeadline())
        );

        // Trivially-accepting contract giver with empty bytes.
        AlwaysValid1271 acceptor = new AlwaysValid1271();
        doThank(r1, buildTerminal(r1, address(acceptor), 0, DEFAULT_SOLUTION, defaultDeadline()));
        assertEq(balanceOf(address(usd), address(acceptor)), 90e6, "trivial 1271 giver, empty bytes");

        // Safe giver: not approved → invalid; approved → empty bytes settle.
        SafeLikeSigner safe = newSafe(OWNER_B_PK);
        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newRoute(h2);
        addSelfHop(r2, E1, 10_000);
        Terminal memory t2 = buildTerminal(r2, address(safe), 0, DEFAULT_SOLUTION, defaultDeadline());
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r2, t2);
        safeApprove(safe, OWNER_B_PK, digestOf(AHandSig.hashGiverAcceptance(AHandSig.hashGive(t2.give))));
        doThank(r2, t2);
        assertEq(balanceOf(address(usd), address(safe)), 90e6, "Safe giver by approved hash");
    }

    /// A Safe as ROOT capability: the Shake and the Give are "signed" by approving
    /// their digests on-chain and submitting empty capability bytes (all four
    /// families accept the approved-hash profile).
    function test_SafeAsRootCapability_ApprovedShakeAndGive_EmptyBytes() public {
        SafeLikeSigner safe = newSafe(OWNER_PK);
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(safe);
        uint256 h = makeRaise(p);

        RouteBuild memory r = newRouteOn(core, h, E0);
        r.parentCap = address(safe);
        Shake memory s = shakeOf(r, vm.addr(E1), address(0), 10_000);
        bytes32 shakeHash = AHandSig.hashShake(s);
        pushRaw(r, s, "", "", E1);
        Terminal memory t = buildTerminal(r);
        expectThankRevert(err(CapabilityProof.selector, 0), r, t); // nothing approved yet

        safeApprove(safe, OWNER_PK, digestOf(shakeHash));
        settle(r);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "Safe root signs hop 0 by approved hash");

        // Zero-shake route on a second Hand: the Safe signs the Give itself.
        uint256 h2 = makeRaise(p);
        RouteBuild memory r2 = newRouteOn(core, h2, E0);
        r2.parentCap = address(safe);
        Terminal memory t2 = buildTerminal(r2);
        t2.capabilitySig = "";
        expectThankRevert(err(CapabilityProof.selector, 0), r2, t2);
        safeApprove(safe, OWNER_PK, digestOf(AHandSig.hashGive(t2.give)));
        doThank(r2, t2);
        assertEq(uint8(statusOf(h2)), uint8(Status.Settled), "Safe terminal signs the Give by approved hash");
    }

    /*//////////////////////////////////////////////////////////
        E. dynamic consent: the Revocable1271Signer hostage scenario (S8)
    //////////////////////////////////////////////////////////*/

    /// A live validator's consent is re-checked at Thank. Valid at signing,
    /// revoked before Thank → that hop fails; the Raiser settles another route.
    function test_RevocableShaker_RevokedBeforeThank_RaiserSettlesAnotherRoute() public {
        Revocable1271Signer hostage = new Revocable1271Signer(vm.addr(OWNER_PK));
        uint256 h1 = makeRaise();
        RouteBuild memory r1 = newRoute(h1);
        addHop(r1, E1, address(hostage), OWNER_PK, 9_000, defaultDeadline()); // owner ECDSA, validated via 1271
        settle(r1);
        assertEq(balanceOf(address(usd), address(hostage)), 9e6, "valid while live");

        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newRoute(h2);
        addHop(r2, E1, address(hostage), OWNER_PK, 9_000, defaultDeadline());
        Terminal memory t2 = buildTerminal(r2);
        hostage.setRevoked(true);
        expectThankRevert(err(ShakerAcceptanceInvalid.selector, 0), r2, t2);
        assertEq(uint8(statusOf(h2)), uint8(Status.Active), "the Hand is not held hostage, only the branch");

        RouteBuild memory fresh = newRoute(h2); // E0 signs a fresh child without the hostage
        addExplicitHop(fresh, E2, shakerB, SHAKER_B_PK, 9_000);
        settle(fresh);
        assertEq(uint8(statusOf(h2)), uint8(Status.Settled));
        assertEq(balanceOf(address(usd), shakerB), 9e6);
        assertEq(balanceOf(address(usd), address(hostage)), 9e6, "the revoked branch earned nothing more");
    }

    /// Key rotation is the same revocation: the old owner's bytes stop validating.
    function test_RevocableShaker_OwnerRotated_OldSignatureInvalid() public {
        Revocable1271Signer wallet = new Revocable1271Signer(vm.addr(OWNER_PK));
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, address(wallet), OWNER_PK, 9_000, defaultDeadline());
        Terminal memory t = buildTerminal(r);
        wallet.rotateOwner(vm.addr(OWNER_B_PK));
        expectThankRevert(err(ShakerAcceptanceInvalid.selector, 0), r, t);
        r.hops[0].shakerAcceptanceSig = signShakerAcceptance(OWNER_B_PK, AHandSig.hashShake(r.hops[0].shake)); // the new owner consents
        doThank(r, t);
        assertEq(balanceOf(address(usd), address(wallet)), 9e6);
    }

    /// A revocable GIVER that revokes holds only its own branch: the Raiser
    /// cannot override the refusal and reclaims 100 % at expiry.
    function test_RevocableGiver_Revoked_RaiserReclaims() public {
        Revocable1271Signer hostage = new Revocable1271Signer(vm.addr(OWNER_PK));
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r, address(hostage), OWNER_PK, DEFAULT_SOLUTION, defaultDeadline());
        hostage.setRevoked(true);
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, t);

        uint256 before = balanceOf(address(usd), raiser);
        warpToExpiry(h);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Reclaimed));
        assertEq(balanceOf(address(usd), raiser) - before, DEPOSIT, "100 % refund, no charity");
    }

    /*//////////////////////////////////////////////////////////
        F. EIP-712: domain, type strings, vectors, fork, replay, strict ECDSA
    //////////////////////////////////////////////////////////*/

    /// ERC-5267 exposes name "aHand", version "3", this chain and this Core, and
    /// the separator derives from exactly those fields — equal to the library mirror.
    function test_Domain_Eip712Domain_And_SeparatorDerivation() public view {
        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifying,
            bytes32 salt,
            uint256[] memory ext
        ) = core.eip712Domain();
        assertEq(fields, bytes1(0x0f), "name, version, chainId, verifyingContract");
        assertEq(name, "aHand");
        assertEq(version, "3");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(core));
        assertEq(salt, bytes32(0));
        assertEq(ext.length, 0);
        bytes32 derived = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
        assertEq(core.DOMAIN_SEPARATOR(), derived, "DOMAIN_SEPARATOR == eip712Domain-derived");
        assertEq(core.DOMAIN_SEPARATOR(), domainSeparatorOf(core), "library mirror agrees");
    }

    /// The four type strings are frozen literals (byte-identical to v1); only the
    /// domain version moved. Pinned as hashes so one changed character is caught.
    function test_TypeHashes_Pinned() public pure {
        assertEq(
            AHandSig.SHAKE_TYPEHASH,
            keccak256(
                "Shake(uint256 handId,address childCapability,address shaker,uint16 parentClaimBps,uint16 childClaimBps,bytes32 hopDataHash,uint40 deadline)"
            )
        );
        assertEq(AHandSig.SHAKER_ACCEPTANCE_TYPEHASH, keccak256("ShakerAcceptance(bytes32 shakeHash)"));
        assertEq(
            AHandSig.GIVE_TYPEHASH,
            keccak256(
                "Give(uint256 handId,bytes32 routeHash,address giver,bytes32 solutionHash,uint16 finalClaimBps,uint40 deadline)"
            )
        );
        assertEq(AHandSig.GIVER_ACCEPTANCE_TYPEHASH, keccak256("GiverAcceptance(bytes32 giveHash)"));
        assertEq(AHandSig.SHAKE_TYPEHASH, VEC_SHAKE_TYPEHASH);
        assertEq(AHandSig.SHAKER_ACCEPTANCE_TYPEHASH, VEC_SHAKER_ACCEPTANCE_TYPEHASH);
        assertEq(AHandSig.GIVE_TYPEHASH, VEC_GIVE_TYPEHASH);
        assertEq(AHandSig.GIVER_ACCEPTANCE_TYPEHASH, VEC_GIVER_ACCEPTANCE_TYPEHASH);
    }

    /*──────────────── pinned vectors (GenVectors fixture, domain v3) ────────────────*/

    uint256 constant VEC_CHAIN = 31337;
    address constant VEC_CORE = 0x00c0FFeE00C0ffEE00C0FfeE00c0fFEe00C0ffEE;
    uint256 constant VEC_HAND = 3;
    // Well-known anvil keys (accounts 0..9 of the default mnemonic).
    uint256 constant PK_ROOT = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant PK_CAP1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant PK_CAP2 = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 constant PK_CAP3 = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 constant PK_RAISER = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;
    uint256 constant PK_CHARITY = 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba;
    uint256 constant PK_SHAKER_A = 0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356;
    uint256 constant PK_GIVER = 0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ---- pinned values (regenerated once for domain v3 by test_Vectors_Pinned_DomainV3 -vv) ----
    bytes32 constant VEC_SHAKE_TYPEHASH = 0x2c253b6c858e4305a92e2024bebed45373bd4d547151a9cada4a2308ad661109;
    bytes32 constant VEC_SHAKER_ACCEPTANCE_TYPEHASH =
        0x2360855c06f7409cc6ca1646c60f45f6506d8f723e4cba3e3b9a4a0edc7cd4ce;
    bytes32 constant VEC_GIVE_TYPEHASH = 0xb291b813add844ee64fdd1c81ccf2f6ec0f667e50260362032d2c39e5e0099f4;
    bytes32 constant VEC_GIVER_ACCEPTANCE_TYPEHASH = 0x245d2efc470ae1c1d6f28d4a6af71d16ade627bda6100dd8178b72b1a7549b5b;
    bytes32 constant VEC_DOMAIN_SEPARATOR = 0xe098593201e4e84f64eb21a6293f815ba00b2c4784d29f3793d411d8dc56f880;
    bytes32 constant VEC_HAND_REF = 0x98bfb3fa2e568b68ea79333d2297b9c7e344e1d3d6901f5c01a55f00d303b07f;
    bytes32 constant VEC_SHAKE_HASH_0 = 0x7b972e9b9b76431eada988bfd07e0e7463c3eff0e2f91270338dac5b5df8efac;
    bytes32 constant VEC_SHAKE_HASH_1 = 0x5e122c89ab1a4563b60d7c980d5a6a44f80b3e10a24147266cafd83726ee9f64;
    bytes32 constant VEC_SHAKE_HASH_2 = 0xd5e1e556b82361faf00f383969a944384933ce9a90356cb890fd7d5f3a7dfa57;
    bytes32 constant VEC_ROUTE_HASH = 0x14103907e2050b85ecc86a8ec04036e8dacafb9c81192b9531728313387e5e52;
    bytes32 constant VEC_GIVE_HASH = 0x2e4b91062fa26d31f54dd90d78214f48aafad18607310e7be0caa1d93f401ff8;
    bytes32 constant VEC_SHAKE_DIGEST_0 = 0x5482928b4514c9c292fe54d892f59c78b55730a13ddcf5e3121d1c75b73f8204;
    bytes32 constant VEC_ACCEPTANCE_DIGEST_2 = 0x39be9af4284e4910b476ee8fd52a9a89f050fc9a4e391a06abeb920897946f99;
    bytes32 constant VEC_GIVE_DIGEST = 0xeac11092c3dbea98318d1667fc7c842ee6ce38037da8dd0eb59cdb26875394a4;
    bytes32 constant VEC_GIVER_ACCEPTANCE_DIGEST = 0xd3a90277e7bc48e63912929d3b4c312c69ba1c5b336b118627692cbc886f01f0;
    bytes32 constant VEC_SETTLEMENT_HASH = 0xac44655e969ae1e5d3ebab5f721d631760ea06a0b6775a3efdd25d338c3440f5;

    struct Vectors {
        bytes32 ds;
        bytes32 ref;
        Shake[3] shakes;
        bytes32[] shakeHashes;
        bytes32 routeHash;
        Give give;
        bytes32 giveHash;
        AHandSettlement.SettlementPreimage preimage;
        bytes32 settlementHash;
    }

    /// The fixture: three hops — self (root, 10 %), anonymous (zero shaker, 0 %),
    /// explicit (10 %) — so the commitment carries a zero shaker in the middle.
    function vectors() internal view returns (Vectors memory v) {
        v.ds = AHandSig.domainSeparator(VEC_CORE);
        v.ref = AHandSig.handRef(VEC_CORE, VEC_HAND);
        v.shakes[0] = Shake(
            VEC_HAND,
            vm.addr(PK_CAP1),
            vm.addr(PK_ROOT),
            10_000,
            9_000,
            keccak256("aHand/vectors/v3/hop-data/0"),
            1_990_000_000
        );
        v.shakes[1] = Shake(VEC_HAND, vm.addr(PK_CAP2), address(0), 9_000, 9_000, bytes32(0), 1_990_000_100);
        v.shakes[2] = Shake(
            VEC_HAND,
            vm.addr(PK_CAP3),
            vm.addr(PK_SHAKER_A),
            9_000,
            8_000,
            keccak256("aHand/vectors/v3/hop-data/2"),
            1_990_000_200
        );
        v.shakeHashes = new bytes32[](3);
        for (uint256 i; i < 3; ++i) {
            v.shakeHashes[i] = AHandSig.hashShake(v.shakes[i]);
        }
        v.routeHash = AHandSig.hashRoute(v.ref, v.shakeHashes);
        v.give = Give(
            VEC_HAND, v.routeHash, vm.addr(PK_GIVER), keccak256("aHand/vectors/v3/solution"), 8_000, 1_990_000_300
        );
        v.giveHash = AHandSig.hashGive(v.give);

        AHandSettlement.SettlementPreimage memory p;
        p.handId = VEC_HAND;
        p.raiser = vm.addr(PK_RAISER);
        p.giver = v.give.giver;
        p.token = BASE_USDC;
        p.charityRecipient = vm.addr(PK_CHARITY);
        p.pool = 100_000_000;
        p.charityAllocation = 10_000_000;
        p.giverAllocation = 72_000_000; // D = 90e6 − 9e6 − 9e6
        p.routeHash = v.routeHash;
        p.giveHash = v.giveHash;
        p.solutionHash = v.give.solutionHash;
        p.closedAt = 1_980_000_000;
        p.occShakers = new address[](3);
        p.occClaimDeltas = new uint16[](3);
        p.occAllocations = new uint256[](3);
        (p.occShakers[0], p.occShakers[1], p.occShakers[2]) = (vm.addr(PK_ROOT), address(0), vm.addr(PK_SHAKER_A));
        (p.occClaimDeltas[0], p.occClaimDeltas[1], p.occClaimDeltas[2]) = (1_000, 0, 1_000);
        (p.occAllocations[0], p.occAllocations[1], p.occAllocations[2]) = (9_000_000, 0, 9_000_000);
        v.preimage = p;
        v.settlementHash = AHandSettlement.commitment(VEC_CORE, p);
    }

    /// Every hash of the fixture equals its pinned value: the byte identity the
    /// SDK replays. Signatures by the anvil keys recover under these digests.
    /// The live values are logged first, so `-vv` prints the regenerated set when
    /// AHandSig / AHandSettlement legitimately change (U27: regenerate once).
    function test_Vectors_Pinned_DomainV3() public {
        vm.chainId(VEC_CHAIN);
        Vectors memory v = vectors();
        emit log_named_bytes32("SHAKE_TYPEHASH", AHandSig.SHAKE_TYPEHASH);
        emit log_named_bytes32("SHAKER_ACCEPTANCE_TYPEHASH", AHandSig.SHAKER_ACCEPTANCE_TYPEHASH);
        emit log_named_bytes32("GIVE_TYPEHASH", AHandSig.GIVE_TYPEHASH);
        emit log_named_bytes32("GIVER_ACCEPTANCE_TYPEHASH", AHandSig.GIVER_ACCEPTANCE_TYPEHASH);
        emit log_named_bytes32("DOMAIN_SEPARATOR", v.ds);
        emit log_named_bytes32("HAND_REF", v.ref);
        emit log_named_bytes32("SHAKE_HASH_0", v.shakeHashes[0]);
        emit log_named_bytes32("SHAKE_HASH_1", v.shakeHashes[1]);
        emit log_named_bytes32("SHAKE_HASH_2", v.shakeHashes[2]);
        emit log_named_bytes32("ROUTE_HASH", v.routeHash);
        emit log_named_bytes32("GIVE_HASH", v.giveHash);
        emit log_named_bytes32("SHAKE_DIGEST_0", AHandSig.digest(v.ds, v.shakeHashes[0]));
        emit log_named_bytes32(
            "ACCEPTANCE_DIGEST_2", AHandSig.digest(v.ds, AHandSig.hashShakerAcceptance(v.shakeHashes[2]))
        );
        emit log_named_bytes32("GIVE_DIGEST", AHandSig.digest(v.ds, v.giveHash));
        emit log_named_bytes32(
            "GIVER_ACCEPTANCE_DIGEST", AHandSig.digest(v.ds, AHandSig.hashGiverAcceptance(v.giveHash))
        );
        emit log_named_bytes32("SETTLEMENT_HASH", v.settlementHash);
        assertEq(v.ds, VEC_DOMAIN_SEPARATOR, "domain separator (aHand/3/31337/CORE)");
        assertEq(v.ref, VEC_HAND_REF, "handRef");
        assertEq(v.shakeHashes[0], VEC_SHAKE_HASH_0);
        assertEq(v.shakeHashes[1], VEC_SHAKE_HASH_1, "zero-shaker hop");
        assertEq(v.shakeHashes[2], VEC_SHAKE_HASH_2);
        assertEq(v.routeHash, VEC_ROUTE_HASH, "routeHash");
        assertEq(v.giveHash, VEC_GIVE_HASH, "giveHash");
        bytes32 shakeDigest0 = AHandSig.digest(v.ds, v.shakeHashes[0]);
        bytes32 acceptanceDigest2 = AHandSig.digest(v.ds, AHandSig.hashShakerAcceptance(v.shakeHashes[2]));
        bytes32 giveDigest = AHandSig.digest(v.ds, v.giveHash);
        bytes32 giverAcceptanceDigest = AHandSig.digest(v.ds, AHandSig.hashGiverAcceptance(v.giveHash));
        assertEq(shakeDigest0, VEC_SHAKE_DIGEST_0);
        assertEq(acceptanceDigest2, VEC_ACCEPTANCE_DIGEST_2);
        assertEq(giveDigest, VEC_GIVE_DIGEST);
        assertEq(giverAcceptanceDigest, VEC_GIVER_ACCEPTANCE_DIGEST);
        assertEq(v.settlementHash, VEC_SETTLEMENT_HASH, "settlement commitment (aHand.settlement.v2)");

        // The signatures the SDK produces for these digests recover the fixture's signers.
        (uint8 vv, bytes32 rr, bytes32 ss) = vm.sign(PK_ROOT, shakeDigest0);
        assertEq(ecrecover(shakeDigest0, vv, rr, ss), vm.addr(PK_ROOT), "root signs hop 0");
        (vv, rr, ss) = vm.sign(PK_SHAKER_A, acceptanceDigest2);
        assertEq(ecrecover(acceptanceDigest2, vv, rr, ss), vm.addr(PK_SHAKER_A), "shaker A accepts hop 2");
        (vv, rr, ss) = vm.sign(PK_CAP3, giveDigest);
        assertEq(ecrecover(giveDigest, vv, rr, ss), vm.addr(PK_CAP3), "terminal CAP3 signs the Give");
        (vv, rr, ss) = vm.sign(PK_GIVER, giverAcceptanceDigest);
        assertEq(ecrecover(giverAcceptanceDigest, vv, rr, ss), vm.addr(PK_GIVER), "giver accepts");
    }

    /// The commitment hashes each occurrence array with 32-byte-padded elements
    /// (abi.encodePacked of a dynamic array never packs tightly); a 20-/2-byte
    /// tight packing yields a different hash, and the zero shaker is preserved.
    function test_Vectors_ArrayHashing_PaddedNotTight() public {
        vm.chainId(VEC_CHAIN);
        Vectors memory v = vectors();
        AHandSettlement.SettlementPreimage memory p = v.preimage;

        bytes32 paddedShakers = keccak256(abi.encodePacked(p.occShakers));
        bytes32 manual = keccak256(
            abi.encodePacked(
                bytes32(uint256(uint160(p.occShakers[0]))),
                bytes32(uint256(uint160(p.occShakers[1]))),
                bytes32(uint256(uint160(p.occShakers[2])))
            )
        );
        assertEq(paddedShakers, manual, "address[] hashes as n 32-byte words");
        bytes32 tight = keccak256(abi.encodePacked(p.occShakers[0], p.occShakers[1], p.occShakers[2]));
        assertTrue(tight != paddedShakers, "tight 20-byte packing is a different hash");

        bytes32 paddedDeltas = keccak256(abi.encodePacked(p.occClaimDeltas));
        assertEq(
            paddedDeltas,
            keccak256(
                abi.encodePacked(
                    uint256(p.occClaimDeltas[0]), uint256(p.occClaimDeltas[1]), uint256(p.occClaimDeltas[2])
                )
            ),
            "uint16[] hashes as n left-padded words"
        );
        assertTrue(
            keccak256(abi.encodePacked(p.occClaimDeltas[0], p.occClaimDeltas[1], p.occClaimDeltas[2])) != paddedDeltas,
            "tight 2-byte packing is a different hash"
        );

        // The flat word list the off-chain hasher must copy (DESIGN §3.5); every field
        // is a static word, so two abi.encode halves concatenate to the one encoding.
        bytes memory head = abi.encode(
            keccak256("aHand.settlement.v2"),
            block.chainid,
            VEC_CORE,
            p.handId,
            p.raiser,
            p.giver,
            p.token,
            p.charityRecipient,
            p.pool
        );
        bytes memory tail = abi.encode(
            p.charityAllocation,
            p.giverAllocation,
            p.routeHash,
            p.giveHash,
            p.solutionHash,
            uint256(p.closedAt),
            paddedShakers,
            paddedDeltas,
            keccak256(abi.encodePacked(p.occAllocations))
        );
        bytes32 recomputed = keccak256(bytes.concat(head, tail));
        assertEq(recomputed, v.settlementHash, "library recipe == flat recipe");

        // Dropping the zero shaker (or any occurrence) changes the commitment.
        AHandSettlement.SettlementPreimage memory dropped = vectors().preimage; // fresh arrays, no aliasing with p
        dropped.occShakers = new address[](2);
        dropped.occClaimDeltas = new uint16[](2);
        dropped.occAllocations = new uint256[](2);
        (dropped.occShakers[0], dropped.occShakers[1]) = (p.occShakers[0], p.occShakers[2]);
        (dropped.occClaimDeltas[0], dropped.occClaimDeltas[1]) = (p.occClaimDeltas[0], p.occClaimDeltas[2]);
        (dropped.occAllocations[0], dropped.occAllocations[1]) = (p.occAllocations[0], p.occAllocations[2]);
        assertTrue(AHandSettlement.commitment(VEC_CORE, dropped) != v.settlementHash, "zeros are preserved facts");
    }

    /// The same shape settled live: the stored settlementHash equals the preimage
    /// rebuilt from events with the zero shaker in the middle (on-chain pin of §3.5).
    function test_Commitment_ZeroShakerMidRoute_RoundTripFromEvents() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        addAnonymousHop(r, E2, 9_000);
        addExplicitHop(r, E3, shakerA, SHAKER_A_PK, 8_000);
        vm.recordLogs();
        Terminal memory t = settle(r);
        AHandSettlement.SettlementPreimage memory fromLogs = preimageFromLogsOn(core, vm.getRecordedLogs(), h);
        bytes32 stored = core.facts(h).settlementHash;
        assertEq(settlementHashOf(fromLogs), stored, "events rebuild the commitment");
        assertEq(settlementHashOf(preimageOf(r, t, uint40(block.timestamp))), stored, "known route agrees");
        assertEq(fromLogs.occShakers[1], address(0), "zero shaker preserved at position 1");
        assertEq(fromLogs.occAllocations[0], 9e6);
        assertEq(fromLogs.occAllocations[2], 9e6);
        assertEq(fromLogs.giverAllocation, 72e6);
    }

    /*──────────────── fork recompute ────────────────*/

    /// The separator is cached for the deployment chain and recomputed on any
    /// other chain id; flipping back restores the cached value exactly.
    function test_DomainSeparator_RecomputedOnFork_Restored() public {
        bytes32 home = core.DOMAIN_SEPARATOR();
        vm.chainId(FORK_CHAIN);
        bytes32 forked = core.DOMAIN_SEPARATOR();
        assertTrue(forked != home, "a fork renames the domain");
        assertEq(forked, domainSeparatorOf(core), "recompute path is canonical too");
        vm.chainId(HOME_CHAIN);
        assertEq(core.DOMAIN_SEPARATOR(), home, "cached separator restored");
    }

    /// Pre-fork artifacts die post-fork, each at its own family: the Shake
    /// (CapabilityProof(0)), the zero-shake Give's routeHash (handRef is chain-scoped),
    /// a stale-domain Give signature (CapabilityProof(n)) and a stale-domain
    /// GiverAcceptance; fresh post-fork artifacts settle — the Hand is not bricked.
    function test_Fork_OldSignaturesRejected_FreshOnesSettle() public {
        uint256 h = makeRaise();
        bytes32 staleDs = core.DOMAIN_SEPARATOR();

        RouteBuild memory pre = newRoute(h);
        addSelfHop(pre, E1, 10_000); // signed under HOME_CHAIN
        Terminal memory tPre = buildTerminal(pre);
        RouteBuild memory zero = newRoute(h);
        Terminal memory tZero = buildTerminal(zero); // handRef @ HOME_CHAIN

        vm.chainId(FORK_CHAIN);
        expectThankRevert(err(CapabilityProof.selector, 0), pre, tPre);
        expectThankRevert(err(RouteHashMismatch.selector), zero, tZero);

        RouteBuild memory live = newRoute(h);
        addSelfHop(live, E1, 10_000); // helpers read DOMAIN_SEPARATOR() live
        Terminal memory t = buildTerminal(live);
        bytes memory liveGiveSig = t.capabilitySig;
        bytes memory liveAcceptance = t.giverAcceptanceSig;
        t.capabilitySig = signStructWithDomain(E1, staleDs, AHandSig.hashGive(t.give));
        expectThankRevert(err(CapabilityProof.selector, 1), live, t);
        t.capabilitySig = liveGiveSig;
        t.giverAcceptanceSig =
            signStructWithDomain(GIVER_PK, staleDs, AHandSig.hashGiverAcceptance(AHandSig.hashGive(t.give)));
        expectThankRevert(err(GiverAcceptanceInvalid.selector), live, t);
        t.giverAcceptanceSig = liveAcceptance;
        doThank(live, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "fork settles fresh artifacts");
        assertEq(balanceOf(address(usd), giver), 90e6);
    }

    /*──────────────── replay across Hands and Cores ────────────────*/

    /// Across Hands of one Core: a Shake carries its handId (WrongHand), and
    /// re-targeting it to another Hand invalidates the signature (CapabilityProof);
    /// a Give for one Hand on another is WrongHand(n).
    function test_Replay_AcrossHands() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();
        RouteBuild memory r1 = newRoute(h1);
        addSelfHop(r1, E1, 9_000);
        Terminal memory t1 = buildTerminal(r1);

        RouteBuild memory onH2 = newRoute(h2);
        addRawHop(onH2, r1.hops[0]); // h1's hop verbatim
        onH2.parentPk = E1;
        onH2.parentCap = vm.addr(E1);
        expectWalkRevert(err(WrongHand.selector, 0), onH2);

        RouteBuild memory retargeted = newRoute(h2);
        Hop memory hop = r1.hops[0];
        hop.shake.handId = h2; // struct changed, signature stale
        addRawHop(retargeted, hop);
        retargeted.parentPk = E1;
        retargeted.parentCap = vm.addr(E1);
        expectWalkRevert(err(CapabilityProof.selector, 0), retargeted);

        RouteBuild memory r2 = newRoute(h2);
        addSelfHop(r2, E1, 9_000);
        expectThankRevert(err(WrongHand.selector, 1), r2, t1);
    }

    /// Across Cores on one chain: the same handId on a second Core is another
    /// domain and another handRef, so every family dies — Shake (CapabilityProof(0)),
    /// acceptance (ShakerAcceptanceInvalid(0)), zero-shake Give (RouteHashMismatch).
    function test_Replay_AcrossCores() public {
        AHandCore core2 = deployCore(charity, policyAdmin);
        fundFor(core2, address(usd), raiser, 1_000e6);
        uint256 h = makeRaise();
        uint256 h2 = makeRaiseAs(raiser, core2, defaultParams(), DEFAULT_REF, noTags());
        assertEq(h, h2, "same id on both Cores");
        assertTrue(core.DOMAIN_SEPARATOR() != core2.DOMAIN_SEPARATOR(), "distinct domains");

        RouteBuild memory onA = newRoute(h);
        addExplicitHop(onA, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory tA = buildTerminal(onA);
        vm.prank(raiser);
        vm.expectRevert(err(CapabilityProof.selector, 0));
        core2.thank(h2, onA.hops, tA);

        RouteBuild memory onB = newRouteOn(core2, h2, E0);
        addExplicitHop(onB, E1, shakerA, SHAKER_A_PK, 9_000);
        onB.hops[0].shakerAcceptanceSig = onA.hops[0].shakerAcceptanceSig; // consent given on Core A
        Terminal memory tB = buildTerminal(onB);
        vm.prank(raiser);
        vm.expectRevert(err(ShakerAcceptanceInvalid.selector, 0));
        core2.thank(h2, onB.hops, tB);

        RouteBuild memory zeroA = newRoute(h);
        Terminal memory tZeroA = buildTerminal(zeroA);
        RouteBuild memory zeroB = newRouteOn(core2, h2, E0);
        vm.prank(raiser);
        vm.expectRevert(err(RouteHashMismatch.selector));
        core2.thank(h2, zeroB.hops, tZeroA);

        // Each Core settles its own artifacts.
        doThank(onA, tA);
        RouteBuild memory ownB = newRouteOn(core2, h2, E0);
        addExplicitHop(ownB, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory tOwnB = buildTerminal(ownB);
        doThank(ownB, tOwnB);
        assertEq(uint8(core2.facts(h2).status), uint8(Status.Settled));
        assertEq(balanceOf(address(usd), shakerA), 18e6, "paid once per Core");
    }

    /*──────────────── strict ECDSA ────────────────*/

    /// A high-s twin (r, N − s, flipped v) recovers the same key on the raw
    /// precompile but is rejected wholesale by the verifier — in the capability
    /// family and in the acceptance family alike.
    function test_Malleability_HighS_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        bytes32 shakeDigest = digestOf(AHandSig.hashShake(r.hops[0].shake));

        bytes memory twin = highSTwin(r.hops[0].capabilitySig);
        (bytes32 tr, bytes32 ts, uint8 tv) = splitSig(twin);
        assertEq(ecrecover(shakeDigest, tv, tr, ts), vm.addr(E0), "the precompile accepts the twin");
        bytes memory original = r.hops[0].capabilitySig;
        r.hops[0].capabilitySig = twin;
        expectWalkRevert(err(CapabilityProof.selector, 0), r);

        r.hops[0].capabilitySig = original;
        r.hops[0].shakerAcceptanceSig = highSTwin(r.hops[0].shakerAcceptanceSig);
        expectWalkRevert(err(ShakerAcceptanceInvalid.selector, 0), r);
    }

    /// Only 65-byte (r ‖ s ‖ v) with v ∈ {27, 28} is ECDSA to the verifier: a bad
    /// v, an EIP-2098 64-byte compact form and empty bytes all fail for an EOA.
    function test_StrictEcdsa_BadV_Compact64_Empty_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addAnonymousHop(r, E1, 10_000);
        bytes memory good = r.hops[0].capabilitySig;
        (bytes32 sr, bytes32 ss, uint8 sv) = splitSig(good);

        r.hops[0].capabilitySig = abi.encodePacked(sr, ss, uint8(29));
        expectWalkRevert(err(CapabilityProof.selector, 0), r);
        r.hops[0].capabilitySig = abi.encodePacked(sr, bytes32(uint256(ss) | (uint256(sv - 27) << 255))); // EIP-2098
        expectWalkRevert(err(CapabilityProof.selector, 0), r);
        r.hops[0].capabilitySig = "";
        expectWalkRevert(err(CapabilityProof.selector, 0), r);
        r.hops[0].capabilitySig = good;
        settle(r);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
    }

    /// Opaque wallet-style bytes for a signer WITHOUT code: ECDSA fails and there
    /// is no ERC-1271 target to ask — invalid, no call made.
    function test_CodelessSigner_ContractStyleBytes_Invalid() public {
        address bare = makeAddr("bareCapability");
        RaiseParams memory p = defaultParams();
        p.rootCapability = bare;
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRouteOn(core, h, JUNK_PK);
        r.parentCap = bare;
        addAnonymousHop(r, E1, 10_000);
        r.hops[0].capabilitySig = abi.encode(keccak256("session-key-proof"), uint64(7), keccak256("attestation"));
        expectWalkRevert(err(CapabilityProof.selector, 0), r);
    }

    /// EIP-7702 profile: an EOA that has code is still its raw key's account.
    /// ECDSA runs first, so the key's 65-byte signature validates even when the
    /// delegated code would reject everything; a non-owner ECDSA falls through to
    /// that code and is judged by it (WrongMagic → CapabilityProof).
    function test_Eip7702_EoaWithCode_SignsWithEcdsaFirst() public {
        address delegated = vm.addr(E1);
        vm.etch(delegated, address(new WrongMagic1271()).code);
        assertGt(delegated.code.length, 0, "the EOA now carries code");

        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_500); // E0 → E1 (the 7702 account)
        addAnonymousHop(r, E2, 9_500); // hop 1 signed by E1's raw key
        Terminal memory t = buildTerminal(r);
        bytes memory ownKey = r.hops[1].capabilitySig;

        r.hops[1].capabilitySig = signShake(JUNK_PK, r.hops[1].shake); // recovers a stranger → code decides → rejects
        expectThankRevert(err(CapabilityProof.selector, 1), r, t);

        r.hops[1].capabilitySig = ownKey;
        doThank(r, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "raw key is the account's own authority");

        // The same profile as a GIVER: raw-key GiverAcceptance validates despite the code.
        address delegatedGiver = vm.addr(GIVER_PK);
        vm.etch(delegatedGiver, address(new WrongMagic1271()).code);
        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newRoute(h2);
        addSelfHop(r2, E3, 10_000);
        Terminal memory t2 = buildTerminal(r2); // acceptance by GIVER_PK
        doThank(r2, t2);
        assertEq(uint8(statusOf(h2)), uint8(Status.Settled), "7702 giver accepts by raw key");
    }
}
