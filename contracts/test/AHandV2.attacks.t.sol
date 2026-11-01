// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Vm} from "forge-std/Test.sol";
import {AHandTestBase} from "./AHandTestBase.sol";
import {
    AnonymousShakerWithMargin,
    ArtifactExpired,
    CapabilityProof,
    CharityNotAllowed,
    ClaimBelowFloor,
    ClaimMismatch,
    ClaimMustNotGrow,
    GiverAcceptanceInvalid,
    HandExpired,
    HandNotExpired,
    Hop,
    IAHandFacts,
    InsufficientGas,
    MarginRoundsToZero,
    NoChange,
    NotActive,
    NotPendingAdmin,
    NotRaiser,
    OnlyPolicyAdmin,
    OnlySelf,
    RaiseParams,
    RouteHashMismatch,
    Shake,
    ShakerAcceptanceInvalid,
    Status,
    Terminal,
    TransferInexact,
    WrongHand,
    ZeroAddress,
    ZeroClaim
} from "../src/AHandTypes.sol";
import {AHandSig} from "../src/AHandSig.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {PausableToken} from "./mocks/PausableToken.sol";
import {LateSenderFeeToken} from "./mocks/FeeTokens.sol";
import {HookToken, IHookRecipient} from "./mocks/HookToken.sol";
import {GasHogRecipient, TxOriginHostileRecipient, burnGas} from "./mocks/HookRecipients.sol";
import {GasHogToken} from "./mocks/GasHogToken.sol";
import {ReturndataBombToken} from "./mocks/ReturndataBombToken.sol";
import {ERC1271_MAGIC, GasBomb1271, EvilMutator1271} from "./mocks/SmartWallet1271.sol";
import {AlwaysValid1271, ReturndataBombValidator, Reentrant1271} from "./mocks/Signers1271.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: attacks (DESIGN §13, I-9 .. I-17, I-27, I-29)

        A. replay: cross-Hand, cross-Core, cross-chain, cross-hop and
           cross-Give acceptance, settled bundle, stale artifact
        B. malleability and non-canonical ECDSA encodings
        C. route truncation trio, mid-chain start, dropped / reordered /
           swapped hops
        D. forged and grown margins, unsigned mutation, anonymous margin,
           margin rounding theft
        E. claim inflation: pushExact from anyone, duplicate shaker
           positions under deferral, withdraw as a fixed-destination drain
        F. the expiry race: reclaim at expiry versus thank
        G. griefing by gas-hog / returndata-bomb recipients and validators:
           cost bounded by PUSH_GAS / ERC1271_GAS, only the hostile share parks
        H. reentrancy through a hooked token and reentrant validators on every
           entry point and inside a frame: deferral or a clean revert, never
           state corruption; the mid-push view sees a settled Hand
        I. policyAdmin abuse: every ADR-0012 "may not"
        J. extension abuse: a hostile anything-signing capability, a hostile
           controller as Raiser
        K. dust and Sybil splitting (telescoping), duplicate positions,
           self-dealing loops, capability cycles
        L. TxOriginHostileRecipient: the estimate passes, the chain reverts
           whole with nothing changed; gas starvation by the caller
        M. a token that turns hostile after raise: the stop is confined
//////////////////////////////////////////////////////////////*/

/// @notice One contract actor for every hostile role — capability, shaker,
///         giver, charity or Raiser (controller). It validates every signature
///         (so it can wear a consenting role with empty bytes), and its token
///         hook can burn gas, re-enter a target or observe Core mid-push.
///         `exec` lets it act as a contract Raiser and bubbles the callee's revert.
contract HostileAccount is IHookRecipient {
    enum Hook {
        None,
        BurnGas,
        Reenter,
        Observe
    }

    Hook public hook;
    uint256 public burn;
    address public target;
    bytes public data;
    bool public acceptAll = true;

    bool public lastOk;
    bytes public lastRet;
    uint8 public seenStatus;
    uint40 public seenClosedAt;
    bytes32 public seenSettlementHash;
    uint256 public seenClaim;

    AHandCore core;
    uint256 handId;

    function setBurn(uint256 gas) external {
        hook = Hook.BurnGas;
        burn = gas;
    }

    function setReenter(address target_, bytes calldata data_) external {
        hook = Hook.Reenter;
        target = target_;
        data = data_;
    }

    function setObserve(AHandCore core_, uint256 handId_) external {
        hook = Hook.Observe;
        core = core_;
        handId = handId_;
    }

    function setAcceptAll(bool accept) external {
        acceptAll = accept;
    }

    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        return acceptAll ? ERC1271_MAGIC : bytes4(0xffffffff);
    }

    function onTokenReceived(address, uint256) external {
        if (hook == Hook.BurnGas) {
            burnGas(burn);
        } else if (hook == Hook.Reenter) {
            (lastOk, lastRet) = target.call(data);
        } else if (hook == Hook.Observe) {
            IAHandFacts.HandFacts memory f = core.facts(handId);
            seenStatus = uint8(f.status);
            seenClosedAt = f.closedAt;
            seenSettlementHash = f.settlementHash;
            seenClaim = core.claims(msg.sender, address(this)); // msg.sender is the token
        }
    }

    /// @dev Act as a contract Raiser (or any caller); the callee's revert bubbles.
    function exec(address target_, bytes calldata data_) external returns (bytes memory ret) {
        bool ok;
        (ok, ret) = target_.call(data_);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

contract AHandV2AttacksTest is AHandTestBase {
    uint256 constant THIEF_PK = 0x7EEFaa;
    uint256 constant RAISER_PK = 0x4A15aa;
    uint256 constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    address thief;

    function setUp() public override {
        super.setUp();
        thief = vm.addr(THIEF_PK);
        vm.label(thief, "thief");
    }

    /*//////////////////// helpers ////////////////////*/

    /// Canonical honest chain: root E0 → E1 (shakerA, 10 %) → E2 (shakerB, 5 %), terminal 85 %.
    function honestChain(uint256 h) internal view returns (RouteBuild memory r) {
        r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        addExplicitHop(r, E2, shakerB, SHAKER_B_PK, 8_500);
    }

    function assertStatus(uint256 h, Status s) internal view {
        assertEq(uint8(statusOf(h)), uint8(s), "status");
    }

    function err(bytes4 selector) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(selector);
    }

    /// @dev The transient lock's revert data.
    function locked() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
    }

    function err(bytes4 selector, uint256 position) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(selector, position);
    }

    /// @dev Re-sign a (mutated) terminal with the route tail and `giverPk`.
    function resign(RouteBuild memory r, Terminal memory t, uint256 giverPk) internal view {
        bytes32 giveHash = AHandSig.hashGive(t.give);
        t.capabilitySig = signStructOn(r.core, r.parentPk, giveHash);
        t.giverAcceptanceSig = signStructOn(r.core, giverPk, AHandSig.hashGiverAcceptance(giveHash));
    }

    function split(bytes memory sig) internal pure returns (bytes32 r_, bytes32 s_, uint8 v_) {
        assembly ("memory-safe") {
            r_ := mload(add(sig, 0x20))
            s_ := mload(add(sig, 0x40))
            v_ := byte(0, mload(add(sig, 0x60)))
        }
    }

    /// @dev The high-s twin (r, N − s, flipped v): same key on the raw precompile.
    function highS(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r_, bytes32 s_, uint8 v_) = split(sig);
        return abi.encodePacked(r_, bytes32(SECP256K1_N - uint256(s_)), v_ == 27 ? uint8(28) : uint8(27));
    }

    /// @dev Count payout events of `sig` toward `beneficiary` (zero = any beneficiary).
    function countPayouts(Vm.Log[] memory logs, bytes32 sig, address beneficiary) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != sig) continue;
            if (beneficiary == address(0) || address(uint160(uint256(logs[i].topics[3]))) == beneficiary) ++n;
        }
    }

    /// @dev A failing call through the raiser: gas it consumed and its revert data.
    function failingThank(RouteBuild memory r, Terminal memory t) internal returns (uint256 used, bytes memory ret) {
        bytes memory cd = abi.encodeCall(r.core.thank, (r.handId, r.hops, t));
        vm.prank(raiser);
        uint256 before = gasleft();
        (bool ok, bytes memory data) = address(r.core).call(cd);
        used = before - gasleft();
        assertFalse(ok, "thank must fail");
        ret = data;
    }

    /// @dev The smallest gas at which `cd` succeeds from `sender` with `origin` — what
    ///      `eth_estimateGas` binary-searches for. State is restored after every probe.
    function minGas(address target, bytes memory cd, address sender, address origin) internal returns (uint256 hi) {
        uint256 lo = 60_000;
        hi = 4_000_000;
        uint256 snap = vm.snapshotState();
        vm.prank(sender, origin);
        (bool ok,) = target.call{gas: hi}(cd);
        vm.revertToState(snap);
        assertTrue(ok, "upper bound must succeed");
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) >> 1;
            snap = vm.snapshotState();
            vm.prank(sender, origin);
            (ok,) = target.call{gas: mid}(cd);
            vm.revertToState(snap);
            if (ok) hi = mid;
            else lo = mid;
        }
    }

    function newHookToken() internal returns (HookToken hook) {
        hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
    }

    /*//////////////////////////////////////////////////////////
        A. replay
    //////////////////////////////////////////////////////////*/

    /// Every Shake and Give names its Hand; the bundle of one Hand is dead on another,
    /// and re-pointing a signed Shake is a forgery of the capability's signature.
    function test_Replay_CrossHand_WrongHandThenForgery() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();
        RouteBuild memory r = newRoute(h1);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);

        vm.prank(raiser);
        vm.expectRevert(err(WrongHand.selector, 0));
        core.thank(h2, r.hops, t);

        // a zero-shake Give of h1 against h2: the Give is position 0 == hops.length
        RouteBuild memory z = newRoute(h1);
        Terminal memory tz = buildTerminal(z);
        vm.prank(raiser);
        vm.expectRevert(err(WrongHand.selector, 0));
        core.thank(h2, z.hops, tz);

        // re-pointing the Shake at h2 under the old signature
        r.hops[0].shake.handId = h2;
        vm.prank(raiser);
        vm.expectRevert(err(CapabilityProof.selector, 0));
        core.thank(h2, r.hops, t);

        assertStatus(h1, Status.Active);
        assertStatus(h2, Status.Active);
    }

    /// The domain binds the verifying Core and `handRef` binds it into the route hash:
    /// the same handId on a sibling Core accepts nothing signed for this one.
    function test_Replay_CrossCore_Rejected() public {
        AHandCore coreB = deployCore(charity, policyAdmin);
        fundFor(coreB, address(usd), raiser, 1_000e6);
        uint256 hA = makeRaise();
        uint256 hB = makeRaiseAs(raiser, coreB, defaultParams(), DEFAULT_REF, noTags());
        assertEq(hA, hB, "same id on both Cores");

        RouteBuild memory r = newRoute(hA);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);
        vm.prank(raiser);
        vm.expectRevert(err(CapabilityProof.selector, 0));
        coreB.thank(hB, r.hops, t);

        // zero-shake: the route hash carries the Core before any signature is read
        RouteBuild memory z = newRoute(hA);
        Terminal memory tz = buildTerminal(z);
        vm.prank(raiser);
        vm.expectRevert(RouteHashMismatch.selector);
        coreB.thank(hB, z.hops, tz);

        // the artifacts settle only where they were signed
        doThank(r, t);
        assertStatus(hA, Status.Settled);
        assertEq(uint8(coreB.facts(hB).status), uint8(Status.Active), "sibling Core untouched");
    }

    /// A fork recomputes the domain and the Hand reference: every artifact signed on the
    /// home chain dies on the fork, and lives again on the home chain.
    function test_Replay_CrossChain_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory t = buildTerminal(r);
        RouteBuild memory z = newRoute(h);
        Terminal memory tz = buildTerminal(z);
        bytes32 homeDomain = core.DOMAIN_SEPARATOR();

        vm.chainId(8453);
        assertTrue(core.DOMAIN_SEPARATOR() != homeDomain, "domain recomputed on the fork");
        expectThankRevert(err(CapabilityProof.selector, 0), r, t);
        expectThankRevert(err(RouteHashMismatch.selector), z, tz);
        assertStatus(h, Status.Active);

        vm.chainId(31337);
        assertEq(core.DOMAIN_SEPARATOR(), homeDomain);
        doThank(r, t);
        assertStatus(h, Status.Settled);
    }

    /// A ShakerAcceptance signs one struct hash: it moves neither to another hop of the
    /// same shaker nor to the identical hop of another Hand.
    function test_Replay_AcceptanceAcrossHopsAndHands_Rejected() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        RouteBuild memory r = newRoute(h1);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_000);
        r.hops[1].shakerAcceptanceSig = r.hops[0].shakerAcceptanceSig;
        expectThankRevert(err(ShakerAcceptanceInvalid.selector, 1), r, buildTerminal(r));

        RouteBuild memory r1 = newRoute(h1);
        addExplicitHop(r1, E1, shakerA, SHAKER_A_PK, 9_000);
        RouteBuild memory r2 = newRoute(h2);
        addExplicitHop(r2, E1, shakerA, SHAKER_A_PK, 9_000);
        r2.hops[0].shakerAcceptanceSig = r1.hops[0].shakerAcceptanceSig;
        expectThankRevert(err(ShakerAcceptanceInvalid.selector, 0), r2, buildTerminal(r2));
    }

    /// Both terminal signatures bind the exact Give: a different solution commitment
    /// is a different Give, for the giver and for the terminal capability alike.
    function test_Replay_TerminalSignaturesAcrossGives_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory tA = buildTerminal(r, giver, GIVER_PK, keccak256("A"), defaultDeadline());
        Terminal memory tB = buildTerminal(r, giver, GIVER_PK, keccak256("B"), defaultDeadline());

        Terminal memory forgedAcceptance = tB;
        forgedAcceptance.giverAcceptanceSig = tA.giverAcceptanceSig;
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, forgedAcceptance);

        Terminal memory forgedGive = buildTerminal(r, giver, GIVER_PK, keccak256("B"), defaultDeadline());
        forgedGive.capabilitySig = tA.capabilitySig;
        expectThankRevert(err(CapabilityProof.selector, 1), r, forgedGive);
    }

    /// Terminal status is the single-use guard: a settled bundle replays into NotActive
    /// and expiry never reopens a settled Hand.
    function test_Replay_SettledBundle_NotActive() public {
        uint256 h = makeRaise();
        RouteBuild memory r = honestChain(h);
        Terminal memory t = settle(r);
        uint256 coreBefore = usd.balanceOf(address(core));

        expectThankRevert(err(NotActive.selector), r, t);
        warpToExpiry(h);
        vm.prank(stranger);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
        expectThankRevert(err(NotActive.selector), r, t); // status is checked before the window
        assertEq(usd.balanceOf(address(core)), coreBefore, "nothing moved on replay");
    }

    /// A Shake past its own deadline is dead even while the Hand is live.
    function test_Replay_StaleShake_ArtifactExpired() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        uint40 hopDeadline = uint40(vm.getBlockTimestamp() + 7 days);
        addHop(r, E1, vm.addr(E0), 0, 9_000, hopDeadline);
        vm.warp(hopDeadline + 1);
        Terminal memory t = buildTerminal(r); // fresh Give over a stale hop
        expectThankRevert(err(ArtifactExpired.selector, 0), r, t);
        assertStatus(h, Status.Active);
    }

    /*//////////////////////////////////////////////////////////
        B. malleability
    //////////////////////////////////////////////////////////*/

    /// The high-s twin recovers the same key on the raw precompile and is rejected in
    /// every family; signature bytes are outside every hash, so nothing is renamed.
    function test_Malleability_HighS_RejectedInEveryFamily() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory t = buildTerminal(r);

        // the twin really is a twin
        bytes memory twin = highS(r.hops[0].capabilitySig);
        (bytes32 tr, bytes32 ts, uint8 tv) = split(twin);
        bytes32 digest = digestOf(AHandSig.hashShake(r.hops[0].shake));
        assertEq(ecrecover(digest, tv, tr, ts), vm.addr(E0), "raw precompile accepts the twin");

        bytes memory keep = r.hops[0].capabilitySig;
        r.hops[0].capabilitySig = twin;
        expectThankRevert(err(CapabilityProof.selector, 0), r, t);
        r.hops[0].capabilitySig = keep;

        keep = r.hops[0].shakerAcceptanceSig;
        r.hops[0].shakerAcceptanceSig = highS(keep);
        expectThankRevert(err(ShakerAcceptanceInvalid.selector, 0), r, t);
        r.hops[0].shakerAcceptanceSig = keep;

        keep = t.capabilitySig;
        t.capabilitySig = highS(keep);
        expectThankRevert(err(CapabilityProof.selector, 1), r, t);
        t.capabilitySig = keep;

        keep = t.giverAcceptanceSig;
        t.giverAcceptanceSig = highS(keep);
        expectThankRevert(err(GiverAcceptanceInvalid.selector), r, t);
        t.giverAcceptanceSig = keep;

        doThank(r, t); // the canonical bundle still settles
        assertStatus(h, Status.Settled);
    }

    /// Only the 65-byte r‖s‖v form recovers: compact (EIP-2098), padded, empty and bad-v
    /// encodings of a valid signature are all rejected for an EOA.
    function test_Malleability_NonCanonicalEncodings_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);
        (bytes32 r_, bytes32 s_, uint8 v_) = split(r.hops[0].capabilitySig);

        bytes[4] memory forms;
        forms[0] = abi.encodePacked(r_, bytes32(uint256(s_) | (uint256(v_ - 27) << 255))); // 64-byte compact
        forms[1] = abi.encodePacked(r_, s_, v_, uint8(0)); // 66 bytes
        forms[2] = ""; // empty: an EOA never validates empty bytes
        forms[3] = abi.encodePacked(r_, s_, uint8(0)); // bad v
        for (uint256 i; i < forms.length; ++i) {
            r.hops[0].capabilitySig = forms[i];
            expectThankRevert(err(CapabilityProof.selector, 0), r, t);
        }
    }

    /*//////////////////////////////////////////////////////////
        C. truncation and route shape
    //////////////////////////////////////////////////////////*/

    /// (a) Compliant payload: the giver holds only the TERMINAL key E2. A route cut at E1
    /// needs E1's Give; neither E2 nor a random key signs it, and the full-route Give
    /// cannot ride the cut (routeHash pins all hops).
    function test_Truncation_CompliantPayload_Reverts() public {
        uint256 h = makeRaise();
        RouteBuild memory full = honestChain(h);
        RouteBuild memory cut = newRoute(h);
        addExplicitHop(cut, E1, shakerA, SHAKER_A_PK, 9_000);

        cut.parentPk = E2;
        expectThankRevert(err(CapabilityProof.selector, 1), cut, buildTerminal(cut));
        cut.parentPk = 0xBAD;
        expectThankRevert(err(CapabilityProof.selector, 1), cut, buildTerminal(cut));
        expectThankRevert(err(RouteHashMismatch.selector), cut, buildTerminal(full));
        assertStatus(h, Status.Active);
    }

    /// (b) Leaked parent key: with E1 in hand truncation IS possible, by design — the
    /// capability boundary is exactly the enforceable one. The thief takes the tail
    /// residual; the stripped shakerB gets nothing; the charity is still paid.
    function test_Truncation_LeakedParentKey_Succeeds_ByDesign() public {
        uint256 h = makeRaise();
        honestChain(h); // the full payload exists; the thief strips it
        RouteBuild memory cut = newRoute(h);
        addExplicitHop(cut, E1, shakerA, SHAKER_A_PK, 9_000);
        doThank(cut, buildTerminal(cut, thief, THIEF_PK, DEFAULT_SOLUTION, defaultDeadline()));

        assertEq(usd.balanceOf(thief), 81e6, "leaked key captures the tail residual");
        assertEq(usd.balanceOf(shakerA), 9e6, "hop 0 is paid as consented");
        assertEq(usd.balanceOf(shakerB), 0, "the stripped hop earns nothing");
        assertEq(usd.balanceOf(charity), 10e6);
    }

    /// (c) Personal anchor: a hop whose child capability is the recipient's own wallet
    /// stops truncation beyond it — only that wallet signs the Give.
    function test_Truncation_PersonalAnchor_Blocks() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        addExplicitHop(r, GIVER_PK, shakerB, SHAKER_B_PK, 8_000); // child = giver's wallet

        r.parentPk = THIEF_PK;
        expectThankRevert(
            err(CapabilityProof.selector, 2), r, buildTerminal(r, thief, THIEF_PK, DEFAULT_SOLUTION, defaultDeadline())
        );
        r.parentPk = GIVER_PK;
        doThank(r, buildTerminal(r));
        assertEq(usd.balanceOf(giver), 72e6, "anchor passes for its owner: D - 9e6 - 9e6");
    }

    /// The chain starts at the stored root: a route entered mid-way never verifies.
    function test_MidChainStart_Impossible() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        r.parentPk = E1; // skip the root
        addAnonymousHop(r, E2, 10_000);
        expectThankRevert(err(CapabilityProof.selector, 0), r, buildTerminal(r));
    }

    /// Dropping an interior hop or reordering hops breaks the signer chain at the first
    /// misplaced hop; swapping the tail orphans the Give.
    function test_RouteSurgery_DroppedReorderedSwapped_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory full = newRoute(h);
        addSelfHop(full, E1, 9_500);
        addSelfHop(full, E2, 9_000);
        addSelfHop(full, E3, 8_500);
        Terminal memory tFull = buildTerminal(full);

        // dropped interior hop: hop 2 is signed by E2, but after hop 0 the expected signer is E1
        RouteBuild memory dropped = newRoute(h);
        addRawHop(dropped, full.hops[0]);
        addRawHop(dropped, full.hops[2]);
        expectThankRevert(err(CapabilityProof.selector, 1), dropped, tFull);

        // reordered: hop 1 first is signed by E1, not the root
        RouteBuild memory reordered = newRoute(h);
        addRawHop(reordered, full.hops[1]);
        addRawHop(reordered, full.hops[0]);
        addRawHop(reordered, full.hops[2]);
        expectThankRevert(err(CapabilityProof.selector, 0), reordered, tFull);

        // tail swap: identical prefix, a validly signed different tail, the original Give
        RouteBuild memory swapped = newRoute(h);
        addSelfHop(swapped, E1, 9_500);
        addSelfHop(swapped, E2, 9_000);
        addSelfHop(swapped, E4, 8_500);
        expectThankRevert(err(RouteHashMismatch.selector), swapped, tFull);

        doThank(full, tFull);
        assertStatus(h, Status.Settled);
    }

    /*//////////////////////////////////////////////////////////
        D. forged and grown margins
    //////////////////////////////////////////////////////////*/

    function test_ClaimMustNotGrow_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addAnonymousHop(r, E1, 10_500);
        expectThankRevert(err(ClaimMustNotGrow.selector, 0), r, buildTerminal(r));
    }

    /// A signed but discontinuous telescope: hop 1 opens at 8 888 although hop 0 closed at 9 000.
    function test_ClaimMismatch_DiscontinuousTelescope_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        r.claim = 8_888;
        addSelfHop(r, E2, 8_000);
        expectThankRevert(err(ClaimMismatch.selector, 1), r, buildTerminal(r));
    }

    /// The giver floor binds every hop, not only the terminal claim.
    function test_ClaimBelowFloor_InteriorDip_Rejected() public {
        RaiseParams memory p = defaultParams();
        p.minGiverClaimBps = 9_000;
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_500);
        addSelfHop(r, E2, 8_999);
        expectThankRevert(err(ClaimBelowFloor.selector, 1), r, buildTerminal(r));
    }

    /// The terminal capability and the giver conspire on a Give claiming 10 000 after a
    /// route that left 9 000: both signatures are valid and the Give is still rejected.
    function test_ForgedGive_FinalClaim_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);
        t.give.finalClaimBps = 10_000;
        resign(r, t, GIVER_PK);
        expectThankRevert(err(ClaimMismatch.selector, 1), r, t);
    }

    /// Any unsigned mutation of a Shake (claim, shaker, child) is a forgery of the
    /// capability's signature, caught before any consent or arithmetic.
    function test_ForgedShake_UnsignedMutation_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory t = buildTerminal(r);

        uint16 keepClaim = r.hops[0].shake.childClaimBps;
        r.hops[0].shake.childClaimBps = 8_000; // a fatter margin
        expectThankRevert(err(CapabilityProof.selector, 0), r, t);
        r.hops[0].shake.childClaimBps = keepClaim;

        r.hops[0].shake.shaker = thief; // redirected margin
        expectThankRevert(err(CapabilityProof.selector, 0), r, t);
        r.hops[0].shake.shaker = shakerA;

        r.hops[0].shake.childCapability = thief; // hijacked tail
        expectThankRevert(err(CapabilityProof.selector, 0), r, t);
    }

    /// A margin to nobody and a margin to nothing: both rejected at their hop.
    function test_MarginToNobodyOrNothing_Rejected() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, address(0), 0, 9_000, defaultDeadline());
        expectThankRevert(err(AnonymousShakerWithMargin.selector, 0), r, buildTerminal(r));

        RaiseParams memory p = defaultParams();
        p.amount = 50; // C = 5, D = 45: a 1-bps margin floors to zero
        uint256 small = makeRaise(p);
        RouteBuild memory rs = newRoute(small);
        addSelfHop(rs, E1, 9_999);
        expectThankRevert(err(MarginRoundsToZero.selector, 0), rs, buildTerminal(rs));
    }

    /*//////////////////////////////////////////////////////////
        E. claim inflation
    //////////////////////////////////////////////////////////*/

    /// The rollback frame is reachable from no external account — EOA, raiser, admin,
    /// test or contract — and custody never moves on their instruction.
    function test_PushExact_OnlySelf_FromEveryone() public {
        makeRaise();
        address[4] memory callers = [stranger, raiser, policyAdmin, address(this)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(OnlySelf.selector);
            core.pushExact(address(usd), callers[i], 1);
        }
        HostileAccount acct = new HostileAccount();
        vm.expectRevert(OnlySelf.selector);
        acct.exec(address(core), abi.encodeCall(core.pushExact, (address(usd), address(acct), 1)));
        assertEq(usd.balanceOf(address(core)), DEPOSIT, "custody intact");
    }

    /// A shaker on two positions is paid per position, exactly; under deferral both
    /// shares aggregate into one claim and drain once.
    function test_DuplicateShakerPositions_AggregateExactly() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000); // position 0: 10 % → 9e6
        addSelfHop(r, E2, 8_500); // position 1: vm.addr(E1) 5 % → 4.5e6
        addExplicitHop(r, E3, shakerA, SHAKER_A_PK, 8_000); // position 2: 5 % → 4.5e6
        bl.setBlocked(shakerA, true);

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(countPayouts(logs, AHandCore.PayoutDeferred.selector, shakerA), 2, "one deferral per position");
        assertEq(countPayouts(logs, AHandCore.PayoutPushed.selector, address(0)), 3, "charity, E1, giver pushed");
        assertEq(claimOf(address(bl), shakerA), 13.5e6, "aggregate claim, nothing more");
        assertEq(bl.balanceOf(address(core)), 13.5e6, "custody holds exactly the parked shares");

        bl.setBlocked(shakerA, false);
        vm.prank(stranger);
        core.withdraw(address(bl), shakerA);
        assertEq(bl.balanceOf(shakerA), 13.5e6);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(bl), shakerA);
        assertEq(bl.balanceOf(address(core)), 0);
    }

    /// withdraw has no destination parameter: whoever pays the gas, the claim reaches
    /// its beneficiary or stays; a drained claim is gone; unknown claims are zero.
    function test_Withdraw_FixedDestination_NoInflation() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h = makeRaise();
        bl.setBlocked(giver, true);
        settleSimple(h);
        assertEq(claimOf(address(bl), giver), 90e6);

        vm.prank(stranger);
        vm.expectRevert(bytes("BLACKLISTED"));
        core.withdraw(address(bl), giver);
        assertEq(claimOf(address(bl), giver), 90e6, "claim restored by the revert");

        bl.setBlocked(giver, false);
        vm.prank(stranger);
        core.withdraw(address(bl), giver);
        assertEq(bl.balanceOf(giver), 90e6);
        assertEq(bl.balanceOf(stranger), 0, "the payer of gas receives nothing");
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(bl), giver);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(bl), stranger);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), giver); // another token, no claim
    }

    /*//////////////////////////////////////////////////////////
        F. the expiry race
    //////////////////////////////////////////////////////////*/

    /// At expiry the thank window is closed whatever the ordering: a reclaim front-run
    /// changes the error from HandExpired to NotActive, never the outcome.
    function test_Frontrun_ReclaimAtExpiry_ThankCannotLand() public {
        uint256 h = makeRaise();
        uint40 expiry = core.facts(h).expiry;
        warpToExpiry(h);
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, vm.addr(E0), 0, 9_000, expiry);
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, expiry);

        expectThankRevert(err(HandExpired.selector), r, t);
        vm.prank(stranger);
        core.reclaim(h);
        expectThankRevert(err(NotActive.selector), r, t);
        assertEq(usd.balanceOf(raiser), 1_000_000e6, "full refund, no donation");
        assertEq(usd.balanceOf(giver), 0);
    }

    /// One second earlier the race goes the other way: reclaim is premature, the thank
    /// lands, and expiry cannot reopen the settled Hand.
    function test_Frontrun_ThankBeforeExpiry_ReclaimCannotLand() public {
        uint256 h = makeRaise();
        uint40 expiry = core.facts(h).expiry;
        vm.warp(expiry - 1);
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, vm.addr(E0), 0, 9_000, expiry);
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, expiry);

        vm.prank(stranger);
        vm.expectRevert(HandNotExpired.selector);
        core.reclaim(h);
        doThank(r, t);
        vm.warp(expiry);
        vm.prank(stranger);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
        assertEq(usd.balanceOf(giver), 81e6);
    }

    /*//////////////////////////////////////////////////////////
        G. griefing: gas hogs and returndata bombs
    //////////////////////////////////////////////////////////*/

    /// A gas-hog giver (hook burning more than PUSH_GAS) parks only its own share, costs
    /// the thank at most PUSH_GAS + the deferral bookkeeping over an honest contract
    /// giver, and is drained by a top-level withdraw with unbounded gas.
    function test_GasHogRecipient_ParksOwnShare_CostBounded() public {
        HookToken hook = newHookToken();
        HostileAccount honest = new HostileAccount();
        HostileAccount hog = new HostileAccount();
        hog.setBurn(250_000);
        hook.setHooked(address(honest), true);
        hook.setHooked(address(hog), true);
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        RouteBuild memory r1 = newRoute(h1);
        addSelfHop(r1, E1, 9_000);
        uint256 gHonest = measureThank(r1, buildTerminal(r1, address(honest), 0, DEFAULT_SOLUTION, defaultDeadline()));
        assertEq(hook.balanceOf(address(honest)), 81e6, "honest contract giver is pushed");

        RouteBuild memory r2 = newRoute(h2);
        addSelfHop(r2, E1, 9_000);
        vm.recordLogs();
        uint256 gHog = measureThank(r2, buildTerminal(r2, address(hog), 0, DEFAULT_SOLUTION, defaultDeadline()));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(countPayouts(logs, AHandCore.PayoutDeferred.selector, address(hog)), 1, "only the hog defers");
        assertEq(countPayouts(logs, AHandCore.PayoutPushed.selector, address(0)), 2, "charity and E0 land");
        assertEq(claimOf(address(hook), address(hog)), 81e6);
        assertEq(hook.balanceOf(address(hog)), 0);
        assertLt(gHog - gHonest, core.PUSH_GAS() + 30_000, "I-29: the hog costs at most its frame");
        assertGt(gHog - gHonest, 100_000, "the frame really burned toward its cap");

        core.withdraw(address(hook), address(hog));
        assertEq(hook.balanceOf(address(hog)), 81e6, "unbounded gas drains the claim");
    }

    /// A heavy-but-honest token push below PUSH_GAS lands; above it the push defers and
    /// withdraw (unbounded) still drains it. The cap is a cost bound, not a liveness bound.
    function test_GasHogToken_BelowCapLands_AboveCapDefers() public {
        GasHogToken gt = new GasHogToken();
        useToken(address(gt));
        fund(address(gt), raiser, 1_000e6);
        gt.setHog(giver, true);
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        gt.setHogGas(100_000);
        settleSimple(h1);
        assertEq(gt.balanceOf(giver), 90e6, "below the cap the heavy push lands");

        gt.setHogGas(250_000);
        settleSimple(h2);
        assertEq(gt.balanceOf(giver), 90e6, "above the cap nothing moved");
        assertEq(claimOf(address(gt), giver), 90e6, "exactly the share parked");
        core.withdraw(address(gt), giver);
        assertEq(gt.balanceOf(giver), 180e6);
    }

    /// A gas-bombing validator costs the submitter exactly its capped budget and fails as
    /// its family's hop-indexed error — capability, shaker and giver alike.
    function test_GasBombValidator_CostCappedAtERC1271Gas() public {
        GasBomb1271 bomb = new GasBomb1271();
        uint256 cap = core.ERC1271_GAS();

        // as an explicit shaker
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addHopTo(r, vm.addr(E1), E1, address(bomb), 0, 9_000, bytes32(0), defaultDeadline());
        (uint256 used, bytes memory ret) = failingThank(r, buildTerminal(r));
        assertEq(ret, err(ShakerAcceptanceInvalid.selector, 0));
        assertGe(used, cap, "the bomb burned its whole budget");
        assertLt(used, cap + 250_000, "and not one budget more");

        // as the giver
        RouteBuild memory rg = newRoute(h);
        addSelfHop(rg, E1, 9_000);
        (used, ret) = failingThank(rg, buildTerminal(rg, address(bomb), 0, DEFAULT_SOLUTION, defaultDeadline()));
        assertEq(ret, err(GiverAcceptanceInvalid.selector));
        assertGe(used, cap);
        assertLt(used, cap + 250_000);

        // as the root capability of its own Hand
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(bomb);
        uint256 hb = makeRaise(p);
        RouteBuild memory rb = newRouteOn(core, hb, E0);
        (used, ret) = failingThank(rb, buildTerminal(rb));
        assertEq(ret, err(CapabilityProof.selector, 0));
        assertGe(used, cap);
        assertLt(used, cap + 250_000);
        assertStatus(h, Status.Active);
    }

    /// A 1 MiB answer cannot be paid for under ERC1271_GAS, so it is simply invalid; a
    /// small padded answer validates because Core reads a fixed 32-byte buffer.
    function test_ReturndataBombValidator_InvalidWhenUnaffordable() public {
        ReturndataBombValidator bomb = new ReturndataBombValidator();
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r, address(bomb), 0, DEFAULT_SOLUTION, defaultDeadline());

        (uint256 used, bytes memory ret) = failingThank(r, t);
        assertEq(ret, err(GiverAcceptanceInvalid.selector));
        assertLt(used, core.ERC1271_GAS() + 250_000, "the bomb is paid inside the capped staticcall");

        bomb.setBombSize(256);
        doThank(r, t);
        assertEq(usd.balanceOf(address(bomb)), 81e6, "a small bomb is just a valid answer");
    }

    /// A token answering `transfer` with 1 MiB cannot afford its own memory inside the
    /// frame: every push parks, the parent copies nothing, and a top-level withdraw
    /// (unbounded) lets the token pay for its bomb and lands.
    function test_ReturndataBombToken_FramePaysDefersWithdrawDrains() public {
        ReturndataBombToken bt = new ReturndataBombToken();
        useToken(address(bt));
        fund(address(bt), raiser, 1_000e6);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);

        vm.recordLogs();
        uint256 used = measureThank(r, buildTerminal(r));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(countPayouts(logs, AHandCore.PayoutDeferred.selector, address(0)), 3, "every push parks");
        assertEq(bt.balanceOf(address(core)), DEPOSIT, "nothing moved");
        assertLt(used, 3 * core.PUSH_GAS() + 400_000, "three capped frames, no returndata copied");

        core.withdraw(address(bt), giver);
        assertEq(bt.balanceOf(giver), 81e6, "the token pays for its own bomb at the top level");
        assertEq(claimOf(address(bt), giver), 0);

        bt.setBomb(64, true, false);
        uint256 h2 = makeRaise();
        settleSimple(h2);
        assertEq(bt.balanceOf(giver), 81e6 + 90e6, "a small answer is just a valid push");
    }

    /*//////////////////////////////////////////////////////////
        H. reentrancy
    //////////////////////////////////////////////////////////*/

    /// From inside a push frame, every entry point is locked and the frame itself is
    /// self-only; the hostile hook learns that and the pushes still land.
    function test_Reentrancy_FromPushFrame_EveryEntryPointLocked() public {
        HookToken hook = newHookToken();
        uint256 h = makeRaise();
        uint256 h2 = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);

        bytes[5] memory attempts;
        attempts[0] = abi.encodeCall(core.raise, (defaultParams(), DEFAULT_REF, noTags()));
        attempts[1] = abi.encodeCall(core.thank, (h2, r.hops, t));
        attempts[2] = abi.encodeCall(core.reclaim, (h2));
        attempts[3] = abi.encodeCall(core.withdraw, (address(hook), giver));
        attempts[4] = abi.encodeCall(core.pushExact, (address(hook), stranger, 1e6));
        for (uint256 i; i < attempts.length; ++i) {
            uint256 snap = vm.snapshotState();
            hook.setReentry(address(core), attempts[i], false, true, false);
            doThank(r, t);
            assertFalse(hook.lastReentryOk(), "re-entry rejected");
            assertEq(hook.lastReentryReturn(), i == 4 ? err(OnlySelf.selector) : locked());
            assertStatus(h, Status.Settled);
            assertStatus(h2, Status.Active);
            assertEq(hook.balanceOf(giver), 81e6, "pushes landed despite the attempt");
            assertEq(hook.balanceOf(address(core)), DEPOSIT, "the sibling's escrow is whole");
            assertEq(hook.balanceOf(stranger), 0);
            assertEq(core.handsCount(), 2, "no Hand was raised from inside");
            vm.revertToState(snap);
        }
    }

    /// When the hook makes the re-entry failure fatal to the transfer, each frame rolls
    /// back and parks exactly its share: deferral, never corruption; withdraw drains later.
    function test_Reentrancy_FatalHook_DefersEachShareExactly() public {
        HookToken hook = newHookToken();
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        hook.setReentry(address(core), abi.encodeCall(core.withdraw, (address(hook), giver)), false, true, true);

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(countPayouts(logs, AHandCore.PayoutDeferred.selector, address(0)), 3);
        assertEq(claimOf(address(hook), charity), 10e6);
        assertEq(claimOf(address(hook), vm.addr(E0)), 9e6);
        assertEq(claimOf(address(hook), giver), 81e6);
        assertEq(hook.balanceOf(address(core)), DEPOSIT);
        assertStatus(h, Status.Settled);

        // withdraw re-entering withdraw: the lock bubbles through the token, the claim survives
        vm.expectRevert(locked());
        core.withdraw(address(hook), giver);
        assertEq(claimOf(address(hook), giver), 81e6);

        hook.setReentry(address(0), "", false, false, false);
        core.withdraw(address(hook), giver);
        assertEq(hook.balanceOf(giver), 81e6);
    }

    /// From inside the deposit (`transferFrom` of raise) every entry point is locked; the
    /// raise still completes with exactly one new Hand.
    function test_Reentrancy_FromDeposit_Locked() public {
        HookToken hook = newHookToken();
        uint256 seed = makeRaise();
        RouteBuild memory r = newRoute(seed);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r);

        bytes[4] memory attempts;
        attempts[0] = abi.encodeCall(core.raise, (defaultParams(), DEFAULT_REF, noTags()));
        attempts[1] = abi.encodeCall(core.thank, (seed, r.hops, t));
        attempts[2] = abi.encodeCall(core.reclaim, (seed));
        attempts[3] = abi.encodeCall(core.withdraw, (address(hook), raiser));
        for (uint256 i; i < attempts.length; ++i) {
            hook.setReentry(address(core), attempts[i], true, false, false);
            uint256 before = core.handsCount();
            uint256 h = makeRaise();
            assertEq(h, before + 1, "exactly one Hand per raise");
            assertFalse(hook.lastReentryOk());
            assertEq(hook.lastReentryReturn(), locked());
            assertStatus(h, Status.Active);
            assertEq(core.facts(h).pool, DEPOSIT);
            assertStatus(seed, Status.Active);
        }
    }

    /// A hooked token that is also the policy admin flips the allowlist mid-deposit:
    /// `Raised` names the pre-deposit revision and the Hand keeps its recipient.
    function test_Reentrancy_DepositHookFlipsAllowlist_RevisionSnapshotted() public {
        HookToken hook = new HookToken();
        AHandCore c = deployCore(charity, address(hook));
        fundFor(c, address(hook), raiser, 1_000e6);
        useToken(address(hook));
        hook.setReentry(address(c), abi.encodeCall(c.setCharityAllowed, (charity, false)), true, false, true);

        vm.recordLogs();
        uint256 h = makeRaiseAs(raiser, c, defaultParams(), DEFAULT_REF, noTags());
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertTrue(hook.lastReentryOk(), "the setter is not under the lock: it moves no money");
        assertEq(c.policyRevision(), 2);
        assertFalse(c.charityAllowed(charity));
        assertEq(c.facts(h).charityRecipient, charity, "the live Hand keeps its snapshot");

        uint64 revisionInRaised;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != AHandCore.Raised.selector) continue;
            (,,,,,,,,,, revisionInRaised) =
                abi.decode(logs[i].data, (uint256, uint40, address, uint8, bytes32, bytes32, bytes, uint16, address, uint16, uint64));
        }
        assertEq(revisionInRaised, 1, "Raised names the revision the check passed under");

        // the next donation raise to that charity now fails before any deposit
        vm.prank(raiser);
        vm.expectRevert(CharityNotAllowed.selector);
        c.raise(defaultParams(), DEFAULT_REF, noTags());

        // and the live Hand still pays the snapshotted recipient
        hook.setReentry(address(0), "", false, false, false);
        RouteBuild memory r = newRouteOn(c, h, E0);
        addSelfHop(r, E1, 10_000);
        doThank(r, buildTerminal(r));
        assertEq(hook.balanceOf(charity), 10e6);
    }

    /// Validators run under staticcall: a re-entering or state-writing validator is
    /// simply invalid, while a read-only re-entry (facts) validates.
    function test_Reentrancy_ValidatorsUnderStaticcall() public {
        uint256 h = makeRaise();

        Reentrant1271 writer = new Reentrant1271(address(core), abi.encodeCall(core.withdraw, (address(usd), stranger)));
        RouteBuild memory r = newRoute(h);
        addHopTo(r, vm.addr(E1), E1, address(writer), 0, 9_000, bytes32(0), defaultDeadline());
        expectThankRevert(err(ShakerAcceptanceInvalid.selector, 0), r, buildTerminal(r));

        EvilMutator1271 mutator = new EvilMutator1271();
        RouteBuild memory rm = newRoute(h);
        addSelfHop(rm, E1, 9_000);
        expectThankRevert(
            err(GiverAcceptanceInvalid.selector), rm, buildTerminal(rm, address(mutator), 0, DEFAULT_SOLUTION, defaultDeadline())
        );
        assertEq(mutator.poked(), 0, "the SSTORE never landed");

        Reentrant1271 reader = new Reentrant1271(address(core), abi.encodeCall(core.facts, (h)));
        RouteBuild memory rr = newRoute(h);
        addHopTo(rr, vm.addr(E1), E1, address(reader), 0, 9_000, bytes32(0), defaultDeadline());
        doThank(rr, buildTerminal(rr));
        assertEq(usd.balanceOf(address(reader)), 9e6, "a read-only validator is a valid shaker");
    }

    /// I-16: a recipient observing Core from inside its push sees a settled Hand with
    /// closedAt and settlementHash final, and no claim of its own.
    function test_Reentrancy_ViewMidPush_SeesSettledHand() public {
        HookToken hook = newHookToken();
        HostileAccount observer = new HostileAccount();
        hook.setHooked(address(observer), true);
        uint256 h = makeRaise();
        observer.setObserve(core, h);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        doThank(r, buildTerminal(r, address(observer), 0, DEFAULT_SOLUTION, defaultDeadline()));

        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(observer.seenStatus(), uint8(Status.Settled));
        assertEq(observer.seenClosedAt(), uint40(block.timestamp));
        assertEq(observer.seenSettlementHash(), f.settlementHash);
        assertTrue(f.settlementHash != bytes32(0));
        assertEq(observer.seenClaim(), 0);
        assertEq(hook.balanceOf(address(observer)), 81e6);
    }

    /*//////////////////////////////////////////////////////////
        I. policyAdmin abuse (ADR-0012 "may not")
    //////////////////////////////////////////////////////////*/

    /// Prospective only: removing a charity leaves every live Hand's recipient and payout
    /// untouched, never blocks a 0 % raise, and the admin has no raiser or reclaim powers.
    function test_PolicyAdmin_CannotTouchLiveHandsOrBlockZeroPercent() public {
        uint256 h = makeRaise();
        vm.prank(policyAdmin);
        core.setCharityAllowed(charity, false);

        assertEq(core.facts(h).charityRecipient, charity, "snapshot kept");
        expectRaiseRevert(CharityNotAllowed.selector, defaultParams());
        uint256 h0 = makeRaise(noCharityParams()); // never policy-gated

        settleSimple(h);
        assertEq(usd.balanceOf(charity), 10e6, "the removed charity is still paid for the live Hand");

        RouteBuild memory r = newRoute(h0);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r);
        vm.prank(policyAdmin);
        vm.expectRevert(NotRaiser.selector);
        core.thank(h0, r.hops, t);
        vm.prank(policyAdmin);
        vm.expectRevert(HandNotExpired.selector);
        core.reclaim(h0);
    }

    /// The allowlist never contains zero or Core; strangers hold no policy power; a
    /// nomination is never forced and zero can never be accepted.
    function test_PolicyAdmin_BoundaryAndHandover() public {
        vm.prank(policyAdmin);
        vm.expectRevert(ZeroAddress.selector);
        core.setCharityAllowed(address(0), true);
        vm.prank(policyAdmin);
        vm.expectRevert(CharityNotAllowed.selector);
        core.setCharityAllowed(address(core), true);
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(core);
        expectRaiseRevert(CharityNotAllowed.selector, p);

        vm.prank(stranger);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setCharityAllowed(stranger, true);
        vm.prank(stranger);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.transferPolicyAdmin(stranger);
        vm.prank(stranger);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();

        vm.prank(policyAdmin);
        vm.expectRevert(NoChange.selector);
        core.transferPolicyAdmin(address(0)); // nothing pending: cancelling nothing is a no-op
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(stranger);
        vm.prank(policyAdmin);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin(); // the admin itself is not the nominee
        vm.prank(thief);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();
        assertEq(core.policyAdmin(), policyAdmin);
        assertEq(core.pendingPolicyAdmin(), stranger);
        assertEq(core.policyRevision(), 1, "handover is not a policy change");
    }

    /// No pause, rescue, upgrade, token switch or admission switch exists, and no fallback
    /// or receive catches a call for one; ETH cannot even enter.
    function test_PolicyAdmin_NoPauseRescueUpgradeSelectors_NoFallback() public {
        bytes4[9] memory absent = [
            bytes4(keccak256("pause()")),
            bytes4(keccak256("unpause()")),
            bytes4(keccak256("rescue(address,address,uint256)")),
            bytes4(keccak256("setTokenEnabled(address,bool)")),
            bytes4(keccak256("setRaiseOpen(bool)")),
            bytes4(keccak256("upgradeTo(address)")),
            bytes4(keccak256("upgradeToAndCall(address,bytes)")),
            bytes4(keccak256("setClaim(address,address,uint256)")),
            bytes4(keccak256("setPolicyAdmin(address)"))
        ];
        for (uint256 i; i < absent.length; ++i) {
            vm.prank(policyAdmin);
            (bool ok, bytes memory ret) = address(core).call(abi.encodePacked(absent[i]));
            assertFalse(ok, "absent selector");
            assertEq(ret.length, 0, "no fallback answers");
        }
        vm.deal(policyAdmin, 1 ether);
        vm.prank(policyAdmin);
        (bool okEth,) = address(core).call{value: 1 ether}("");
        assertFalse(okEth, "no receive");
        assertEq(address(core).balance, 0);
    }

    /// Claims are not policy: no admin action moves or redirects a parked share, and the
    /// admin draining it pays the beneficiary like anyone else.
    function test_PolicyAdmin_CannotTouchClaims() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h = makeRaise();
        bl.setBlocked(giver, true);
        settleSimple(h);
        assertEq(claimOf(address(bl), giver), 90e6);

        vm.startPrank(policyAdmin);
        core.setCharityAllowed(charity, false);
        core.setCharityAllowed(charity, true);
        core.transferPolicyAdmin(thief);
        vm.stopPrank();
        assertEq(claimOf(address(bl), giver), 90e6, "policy churn never touches a claim");

        bl.setBlocked(giver, false);
        vm.prank(policyAdmin);
        core.withdraw(address(bl), giver);
        assertEq(bl.balanceOf(giver), 90e6);
        assertEq(bl.balanceOf(policyAdmin), 0);
    }

    /*//////////////////////////////////////////////////////////
        J. extension abuse
    //////////////////////////////////////////////////////////*/

    /// A root capability that validates anything can authorise any route on its Hand —
    /// and still cannot breach the floor, skip the charity, conscript a giver or thank.
    function test_ExtensionAbuse_AnythingSigningCapability_StillBounded() public {
        AlwaysValid1271 cap = new AlwaysValid1271();
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(cap);
        uint256 h = makeRaise(p);

        Shake memory s = Shake(h, thief, thief, 10_000, 4_999, bytes32(0), defaultDeadline());
        RouteBuild memory r = newRouteOn(core, h, E0);
        r.parentCap = address(cap);
        addRawHop(r, Hop(s, "", signStruct(THIEF_PK, AHandSig.hashShakerAcceptance(AHandSig.hashShake(s)))));
        r.parentPk = THIEF_PK;
        r.parentCap = thief;
        expectThankRevert(
            err(ClaimBelowFloor.selector, 0), r, buildTerminal(r, thief, THIEF_PK, DEFAULT_SOLUTION, defaultDeadline())
        );

        s.childClaimBps = 5_000; // at the floor it is a legitimate route
        RouteBuild memory ok = newRouteOn(core, h, E0);
        ok.parentCap = address(cap);
        addRawHop(ok, Hop(s, "", signStruct(THIEF_PK, AHandSig.hashShakerAcceptance(AHandSig.hashShake(s)))));
        ok.parentPk = THIEF_PK;
        ok.parentCap = thief;
        Terminal memory unwilling = buildTerminal(ok, giver, 0, DEFAULT_SOLUTION, defaultDeadline());
        expectThankRevert(err(GiverAcceptanceInvalid.selector), ok, unwilling);
        Terminal memory t = buildTerminal(ok, thief, THIEF_PK, DEFAULT_SOLUTION, defaultDeadline());
        vm.prank(address(cap));
        vm.expectRevert(NotRaiser.selector);
        core.thank(h, ok.hops, t);

        doThank(ok, t);
        assertEq(usd.balanceOf(thief), 90e6, "margin + residual = D, nothing beyond it");
        assertEq(usd.balanceOf(charity), 10e6, "the charity is paid first, from P");
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /// A hostile contract Raiser has exactly a Raiser's powers: no early reclaim, no thank
    /// of another's Hand, no settlement without the giver, no custody access, no thank
    /// after expiry; the refund is fixed to it and reaches it whole.
    function test_ExtensionAbuse_HostileControllerRaiser_OnlyRaiserPowers() public {
        HostileAccount ctl = new HostileAccount();
        usd.mint(address(ctl), DEPOSIT);
        ctl.exec(address(usd), abi.encodeCall(usd.approve, (address(core), type(uint256).max)));
        uint256 h = abi.decode(
            ctl.exec(address(core), abi.encodeCall(core.raise, (defaultParams(), DEFAULT_REF, noTags()))), (uint256)
        );
        uint256 other = makeRaise();
        assertEq(core.facts(h).raiser, address(ctl));

        vm.expectRevert(HandNotExpired.selector);
        ctl.exec(address(core), abi.encodeCall(core.reclaim, (h)));

        RouteBuild memory ro = newRoute(other);
        addSelfHop(ro, E1, 10_000);
        Terminal memory to = buildTerminal(ro);
        vm.expectRevert(NotRaiser.selector);
        ctl.exec(address(core), abi.encodeCall(core.thank, (other, ro.hops, to)));

        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        Terminal memory noConsent = buildTerminal(r, giver, 0, DEFAULT_SOLUTION, defaultDeadline());
        vm.expectRevert(GiverAcceptanceInvalid.selector);
        ctl.exec(address(core), abi.encodeCall(core.thank, (h, r.hops, noConsent)));

        vm.expectRevert(OnlySelf.selector);
        ctl.exec(address(core), abi.encodeCall(core.pushExact, (address(usd), address(ctl), 1)));
        vm.expectRevert(ZeroClaim.selector);
        ctl.exec(address(core), abi.encodeCall(core.withdraw, (address(usd), address(ctl))));

        warpToExpiry(h);
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, core.facts(h).expiry);
        vm.expectRevert(HandExpired.selector);
        ctl.exec(address(core), abi.encodeCall(core.thank, (h, r.hops, t)));
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(usd.balanceOf(address(ctl)), DEPOSIT, "the refund is fixed to the controller");
        assertStatus(other, Status.Active);
    }

    /*//////////////////////////////////////////////////////////
        K. dust, Sybil splitting, self-dealing
    //////////////////////////////////////////////////////////*/

    /// A giver inserting a Sybil hop inside its own claim never beats the honest route:
    /// coalition ≤ honest, and the floor dust still lands on the giver side.
    function testFuzz_SelfInsertion_CoalitionBound(uint16 split_) public {
        split_ = uint16(bound(split_, 0, 4_000)); // the Sybil claim stays above the 50 % floor
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        RouteBuild memory r1 = newRoute(h1);
        addExplicitHop(r1, E1, shakerA, SHAKER_A_PK, 9_000);
        settle(r1);
        uint256 honest = usd.balanceOf(giver);

        RouteBuild memory r2 = newRoute(h2);
        addExplicitHop(r2, E1, shakerA, SHAKER_A_PK, 9_000);
        addSelfHop(r2, E3, 9_000 - split_); // Sybil hop paid to vm.addr(E1)
        settle(r2);
        uint256 giverPart = usd.balanceOf(giver) - honest;
        uint256 coalition = giverPart + usd.balanceOf(vm.addr(E1));

        assertLe(coalition, honest, "self-insertion never beats the honest route");
        assertGe(giverPart, (90e6 * uint256(9_000 - split_)) / 10_000, "floor dust lands on the giver");
        assertEq(usd.balanceOf(address(core)), 0, "no dust stranded in Core");
    }

    /// I-27: splitting one margin across two hops never increases what the hops receive
    /// (by at most one unit of rounding it decreases) and never decreases the giver.
    function testFuzz_Telescoping_SplitNeverAmplifies(uint256 amount, uint16 total, uint16 first) public {
        amount = bound(amount, 1_000_000, 4e11); // two raises fit the raiser's 1e12; every 1-bps margin pays ≥ 90 units
        total = uint16(bound(total, 2, 5_000));
        first = uint16(bound(first, 1, total - 1));
        RaiseParams memory p = defaultParams();
        p.amount = amount;
        uint256 h1 = makeRaise(p);
        uint256 h2 = makeRaise(p);

        RouteBuild memory r1 = newRoute(h1);
        addExplicitHop(r1, E1, shakerA, SHAKER_A_PK, 10_000 - total);
        settle(r1);
        uint256 single = usd.balanceOf(shakerA);
        uint256 giverSingle = usd.balanceOf(giver);

        RouteBuild memory r2 = newRoute(h2);
        addExplicitHop(r2, E1, shakerA, SHAKER_A_PK, 10_000 - first);
        addExplicitHop(r2, E2, shakerA, SHAKER_A_PK, 10_000 - total);
        settle(r2);
        uint256 splitSum = usd.balanceOf(shakerA) - single;
        uint256 giverSplit = usd.balanceOf(giver) - giverSingle;

        assertLe(splitSum, single, "splitting never amplifies");
        assertLe(single - splitSum, 1, "two floors lose at most one unit");
        assertGe(giverSplit, giverSingle, "the giver never loses to a split");
        assertEq(single + giverSingle, splitSum + giverSplit, "both routes distribute exactly D");
        assertEq(usd.balanceOf(address(core)), 0, "no dust stranded");
    }

    /// Rounding dust goes to the giver, never to Core, never to the charity: the three
    /// outflows of an odd pool sum to the pool and custody is empty afterwards.
    function test_Dust_NeverStrandedNeverToCharity() public {
        RaiseParams memory p = defaultParams();
        p.amount = 100_000_007;
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 6_667); // margin 3 333 to vm.addr(E0)
        addSelfHop(r, E2, 6_666); // margin 1 to vm.addr(E1)
        settle(r);

        uint16[] memory margins = new uint16[](2);
        margins[0] = 3_333;
        margins[1] = 1;
        (uint256 C, uint256 D, uint256[] memory A, uint256 G) = expectedSplit(h, margins);
        assertEq(C, 10_000_000, "charity floored from P");
        assertEq(usd.balanceOf(charity), C);
        assertEq(usd.balanceOf(vm.addr(E0)), A[0]);
        assertEq(usd.balanceOf(vm.addr(E1)), A[1]);
        assertEq(usd.balanceOf(giver), G);
        assertEq(C + A[0] + A[1] + G, 100_000_007, "P = C + sum(A) + G");
        assertEq(D - A[0] - A[1], G);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /// Self-dealing loops: the raiser as shaker and as giver gets its own money back minus
    /// the donation; Core is neutral and conservation holds.
    function test_SelfDealing_RaiserAsShakerAndGiver() public {
        address kr = vm.addr(RAISER_PK);
        fund(address(usd), kr, 1_000e6);
        uint256 h = makeRaiseAs(kr, core, defaultParams(), DEFAULT_REF, noTags());
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, kr, RAISER_PK, 9_000);
        Terminal memory t = buildTerminal(r, kr, RAISER_PK, DEFAULT_SOLUTION, defaultDeadline());
        doThankAs(kr, r, t);

        assertEq(usd.balanceOf(kr), 1_000e6 - 10e6, "back everything but the donation");
        assertEq(usd.balanceOf(charity), 10e6);
        assertEq(usd.balanceOf(address(core)), 0);
        assertStatus(h, Status.Settled);
    }

    /// The charity as a consenting shaker is paid twice, once per role, exactly; Core
    /// records the fact and stays neutral (Up qualification is Signals policy).
    function test_SelfDealing_CharityAsShaker() public {
        vm.prank(policyAdmin);
        core.setCharityAllowed(shakerA, true);
        RaiseParams memory p = defaultParams();
        p.charityRecipient = shakerA;
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);

        vm.recordLogs();
        settle(r);
        assertEq(countPayouts(vm.getRecordedLogs(), AHandCore.PayoutPushed.selector, shakerA), 2, "Charity + ShakerMargin");
        assertEq(usd.balanceOf(shakerA), 19e6);
        assertEq(usd.balanceOf(giver), 81e6);
        assertEq(core.facts(h).charityRecipient, shakerA);
    }

    /// A capability cycle (E0 → E1 → E0) is harmless: claims only telescope down and the
    /// route hash is still unique by order.
    function test_SelfDealing_CapabilityCycle_Harmless() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_500);
        addSelfHop(r, E0, 9_000); // back to the root key
        settle(r);
        assertEq(usd.balanceOf(vm.addr(E0)), 4.5e6);
        assertEq(usd.balanceOf(vm.addr(E1)), 4.5e6);
        assertEq(usd.balanceOf(giver), 81e6);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /// Only the raiser thanks: stranger, admin, giver and the root capability are refused.
    function test_Authority_OnlyRaiserThanks() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);
        address[4] memory callers = [stranger, policyAdmin, giver, vm.addr(E0)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(NotRaiser.selector);
            core.thank(h, r.hops, t);
        }
        assertStatus(h, Status.Active);
    }

    /// Settling one Hand touches only its own escrow, across Hands and across tokens;
    /// force-sent surplus is inert and unreachable.
    function test_EscrowIsolation_AndInertSurplus() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();
        useToken(address(t18));
        RaiseParams memory p = defaultParams();
        p.amount = 10 ether;
        uint256 h3 = makeRaise(p);
        usd.mint(address(core), 500e6); // force-send

        settleSimple(h1);
        assertEq(usd.balanceOf(giver), 90e6, "exact, no surplus leaks into a payout");
        assertEq(usd.balanceOf(address(core)), DEPOSIT + 500e6, "sibling escrow + surplus remain");
        assertEq(t18.balanceOf(address(core)), 10 ether);
        assertStatus(h2, Status.Active);
        assertStatus(h3, Status.Active);

        warpToExpiry(h2);
        core.reclaim(h2);
        core.reclaim(h3);
        assertEq(usd.balanceOf(address(core)), 500e6, "surplus stays; no claim keys to it");
        assertEq(t18.balanceOf(address(core)), 0);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), raiser);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), policyAdmin);
    }

    /*//////////////////////////////////////////////////////////
        L. simulation/chain divergence and gas starvation
    //////////////////////////////////////////////////////////*/

    /// A recipient that behaves in simulation and burns on-chain: the estimate passes, the
    /// real transaction reverts InsufficientGas whole — no state change, no parked share.
    /// With an explicit budget the hostile hop costs only its own share.
    function test_TxOriginHostileRecipient_EstimatePasses_OnchainRevertsWhole() public {
        HookToken hook = newHookToken();
        TxOriginHostileRecipient hostile = new TxOriginHostileRecipient();
        address evil = makeAddr("evilOrigin");
        hostile.setHostileOrigin(evil);
        hook.setHooked(address(hostile), true);
        vm.prank(policyAdmin);
        core.setCharityAllowed(address(hostile), true);
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(hostile); // the hostile push is first; the giver's follows
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r);
        bytes memory cd = abi.encodeCall(core.thank, (h, r.hops, t));

        uint256 estimate = minGas(address(core), cd, raiser, makeAddr("simulator"));

        vm.prank(raiser, evil);
        (bool ok, bytes memory ret) = address(core).call{gas: estimate}(cd);
        assertFalse(ok);
        assertEq(ret, err(InsufficientGas.selector), "the burned budget starves the next guard");
        assertStatus(h, Status.Active);
        assertEq(claimOf(address(hook), address(hostile)), 0, "no parked share");
        assertEq(hook.balanceOf(address(core)), DEPOSIT);
        assertEq(hook.balanceOf(giver), 0);

        vm.prank(raiser, evil);
        core.thank(h, r.hops, t);
        assertEq(claimOf(address(hook), address(hostile)), 10e6, "with budget: only the hostile share parks");
        assertEq(hook.balanceOf(giver), 90e6);
    }

    /// I-9: the smallest passing gas delivers every push; one unit less reverts the whole
    /// thank with InsufficientGas and parks nothing — the caller cannot starve a push.
    function test_Starvation_UnderfundedThank_RevertsWholeNeverDefers() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);
        bytes memory cd = abi.encodeCall(core.thank, (h, r.hops, t));
        uint256 estimate = minGas(address(core), cd, raiser, tx.origin);

        vm.prank(raiser);
        (bool ok, bytes memory ret) = address(core).call{gas: estimate - 1}(cd);
        assertFalse(ok);
        assertEq(ret, err(InsufficientGas.selector));
        assertStatus(h, Status.Active);
        assertEq(claimOf(address(usd), giver) + claimOf(address(usd), charity) + claimOf(address(usd), vm.addr(E0)), 0);

        vm.recordLogs();
        vm.prank(raiser);
        (ok,) = address(core).call{gas: estimate}(cd);
        assertTrue(ok);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(countPayouts(logs, AHandCore.PayoutDeferred.selector, address(0)), 0, "just above: every frame is funded");
        assertEq(countPayouts(logs, AHandCore.PayoutPushed.selector, address(0)), 3);
    }

    /// A stranger cannot park the raiser's refund by under-funding reclaim.
    function test_Starvation_UnderfundedReclaim_RevertsWhole() public {
        uint256 h = makeRaise();
        warpToExpiry(h);
        vm.prank(stranger);
        vm.expectRevert(InsufficientGas.selector);
        core.reclaim{gas: 150_000}(h);
        assertStatus(h, Status.Active);
        assertEq(claimOf(address(usd), raiser), 0);

        vm.prank(stranger);
        core.reclaim{gas: 400_000}(h);
        assertEq(usd.balanceOf(raiser), 1_000_000e6, "pushed, not parked");
    }

    /*//////////////////////////////////////////////////////////
        M. a token that turns hostile after raise
    //////////////////////////////////////////////////////////*/

    /// A token paused after Hands are open: every push parks, withdraw reverts with the
    /// token's own reason, the reclaim refund parks — and a sibling token settles normally.
    /// Unpausing drains everything. The documented total stop, confined to that token.
    function test_HostileToken_PausedAfterRaise_StopConfined() public {
        PausableToken pt = new PausableToken();
        useToken(address(pt));
        fund(address(pt), raiser, 1_000e6);
        uint256 hThank = makeRaise();
        uint256 hReclaim = makeRaise();
        useToken(address(usd));
        uint256 hUsd = makeRaise();
        settleSimple(hUsd);
        assertEq(usd.balanceOf(giver), 90e6, "the sibling token is untouched by the stop");

        pt.setPaused(true);
        RouteBuild memory r = newRoute(hThank);
        addSelfHop(r, E1, 9_000);
        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(countPayouts(logs, AHandCore.PayoutDeferred.selector, address(0)), 3);
        assertEq(countPayouts(logs, AHandCore.PayoutPushed.selector, address(0)), 0);
        assertStatus(hThank, Status.Settled);
        assertEq(claimOf(address(pt), charity), 10e6);
        assertEq(claimOf(address(pt), vm.addr(E0)), 9e6);
        assertEq(claimOf(address(pt), giver), 81e6);

        vm.expectRevert(bytes("PAUSED"));
        core.withdraw(address(pt), giver);

        warpToExpiry(hReclaim);
        vm.prank(stranger);
        core.reclaim(hReclaim);
        assertEq(claimOf(address(pt), raiser), DEPOSIT, "the refund parks too");
        assertEq(pt.balanceOf(address(core)), 2 * DEPOSIT, "100 % of that token stays in Core");

        pt.setPaused(false);
        core.withdraw(address(pt), giver);
        core.withdraw(address(pt), raiser);
        core.withdraw(address(pt), charity);
        core.withdraw(address(pt), vm.addr(E0));
        assertEq(pt.balanceOf(giver), 81e6);
        assertEq(pt.balanceOf(raiser), 1_000e6 - DEPOSIT);
        assertEq(pt.balanceOf(address(core)), 0);
    }

    /// A sender-side fee switched on after raise: inside the frame the inexact custody
    /// debit rolls back and parks each share; withdraw reverts TransferInexact; the
    /// refund parks. Confined to that token; the custody number itself never moves.
    function test_HostileToken_LateSenderFee_StopConfined() public {
        LateSenderFeeToken lf = new LateSenderFeeToken();
        useToken(address(lf));
        fund(address(lf), raiser, 1_000e6);
        uint256 hThank = makeRaise();
        uint256 hReclaim = makeRaise();
        useToken(address(usd));
        uint256 hUsd = makeRaise();

        lf.setFeeOn(true);
        RouteBuild memory r = newRoute(hThank);
        addSelfHop(r, E1, 9_000);
        vm.recordLogs();
        settle(r);
        assertEq(countPayouts(vm.getRecordedLogs(), AHandCore.PayoutDeferred.selector, address(0)), 3);
        assertEq(claimOf(address(lf), giver), 81e6);
        assertEq(lf.balanceOf(giver), 0, "the frame rolled the inexact move back");

        vm.expectRevert(TransferInexact.selector);
        core.withdraw(address(lf), giver);
        assertEq(claimOf(address(lf), giver), 81e6, "claim restored");

        settleSimple(hUsd);
        assertEq(usd.balanceOf(giver), 90e6, "the sibling token settles");

        warpToExpiry(hReclaim);
        vm.prank(stranger);
        core.reclaim(hReclaim);
        assertEq(claimOf(address(lf), raiser), DEPOSIT);
        assertEq(lf.balanceOf(address(core)), 2 * DEPOSIT, "nobody exits: the documented total stop");

        lf.setFeeOn(false); // were the token to relent, exits resume exactly
        core.withdraw(address(lf), giver);
        assertEq(lf.balanceOf(giver), 81e6);
    }
}
