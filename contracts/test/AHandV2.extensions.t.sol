// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
    SUITE: Extension mechanism — the §9.6 conformance record (DESIGN §9, I-19, I-26).

    Every scenario of the §9.3 catalogue is run against the UNCHANGED Core through
    the probes under test/probes/: a controller Raiser, a pooled Raiser, an agent
    hop with a Seam-2 envelope, a policy-bounded capability, a splitting giver, a
    tip distributor from new money, a Safe-like approved-hash signer, a governor
    successor, an EAS-style late-delivery reader and a Seam-2 envelope verifier
    compiled against IAHandFacts only. The last section proves the bounds that make
    "any scenario" honest: no extension moves money it was not granted (a stateful
    invariant with Granted(h, a) ghost accounting over contract actors), none can
    block reclaim or withdraw, none can change the terms of an Active Hand, and the
    Core needed no change (its bytecode equals a fresh deployment's).
//////////////////////////////////////////////////////////////*/

import {Test, Vm, stdError} from "forge-std/Test.sol";
import {AHandTestBase} from "./AHandTestBase.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSig} from "../src/AHandSig.sol";
import {AHandMath, AHandSettlement} from "../src/AHandFacts.sol";
import {
    AllocationKind,
    CapabilityProof,
    CharityNotAllowed,
    ClaimBelowFloor,
    GiverAcceptanceInvalid,
    HandExpired,
    HandNotExpired,
    Hop,
    IAHandFacts,
    NotPendingAdmin,
    NotRaiser,
    OnlyPolicyAdmin,
    RaiseParams,
    RouteHashMismatch,
    Shake,
    ShakerAcceptanceInvalid,
    Status,
    Terminal,
    ZeroClaim
} from "../src/AHandTypes.sol";
import {PolicyRaiser} from "./probes/PolicyRaiser.sol";
import {PolicyCapability} from "./probes/PolicyCapability.sol";
import {FundingVault} from "./probes/FundingVault.sol";
import {TipDistributor} from "./probes/TipDistributor.sol";
import {SplitterGiver} from "./probes/SplitterGiver.sol";
import {GovernorSuccessor} from "./probes/GovernorSuccessor.sol";
import {GiveTimestamper, LateDeliveryReader} from "./probes/GiveTimestamper.sol";
import {EnvelopeVerifier} from "./probes/EnvelopeVerifier.sol";
import {SafeLikeSigner} from "./mocks/SafeLikeSigner.sol";
import {SmartWallet1271, ERC1271_MAGIC} from "./mocks/SmartWallet1271.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {HookToken, IHookRecipient} from "./mocks/HookToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev A consenting-but-hostile contract shaker: accepts any acceptance bytes
///      (its consent lives elsewhere) and, while armed, reverts the token hook that
///      pays it — so its own share parks while everyone else is paid.
contract HostileHookShaker is IHookRecipient {
    bool public armed = true;

    function setArmed(bool isArmed) external {
        armed = isArmed;
    }

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return ERC1271_MAGIC;
    }

    function onTokenReceived(address, uint256) external view {
        require(!armed, "REFUSED");
    }
}

/*//////////////////////////////////////////////////////////////
                    Shared fixtures for the probes
//////////////////////////////////////////////////////////////*/

abstract contract ExtensionsFixture is AHandTestBase {
    uint256 constant AGENT_PK = 0xA6E7aa;
    uint256 constant MANAGER_PK = 0x3A7aa;
    uint256 constant SAFE_PK = 0x5AFEaa;

    bytes32 constant APP_HOP_TAG = keccak256("ahand.hop.app.v1");

    address decisionMaker = makeAddr("decisionMaker");
    address council = makeAddr("council");

    /// @dev Default policy: delivery now+1d < challenge now+2d < decision now+3d < expiry now+30d.
    function defaultPolicy() internal view returns (PolicyRaiser.Policy memory) {
        return PolicyRaiser.Policy({
            decisionMaker: decisionMaker,
            principal: raiser,
            deliveryDeadline: uint40(block.timestamp + 1 days),
            challengeDeadline: uint40(block.timestamp + 2 days),
            decisionDeadline: uint40(block.timestamp + 3 days)
        });
    }

    /// @dev A controller funded by the raiser (its principal) under `p` with the
    ///      controller's own policy envelope as the metadata commitment.
    function fundController(PolicyRaiser ctl, RaiseParams memory p) internal returns (uint256 handId) {
        p.metadataCommitment = ctl.metadataCommitment();
        vm.startPrank(raiser);
        IERC20(p.token).approve(address(ctl), type(uint256).max);
        handId = ctl.fund(p, DEFAULT_REF, noTags());
        vm.stopPrank();
    }

    /// @dev A default controller Hand: the controller is the raiser of a default Hand.
    function controllerHand() internal returns (PolicyRaiser ctl, uint256 handId) {
        ctl = new PolicyRaiser(core, defaultPolicy());
        handId = fundController(ctl, defaultParams());
    }

    /// @dev Enter the decision window of the default policy (challenge deadline + 1).
    function enterDecisionWindow() internal {
        vm.warp(block.timestamp + 2 days + 1);
    }

    /// @dev A vault over `token_` with `contributions` from fresh contributors, raised
    ///      at the funding deadline with the default terms over the pooled amount.
    function vaultHand(address token_, uint256[] memory contributions)
        internal
        returns (FundingVault vault, uint256 handId, address[] memory contributors)
    {
        vault = new FundingVault(
            core, IERC20(token_), address(this), uint40(block.timestamp + 1 days), uint40(block.timestamp + 2 days)
        );
        contributors = new address[](contributions.length);
        uint256 total;
        for (uint256 i; i < contributions.length; ++i) {
            contributors[i] = makeAddr(string.concat("contributor", vm.toString(i)));
            fund(token_, contributors[i], contributions[i]);
            vm.startPrank(contributors[i]);
            IERC20(token_).approve(address(vault), contributions[i]);
            vault.contribute(contributions[i]);
            vm.stopPrank();
            total += contributions[i];
        }
        vm.warp(block.timestamp + 1 days);
        RaiseParams memory p = defaultParams();
        p.token = token_;
        p.amount = total;
        handId = vault.raise(p, DEFAULT_REF, noTags());
    }

    /// @dev Append a hop whose capability is a `PolicyCapability`: the capability
    ///      signs `s` through its policy envelope with the agent key.
    function addPolicyHop(RouteBuild memory r, PolicyCapability cap, uint256 agentPk, Shake memory s) internal view {
        bytes memory ownerSig = signStruct(agentPk, AHandSig.hashShake(s));
        addRawHop(r, Hop({shake: s, capabilitySig: cap.encodeShake(s, ownerSig), shakerAcceptanceSig: ""}));
    }

    /// @dev `hopDataHash` of the `RouteHopSettled` event at `position` of `handId`.
    function hopDataHashAt(Vm.Log[] memory logs, uint256 handId, uint256 position) internal pure returns (bytes32) {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (log.topics.length < 2 || log.topics[0] != AHandCore.RouteHopSettled.selector) continue;
            if (uint256(log.topics[1]) != handId) continue;
            (uint256 pos,,,,,,, bytes32 hopDataHash,) =
                abi.decode(log.data, (uint256, address, address, uint16, uint16, address, bytes32, bytes32, uint256));
            if (pos == position) return hopDataHash;
        }
        revert("no RouteHopSettled at position");
    }

    /// @dev Count of `PayoutAllocated` events to `beneficiary` in `logs`.
    function allocationsTo(Vm.Log[] memory logs, address beneficiary) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (log.topics[0] != AHandCore.PayoutAllocated.selector) continue;
            if (address(uint160(uint256(log.topics[3]))) == beneficiary) ++n;
        }
    }

    /// @dev keccak of the Raise-time facts of `handId`: every field an extension could
    ///      wish to change. Terminal facts (`status`, `closedAt`, `settlementHash`) excluded.
    function termsOf(uint256 handId) internal view returns (bytes32) {
        IAHandFacts.HandFacts memory f = core.facts(handId);
        return keccak256(
            abi.encode(
                f.raiser,
                f.token,
                f.pool,
                f.charityBps,
                f.charityRecipient,
                f.minGiverClaimBps,
                f.rootCapability,
                f.expiry,
                f.visibility,
                f.metadataCommitment,
                f.discoveryCommitment
            )
        );
    }

    /// @dev The runtime code of Core `c` with its two deployment-bound immutables
    ///      (OZ EIP712's cached `address(this)` and cached domain separator) zeroed,
    ///      and how many 32-byte words were masked. Two Cores built from the same
    ///      source have identical masked code; any other difference is a code change.
    function maskedCode(AHandCore c) internal view returns (bytes memory code, uint256 masked) {
        code = address(c).code;
        bytes32 self = bytes32(uint256(uint160(address(c))));
        bytes32 ds = c.DOMAIN_SEPARATOR();
        uint256 n = code.length;
        for (uint256 i; i + 32 <= n; ++i) {
            bytes32 w;
            assembly ("memory-safe") {
                w := mload(add(add(code, 0x20), i))
            }
            if (w == self || w == ds) {
                assembly ("memory-safe") {
                    mstore(add(add(code, 0x20), i), 0)
                }
                ++masked;
                i += 31;
            }
        }
    }
}

/*//////////////////////////////////////////////////////////////
                        The conformance record
//////////////////////////////////////////////////////////////*/

contract AHandV2ExtensionsTest is ExtensionsFixture {
    bytes32 coreCodeHashAtSetUp;

    function setUp() public override {
        super.setUp();
        coreCodeHashAtSetUp = address(core).codehash;
    }

    /*//////////////////// §9.3 #1 — controller / arbiter as Raiser ////////////////////*/

    function test_Controller_IsRaiserAndSettlesTheUnmodifiedSignedRoute() public {
        (PolicyRaiser ctl, uint256 h) = controllerHand();
        assertEq(core.facts(h).raiser, address(ctl), "check 1: the controller IS h.raiser");
        assertEq(usd.balanceOf(address(ctl)), 0, "the pot went straight through to Core");
        assertEq(usd.balanceOf(address(core)), DEPOSIT);

        enterDecisionWindow();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory t = buildTerminal(r);

        vm.recordLogs();
        vm.prank(decisionMaker);
        ctl.decide(r.hops, t, keccak256("evidence"));

        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(ctl.evidenceHash(), keccak256("evidence"));
        assertEq(usd.balanceOf(charity), 10e6, "C from P");
        assertEq(usd.balanceOf(shakerA), 9e6, "A_0 from D");
        assertEq(usd.balanceOf(giver), 81e6, "G = D - A_0");
        assertEq(usd.balanceOf(address(ctl)), 0, "the controller is paid nothing it was not granted");
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h);
        assertEq(p.raiser, address(ctl), "the settlement commits the controller as raiser");
        assertEq(settlementHashOf(p), core.facts(h).settlementHash);
    }

    function test_Controller_CannotAlterTheRouteItWasHanded() public {
        (PolicyRaiser ctl, uint256 h) = controllerHand();
        enterDecisionWindow();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory t = buildTerminal(r);

        // a bigger margin for the shaker: the capability's signature no longer covers the Shake
        r.hops[0].shake.childClaimBps = 8_000;
        vm.prank(decisionMaker);
        vm.expectRevert(abi.encodeWithSelector(CapabilityProof.selector, 0));
        ctl.decide(r.hops, t, 0);
        r.hops[0].shake.childClaimBps = 9_000;

        // a different giver: the terminal capability's Give signature no longer covers it
        t.give.giver = stranger;
        vm.prank(decisionMaker);
        vm.expectRevert(abi.encodeWithSelector(CapabilityProof.selector, 1));
        ctl.decide(r.hops, t, 0);
        t.give.giver = giver;

        // dropping the hop: the Give pins the exact route
        vm.prank(decisionMaker);
        vm.expectRevert(RouteHashMismatch.selector);
        ctl.decide(new Hop[](0), t, 0);

        assertEq(uint8(statusOf(h)), uint8(Status.Active), "nothing settled");
    }

    function test_Controller_CannotAdoptAnEoaHand() public {
        (PolicyRaiser ctl,) = controllerHand();
        uint256 eoaHand = makeRaise();
        RouteBuild memory r = newRoute(eoaHand);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);
        vm.prank(address(ctl));
        vm.expectRevert(NotRaiser.selector);
        core.thank(eoaHand, r.hops, t);
    }

    function test_Controller_CannotSkipGiverAcceptance() public {
        (PolicyRaiser ctl, uint256 h) = controllerHand();
        enterDecisionWindow();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory noConsent = buildTerminal(r, giver, 0, DEFAULT_SOLUTION, defaultDeadline());
        vm.prank(decisionMaker);
        vm.expectRevert(GiverAcceptanceInvalid.selector);
        ctl.decide(r.hops, noConsent, 0);
    }

    function test_Controller_CannotThankAfterExpiry() public {
        (PolicyRaiser ctl, uint256 h) = controllerHand();
        enterDecisionWindow();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, core.facts(h).expiry);
        warpToExpiry(h);
        // its own policy refuses first …
        vm.prank(decisionMaker);
        vm.expectRevert(PolicyRaiser.OutsideDecisionWindow.selector);
        ctl.decide(r.hops, t, 0);
        // … and Core refuses the controller regardless of any policy it might have
        vm.prank(address(ctl));
        vm.expectRevert(HandExpired.selector);
        core.thank(h, r.hops, t);
    }

    function test_Controller_CannotExtendExpiry() public {
        // a policy whose decision would come after expiry cannot even be funded
        PolicyRaiser.Policy memory late = defaultPolicy();
        late.decisionDeadline = uint40(block.timestamp + 31 days);
        PolicyRaiser lateCtl = new PolicyRaiser(core, late);
        RaiseParams memory p = defaultParams();
        p.metadataCommitment = lateCtl.metadataCommitment();
        vm.startPrank(raiser);
        usd.approve(address(lateCtl), type(uint256).max);
        vm.expectRevert(PolicyRaiser.ExpiryBeforeDecision.selector);
        lateCtl.fund(p, DEFAULT_REF, noTags());
        vm.stopPrank();

        // and Core has no door to a later expiry: no such selector, no fallback
        (PolicyRaiser ctl, uint256 h) = controllerHand();
        uint40 expiry = core.facts(h).expiry;
        vm.startPrank(address(ctl));
        (bool ok,) = address(core).call(abi.encodeWithSignature("extendExpiry(uint256,uint40)", h, expiry + 1 days));
        assertFalse(ok, "extendExpiry does not exist");
        (ok,) = address(core).call(abi.encodeWithSignature("setExpiry(uint256,uint40)", h, expiry + 1 days));
        assertFalse(ok, "setExpiry does not exist");
        vm.stopPrank();
        assertEq(core.facts(h).expiry, expiry, "expiry is final");
    }

    function test_Controller_RefundLandsOnTheControllerThenFollowsItsPolicy() public {
        uint256 principalBefore = usd.balanceOf(raiser);
        (PolicyRaiser ctl, uint256 h) = controllerHand();
        assertEq(usd.balanceOf(raiser), principalBefore - DEPOSIT);
        vm.expectRevert(PolicyRaiser.NotReclaimed.selector);
        ctl.distributeRefund();

        warpToExpiry(h);
        vm.expectEmit(true, true, false, true, address(core));
        emit AHandCore.Reclaimed(h, address(ctl), address(usd), DEPOSIT);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(usd.balanceOf(address(ctl)), DEPOSIT, "check 4: the refund lands on the controller, in full");
        assertEq(usd.balanceOf(raiser), principalBefore - DEPOSIT, "Core paid the principal nothing");

        ctl.distributeRefund();
        assertEq(usd.balanceOf(raiser), principalBefore, "the controller's policy returns it to the principal");
        assertEq(usd.balanceOf(address(ctl)), 0);
    }

    function test_Controller_PolicyEnvelopeIsVerifiableFromFactsOnly() public {
        (PolicyRaiser ctl, uint256 h) = controllerHand();
        EnvelopeVerifier verifier = new EnvelopeVerifier(IAHandFacts(address(core)));
        bytes memory payload = abi.encode(ctl.policyHash(), raiser);
        assertTrue(verifier.verifyMetadata(h, ctl.SCHEMA_TAG(), payload), "the envelope opens with the policy");
        assertFalse(verifier.verifyMetadata(h, ctl.SCHEMA_TAG(), abi.encode(ctl.policyHash(), stranger)), "wrong principal");
        assertFalse(verifier.verifyMetadata(h, keccak256("ahand.meta.v1"), payload), "wrong schema");

        // a controller refuses a Hand that does not commit to its policy
        PolicyRaiser other = new PolicyRaiser(core, defaultPolicy());
        vm.startPrank(raiser);
        usd.approve(address(other), type(uint256).max);
        vm.expectRevert(PolicyRaiser.WrongEnvelope.selector);
        other.fund(defaultParams(), DEFAULT_REF, noTags());
        vm.stopPrank();
    }

    /*//////////////////// §9.3 #2 — pooled Raiser ////////////////////*/

    function test_Vault_PoolsContributionsIntoOneHand() public {
        uint256[] memory c = new uint256[](2);
        c[0] = 60e6;
        c[1] = 40e6;
        uint256 coreBefore = usd.balanceOf(address(core));
        (FundingVault vault, uint256 h,) = vaultHand(address(usd), c);
        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(f.raiser, address(vault), "the vault IS h.raiser");
        assertEq(f.pool, 100e6, "one pot, the sum");
        assertEq(usd.balanceOf(address(vault)), 0);
        assertEq(usd.balanceOf(address(core)), coreBefore + 100e6);
        assertFalse(vault.refundable());

        // the raise window is single-use and the pot is the whole pool
        RaiseParams memory p = defaultParams();
        vm.expectRevert(FundingVault.AlreadyRaised.selector);
        vault.raise(p, DEFAULT_REF, noTags());
        FundingVault late = new FundingVault(
            core, IERC20(address(usd)), address(this), uint40(block.timestamp + 1), uint40(block.timestamp + 2)
        );
        vm.warp(block.timestamp + 1);
        vm.expectRevert(FundingVault.FundingClosed.selector);
        late.contribute(1);
        vm.expectRevert(FundingVault.NothingPooled.selector);
        late.raise(p, DEFAULT_REF, noTags());
    }

    function test_Vault_RefundsContributorsProRataAfterReclaim() public {
        uint256[] memory c = new uint256[](3);
        c[0] = 33e6;
        c[1] = 33e6;
        c[2] = 34e6;
        (FundingVault vault, uint256 h, address[] memory who) = vaultHand(address(usd), c);
        vm.prank(who[0]);
        vm.expectRevert(FundingVault.NotRefundable.selector);
        vault.refund();

        warpToExpiry(h);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(usd.balanceOf(address(vault)), 100e6, "the refund lands on the vault");
        assertTrue(vault.refundable());
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vault.refund();
            assertEq(usd.balanceOf(who[i]), c[i], "each contributor takes exactly their contribution back");
        }
        assertEq(usd.balanceOf(address(vault)), 0, "nothing stranded");
        vm.prank(who[0]);
        vm.expectRevert(FundingVault.NothingToRefund.selector);
        vault.refund();
    }

    function test_Vault_StewardThanksAndSettlementClosesRefunds() public {
        uint256[] memory c = new uint256[](1);
        c[0] = 100e6;
        (FundingVault vault, uint256 h, address[] memory who) = vaultHand(address(usd), c);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);
        vm.prank(who[0]);
        vm.expectRevert(FundingVault.NotSteward.selector);
        vault.thank(r.hops, t);
        vault.thank(r.hops, t); // this test is the steward
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(usd.balanceOf(giver), 81e6);
        assertFalse(vault.refundable(), "a settled Hand refunds nobody");
        vm.prank(who[0]);
        vm.expectRevert(FundingVault.NotRefundable.selector);
        vault.refund();
    }

    function test_Vault_NoRaiseByTheExecutionDeadlineRefunds() public {
        FundingVault vault = new FundingVault(
            core, IERC20(address(usd)), address(this), uint40(block.timestamp + 1 days), uint40(block.timestamp + 2 days)
        );
        address alice = makeAddr("alice");
        fund(address(usd), alice, 5e6);
        vm.startPrank(alice);
        usd.approve(address(vault), 5e6);
        vault.contribute(5e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(FundingVault.RaiseWindowClosed.selector);
        vault.raise(defaultParams(), DEFAULT_REF, noTags());
        assertTrue(vault.refundable());
        vm.prank(alice);
        vault.refund();
        assertEq(usd.balanceOf(alice), 5e6);
    }

    function test_Vault_DeferredRefundNeedsOnlyThePermissionlessWithdraw() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        uint256[] memory c = new uint256[](2);
        c[0] = 70e6;
        c[1] = 30e6;
        (FundingVault vault, uint256 h, address[] memory who) = vaultHand(address(bl), c);
        bl.setBlocked(address(vault), true);
        warpToExpiry(h);
        vm.expectEmit(true, true, true, true, address(core));
        emit AHandCore.PayoutDeferred(h, address(bl), address(vault), AllocationKind.RaiserRefund, 0, 100e6);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Reclaimed), "a blocked raiser never blocks reclaim");
        assertEq(core.claims(address(bl), address(vault)), 100e6, "the refund parks as the vault's claim");
        assertTrue(vault.refundable());
        vm.prank(who[0]);
        vm.expectRevert(stdError.arithmeticError);
        vault.refund(); // the vault holds nothing yet; its own transfer fails, the contribution stays recorded
        assertEq(vault.contributed(who[0]), 70e6);

        bl.setBlocked(address(vault), false);
        vm.prank(stranger);
        core.withdraw(address(bl), address(vault)); // anyone pays the gas; the destination is fixed
        assertEq(bl.balanceOf(address(vault)), 100e6);
        vm.prank(who[0]);
        vault.refund();
        vm.prank(who[1]);
        vault.refund();
        assertEq(bl.balanceOf(who[0]), 70e6);
        assertEq(bl.balanceOf(who[1]), 30e6);
    }

    /*//////////////////// §9.3 #3 — agent / app as an explicit hop ////////////////////*/

    function test_AgentHop_ExplicitShakerWithEnvelope_SameEconomicsAsAHuman() public {
        SmartWallet1271 agent = newSmartWallet(AGENT_PK);
        EnvelopeVerifier verifier = new EnvelopeVerifier(IAHandFacts(address(core)));
        bytes memory payload = abi.encode("model=routing-v3", "task=42");
        bytes32 hopData = verifier.envelope(APP_HOP_TAG, keccak256(payload));

        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        // E0 delegates to the agent wallet; the agent is the attributed shaker (explicit:
        // it is not the signer of this hop), consents through ERC-1271 with its owner key
        addHopTo(r, address(agent), AGENT_PK, address(agent), AGENT_PK, 9_000, hopData, defaultDeadline());
        // the agent delegates on; a human takes the next margin
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_500);
        Terminal memory t = buildTerminal(r);
        vm.recordLogs();
        doThank(r, t);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint16[] memory margins = new uint16[](2);
        margins[0] = 1_000;
        margins[1] = 500;
        (uint256 C,, uint256[] memory A, uint256 G) = expectedSplit(h, margins);
        assertEq(usd.balanceOf(address(agent)), A[0], "the agent's margin: floor(D * delta / 10 000), exactly a human's");
        assertEq(usd.balanceOf(shakerA), A[1]);
        assertEq(usd.balanceOf(giver), G);
        assertEq(usd.balanceOf(charity), C);
        assertEq(hopDataHashAt(logs, h, 0), hopData, "the Seam-2 envelope is a committed hop fact");
        assertTrue(verifier.verifyHop(r.hops[0].shake, APP_HOP_TAG, payload), "a reader that knows the tag opens it");
        assertFalse(verifier.verifyHop(r.hops[0].shake, APP_HOP_TAG, abi.encode("model=other")));
        assertEq(hopDataHashAt(logs, h, 1), bytes32(0), "the human hop carries none");

        // the identical human route on a second Hand pays identical allocations
        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newRoute(h2);
        addExplicitHop(r2, E1, shakerB, SHAKER_B_PK, 9_000);
        addExplicitHop(r2, E2, shakerA, SHAKER_A_PK, 8_500);
        settle(r2);
        assertEq(usd.balanceOf(shakerB), A[0], "H16: identical economics");
    }

    function test_AgentHop_BoundedByTheFloorAndByTheRaiser() public {
        SmartWallet1271 agent = newSmartWallet(AGENT_PK);
        uint256 h = makeRaise();
        // over-reach into the giver's floor: the hop is refused at its index
        RouteBuild memory r = newRoute(h);
        addHopTo(r, address(agent), AGENT_PK, address(agent), AGENT_PK, 4_900, bytes32(0), defaultDeadline());
        expectThankRevert(abi.encodeWithSelector(ClaimBelowFloor.selector, 0), r, buildTerminal(r));

        // no fixed position: the Raiser settles another route and the agent's signed hop is simply not it
        RouteBuild memory human = newRoute(h);
        addSelfHop(human, E1, 9_000);
        settle(human);
        assertEq(usd.balanceOf(address(agent)), 0, "an unsettled hop earns nothing");
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
    }

    /*//////////////////// §9.3 #8 — policy-bounded capability ////////////////////*/

    /// @dev A capability allowing E2 as the next capability, a 5 % margin and `window`.
    function newPolicyCap(uint40 window) internal returns (PolicyCapability cap) {
        address[] memory allowed = new address[](1);
        allowed[0] = vm.addr(E2);
        cap = new PolicyCapability(address(core), vm.addr(AGENT_PK), 500, window, allowed);
    }

    /// @dev Route E0 → cap (self hop, 10 %), then cap → `child` keeping `margin` bps
    ///      with `deadline`, signed through the capability's envelope by `agentPk`.
    function delegatedRoute(uint256 h, PolicyCapability cap, address child, uint16 margin, uint40 deadline, uint256 agentPk)
        internal
        view
        returns (RouteBuild memory r)
    {
        r = newRoute(h);
        addHopTo(r, address(cap), 0, vm.addr(E0), 0, 9_000, bytes32(0), defaultDeadline());
        Shake memory s = Shake({
            handId: h,
            childCapability: child,
            shaker: address(cap),
            parentClaimBps: 9_000,
            childClaimBps: 9_000 - margin,
            hopDataHash: 0,
            deadline: deadline
        });
        addPolicyHop(r, cap, agentPk, s);
        r.parentPk = E2;
        r.parentCap = vm.addr(E2);
    }

    function test_PolicyCapability_AsChildCapability_SignsWithinPolicy() public {
        PolicyCapability cap = newPolicyCap(uint40(block.timestamp + 2 days));
        uint256 h = makeRaise();
        RouteBuild memory r = delegatedRoute(h, cap, vm.addr(E2), 500, defaultDeadline(), AGENT_PK);
        settle(r);
        assertEq(usd.balanceOf(vm.addr(E0)), 9e6, "the parent's margin");
        assertEq(usd.balanceOf(address(cap)), 4.5e6, "the bounded agent's margin: 5 % of D");
        assertEq(usd.balanceOf(giver), 76.5e6);
    }

    function test_PolicyCapability_RefusesAMarginAboveItsPolicy() public {
        PolicyCapability cap = newPolicyCap(uint40(block.timestamp + 2 days));
        uint256 h = makeRaise();
        RouteBuild memory r = delegatedRoute(h, cap, vm.addr(E2), 501, defaultDeadline(), AGENT_PK);
        expectThankRevert(abi.encodeWithSelector(CapabilityProof.selector, 1), r, buildTerminal(r));
    }

    function test_PolicyCapability_RefusesADisallowedChild() public {
        PolicyCapability cap = newPolicyCap(uint40(block.timestamp + 2 days));
        uint256 h = makeRaise();
        RouteBuild memory r = delegatedRoute(h, cap, vm.addr(E3), 500, defaultDeadline(), AGENT_PK);
        r.parentPk = E3;
        r.parentCap = vm.addr(E3);
        expectThankRevert(abi.encodeWithSelector(CapabilityProof.selector, 1), r, buildTerminal(r));
    }

    function test_PolicyCapability_RefusesADeadlineBeyondItsWindow() public {
        PolicyCapability cap = newPolicyCap(uint40(block.timestamp + 2 hours));
        uint256 h = makeRaise();
        RouteBuild memory r = delegatedRoute(h, cap, vm.addr(E2), 500, defaultDeadline(), AGENT_PK); // now + 1 day
        expectThankRevert(abi.encodeWithSelector(CapabilityProof.selector, 1), r, buildTerminal(r));
        // the same hop inside the window settles
        RouteBuild memory ok = delegatedRoute(h, cap, vm.addr(E2), 500, uint40(block.timestamp + 1 hours), AGENT_PK);
        settle(ok);
        assertEq(usd.balanceOf(address(cap)), 4.5e6);
    }

    function test_PolicyCapability_RefusesAForeignKeyAndMalformedBytes() public {
        PolicyCapability cap = newPolicyCap(uint40(block.timestamp + 2 days));
        uint256 h = makeRaise();
        // the policy passes but the owner's signature is somebody else's
        RouteBuild memory r = delegatedRoute(h, cap, vm.addr(E2), 500, defaultDeadline(), SHAKER_A_PK);
        expectThankRevert(abi.encodeWithSelector(CapabilityProof.selector, 1), r, buildTerminal(r));
        // garbage bytes revert inside Core's staticcall and count as invalid
        RouteBuild memory g = delegatedRoute(h, cap, vm.addr(E2), 500, defaultDeadline(), AGENT_PK);
        g.hops[1].capabilitySig = hex"deadbeef";
        expectThankRevert(abi.encodeWithSelector(CapabilityProof.selector, 1), g, buildTerminal(g));
        // a plain ECDSA signature by the agent is not the capability's envelope either
        RouteBuild memory e = delegatedRoute(h, cap, vm.addr(E2), 500, defaultDeadline(), AGENT_PK);
        e.hops[1].capabilitySig = signShake(AGENT_PK, e.hops[1].shake);
        expectThankRevert(abi.encodeWithSelector(CapabilityProof.selector, 1), e, buildTerminal(e));
    }

    function test_PolicyCapability_AsTerminalCapability_SignsTheGiveWithinItsWindow() public {
        PolicyCapability cap = newPolicyCap(uint40(block.timestamp + 2 hours));
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addHopTo(r, address(cap), 0, vm.addr(E0), 0, 9_000, bytes32(0), defaultDeadline());
        r.parentPk = AGENT_PK; // the builder's placeholder signature is replaced by the envelope below
        // beyond the window → the Give (position hops.length == 1) is refused
        Terminal memory late = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, defaultDeadline());
        late.capabilitySig = cap.encodeGive(late.give, signStruct(AGENT_PK, AHandSig.hashGive(late.give)));
        expectThankRevert(abi.encodeWithSelector(CapabilityProof.selector, 1), r, late);
        // inside the window → settles; the capability keeps no margin here, the giver takes D − A_0
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, uint40(block.timestamp + 1 hours));
        t.capabilitySig = cap.encodeGive(t.give, signStruct(AGENT_PK, AHandSig.hashGive(t.give)));
        doThank(r, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(usd.balanceOf(giver), 81e6);
    }

    /*//////////////////// §9.3 #7 — a team as the Giver (ERC-1271 splitter) ////////////////////*/

    function newSplitter() internal returns (SplitterGiver splitter, address[] memory members) {
        members = new address[](3);
        members[0] = makeAddr("member0");
        members[1] = makeAddr("member1");
        members[2] = makeAddr("member2");
        uint16[] memory shares = new uint16[](3);
        shares[0] = 6_000;
        shares[1] = 3_000;
        shares[2] = 1_000;
        splitter = new SplitterGiver(vm.addr(MANAGER_PK), members, shares);
    }

    function test_SplitterGiver_ReceivesTheResidualAndSplitsItItself() public {
        (SplitterGiver splitter, address[] memory members) = newSplitter();
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r, address(splitter), MANAGER_PK, DEFAULT_SOLUTION, defaultDeadline());
        vm.recordLogs();
        doThank(r, t);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(usd.balanceOf(address(splitter)), 81e6, "Core pays G to the giver contract, whole");
        assertEq(allocationsTo(logs, address(splitter)), 1, "one GiverResidual grant");
        for (uint256 i; i < members.length; ++i) {
            assertEq(allocationsTo(logs, members[i]), 0, "Core knows no member");
        }
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, logs, h);
        assertEq(p.giver, address(splitter), "the committed giver is the contract");

        splitter.split(IERC20(address(usd)));
        assertEq(usd.balanceOf(members[0]), 48.6e6);
        assertEq(usd.balanceOf(members[1]), 24.3e6);
        assertEq(usd.balanceOf(members[2]), 8.1e6);
        assertEq(usd.balanceOf(address(splitter)), 0, "sum of shares == G, dust to the last member");
    }

    function test_SplitterGiver_CannotBeFramed_ManagerConsentRequired() public {
        (SplitterGiver splitter,) = newSplitter();
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory wrongKey = buildTerminal(r, address(splitter), GIVER_PK, DEFAULT_SOLUTION, defaultDeadline());
        expectThankRevert(abi.encodeWithSelector(GiverAcceptanceInvalid.selector), r, wrongKey);
        Terminal memory empty = buildTerminal(r, address(splitter), 0, DEFAULT_SOLUTION, defaultDeadline());
        expectThankRevert(abi.encodeWithSelector(GiverAcceptanceInvalid.selector), r, empty);
        assertEq(uint8(statusOf(h)), uint8(Status.Active));
    }

    /*//////////////////// §9.3 #7 — tips from new money, bound to a path ////////////////////*/

    function test_TipDistributor_PaysALosingPathOnTheSettledFact() public {
        TipDistributor tips = new TipDistributor(IAHandFacts(address(core)));
        address tipper = makeAddr("tipper");
        fund(address(usd), tipper, 7e6);
        uint256 h = makeRaise();

        // the tipped path: shakerB's hop, which the Raiser will NOT settle
        RouteBuild memory losing = newRoute(h);
        addExplicitHop(losing, E1, shakerB, SHAKER_B_PK, 9_000);
        bytes32 losingShake = shakeHashesOf(losing)[0];
        vm.startPrank(tipper);
        usd.approve(address(tips), 7e6);
        uint256 id = tips.tip(h, losingShake, shakerB, address(usd), 7e6);
        vm.stopPrank();
        vm.expectRevert(TipDistributor.HandNotTerminal.selector);
        tips.release(id);

        RouteBuild memory winning = newRoute(h);
        addExplicitHop(winning, E1, shakerA, SHAKER_A_PK, 9_000);
        settle(winning);
        assertEq(usd.balanceOf(shakerA), 9e6, "the pot pays the settled route only");
        assertEq(usd.balanceOf(giver), 81e6);
        assertEq(usd.balanceOf(charity), 10e6);
        assertEq(usd.balanceOf(address(core)), 0, "Core custody never held the tip");

        tips.release(id);
        assertEq(usd.balanceOf(shakerB), 7e6, "new money, released by the Hand's terminal fact");
        assertEq(usd.balanceOf(address(tips)), 0);
        vm.expectRevert(TipDistributor.AlreadyReleased.selector);
        tips.release(id);
    }

    function test_TipDistributor_PaysOnTheReclaimedFactAndGuardsItsInputs() public {
        TipDistributor tips = new TipDistributor(IAHandFacts(address(core)));
        fund(address(t18), stranger, 10 ether);
        uint256 h = makeRaise();
        vm.startPrank(stranger);
        t18.approve(address(tips), 10 ether);
        vm.expectRevert(TipDistributor.UnknownHand.selector);
        tips.tip(h + 1, 0, shakerB, address(t18), 1 ether);
        vm.expectRevert(TipDistributor.ZeroBeneficiary.selector);
        tips.tip(h, 0, address(0), address(t18), 1 ether);
        vm.expectRevert(TipDistributor.ZeroTip.selector);
        tips.tip(h, 0, shakerB, address(t18), 0);
        uint256 id = tips.tip(h, keccak256("path"), shakerB, address(t18), 10 ether);
        vm.stopPrank();
        warpToExpiry(h);
        core.reclaim(h);
        tips.release(id);
        assertEq(t18.balanceOf(shakerB), 10 ether, "a reclaimed Hand is terminal too");
        assertEq(tips.tipCount(), 1);
    }

    /*//////////////////// §9.3 #8 — Safe approved-hash consent ////////////////////*/

    function test_SafeShaker_ConsentsByApprovedHashWithEmptyBytes() public {
        SafeLikeSigner safe = newSafe(SAFE_PK);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, address(safe), 0, 9_000); // empty acceptance bytes
        Terminal memory t = buildTerminal(r);
        expectThankRevert(abi.encodeWithSelector(ShakerAcceptanceInvalid.selector, 0), r, t);
        safeApprove(safe, SAFE_PK, digestOf(AHandSig.hashShakerAcceptance(shakeHashesOf(r)[0])));
        doThank(r, t);
        assertEq(usd.balanceOf(address(safe)), 9e6, "the Safe's margin");
    }

    function test_SafeGiver_ConsentsByApprovedHashWithEmptyBytes() public {
        SafeLikeSigner safe = newSafe(SAFE_PK);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r, address(safe), 0, DEFAULT_SOLUTION, defaultDeadline());
        expectThankRevert(abi.encodeWithSelector(GiverAcceptanceInvalid.selector), r, t);
        safeApprove(safe, SAFE_PK, digestOf(AHandSig.hashGiverAcceptance(AHandSig.hashGive(t.give))));
        doThank(r, t);
        assertEq(usd.balanceOf(address(safe)), 81e6, "the Safe's residual");
    }

    /*//////////////////// §9.3 #9 — governor successor on the policyAdmin seam ////////////////////*/

    function test_Governor_SucceedsTheAdminAndCanCallExactlySetCharityAllowed() public {
        GovernorSuccessor gov = new GovernorSuccessor(core, council);
        uint256 live = makeRaise(); // raised under the old allowlist
        address newCharity = makeAddr("newCharity");

        vm.prank(council);
        vm.expectRevert(NotPendingAdmin.selector);
        gov.accept(); // not nominated yet
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(address(gov));
        vm.expectEmit(true, true, false, false, address(core));
        emit AHandCore.PolicyAdminTransferred(policyAdmin, address(gov));
        vm.prank(council);
        gov.accept();
        assertEq(core.policyAdmin(), address(gov));
        assertEq(core.pendingPolicyAdmin(), address(0));
        vm.prank(policyAdmin);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setCharityAllowed(newCharity, true); // the old key is powerless

        // the one power, prospective only
        vm.startPrank(council);
        gov.setCharity(newCharity, true);
        gov.setCharity(charity, false);
        vm.stopPrank();
        assertTrue(core.charityAllowed(newCharity));
        assertFalse(core.charityAllowed(charity));
        assertEq(core.policyRevision(), 3);
        vm.prank(stranger);
        vm.expectRevert(GovernorSuccessor.NotCouncil.selector);
        gov.setCharity(charity, true);

        expectRaiseRevert(CharityNotAllowed.selector, defaultParams()); // future Hands follow the new list
        RaiseParams memory p = defaultParams();
        p.charityRecipient = newCharity;
        makeRaise(p);
        RouteBuild memory r = newRoute(live);
        addSelfHop(r, E1, 10_000);
        settle(r);
        assertEq(usd.balanceOf(charity), 10e6, "the live Hand still pays its snapshotted charity");
    }

    function test_Governor_HasNoOtherReach() public {
        GovernorSuccessor gov = new GovernorSuccessor(core, council);
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(address(gov));
        vm.prank(council);
        gov.accept();
        uint256 h = makeRaise();
        bytes32 terms = termsOf(h);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r);

        vm.startPrank(council);
        bytes[] memory absent = new bytes[](7);
        absent[0] = abi.encodeWithSignature("pause()");
        absent[1] = abi.encodeWithSignature("unpause()");
        absent[2] = abi.encodeWithSignature("rescue(address,address,uint256)", address(usd), council, 1);
        absent[3] = abi.encodeWithSignature("upgradeTo(address)", address(gov));
        absent[4] = abi.encodeWithSignature("setTokenEnabled(address,bool)", address(usd), false);
        absent[5] = abi.encodeWithSignature("setRaiseOpen(bool)", false);
        absent[6] = abi.encodeWithSignature("setExpiry(uint256,uint40)", h, uint40(block.timestamp + 60 days));
        for (uint256 i; i < absent.length; ++i) {
            (bool ok, bytes memory ret) = gov.attempt(absent[i]);
            assertFalse(ok, "no such selector");
            assertEq(ret.length, 0, "no fallback answered");
        }
        (bool okThank, bytes memory retThank) = gov.attempt(abi.encodeCall(core.thank, (h, r.hops, t)));
        assertFalse(okThank);
        assertEq(bytes4(retThank), NotRaiser.selector, "the governor is nobody's raiser");
        (bool okReclaim, bytes memory retReclaim) = gov.attempt(abi.encodeCall(core.reclaim, (h)));
        assertFalse(okReclaim);
        assertEq(bytes4(retReclaim), HandNotExpired.selector, "expiry is not the governor's to call");
        (bool okWithdraw, bytes memory retWithdraw) = gov.attempt(abi.encodeCall(core.withdraw, (address(usd), council)));
        assertFalse(okWithdraw);
        assertEq(bytes4(retWithdraw), ZeroClaim.selector, "nothing to redirect");
        (bool okSame,) = gov.attempt(abi.encodeCall(core.transferPolicyAdmin, (address(0))));
        assertFalse(okSame, "cancelling nothing is NoChange");
        vm.stopPrank();
        assertEq(termsOf(h), terms, "no term moved");
        assertEq(uint8(statusOf(h)), uint8(Status.Active));
    }

    /*//////////////////// §9.3 #5 — EAS-style late-delivery reader ////////////////////*/

    function test_LateDeliveryReader_FlagsAReclaimedHandWhoseGiveWasTimestampedBefore() public {
        GiveTimestamper eas = new GiveTimestamper();
        LateDeliveryReader reader = new LateDeliveryReader(IAHandFacts(address(core)), eas);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, core.facts(h).expiry);
        bytes32 giveHash = AHandSig.hashGive(t.give);
        bytes32 key = reader.giveKey(h, giveHash);
        assertEq(key, keccak256(abi.encode("ahand.give.v1", block.chainid, address(core), h, giveHash)));

        // the giver proves delivery existed at T0
        vm.warp(block.timestamp + 5 days);
        uint64 t0 = uint64(vm.getBlockTimestamp()); // not block.timestamp: via-IR may re-read it after the next warp
        vm.prank(giver);
        eas.timestamp(key);
        vm.prank(giver);
        vm.expectRevert(GiveTimestamper.AlreadyTimestamped.selector);
        eas.timestamp(key);
        (bool flagged,,) = reader.freeriderFlag(h, giveHash);
        assertFalse(flagged, "an Active Hand is not a fact yet");

        // the Raiser lets it expire and anyone reclaims
        warpToExpiry(h);
        vm.prank(stranger);
        core.reclaim(h);
        (bool flaggedNow, uint64 ts, uint40 closedAt) = reader.freeriderFlag(h, giveHash);
        assertTrue(flaggedNow, "evidence predates the reclaim: flag");
        assertEq(ts, t0);
        assertEq(closedAt, core.facts(h).closedAt);
        (bool other,,) = reader.freeriderFlag(h, keccak256("another give"));
        assertFalse(other, "a Give nobody timestamped flags nothing");

        // a settled Hand never flags, even with a timestamped Give
        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newRoute(h2);
        addSelfHop(r2, E1, 9_000);
        Terminal memory t2 = buildTerminal(r2);
        vm.prank(giver);
        eas.timestamp(reader.giveKey(h2, AHandSig.hashGive(t2.give)));
        doThank(r2, t2);
        (bool settledFlag,,) = reader.freeriderFlag(h2, AHandSig.hashGive(t2.give));
        assertFalse(settledFlag, "the Hand settled: no freeriding");
    }

    /*//////////////////// Seam 2 — a verifier bound to IAHandFacts only ////////////////////*/

    function test_EnvelopeVerifier_BindsTheFactsInterfaceNotACore() public {
        bytes memory meta = abi.encode("title", "body");
        bytes memory disc = abi.encode("topic");
        RaiseParams memory p = defaultParams();
        EnvelopeVerifier v1 = new EnvelopeVerifier(IAHandFacts(address(core)));
        p.metadataCommitment = v1.envelope(keccak256("ahand.meta.v1"), keccak256(meta));
        p.discoveryCommitment = v1.envelope(keccak256("ahand.discovery.v1"), keccak256(disc));
        uint256 h = makeRaise(p);
        assertTrue(v1.verifyMetadata(h, keccak256("ahand.meta.v1"), meta));
        assertTrue(v1.verifyDiscovery(h, keccak256("ahand.discovery.v1"), disc));
        assertFalse(v1.verifyMetadata(h, keccak256("ahand.meta.v1"), disc));

        // the same verifier source against a second Core reads that Core's Hands: it knows only the interface
        AHandCore other = deployCore(charity, policyAdmin);
        fundFor(other, address(usd), raiser, DEPOSIT);
        uint256 h2 = makeRaiseAs(raiser, other, p, DEFAULT_REF, noTags());
        EnvelopeVerifier v2 = new EnvelopeVerifier(IAHandFacts(address(other)));
        assertTrue(v2.verifyMetadata(h2, keccak256("ahand.meta.v1"), meta));
        assertFalse(v2.verifyMetadata(h2 + 1, keccak256("ahand.meta.v1"), meta), "never raised there: zero commitment");
    }

    /*//////////////////// Bounds: block nothing, change nothing, need nothing ////////////////////*/

    function test_NoExtensionCanBlockReclaim_HostileRaiserParksItsOwnRefund() public {
        HookToken hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
        (PolicyRaiser ctl, uint256 h) = controllerHand(); // the controller holds the refund right
        hook.setHooked(address(ctl), true); // the controller has no hook: every push to it reverts
        warpToExpiry(h);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Reclaimed), "reclaim never waits for the raiser");
        assertEq(core.claims(address(hook), address(ctl)), DEPOSIT, "its refund parks, nothing else does");
        assertEq(hook.balanceOf(address(core)), DEPOSIT);
        // the parked refund is anyone's to deliver once the recipient stops refusing
        vm.prank(stranger);
        vm.expectRevert(); // the hook call to a contract without the hook reverts with no data
        core.withdraw(address(hook), address(ctl));
        hook.setHooked(address(ctl), false);
        vm.prank(stranger);
        core.withdraw(address(hook), address(ctl));
        assertEq(hook.balanceOf(address(ctl)), DEPOSIT);
        ctl.distributeRefund();
        assertEq(hook.balanceOf(raiser), 1_000e6, "the policy forwards it to the principal");
    }

    function test_NoExtensionCanBlockSettlementOrWithdraw_HostileShakerParksOnlyItsShare() public {
        HookToken hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
        HostileHookShaker hostile = new HostileHookShaker();
        hook.setHooked(address(hostile), true);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, address(hostile), 0, 9_000); // consents with empty bytes (its verifier accepts anything)
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_000);
        Terminal memory t = buildTerminal(r);
        vm.expectEmit(true, true, true, true, address(core));
        emit AHandCore.PayoutDeferred(h, address(hook), address(hostile), AllocationKind.ShakerMargin, 0, 9e6);
        doThank(r, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "one hostile hop never kills the settlement");
        assertEq(hook.balanceOf(charity), 10e6);
        assertEq(hook.balanceOf(shakerA), 9e6);
        assertEq(hook.balanceOf(giver), 72e6);
        assertEq(core.claims(address(hook), address(hostile)), 9e6, "exactly its own share parks");
        vm.prank(stranger);
        vm.expectRevert(bytes("REFUSED"));
        core.withdraw(address(hook), address(hostile)); // while it refuses, only it waits
        hostile.setArmed(false);
        vm.prank(stranger);
        core.withdraw(address(hook), address(hostile));
        assertEq(hook.balanceOf(address(hostile)), 9e6);
        assertEq(hook.balanceOf(address(core)), 0);
    }

    function test_NoExtensionCanChangeTheTermsOfActiveHands() public {
        uint256 eoaHand = makeRaise();
        (PolicyRaiser ctl, uint256 ctlHand) = controllerHand();
        uint256[] memory c = new uint256[](1);
        c[0] = 50e6;
        (FundingVault vault, uint256 vaultHandId,) = vaultHand(address(usd), c);
        bytes32[3] memory before = [termsOf(eoaHand), termsOf(ctlHand), termsOf(vaultHandId)];

        // every lever an extension or the admin seam has, pulled
        GovernorSuccessor gov = new GovernorSuccessor(core, council);
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(address(gov));
        vm.prank(council);
        gov.accept();
        vm.prank(council);
        gov.setCharity(charity, false);
        TipDistributor tips = new TipDistributor(IAHandFacts(address(core)));
        fund(address(usd), stranger, 1e6);
        vm.startPrank(stranger);
        usd.approve(address(tips), 1e6);
        tips.tip(eoaHand, 0, giver, address(usd), 1e6);
        vm.stopPrank();
        newPolicyCap(uint40(block.timestamp + 1 days));
        vm.prank(address(ctl));
        (bool ok,) = address(core).call(abi.encodeWithSignature("setCharityRecipient(uint256,address)", ctlHand, stranger));
        assertFalse(ok);
        vm.prank(address(vault));
        (ok,) = address(core).call(abi.encodeWithSignature("topUp(uint256,uint256)", vaultHandId, 1e6));
        assertFalse(ok);

        assertEq(termsOf(eoaHand), before[0], "EOA Hand terms frozen");
        assertEq(termsOf(ctlHand), before[1], "controller Hand terms frozen");
        assertEq(termsOf(vaultHandId), before[2], "vault Hand terms frozen");
        assertFalse(core.charityAllowed(charity));
        // the de-listed charity is still paid by the Hand that snapshotted it
        RouteBuild memory r = newRoute(eoaHand);
        addSelfHop(r, E1, 9_000);
        settle(r);
        assertEq(usd.balanceOf(charity), 10e6);
    }

    function test_CoreNeededNoChange_BytecodeEqualsAFreshDeployment() public {
        // run the catalogue against the live Core …
        (PolicyRaiser ctl, uint256 h1) = controllerHand();
        enterDecisionWindow();
        RouteBuild memory r1 = newRoute(h1);
        addExplicitHop(r1, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory t1 = buildTerminal(r1);
        vm.prank(decisionMaker);
        ctl.decide(r1.hops, t1, 0);
        uint256[] memory c = new uint256[](1);
        c[0] = 10e6;
        (, uint256 h2,) = vaultHand(address(usd), c);
        PolicyCapability cap = newPolicyCap(uint40(block.timestamp + 2 days));
        uint256 h3 = makeRaise();
        (SplitterGiver splitter,) = newSplitter();
        RouteBuild memory r3 = delegatedRoute(h3, cap, vm.addr(E2), 500, defaultDeadline(), AGENT_PK);
        doThank(r3, buildTerminal(r3, address(splitter), MANAGER_PK, DEFAULT_SOLUTION, defaultDeadline()));
        warpToExpiry(h2);
        core.reclaim(h2);
        assertEq(uint8(statusOf(h1)), uint8(Status.Settled));
        assertEq(uint8(statusOf(h3)), uint8(Status.Settled));

        // … and the Core is the same contract it was before any of it
        assertEq(address(core).codehash, coreCodeHashAtSetUp, "the live code never changed");
        AHandCore fresh = deployCore(charity, policyAdmin);
        (bytes memory liveMasked, uint256 liveWords) = maskedCode(core);
        (bytes memory freshMasked, uint256 freshWords) = maskedCode(fresh);
        assertTrue(liveWords >= 2, "both deployment-bound immutables were found");
        assertEq(liveWords, freshWords);
        assertEq(address(core).code.length, address(fresh).code.length);
        assertTrue(keccak256(address(core).code) != keccak256(address(fresh).code), "they differ only by the immutables ...");
        assertEq(keccak256(liveMasked), keccak256(freshMasked), "... and are otherwise byte-identical");
        assertEq(fresh.DOMAIN_SEPARATOR(), domainSeparatorOf(fresh));
    }
}

/*//////////////////////////////////////////////////////////////
    I-19 — Granted(h, a) ghost accounting over contract actors (§9.5).

    The handler owns every key and constructs only valid calls (fail_on_revert).
    Raisers are an EOA, controllers and vaults; capabilities are EOA keys and a
    PolicyCapability; shakers are an EOA, a Safe-like approved-hash signer and an
    ERC-1271 wallet; givers are an EOA, a Safe and a splitter. The token blacklists
    recipients at the fuzzer's whim so pushes really defer. After every call:
    received + claims == granted for every actor, custody covers the liability,
    Raise-time terms are frozen, and the Core bytecode is what it was.
//////////////////////////////////////////////////////////////*/

contract ExtensionGrantHandler is ExtensionsFixture {
    BlacklistToken public bl;
    SafeLikeSigner public safeShaker;
    SafeLikeSigner public safeGiver;
    SmartWallet1271 public walletShaker;
    SplitterGiver public splitter;
    PolicyCapability public cap;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant WALLET_PK = 0x3A11E7aa;
    uint256 constant SAFE_SHAKER_PK = 0x5AFE01aa;
    uint256 constant SAFE_GIVER_PK = 0x5AFE02aa;

    /// Every address Core could ever pay (grants and refunds); contract raisers join on creation.
    address[] public actors;
    mapping(address => bool) public isActor;

    /// Ghosts (§9.5): Granted(·, a) summed over Hands, tokens received from Core, custody liability.
    mapping(address => uint256) public granted;
    mapping(address => uint256) public received;
    uint256 public activeLiability;
    bytes32 public coreCodeHash;

    /// Hands: 0 = EOA raiser, 1 = PolicyRaiser, 2 = FundingVault.
    struct HandCtx {
        uint8 kind;
        address ext;
    }

    uint256[] public allHands;
    uint256[] public activeHands;
    mapping(uint256 => HandCtx) public ctxOf;
    mapping(uint256 => bytes32) public termsAtRaise;

    uint256 public thanks;
    uint256 public reclaims;
    uint256 public deferrals;
    uint256 public withdrawals;

    uint256[] private _before;

    function setUp() public override {
        super.setUp();
        bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1e15);
        bl.mint(alice, 1e15);
        bl.mint(bob, 1e15);
        safeShaker = newSafe(SAFE_SHAKER_PK);
        safeGiver = newSafe(SAFE_GIVER_PK);
        walletShaker = newSmartWallet(WALLET_PK);
        address[] memory members = new address[](2);
        members[0] = makeAddr("m0");
        members[1] = makeAddr("m1");
        uint16[] memory shares = new uint16[](2);
        shares[0] = 7_000;
        shares[1] = 3_000;
        splitter = new SplitterGiver(vm.addr(MANAGER_PK), members, shares);
        address[] memory allowed = new address[](1);
        allowed[0] = vm.addr(E2);
        cap = new PolicyCapability(address(core), vm.addr(AGENT_PK), 500, type(uint40).max, allowed);
        coreCodeHash = address(core).codehash;

        _addActor(charity);
        _addActor(raiser);
        _addActor(giver);
        _addActor(shakerA);
        _addActor(vm.addr(E0));
        _addActor(address(safeShaker));
        _addActor(address(walletShaker));
        _addActor(address(safeGiver));
        _addActor(address(splitter));
        _addActor(address(cap));
    }

    /*//////////////////// views ////////////////////*/

    function coreOf() external view returns (AHandCore) {
        return core;
    }

    function giverOf() external view returns (address) {
        return giver;
    }

    function termsOfPublic(uint256 handId) external view returns (bytes32) {
        return termsOf(handId);
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function handCount() external view returns (uint256) {
        return allHands.length;
    }

    function activeCount() external view returns (uint256) {
        return activeHands.length;
    }

    function claimsTotal() external view returns (uint256 sum) {
        for (uint256 i; i < actors.length; ++i) {
            sum += core.claims(address(bl), actors[i]);
        }
    }

    /*//////////////////// actions ////////////////////*/

    function raiseEoa(uint256 amount, bool donate) external {
        RaiseParams memory p = _params(amount, donate);
        vm.prank(raiser);
        uint256 h = core.raise(p, DEFAULT_REF, noTags());
        _track(h, HandCtx(0, raiser), p.amount);
    }

    function raiseController(uint256 amount, bool donate) external {
        PolicyRaiser ctl = new PolicyRaiser(
            core,
            PolicyRaiser.Policy({
                decisionMaker: address(this),
                principal: raiser,
                deliveryDeadline: uint40(block.timestamp + 30 minutes),
                challengeDeadline: uint40(block.timestamp + 1 hours),
                decisionDeadline: uint40(block.timestamp + 7 days)
            })
        );
        _addActor(address(ctl));
        RaiseParams memory p = _params(amount, donate);
        p.metadataCommitment = ctl.metadataCommitment();
        vm.startPrank(raiser);
        bl.approve(address(ctl), p.amount);
        uint256 h = ctl.fund(p, DEFAULT_REF, noTags());
        vm.stopPrank();
        _track(h, HandCtx(1, address(ctl)), p.amount);
    }

    function raiseVault(uint256 a, uint256 b, bool donate) external {
        a = bound(a, 1e6, 5e11);
        b = bound(b, 1e6, 5e11); // a + b stays inside _params' range, so the pot equals the pool
        FundingVault vault = new FundingVault(
            core, IERC20(address(bl)), address(this), uint40(block.timestamp + 1), uint40(block.timestamp + 1 hours)
        );
        _addActor(address(vault));
        vm.startPrank(alice);
        bl.approve(address(vault), a);
        vault.contribute(a);
        vm.stopPrank();
        vm.startPrank(bob);
        bl.approve(address(vault), b);
        vault.contribute(b);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
        RaiseParams memory p = _params(a + b, donate);
        uint256 h = vault.raise(p, DEFAULT_REF, noTags());
        _track(h, HandCtx(2, address(vault)), p.amount);
    }

    /// @dev Thank an active Hand over a route of `kind`: 0 zero-shake; 1 self hop then an
    ///      explicit contract/EOA shaker; 2 self hop then the PolicyCapability as a bounded
    ///      child. Giver: 0 EOA, 1 Safe (approved hash), 2 splitter (ERC-1271).
    function thank(uint256 pick, uint8 kind, uint8 giverKind, uint8 shakerKind, uint16 m1, uint16 m2) external {
        if (activeHands.length == 0) return;
        uint256 h = activeHands[pick % activeHands.length];
        IAHandFacts.HandFacts memory f = core.facts(h);
        if (vm.getBlockTimestamp() >= f.expiry) return;
        HandCtx memory c = ctxOf[h];
        if (c.kind == 1) {
            (,,, uint40 challenge, uint40 decision) = PolicyRaiser(c.ext).policy();
            uint256 now_ = vm.getBlockTimestamp();
            if (now_ > decision) return;
            if (now_ <= challenge) vm.warp(uint256(challenge) + 1); // challenge + 1 < decision < expiry
        }
        kind %= 3;
        giverKind %= 3;
        shakerKind %= 3;
        m1 = uint16(bound(m1, 0, 2_000));
        m2 = uint16(bound(m2, 0, kind == 2 ? 500 : 2_000));

        RouteBuild memory r = newRoute(h);
        uint40 deadline = f.expiry;
        address[] memory shakers = new address[](2);
        uint16[] memory margins = new uint16[](2);
        uint256 hops;
        if (kind != 0) {
            addHop(r, E1, vm.addr(E0), 0, 10_000 - m1, deadline); // self-attributed to the root
            shakers[0] = vm.addr(E0);
            margins[0] = m1;
            if (kind == 1) {
                address shaker = _shaker(shakerKind);
                addHop(r, E2, shaker, _shakerPk(shakerKind), 10_000 - m1 - m2, deadline);
                if (shakerKind == 1) {
                    safeApprove(safeShaker, SAFE_SHAKER_PK, digestOf(AHandSig.hashShakerAcceptance(shakeHashesOf(r)[1])));
                }
                shakers[1] = shaker;
            } else {
                // E1 is replaced by the capability: rebuild hop 0 toward the cap
                r = newRoute(h);
                addHopTo(r, address(cap), 0, vm.addr(E0), 0, 10_000 - m1, bytes32(0), deadline);
                Shake memory s = Shake({
                    handId: h,
                    childCapability: vm.addr(E2),
                    shaker: address(cap),
                    parentClaimBps: 10_000 - m1,
                    childClaimBps: 10_000 - m1 - m2,
                    hopDataHash: 0,
                    deadline: deadline
                });
                addPolicyHop(r, cap, AGENT_PK, s);
                r.parentPk = E2;
                r.parentCap = vm.addr(E2);
                shakers[1] = address(cap);
            }
            margins[1] = m2;
            hops = 2;
        }
        address giverAddr = _giver(giverKind);
        Terminal memory t = buildTerminal(r, giverAddr, _giverPk(giverKind), keccak256(abi.encode(h, pick)), deadline);
        if (giverKind == 1) {
            safeApprove(safeGiver, SAFE_GIVER_PK, digestOf(AHandSig.hashGiverAcceptance(AHandSig.hashGive(t.give))));
        }

        _snapshot();
        vm.recordLogs();
        if (c.kind == 0) {
            vm.prank(raiser);
            core.thank(h, r.hops, t);
        } else if (c.kind == 1) {
            PolicyRaiser(c.ext).decide(r.hops, t, keccak256("evidence"));
        } else {
            FundingVault(c.ext).thank(r.hops, t);
        }
        _collect();
        deferrals += _countDeferred(vm.getRecordedLogs());

        // Granted(h, ·): C to the charity, A_i to each consenting shaker, G to the giver
        uint256 C = AHandMath.cut(f.pool, f.charityBps);
        uint256 D = f.pool - C;
        uint256 sumA;
        for (uint256 i; i < hops; ++i) {
            uint256 A = margins[i] == 0 ? 0 : AHandMath.cut(D, margins[i]);
            granted[shakers[i]] += A;
            sumA += A;
        }
        granted[f.charityRecipient] += C;
        granted[giverAddr] += D - sumA;
        _retire(h, f.pool);
        ++thanks;
    }

    function reclaim(uint256 pick) external {
        if (activeHands.length == 0) return;
        uint256 h = activeHands[pick % activeHands.length];
        IAHandFacts.HandFacts memory f = core.facts(h);
        if (vm.getBlockTimestamp() < f.expiry) vm.warp(f.expiry);
        _snapshot();
        vm.recordLogs();
        vm.prank(stranger);
        core.reclaim(h);
        _collect();
        deferrals += _countDeferred(vm.getRecordedLogs());
        granted[f.raiser] += f.pool; // Granted(h, raiser) on reclaim = P
        _retire(h, f.pool);
        ++reclaims;
    }

    function withdraw(uint256 pick) external {
        address a = actors[pick % actors.length];
        uint256 claim = core.claims(address(bl), a);
        if (claim == 0) return;
        if (bl.blocked(a)) {
            uint256 custody = bl.balanceOf(address(core));
            vm.prank(stranger);
            try core.withdraw(address(bl), a) {
                revert("withdraw to a blocked beneficiary must revert");
            } catch {}
            require(core.claims(address(bl), a) == claim && bl.balanceOf(address(core)) == custody, "claim untouched");
            return;
        }
        _snapshot();
        vm.prank(stranger);
        core.withdraw(address(bl), a);
        _collect();
        ++withdrawals;
    }

    function toggleBlock(uint256 pick) external {
        address a = actors[pick % actors.length];
        bl.setBlocked(a, !bl.blocked(a));
    }

    /// @dev Extensions distribute what Core paid them, outside Core: never a Core outflow.
    function distributeOutside(uint256 pick) external {
        uint256 h = allHands.length == 0 ? 0 : allHands[pick % allHands.length];
        if (h == 0) return;
        HandCtx memory c = ctxOf[h];
        if (core.facts(h).status != Status.Reclaimed) {
            if (bl.balanceOf(address(splitter)) != 0) splitter.split(IERC20(address(bl)));
            return;
        }
        if (c.kind == 1 && bl.balanceOf(c.ext) != 0 && !bl.blocked(raiser)) PolicyRaiser(c.ext).distributeRefund();
        if (c.kind == 2) {
            FundingVault vault = FundingVault(c.ext);
            if (bl.balanceOf(c.ext) >= vault.totalContributed() && vault.contributed(alice) != 0) {
                vm.prank(alice);
                vault.refund();
            }
        }
    }

    /*//////////////////// internals ////////////////////*/

    function _params(uint256 amount, bool donate) private view returns (RaiseParams memory p) {
        p = donate ? defaultParams() : noCharityParams();
        p.amount = bound(amount, 1e6, 1e12);
    }

    function _track(uint256 h, HandCtx memory c, uint256 pool) private {
        allHands.push(h);
        activeHands.push(h);
        ctxOf[h] = c;
        termsAtRaise[h] = termsOf(h);
        activeLiability += pool;
    }

    function _retire(uint256 h, uint256 pool) private {
        activeLiability -= pool;
        for (uint256 i; i < activeHands.length; ++i) {
            if (activeHands[i] == h) {
                activeHands[i] = activeHands[activeHands.length - 1];
                activeHands.pop();
                return;
            }
        }
    }

    function _addActor(address a) private {
        if (isActor[a]) return;
        isActor[a] = true;
        actors.push(a);
    }

    function _shaker(uint8 k) private view returns (address) {
        return k == 0 ? shakerA : k == 1 ? address(safeShaker) : address(walletShaker);
    }

    function _shakerPk(uint8 k) private pure returns (uint256) {
        return k == 0 ? SHAKER_A_PK : k == 1 ? 0 : WALLET_PK;
    }

    function _giver(uint8 k) private view returns (address) {
        return k == 0 ? giver : k == 1 ? address(safeGiver) : address(splitter);
    }

    function _giverPk(uint8 k) private pure returns (uint256) {
        return k == 0 ? GIVER_PK : k == 1 ? 0 : MANAGER_PK;
    }

    /// @dev Balances of every actor before a Core call that may pay out.
    function _snapshot() private {
        delete _before;
        for (uint256 i; i < actors.length; ++i) {
            _before.push(bl.balanceOf(actors[i]));
        }
    }

    /// @dev Credit every actor's inflow from the call to `received`; a Core payout never debits an actor.
    function _collect() private {
        for (uint256 i; i < actors.length; ++i) {
            uint256 now_ = bl.balanceOf(actors[i]);
            require(now_ >= _before[i], "Core call debited an actor");
            received[actors[i]] += now_ - _before[i];
        }
    }

    function _countDeferred(Vm.Log[] memory logs) private pure returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == AHandCore.PayoutDeferred.selector) ++n;
        }
    }
}

contract AHandV2ExtensionsGrantInvariant is Test {
    ExtensionGrantHandler handler;

    function setUp() public {
        handler = new ExtensionGrantHandler();
        handler.setUp();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.raiseEoa.selector;
        selectors[1] = handler.raiseController.selector;
        selectors[2] = handler.raiseVault.selector;
        selectors[3] = handler.thank.selector;
        selectors[4] = handler.reclaim.selector;
        selectors[5] = handler.withdraw.selector;
        selectors[6] = handler.toggleBlock.selector;
        selectors[7] = handler.distributeOutside.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev The handler is not vacuous: every raiser kind, route kind, shaker kind and giver
    ///      kind settles, pushes defer under the blacklist, withdraw drains them, and the
    ///      ghost ledger balances at the end of the deterministic drive.
    function test_Handler_DrivesEveryActorKindThroughSettlementDeferralAndWithdraw() public {
        handler.raiseEoa(1_000e6, true);
        handler.raiseController(2_000e6, true);
        handler.raiseVault(300e6, 700e6, false);
        handler.raiseEoa(50e6, false);
        handler.raiseController(60e6, false);
        handler.raiseVault(10e6, 20e6, true);
        // block the EOA giver, the Safe shaker and the splitter so their pushes park
        uint256 n = handler.actorCount();
        for (uint256 i; i < n; ++i) {
            address a = handler.actors(i);
            if (a == handler.giverOf() || a == address(handler.safeShaker()) || a == address(handler.splitter())) {
                handler.toggleBlock(i);
            }
        }
        // six Hands, six route shapes: (kind, giver, shaker) over EOA / controller / vault raisers
        handler.thank(0, 0, 0, 0, 0, 0); // zero-shake, EOA giver
        handler.thank(0, 1, 1, 1, 1_000, 500); // self hop + Safe shaker, Safe giver
        handler.thank(0, 2, 2, 0, 1_000, 500); // self hop + policy capability, splitter giver
        handler.thank(0, 1, 2, 2, 700, 300); // self hop + ERC-1271 wallet shaker, splitter giver
        handler.reclaim(0); // the remaining two expire
        handler.reclaim(0);
        assertEq(handler.thanks(), 4, "every route shape settled");
        assertEq(handler.reclaims(), 2);
        assertGt(handler.deferrals(), 0, "the blacklist parked shares");
        // unblock and drain every claim
        for (uint256 i; i < handler.actorCount(); ++i) {
            address a = handler.actors(i);
            if (handler.bl().blocked(a)) handler.toggleBlock(i);
            handler.withdraw(i);
        }
        assertGt(handler.withdrawals(), 0);
        assertEq(handler.claimsTotal(), 0, "nothing left parked");
        assertEq(handler.activeCount(), 0);
        invariant_GrantBound_ReceivedPlusClaimsEqualsGranted();
        invariant_CustodyCoversActivePoolsAndClaims();
        invariant_RaiseTimeTermsFrozenAndLifecycleOneWay();
        assertEq(handler.bl().balanceOf(address(handler.coreOf())), 0, "custody fully released");
        // what Core paid, the extensions now distribute outside Core
        for (uint256 i; i < handler.handCount(); ++i) {
            handler.distributeOutside(i);
        }
        assertEq(handler.bl().balanceOf(address(handler.splitter())), 0, "the splitter split its residuals");
    }

    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 64
    function invariant_GrantBound_ReceivedPlusClaimsEqualsGranted() public view {
        AHandCore c = handler.coreOf();
        address token = address(handler.bl());
        uint256 n = handler.actorCount();
        for (uint256 i; i < n; ++i) {
            address a = handler.actors(i);
            assertEq(
                handler.received(a) + c.claims(token, a), handler.granted(a), "outflow(h, a) + parked == Granted(h, a)"
            );
        }
    }

    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 64
    function invariant_CustodyCoversActivePoolsAndClaims() public view {
        AHandCore c = handler.coreOf();
        assertEq(
            handler.bl().balanceOf(address(c)),
            handler.activeLiability() + handler.claimsTotal(),
            "custody == sum pool(Active) + sum claims"
        );
    }

    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 64
    function invariant_RaiseTimeTermsFrozenAndLifecycleOneWay() public view {
        AHandCore c = handler.coreOf();
        uint256 n = handler.handCount();
        for (uint256 i; i < n; ++i) {
            uint256 h = handler.allHands(i);
            assertEq(handler.termsOfPublic(h), handler.termsAtRaise(h), "no extension changed a Raise-time fact");
            IAHandFacts.HandFacts memory f = c.facts(h);
            if (f.status == Status.Active) {
                assertEq(f.closedAt, 0);
                assertEq(f.settlementHash, bytes32(0));
            } else {
                assertTrue(f.closedAt != 0, "terminal => closedAt");
                assertEq(f.settlementHash != bytes32(0), f.status == Status.Settled, "settlementHash <=> Settled");
            }
        }
    }

    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 64
    function invariant_CoreCodeUnchanged() public view {
        assertEq(address(handler.coreOf()).codehash, handler.coreCodeHash(), "the Core needed no change");
    }
}
