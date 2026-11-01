// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
    Signals v2 suite — DESIGN §9.4, D5–D16, Q32, S35, I-26.

    The reference reader of Seam 3: receipts (RAISED, SHAKEN, GIVEN,
    THANKED) and earned Up materialized permissionlessly from facts the
    Core already settled, Up endorsements, voluntary Downs, the soulbound
    ERC-1155 surface, and the one rule that holds it all together: Core
    never calls Signals, so nothing here can touch escrow.
//////////////////////////////////////////////////////////////*/

import {Vm} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {AHandTestBase} from "./AHandTestBase.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandMath, AHandSettlement} from "../src/AHandFacts.sol";
import {RaiseParams, Terminal, Status, ZeroAddress} from "../src/AHandTypes.sol";
import {
    AHandSignalsV2,
    UpContext,
    NotRaised,
    NotSettled,
    AlreadyMaterialized,
    SourceCommitmentMismatch,
    ZeroAmount,
    InsufficientEarned,
    SelfTarget,
    ZeroContext,
    NotParticipant,
    LengthMismatch,
    Soulbound,
    UnsupportedDecimals
} from "../src/AHandSignalsV2.sol";
import {NoDecimalsToken, Token30Decimals} from "./mocks/DecimalsTokens.sol";
import {AlwaysValid1271} from "./mocks/Signers1271.sol";
import {FiatTokenLikeV1} from "./mocks/FiatTokenLike.sol";

/// @dev A contract actor that loudly rejects every ERC-1155 receiver hook — so a
///      successful mint to it proves Signals never calls one — and accepts any
///      ERC-1271 signature, so it can be a giver (empty acceptance bytes) and a
///      raiser (Core needs no signature from the raiser).
contract RevertingReceiver1155 is AlwaysValid1271 {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert("hook called");
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("hook called");
    }
}

contract AHandV2SignalsTest is AHandTestBase {
    AHandSignalsV2 signals;

    uint256 constant ID_RAISED = 1;
    uint256 constant ID_SHAKEN = 2;
    uint256 constant ID_GIVEN = 3;
    uint256 constant ID_THANKED = 4;
    uint256 constant ID_UP = 5;
    uint256 constant ID_DOWN = 6;

    /// Second keyed giver and a keyed raiser (the default `raiser` has no key, so
    /// it can never be its own giver).
    uint256 constant GIVER2_PK = 0x62aa;
    uint256 constant KEYED_RAISER_PK = 0x7a15e7;
    address giver2;
    address keyedRaiser;

    /// The v1 curve vectors (floor-sqrt, 1e18-scaled value, ONE_UP = 1e9).
    uint256 constant SQRT_5E18 = 2_236_067_977; // default Hand: $10 donation → $5 credit each
    uint256 constant SQRT_HALF_DOLLAR = 707_106_781; // floor(sqrt(5e17))
    uint256 constant SQRT_HALF_CENT = 70_710_678; // floor(sqrt(5e15))
    uint256 constant SQRT_ONE_DOLLAR = 1_000_000_000; // floor(sqrt(1e18)) — exactly one Up
    uint256 constant SQRT_5E19 = 7_071_067_811; // $100 donation → $50 credit each

    function setUp() public override {
        super.setUp();
        giver2 = vm.addr(GIVER2_PK);
        keyedRaiser = vm.addr(KEYED_RAISER_PK);
        vm.label(giver2, "giver2");
        vm.label(keyedRaiser, "keyedRaiser");
        signals = new AHandSignalsV2(address(core), address(usd));
    }

    /*//////////////////// helpers ////////////////////*/

    /// @dev Default params with another pool and donation share.
    function paramsWith(uint256 amount, uint16 charityBps) internal view returns (RaiseParams memory p) {
        p = defaultParams();
        p.amount = amount;
        p.charityBps = charityBps;
        if (charityBps == 0) p.charityRecipient = address(0);
    }

    /// @dev Settle `r` to the default giver, rebuild the preimage from the events
    ///      exactly as the app does, and materialize it as a stranger (anyone may).
    function settleAndMaterialize(RouteBuild memory r) internal returns (AHandSettlement.SettlementPreimage memory p) {
        vm.recordLogs();
        settle(r);
        p = preimageFromLogsOn(core, vm.getRecordedLogs(), r.handId);
        vm.prank(stranger);
        signals.materializeThank(p);
    }

    /// @dev A Hand under `p`, settled over one zero-margin self hop E0 → E1 and materialized.
    function simpleHand(RaiseParams memory p) internal returns (uint256 handId, AHandSettlement.SettlementPreimage memory pre) {
        handId = makeRaise(p);
        RouteBuild memory r = newRoute(handId);
        addSelfHop(r, E1, 10_000);
        pre = settleAndMaterialize(r);
    }

    /// @dev A Hand under `p`, settled over a zero-hop route (the root signs the Give)
    ///      to `giver_`, then materialized. No SHAKEN noise: only the two roles.
    function zeroHopHand(RaiseParams memory p, address giver_, uint256 giverPk)
        internal
        returns (uint256 handId, AHandSettlement.SettlementPreimage memory pre)
    {
        handId = makeRaise(p);
        RouteBuild memory r = newRoute(handId);
        Terminal memory t = buildTerminal(r, giver_, giverPk, DEFAULT_SOLUTION, defaultDeadline());
        vm.recordLogs();
        doThank(r, t);
        pre = preimageFromLogsOn(core, vm.getRecordedLogs(), handId);
        vm.prank(stranger);
        signals.materializeThank(pre);
    }

    /// @dev The mixed route of the mutation matrix: self hop, explicit shakerA,
    ///      anonymous zero-margin hop, shakerA again (two SHAKEN, no dedup).
    function fourHopRepeatShakerRoute(uint256 handId) internal view returns (RouteBuild memory r) {
        r = newRoute(handId);
        addSelfHop(r, E1, 9_000);
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_000);
        addAnonymousHop(r, E3, 8_000);
        addExplicitHop(r, E4, shakerA, SHAKER_A_PK, 7_000);
    }

    /// @dev A settled mixed route whose preimage is NOT yet materialized.
    function settledMixed() internal returns (uint256 handId, AHandSettlement.SettlementPreimage memory p) {
        handId = makeRaise();
        RouteBuild memory r = fourHopRepeatShakerRoute(handId);
        vm.recordLogs();
        settle(r);
        p = preimageFromLogsOn(core, vm.getRecordedLogs(), handId);
    }

    function expectMismatch(AHandSettlement.SettlementPreimage memory p) internal {
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(p);
    }

    /// @dev An actor with ≈ 7.07 earned Up: a $1 000 Hand with a $100 donation.
    function earnedActor() internal returns (address) {
        zeroHopHand(paramsWith(1_000e6, 1_000), giver, GIVER_PK);
        assertEq(signals.earnedUp(raiser), SQRT_5E19, "fixture: 7071067811 earned");
        return raiser;
    }

    function ctx(uint256 handId) internal pure returns (UpContext memory) {
        return UpContext({handId: handId, reasonTag: bytes32(0), evidenceHash: bytes32(0)});
    }

    function factsDigest(uint256 handId) internal view returns (bytes32) {
        return keccak256(abi.encode(core.facts(handId)));
    }

    function countFrom(Vm.Log[] memory logs, address emitter, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == sig) ++n;
        }
    }

    /*//////////////////// profile and construction ////////////////////*/

    function test_Profile_IsImmutablePerDeployment() public view {
        assertEq(signals.sourceCore(), address(core));
        assertEq(signals.qualifiedToken(), address(usd));
        assertEq(signals.unitScale(), 1e12, "6 decimals -> 1e12 per raw unit");
        assertTrue(signals.qualified(address(usd), 0));
        assertTrue(signals.qualified(address(usd), type(uint40).max), "closedAt is ignored by this profile");
        assertFalse(signals.qualified(address(t18), 0));
        assertFalse(signals.qualified(address(0), 0), "a zero-pot Hand has no qualified token");
        assertEq(signals.valuation(address(usd), 1e6), 1e18, "one whole USDC = one unit of value");
        assertEq(signals.valuation(address(usd), 10e6), 10e18);
        assertEq(signals.valuation(address(t18), 1 ether), 0, "outside the profile: zero");
        assertEq(signals.ONE_UP(), 1e9);
        assertEq(signals.SIGNAL_RAISED(), ID_RAISED);
        assertEq(signals.SIGNAL_SHAKEN(), ID_SHAKEN);
        assertEq(signals.SIGNAL_GIVEN(), ID_GIVEN);
        assertEq(signals.SIGNAL_THANKED(), ID_THANKED);
        assertEq(signals.SIGNAL_UP(), ID_UP);
        assertEq(signals.SIGNAL_DOWN(), ID_DOWN);
        assertEq(signals.ROLE_RAISER(), 1);
        assertEq(signals.ROLE_GIVER(), 2);
    }

    function test_Constructor_RejectsZeroAddresses() public {
        vm.expectRevert(ZeroAddress.selector);
        new AHandSignalsV2(address(0), address(usd));
        vm.expectRevert(ZeroAddress.selector);
        new AHandSignalsV2(address(core), address(0));
    }

    function test_Constructor_RejectsMoreThan18Decimals() public {
        Token30Decimals t30 = new Token30Decimals();
        vm.expectRevert(UnsupportedDecimals.selector);
        new AHandSignalsV2(address(core), address(t30));
    }

    function test_Constructor_RejectsTokenWithoutDecimals() public {
        NoDecimalsToken nd = new NoDecimalsToken();
        vm.expectRevert();
        new AHandSignalsV2(address(core), address(nd));
    }

    function test_Constructor_ScalesByDecimals() public {
        AHandSignalsV2 s18 = new AHandSignalsV2(address(core), address(t18));
        assertEq(s18.unitScale(), 1, "18 decimals: raw units are already 1e18-scaled");
        assertEq(s18.valuation(address(t18), 2 ether), 2e18);
        FiatTokenLikeV1 usdc = deployFiatToken();
        AHandSignalsV2 sUsdc = new AHandSignalsV2(address(core), address(usdc));
        assertEq(sUsdc.unitScale(), 1e12, "proxied USDC shape: 6 decimals through the proxy");
    }

    /*//////////////////// source keys ////////////////////*/

    function test_SourceKeys_V2TagsAndDerivation() public view {
        assertEq(signals.RAISED_SOURCE(), keccak256("aHand.signals.source.raised.v2"));
        assertEq(signals.THANK_SOURCE(), keccak256("aHand.signals.source.thank.v2"));
        uint256 handId = 42;
        assertEq(
            signals.raisedSourceKey(handId),
            keccak256(abi.encode(signals.RAISED_SOURCE(), block.chainid, address(core), handId))
        );
        assertEq(
            signals.thankSourceKey(handId),
            keccak256(abi.encode(signals.THANK_SOURCE(), block.chainid, address(core), handId))
        );
        assertTrue(signals.raisedSourceKey(handId) != signals.thankSourceKey(handId), "domains separate the keys");
    }

    function test_SourceKeys_BindChainAndCore() public {
        bytes32 before = signals.thankSourceKey(1);
        AHandSignalsV2 other = new AHandSignalsV2(address(deployCore(charity, policyAdmin)), address(usd));
        assertTrue(other.thankSourceKey(1) != before, "another Core, another key");
        assertTrue(other.raisedSourceKey(1) != signals.raisedSourceKey(1));
        vm.chainId(8453);
        assertTrue(signals.thankSourceKey(1) != before, "another chain, another key");
    }

    function test_SourceKeys_RaisedAndThankIndependent() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        settleAndMaterialize(r);
        assertTrue(signals.processedSource(signals.thankSourceKey(h)), "thank key processed");
        assertFalse(signals.processedSource(signals.raisedSourceKey(h)), "raised key untouched");
        assertEq(signals.balanceOf(raiser, ID_RAISED), 0, "no RAISED yet");
        assertEq(signals.balanceOf(raiser, ID_THANKED), 1);

        signals.materializeRaised(h);
        assertTrue(signals.processedSource(signals.raisedSourceKey(h)));
        assertEq(signals.balanceOf(raiser, ID_RAISED), 1, "RAISED after THANKED is fine");
    }

    /*//////////////////// materializeRaised (D6) ////////////////////*/

    function test_MaterializeRaised_Active_MintsToRaiserWithoutHook() public {
        uint256 h = makeRaise();
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(stranger, address(0), raiser, ID_RAISED, 1);
        vm.prank(stranger);
        signals.materializeRaised(h);
        assertEq(signals.balanceOf(raiser, ID_RAISED), 1);
        assertEq(signals.totalSupply(ID_RAISED), 1);
        assertTrue(signals.processedSource(signals.raisedSourceKey(h)));
    }

    function test_MaterializeRaised_Settled() public {
        uint256 h = makeRaise();
        settleSimple(h);
        signals.materializeRaised(h);
        assertEq(signals.balanceOf(raiser, ID_RAISED), 1);
    }

    function test_MaterializeRaised_Reclaimed() public {
        uint256 h = makeRaise();
        warpToExpiry(h);
        vm.prank(stranger);
        core.reclaim(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Reclaimed));
        signals.materializeRaised(h);
        assertEq(signals.balanceOf(raiser, ID_RAISED), 1, "the raise happened however it resolved");
    }

    function test_MaterializeRaised_ZeroPot() public {
        uint256 h = makeRaise(zeroPotParams());
        signals.materializeRaised(h);
        assertEq(signals.balanceOf(raiser, ID_RAISED), 1);
    }

    function test_MaterializeRaised_NeverRaised_NotRaised() public {
        vm.expectRevert(NotRaised.selector);
        signals.materializeRaised(777);
        vm.expectRevert(NotRaised.selector);
        signals.materializeRaised(0);
    }

    function test_MaterializeRaised_Replay_AlreadyMaterialized() public {
        uint256 h = makeRaise();
        signals.materializeRaised(h);
        vm.expectRevert(AlreadyMaterialized.selector);
        signals.materializeRaised(h);
        assertEq(signals.balanceOf(raiser, ID_RAISED), 1, "still exactly one");
    }

    function test_MaterializeRaised_TwoHandsTwoReceipts() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();
        signals.materializeRaised(h1);
        signals.materializeRaised(h2);
        assertEq(signals.balanceOf(raiser, ID_RAISED), 2);
    }

    /*//////////////////// materializeThank: guards ////////////////////*/

    function test_MaterializeThank_ActiveHand_NotSettled() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r);
        AHandSettlement.SettlementPreimage memory p = preimageOf(r, t, uint40(block.timestamp));
        vm.expectRevert(NotSettled.selector);
        signals.materializeThank(p);
        // the same preimage materializes once the thank lands in this block
        doThank(r, t);
        signals.materializeThank(p);
        assertEq(signals.balanceOf(giver, ID_GIVEN), 1);
    }

    function test_MaterializeThank_Reclaimed_NotSettled() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        AHandSettlement.SettlementPreimage memory p = preimageOf(r, buildTerminal(r), uint40(block.timestamp));
        warpToExpiry(h);
        core.reclaim(h);
        vm.expectRevert(NotSettled.selector);
        signals.materializeThank(p);
    }

    function test_MaterializeThank_NeverRaised_NotSettled() public {
        AHandSettlement.SettlementPreimage memory p;
        p.handId = 999;
        vm.expectRevert(NotSettled.selector);
        signals.materializeThank(p);
    }

    function test_MaterializeThank_Replay_AlreadyMaterialized() public {
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(defaultParams());
        vm.expectRevert(AlreadyMaterialized.selector);
        signals.materializeThank(p);
        // the replay check comes first: a corrupted replay is still AlreadyMaterialized
        p.giverAllocation += 1;
        vm.expectRevert(AlreadyMaterialized.selector);
        signals.materializeThank(p);
        assertEq(signals.balanceOf(raiser, ID_THANKED), 1, "minted once");
        assertEq(signals.totalSupply(ID_UP), 2 * SQRT_5E18, "Up minted once");
    }

    function test_MaterializeThank_FromEvents_MatchesStoredHash() public {
        (uint256 h, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        assertEq(settlementHashOf(p), core.facts(h).settlementHash, "events rebuild the commitment");
        assertEq(p.occShakers.length, 4);
        assertEq(p.occShakers[2], address(0), "anonymous zero preserved by position");
        vm.prank(stranger);
        signals.materializeThank(p);
        assertTrue(signals.processedSource(signals.thankSourceKey(h)));
    }

    /*//////////////////// materializeThank: the mutation matrix ////////////////////*/

    function test_Mismatch_Raiser() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.raiser = stranger;
        expectMismatch(p);
    }

    function test_Mismatch_Giver() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.giver = giver2;
        expectMismatch(p);
    }

    function test_Mismatch_Token() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.token = address(t18);
        expectMismatch(p);
    }

    function test_Mismatch_CharityRecipient() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.charityRecipient = stranger;
        expectMismatch(p);
    }

    function test_Mismatch_Pool() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.pool += 1;
        expectMismatch(p);
    }

    function test_Mismatch_CharityAllocation() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.charityAllocation -= 1;
        expectMismatch(p);
    }

    function test_Mismatch_GiverAllocation() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.giverAllocation += 1;
        expectMismatch(p);
    }

    function test_Mismatch_RouteHash() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.routeHash = bytes32(uint256(p.routeHash) ^ 1);
        expectMismatch(p);
    }

    function test_Mismatch_GiveHash() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.giveHash = bytes32(0);
        expectMismatch(p);
    }

    function test_Mismatch_SolutionHash() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.solutionHash = keccak256("another solution");
        expectMismatch(p);
    }

    function test_Mismatch_ClosedAt() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.closedAt += 1;
        expectMismatch(p);
    }

    function test_Mismatch_ShakerSubstituted() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.occShakers[1] = shakerB;
        expectMismatch(p);
    }

    function test_Mismatch_AnonymousZeroAttributed() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.occShakers[2] = stranger; // claiming the anonymous hop
        expectMismatch(p);
    }

    function test_Mismatch_ClaimDelta() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.occClaimDeltas[3] = 999;
        expectMismatch(p);
    }

    function test_Mismatch_Allocation() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        p.occAllocations[0] += 1;
        expectMismatch(p);
    }

    function test_Mismatch_ReorderedOccurrences() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        // a consistent swap of positions 1 (shakerA, 10 %) and 2 (anonymous, 0 %) in all
        // three arrays: the multiset is unchanged, the order is committed
        assertTrue(p.occShakers[1] != p.occShakers[2]);
        (p.occShakers[1], p.occShakers[2]) = (p.occShakers[2], p.occShakers[1]);
        (p.occClaimDeltas[1], p.occClaimDeltas[2]) = (p.occClaimDeltas[2], p.occClaimDeltas[1]);
        (p.occAllocations[1], p.occAllocations[2]) = (p.occAllocations[2], p.occAllocations[1]);
        expectMismatch(p);
    }

    function test_Mismatch_DroppedAnonymousZero() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        address[] memory shakers = new address[](3);
        uint16[] memory deltas = new uint16[](3);
        uint256[] memory allocations = new uint256[](3);
        uint256 j;
        for (uint256 i; i < 4; ++i) {
            if (i == 2) continue;
            shakers[j] = p.occShakers[i];
            deltas[j] = p.occClaimDeltas[i];
            allocations[j] = p.occAllocations[i];
            ++j;
        }
        p.occShakers = shakers;
        p.occClaimDeltas = deltas;
        p.occAllocations = allocations;
        expectMismatch(p);
    }

    function test_Mismatch_AppendedZeroOccurrence() public {
        (, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        address[] memory shakers = new address[](5);
        uint16[] memory deltas = new uint16[](5);
        uint256[] memory allocations = new uint256[](5);
        for (uint256 i; i < 4; ++i) {
            shakers[i] = p.occShakers[i];
            deltas[i] = p.occClaimDeltas[i];
            allocations[i] = p.occAllocations[i];
        }
        p.occShakers = shakers;
        p.occClaimDeltas = deltas;
        p.occAllocations = allocations;
        expectMismatch(p);
    }

    function test_Mismatch_PreimageOfAnotherHand() public {
        (uint256 h1, AHandSettlement.SettlementPreimage memory p1) = settledMixed();
        uint256 h2 = makeRaise();
        settleSimple(h2);
        p1.handId = h2; // h2 is Settled, so the check that fails is the commitment, not the status
        expectMismatch(p1);
        p1.handId = h1;
        signals.materializeThank(p1);
        assertEq(signals.balanceOf(shakerA, ID_SHAKEN), 2, "the honest preimage still works afterwards");
    }

    /*//////////////////// what a Thank mints (D13, Q32) ////////////////////*/

    function test_Thank_FullSet_AndExactEventOrder() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        vm.recordLogs();
        settle(r);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h);
        bytes32 key = signals.thankSourceKey(h);

        // THANKED, GIVEN, SHAKEN, then per role (UP mint, EarnedUpMaterialized), then the summary
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(address(this), address(0), raiser, ID_THANKED, 1);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(address(this), address(0), giver, ID_GIVEN, 1);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(address(this), address(0), vm.addr(E0), ID_SHAKEN, 1);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(address(this), address(0), raiser, ID_UP, SQRT_5E18);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.EarnedUpMaterialized(key, raiser, 1, 5e18, 0, 5e18, SQRT_5E18);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(address(this), address(0), giver, ID_UP, SQRT_5E18);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.EarnedUpMaterialized(key, giver, 2, 5e18, 0, 5e18, SQRT_5E18);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.ThankSignalsMaterialized(key, h, raiser, giver, 10e6, 1, 2 * SQRT_5E18);
        signals.materializeThank(p);

        assertEq(signals.balanceOf(raiser, ID_THANKED), 1);
        assertEq(signals.balanceOf(giver, ID_GIVEN), 1);
        assertEq(signals.balanceOf(vm.addr(E0), ID_SHAKEN), 1);
        assertEq(signals.earnedUp(raiser), SQRT_5E18);
        assertEq(signals.earnedUp(giver), SQRT_5E18);
        assertEq(signals.balanceOf(raiser, ID_UP), SQRT_5E18);
        assertEq(signals.cumulativeValue(raiser), 5e18);
        assertEq(signals.prevSqrt(raiser), SQRT_5E18);
        assertEq(signals.totalSupply(ID_UP), 2 * SQRT_5E18);
        assertEq(signals.receivedOf(raiser), 0, "all of it earned");
        assertTrue(signals.isThankParticipant(raiser));
        assertTrue(signals.isThankParticipant(giver));
        assertTrue(signals.isThankParticipant(vm.addr(E0)));
        assertFalse(signals.isThankParticipant(stranger));
    }

    function test_Thank_Shaken_PerOccurrenceNoDedup_AnonymousMintsNothing() public {
        uint256 h = makeRaise();
        RouteBuild memory r = fourHopRepeatShakerRoute(h);
        vm.recordLogs();
        AHandSettlement.SettlementPreimage memory p = settleAndMaterialize(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(signals.balanceOf(shakerA, ID_SHAKEN), 2, "a shaker on two hops holds two");
        assertEq(signals.balanceOf(vm.addr(E0), ID_SHAKEN), 1, "self-attributed hop");
        assertEq(signals.balanceOf(address(0), ID_SHAKEN), 0, "anonymous zero mints nothing");
        assertEq(signals.totalSupply(ID_SHAKEN), 3, "three attributed occurrences of four");
        assertEq(p.occShakers.length, 4);
        // the summary names the route length, anonymous hop included
        uint256 summaries;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(signals)) continue;
            if (logs[i].topics[0] != AHandSignalsV2.ThankSignalsMaterialized.selector) continue;
            (,,, uint256 occurrences,) = abi.decode(logs[i].data, (address, address, uint256, uint256, uint256));
            assertEq(occurrences, 4, "occurrences = occShakers.length");
            ++summaries;
        }
        assertEq(summaries, 1);
    }

    function test_Thank_GiverWhoAlsoShook_HoldsBothReceipts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, giver, GIVER_PK, 9_000);
        settleAndMaterialize(r);
        assertEq(signals.balanceOf(giver, ID_SHAKEN), 1);
        assertEq(signals.balanceOf(giver, ID_GIVEN), 1);
        assertEq(signals.earnedUp(giver), SQRT_5E18, "the giver role still earns");
    }

    function test_Thank_RaiserIsGiver_BothReceiptsZeroUp() public {
        fund(address(usd), keyedRaiser, 1_000e6);
        uint256 h = makeRaiseAs(keyedRaiser, core, defaultParams(), DEFAULT_REF, noTags());
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r, keyedRaiser, KEYED_RAISER_PK, DEFAULT_SOLUTION, defaultDeadline());
        vm.recordLogs();
        doThankAs(keyedRaiser, r, t);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h);
        assertEq(p.raiser, p.giver);
        assertFalse(signals.earnsUp(p), "D12");

        bytes32 key = signals.thankSourceKey(h);
        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.ThankSignalsMaterialized(key, h, keyedRaiser, keyedRaiser, 10e6, 1, 0);
        signals.materializeThank(p);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(signals.balanceOf(keyedRaiser, ID_THANKED), 1, "THANKED to the one address");
        assertEq(signals.balanceOf(keyedRaiser, ID_GIVEN), 1, "GIVEN to the one address");
        assertEq(signals.earnedUp(keyedRaiser), 0, "zero earned Up");
        assertEq(signals.balanceOf(keyedRaiser, ID_UP), 0);
        assertEq(signals.cumulativeValue(keyedRaiser), 0, "no credit recorded either");
        assertEq(countFrom(logs, address(signals), AHandSignalsV2.EarnedUpMaterialized.selector), 0, "no credit event");
    }

    function test_Thank_ZeroPotHand_ReceiptsNoUp() public {
        (uint256 h, AHandSettlement.SettlementPreimage memory p) = simpleHand(zeroPotParams());
        assertEq(p.pool, 0);
        assertEq(p.token, address(0));
        assertFalse(signals.earnsUp(p));
        assertEq(signals.balanceOf(raiser, ID_THANKED), 1);
        assertEq(signals.balanceOf(giver, ID_GIVEN), 1);
        assertEq(signals.balanceOf(vm.addr(E0), ID_SHAKEN), 1);
        assertEq(signals.totalSupply(ID_UP), 0, "nothing to value");
        signals.materializeRaised(h);
        assertEq(signals.balanceOf(raiser, ID_RAISED), 1);
    }

    function test_Thank_NoDonation_ReceiptsNoUp() public {
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(noCharityParams());
        assertEq(p.charityAllocation, 0);
        assertFalse(signals.earnsUp(p), "C = 0 is never > P / 100");
        assertEq(signals.balanceOf(raiser, ID_THANKED), 1);
        assertEq(signals.totalSupply(ID_UP), 0);
    }

    function test_Thank_ContractActors_NoReceiverHookEver() public {
        RevertingReceiver1155 contractRaiser = new RevertingReceiver1155();
        RevertingReceiver1155 contractGiver = new RevertingReceiver1155();
        fund(address(usd), address(contractRaiser), 1_000e6);
        uint256 h = makeRaiseAs(address(contractRaiser), core, defaultParams(), DEFAULT_REF, noTags());
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        Terminal memory t = buildTerminal(r, address(contractGiver), 0, DEFAULT_SOLUTION, defaultDeadline());
        vm.recordLogs();
        doThankAs(address(contractRaiser), r, t);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h);

        signals.materializeRaised(h);
        signals.materializeThank(p);
        assertEq(signals.balanceOf(address(contractRaiser), ID_RAISED), 1);
        assertEq(signals.balanceOf(address(contractRaiser), ID_THANKED), 1);
        assertEq(signals.balanceOf(address(contractGiver), ID_GIVEN), 1);
        assertEq(signals.balanceOf(address(contractRaiser), ID_UP), SQRT_5E18);
        assertEq(signals.balanceOf(address(contractGiver), ID_UP), SQRT_5E18);
    }

    /*//////////////////// the Up gate (D5, D12, S35, token) ////////////////////*/

    function test_UpGate_ExactlyOnePercent_NoUp() public {
        // P = 10 000, 100 bps → C = 100 == P / 100: not strictly greater
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(paramsWith(10_000, 100));
        assertEq(p.charityAllocation, 100);
        assertFalse(signals.earnsUp(p));
        assertEq(signals.totalSupply(ID_UP), 0, "no Up");
        assertEq(signals.balanceOf(raiser, ID_THANKED), 1, "receipts regardless");
        assertEq(signals.balanceOf(giver, ID_GIVEN), 1);
    }

    function test_UpGate_JustAboveOnePercent_Up() public {
        // P = 10 000, 101 bps → C = 101 > 100
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(paramsWith(10_000, 101));
        assertEq(p.charityAllocation, 101);
        assertTrue(signals.earnsUp(p));
        // credit = 101e12 / 2 = 5.05e13 each → floor(sqrt) = 7 106 335
        assertEq(signals.cumulativeValue(raiser), 505e11);
        assertEq(signals.earnedUp(raiser), 7_106_335);
        assertEq(signals.earnedUp(giver), 7_106_335);
    }

    function test_UpGate_RoundingBoundary_P199() public {
        // P = 199, 150 bps → C = floor(2.985) = 2 > floor(199 / 100) = 1
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(paramsWith(199, 150));
        assertEq(p.charityAllocation, 2);
        assertTrue(signals.earnsUp(p));
        assertEq(signals.cumulativeValue(raiser), 1e12, "2 raw units -> 2e12, half each");
        assertEq(signals.earnedUp(raiser), 1_000_000, "floor(sqrt(1e12))");
    }

    function test_UpGate_DefaultHand_TenPercent_Up() public {
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(defaultParams());
        assertTrue(signals.earnsUp(p));
        assertEq(signals.earnedUp(raiser), SQRT_5E18);
    }

    function test_UpGate_UnqualifiedToken_ReceiptsOnly() public {
        useToken(address(t18));
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(defaultParams());
        assertEq(p.token, address(t18));
        assertEq(p.charityAllocation, 10e6, "10 % of 100e6 raw units: a real donation, just not valued here");
        assertFalse(signals.earnsUp(p));
        assertEq(signals.balanceOf(raiser, ID_THANKED), 1);
        assertEq(signals.balanceOf(giver, ID_GIVEN), 1);
        assertEq(signals.totalSupply(ID_UP), 0);
    }

    function test_UpGate_OtherProfileValuesOtherToken() public {
        // the same settlement earns under a Signals whose profile is t18
        AHandSignalsV2 s18 = new AHandSignalsV2(address(core), address(t18));
        useToken(address(t18));
        RaiseParams memory params = defaultParams();
        params.amount = 100 ether; // 100 T18, 10 % → 10e18 of value → 5e18 each
        uint256 h = makeRaise(params);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        AHandSettlement.SettlementPreimage memory p = settleAndMaterialize(r);
        assertFalse(signals.earnsUp(p), "USDC profile: no");
        assertTrue(s18.earnsUp(p), "T18 profile: yes");
        s18.materializeThank(p);
        assertEq(s18.earnedUp(raiser), SQRT_5E18, "same curve, nominal units of the profile token");
        assertEq(signals.earnedUp(raiser), 0);
    }

    function test_UpGate_CharityIsRaiser_NoUp() public {
        vm.prank(policyAdmin);
        core.setCharityAllowed(raiser, true);
        RaiseParams memory params = defaultParams();
        params.charityRecipient = raiser;
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(params);
        assertEq(p.charityRecipient, raiser);
        assertFalse(signals.earnsUp(p), "a donation that never left the circle");
        assertEq(signals.totalSupply(ID_UP), 0);
        assertEq(signals.balanceOf(raiser, ID_THANKED), 1);
    }

    function test_UpGate_CharityIsGiver_NoUp() public {
        vm.prank(policyAdmin);
        core.setCharityAllowed(giver, true);
        RaiseParams memory params = defaultParams();
        params.charityRecipient = giver;
        (, AHandSettlement.SettlementPreimage memory p) = simpleHand(params);
        assertFalse(signals.earnsUp(p));
        assertEq(signals.totalSupply(ID_UP), 0);
        assertEq(signals.balanceOf(giver, ID_GIVEN), 1);
    }

    function test_UpGate_CharityIsShaker_NoUp() public {
        vm.prank(policyAdmin);
        core.setCharityAllowed(shakerA, true);
        RaiseParams memory params = defaultParams();
        params.charityRecipient = shakerA;
        uint256 h = makeRaise(params);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_000); // the charity sits on hop 1
        AHandSettlement.SettlementPreimage memory p = settleAndMaterialize(r);
        assertFalse(signals.earnsUp(p), "S35: a Raiser-controlled shaker that is also the charity");
        assertEq(signals.totalSupply(ID_UP), 0);
        assertEq(signals.balanceOf(shakerA, ID_SHAKEN), 1, "the receipt is a fact, not a reward");
    }

    function test_UpGate_CharityIsStranger_Up() public {
        // control: the default charity is outside the circle and the same route earns
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_000);
        AHandSettlement.SettlementPreimage memory p = settleAndMaterialize(r);
        assertTrue(signals.earnsUp(p));
        assertEq(signals.earnedUp(raiser), SQRT_5E18);
        assertEq(signals.earnedUp(shakerA), 0, "shakers never earn Up (D9: raiser and giver only)");
    }

    /// @dev `earnsUp` against its specification for arbitrary preimages: every
    ///      conjunct independently, and the §18 #6 identity C > floor(P / 100) ⇔ 100·C > P.
    function testFuzz_EarnsUp_MatchesSpecification(
        uint256 pool,
        uint16 charityBps,
        uint8 roles,
        bool qualifiedToken,
        bool anonymousHop
    ) public view {
        pool = bound(pool, 0, type(uint256).max / 100);
        charityBps = uint16(bound(charityBps, 0, 3_000));
        address[4] memory circle = [raiser, giver, shakerA, charity];
        AHandSettlement.SettlementPreimage memory p;
        p.raiser = circle[roles & 3];
        p.giver = circle[(roles >> 2) & 3];
        p.charityRecipient = circle[(roles >> 4) & 3];
        p.occShakers = new address[](2);
        p.occShakers[0] = circle[(roles >> 6) & 3];
        p.occShakers[1] = anonymousHop ? address(0) : shakerB;
        p.token = qualifiedToken ? address(usd) : address(t18);
        p.pool = pool;
        p.charityAllocation = AHandMath.cut(pool, charityBps);

        bool gate = p.charityAllocation > pool / 100;
        assertEq(gate, 100 * p.charityAllocation > pool, "C > floor(P/100) iff 100*C > P");
        bool outsideCircle = p.charityRecipient != p.raiser && p.charityRecipient != p.giver
            && p.charityRecipient != p.occShakers[0] && p.charityRecipient != p.occShakers[1];
        bool expected = p.raiser != p.giver && gate && qualifiedToken && outsideCircle;
        assertEq(signals.earnsUp(p), expected);
    }

    /*//////////////////// the floor-sqrt curve (D11; v1 vectors) ////////////////////*/

    function test_Curve_OneDollar_707106781PerRole() public {
        // $10 Hand, 10 % → $1 donation → 5e17 credit each → floor(sqrt(5e17))
        (uint256 h,) = zeroHopHand(paramsWith(10e6, 1_000), giver, GIVER_PK);
        assertEq(signals.cumulativeValue(raiser), 5e17);
        assertEq(signals.cumulativeValue(giver), 5e17);
        assertEq(signals.prevSqrt(raiser), SQRT_HALF_DOLLAR);
        assertEq(signals.earnedUp(raiser), SQRT_HALF_DOLLAR);
        assertEq(signals.earnedUp(giver), SQRT_HALF_DOLLAR);
        assertEq(signals.balanceOf(raiser, ID_UP), SQRT_HALF_DOLLAR);
        assertEq(signals.totalSupply(ID_UP), 2 * SQRT_HALF_DOLLAR);
        assertEq(signals.balanceOf(raiser, ID_SHAKEN), 0, "zero-hop route: no SHAKEN anywhere");
        assertEq(signals.totalSupply(ID_SHAKEN), 0);
        signals.materializeRaised(h);
    }

    function test_Curve_OneCent_70710678PerRole() public {
        // $0.10 Hand, 10 % → $0.01 donation → 5e15 credit each
        zeroHopHand(paramsWith(100_000, 1_000), giver, GIVER_PK);
        assertEq(signals.cumulativeValue(raiser), 5e15);
        assertEq(signals.earnedUp(raiser), SQRT_HALF_CENT);
        assertEq(signals.earnedUp(giver), SQRT_HALF_CENT);
    }

    function test_Curve_RepeatCredit_IncrementalDelta() public {
        (uint256 h1,) = zeroHopHand(paramsWith(10e6, 1_000), giver, GIVER_PK);
        assertEq(signals.earnedUp(raiser), SQRT_HALF_DOLLAR, "first delta");
        // the same Hand again: 5e17 → 1e18, floor(sqrt) 1e9, delta 292 893 219
        uint256 h2 = makeRaise(paramsWith(10e6, 1_000));
        RouteBuild memory r = newRoute(h2);
        Terminal memory t = buildTerminal(r, giver2, GIVER2_PK, DEFAULT_SOLUTION, defaultDeadline());
        vm.recordLogs();
        doThank(r, t);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h2);
        bytes32 key2 = signals.thankSourceKey(h2);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.EarnedUpMaterialized(key2, raiser, 1, 5e17, 5e17, 1e18, 292_893_219);
        signals.materializeThank(p);
        assertEq(signals.earnedUp(raiser), SQRT_ONE_DOLLAR, "707106781 + 292893219 == 1e9");
        assertEq(signals.prevSqrt(raiser), SQRT_ONE_DOLLAR, "watermark == floor(sqrt(cumulative))");
        assertEq(signals.cumulativeValue(raiser), 1e18);
        assertTrue(h1 != h2);
    }

    function test_Curve_SubAdditive_SplittingNeverMintsMore() public {
        // two $1 Hands to one raiser mint exactly what one $2 Hand would: floor(sqrt(1e18)) = 1e9 …
        zeroHopHand(paramsWith(10e6, 1_000), giver, GIVER_PK);
        zeroHopHand(paramsWith(10e6, 1_000), giver2, GIVER2_PK);
        assertEq(signals.earnedUp(raiser), SQRT_ONE_DOLLAR);
        // … while the two givers, each credited once, together hold more than the raiser:
        // the curve rewards concentration, not splitting (sqrt(a) + sqrt(b) ≥ sqrt(a + b))
        assertEq(signals.earnedUp(giver) + signals.earnedUp(giver2), 2 * SQRT_HALF_DOLLAR);
        assertGt(2 * SQRT_HALF_DOLLAR, SQRT_ONE_DOLLAR);
    }

    function test_Curve_ZeroDelta_EmitsWithoutMint() public {
        // the raiser lands exactly on the perfect square 6.25e22 (watermark 2.5e11):
        // a $125 000 donation → $62 500 credit; the pool is $1 250 000 at 10 %
        fund(address(usd), raiser, 2_000_000e6);
        zeroHopHand(paramsWith(1_250_000e6, 1_000), giver, GIVER_PK);
        assertEq(signals.cumulativeValue(raiser), 625e20);
        assertEq(signals.prevSqrt(raiser), 250_000_000_000, "perfect-square watermark");
        uint256 earnedBefore = signals.earnedUp(raiser);
        uint256 supplyBefore = signals.totalSupply(ID_UP);

        // a 50-unit Hand at 3 % → C = 1 raw unit (> 50 / 100 = 0) → 1e12 of value → 5e11 each;
        // the next square needs 2 · 2.5e11 + 1 > 5e11, so the raiser's delta is zero
        uint256 h2 = makeRaise(paramsWith(50, 300));
        RouteBuild memory r = newRoute(h2);
        Terminal memory t = buildTerminal(r, giver2, GIVER2_PK, DEFAULT_SOLUTION, defaultDeadline());
        vm.recordLogs();
        doThank(r, t);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h2);
        assertEq(p.charityAllocation, 1);
        assertTrue(signals.earnsUp(p));
        bytes32 key2 = signals.thankSourceKey(h2);

        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.EarnedUpMaterialized(key2, raiser, 1, 5e11, 625e20, 625e20 + 5e11, 0);
        signals.materializeThank(p);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(signals.cumulativeValue(raiser), 625e20 + 5e11, "the value is still recorded");
        assertEq(signals.earnedUp(raiser), earnedBefore, "no Up for the raiser");
        assertEq(signals.earnedUp(giver2), 707_106, "a first credit of 5e11 still mints floor(sqrt(5e11))");
        assertEq(signals.totalSupply(ID_UP), supplyBefore + 707_106, "exactly one UP mint in this call");
        // no TransferSingle of UP to the raiser in this call
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(signals) || logs[i].topics[0] != AHandSignalsV2.TransferSingle.selector) continue;
            if (logs[i].topics[3] != bytes32(uint256(uint160(raiser)))) continue;
            (uint256 id,) = abi.decode(logs[i].data, (uint256, uint256));
            assertTrue(id != ID_UP, "zero delta: no UP TransferSingle to the raiser");
        }
    }

    function test_Curve_OrderIndependence_BigThenSmall() public {
        zeroHopHand(paramsWith(10e6, 1_000), giver, GIVER_PK); // $1 donation
        assertEq(signals.earnedUp(raiser), SQRT_HALF_DOLLAR);
        zeroHopHand(paramsWith(100_000, 1_000), giver2, GIVER2_PK); // $0.01 donation
        assertFinalTwoHandState();
        assertEq(710_633_520 - SQRT_HALF_DOLLAR, 3_526_739, "incremental delta big then small");
    }

    function test_Curve_OrderIndependence_SmallThenBig() public {
        zeroHopHand(paramsWith(100_000, 1_000), giver2, GIVER2_PK);
        assertEq(signals.earnedUp(raiser), SQRT_HALF_CENT);
        zeroHopHand(paramsWith(10e6, 1_000), giver, GIVER_PK);
        assertFinalTwoHandState();
        assertEq(710_633_520 - SQRT_HALF_CENT, 639_922_842, "incremental delta small then big");
    }

    /// @dev cumulative 5.05e17 → floor(sqrt) = 710 633 520; supply = raiser + both givers.
    function assertFinalTwoHandState() internal view {
        assertEq(signals.cumulativeValue(raiser), 505e15);
        assertEq(signals.earnedUp(raiser), 710_633_520);
        assertEq(signals.prevSqrt(raiser), 710_633_520);
        assertEq(signals.balanceOf(raiser, ID_UP), 710_633_520);
        assertEq(signals.earnedUp(giver), SQRT_HALF_DOLLAR);
        assertEq(signals.earnedUp(giver2), SQRT_HALF_CENT);
        assertEq(signals.totalSupply(ID_UP), 710_633_520 + SQRT_HALF_DOLLAR + SQRT_HALF_CENT);
    }

    /// @dev The watermark law for any two pools: Up ever minted == floor(sqrt(cumulative)),
    ///      the credit is exactly half the donation's value, and supply is the sum of
    ///      the three earned balances.
    function testFuzz_Curve_WatermarkIsFloorSqrt(uint256 a1, uint256 a2) public {
        a1 = bound(a1, 10, 1_000_000e6 / 2); // C = a / 10 ≥ 1 and > a / 100 for every a ≥ 10
        a2 = bound(a2, 10, 1_000_000e6 / 2);
        zeroHopHand(paramsWith(a1, 1_000), giver, GIVER_PK);
        zeroHopHand(paramsWith(a2, 1_000), giver2, GIVER2_PK);

        uint256 c1 = AHandMath.cut(a1, 1_000);
        uint256 c2 = AHandMath.cut(a2, 1_000);
        uint256 cumulative = (c1 * 1e12) / 2 + (c2 * 1e12) / 2;
        assertEq(signals.cumulativeValue(raiser), cumulative);
        uint256 x = signals.prevSqrt(raiser);
        assertTrue(x * x <= cumulative && (x + 1) * (x + 1) > cumulative, "floor sqrt");
        assertEq(signals.earnedUp(raiser), x, "earned == watermark while nothing was spent");
        assertEq(signals.balanceOf(raiser, ID_UP), x);
        assertEq(
            signals.totalSupply(ID_UP),
            signals.earnedUp(raiser) + signals.earnedUp(giver) + signals.earnedUp(giver2),
            "supply is the sum of earned balances"
        );
    }

    /*//////////////////// up() ////////////////////*/

    function test_Up_MovesEarnedAsReceived_SupplyConserved() public {
        address actor = earnedActor();
        address target = makeAddr("target");
        uint256 supplyBefore = signals.totalSupply(ID_UP);
        uint256 amount = 2 * signals.ONE_UP();

        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(actor, actor, address(0), ID_UP, amount);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(actor, address(0), target, ID_UP, amount);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.Upped(actor, target, 42, 2, amount, bytes32("why"), keccak256("evidence"));
        vm.prank(actor);
        signals.up(target, 2, UpContext({handId: 42, reasonTag: bytes32("why"), evidenceHash: keccak256("evidence")}));

        assertEq(signals.totalSupply(ID_UP), supplyBefore, "burn + mint conserve supply");
        assertEq(signals.earnedUp(actor), SQRT_5E19 - amount);
        assertEq(signals.balanceOf(actor, ID_UP), SQRT_5E19 - amount);
        assertEq(signals.balanceOf(target, ID_UP), amount);
        assertEq(signals.receivedOf(target), amount, "lands as received");
        assertEq(signals.earnedUp(target), 0, "never as earned");
        assertEq(signals.prevSqrt(actor), SQRT_5E19, "the watermark does not move: spending is not un-earning");
    }

    function test_Up_ReceivedCannotRecurse() public {
        address actor = earnedActor();
        address target = makeAddr("target");
        vm.prank(actor);
        signals.up(target, 3, ctx(1));
        vm.prank(target);
        vm.expectRevert(InsufficientEarned.selector);
        signals.up(actor, 1, ctx(1));
        // a target that is itself an earner spends only its own earned part
        vm.prank(actor);
        signals.up(giver, 1, ctx(1)); // giver earned 7.07 Up in the fixture, now holds 8.07
        assertEq(signals.balanceOf(giver, ID_UP), SQRT_5E19 + 1e9);
        vm.prank(giver);
        vm.expectRevert(InsufficientEarned.selector);
        signals.up(target, 8, ctx(1));
        vm.prank(giver);
        signals.up(target, 7, ctx(1));
        assertEq(signals.earnedUp(giver), SQRT_5E19 - 7e9);
        assertEq(signals.receivedOf(giver), 1e9, "the received Up stays put");
    }

    function test_Up_WholeUnitsOnly_PartialDoesNotRound() public {
        address actor = earnedActor(); // 7.071067811 Up
        vm.prank(actor);
        vm.expectRevert(InsufficientEarned.selector);
        signals.up(giver, 8, ctx(1));
        vm.prank(actor);
        signals.up(giver, 7, ctx(1));
        assertEq(signals.earnedUp(actor), 71_067_811, "the fraction stays");
    }

    function test_Up_GuardOrder_ZeroAmountFirst() public {
        vm.expectRevert(ZeroAmount.selector);
        signals.up(address(0), 0, ctx(0));
    }

    function test_Up_GuardOrder_CheckedMultiplicationBeforeInsufficientEarned() public {
        uint256 count = type(uint256).max / signals.ONE_UP() + 1;
        vm.expectRevert(stdError.arithmeticError);
        signals.up(address(0xBEEF), count, ctx(0));
    }

    function test_Up_GuardOrder_InsufficientEarnedBeforeTargetChecks() public {
        vm.prank(stranger);
        vm.expectRevert(InsufficientEarned.selector);
        signals.up(address(0), 1, ctx(0));
    }

    function test_Up_GuardOrder_ZeroAddress_SelfTarget_ZeroContext() public {
        address actor = earnedActor();
        vm.prank(actor);
        vm.expectRevert(ZeroAddress.selector);
        signals.up(address(0), 1, ctx(0));
        vm.prank(actor);
        vm.expectRevert(SelfTarget.selector);
        signals.up(actor, 1, ctx(0));
        vm.prank(actor);
        vm.expectRevert(ZeroContext.selector);
        signals.up(address(0xBEEF), 1, ctx(0));
        // any single non-zero context field is enough
        vm.prank(actor);
        signals.up(address(0xBEEF), 1, UpContext(0, bytes32("because"), 0));
        vm.prank(actor);
        signals.up(address(0xBEEF), 1, UpContext(0, 0, keccak256("proof")));
        vm.prank(actor);
        signals.up(address(0xBEEF), 1, UpContext(7, 0, 0));
        assertEq(signals.balanceOf(address(0xBEEF), ID_UP), 3e9);
    }

    function test_Up_ToContractWithoutReceiver_NoHook() public {
        address actor = earnedActor();
        RevertingReceiver1155 target = new RevertingReceiver1155();
        vm.prank(actor);
        signals.up(address(target), 1, ctx(1));
        assertEq(signals.balanceOf(address(target), ID_UP), 1e9);
    }

    /*//////////////////// down() (D14, Q6 interim) ////////////////////*/

    function test_Down_ZeroBurn_MintsOneDown() public {
        earnedActor(); // raiser THANKED, giver GIVEN
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(giver, address(0), shakerA, ID_DOWN, 1);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.Downed(giver, shakerA, 0, 0, keccak256("late"), 0);
        vm.prank(giver);
        signals.down(shakerA, 0, UpContext(0, keccak256("late"), 0));
        assertEq(signals.balanceOf(shakerA, ID_DOWN), 1);
        assertEq(signals.totalSupply(ID_DOWN), 1);
        assertEq(signals.earnedUp(giver), SQRT_5E19, "nothing burned");
        assertEq(signals.totalSupply(ID_UP), 2 * SQRT_5E19);
    }

    function test_Down_BurnsEarned_InBaseUnits() public {
        address actor = earnedActor();
        uint256 burn = 1_500_000_000; // 1.5 Up — not a whole number on purpose
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(actor, actor, address(0), ID_UP, burn);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.TransferSingle(actor, address(0), stranger, ID_DOWN, 1);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignalsV2.Downed(actor, stranger, 9, burn, 0, 0);
        vm.prank(actor);
        signals.down(stranger, burn, ctx(9));
        assertEq(signals.earnedUp(actor), SQRT_5E19 - burn);
        assertEq(signals.balanceOf(actor, ID_UP), SQRT_5E19 - burn);
        assertEq(signals.totalSupply(ID_UP), 2 * SQRT_5E19 - burn, "burned Up leaves the supply");
        assertEq(signals.balanceOf(stranger, ID_DOWN), 1);
        assertEq(signals.prevSqrt(actor), SQRT_5E19, "the watermark does not move");
    }

    function test_Down_Repeated_CountsUp() public {
        earnedActor();
        vm.startPrank(giver);
        signals.down(shakerA, 0, ctx(1));
        signals.down(shakerA, 1e9, ctx(1));
        signals.down(shakerA, 0, ctx(2));
        vm.stopPrank();
        assertEq(signals.balanceOf(shakerA, ID_DOWN), 3);
        assertEq(signals.earnedUp(giver), SQRT_5E19 - 1e9);
    }

    function test_Down_MoreThanEarned_InsufficientEarned() public {
        address actor = earnedActor();
        vm.prank(actor);
        vm.expectRevert(InsufficientEarned.selector);
        signals.down(stranger, SQRT_5E19 + 1, ctx(1));
        vm.prank(actor);
        signals.down(stranger, SQRT_5E19, ctx(1)); // everything, exactly
        assertEq(signals.earnedUp(actor), 0);
        assertEq(signals.balanceOf(actor, ID_UP), 0);
    }

    function test_Down_ReceivedUpIsNotBurnable() public {
        address actor = earnedActor();
        address shaker = vm.addr(E0);
        // a SHAKEN holder (participant) with received Up only
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 10_000);
        settleAndMaterialize(r);
        vm.prank(actor);
        signals.up(shaker, 2, ctx(h));
        assertEq(signals.balanceOf(shaker, ID_UP), 2e9);
        assertEq(signals.earnedUp(shaker), 0);
        vm.prank(shaker);
        vm.expectRevert(InsufficientEarned.selector);
        signals.down(stranger, 1, ctx(h));
        vm.prank(shaker);
        signals.down(stranger, 0, ctx(h)); // a zero-burn Down is still open to it
        assertEq(signals.balanceOf(stranger, ID_DOWN), 1);
    }

    function test_Down_NonParticipant_NotParticipant() public {
        earnedActor();
        vm.prank(stranger);
        vm.expectRevert(NotParticipant.selector);
        signals.down(giver, 0, ctx(1));
        // received Up alone does not make a participant
        vm.prank(raiser);
        signals.up(stranger, 1, ctx(1));
        vm.prank(stranger);
        vm.expectRevert(NotParticipant.selector);
        signals.down(giver, 0, ctx(1));
        // a RAISED receipt alone does not either: only Thank receipts count
        uint256 h = makeRaise();
        signals.materializeRaised(h);
        address onlyRaised = makeAddr("onlyRaised");
        fund(address(usd), onlyRaised, DEPOSIT);
        uint256 h2 = makeRaiseAs(onlyRaised, core, defaultParams(), DEFAULT_REF, noTags());
        signals.materializeRaised(h2);
        assertEq(signals.balanceOf(onlyRaised, ID_RAISED), 1);
        assertFalse(signals.isThankParticipant(onlyRaised));
        vm.prank(onlyRaised);
        vm.expectRevert(NotParticipant.selector);
        signals.down(giver, 0, ctx(h2));
    }

    function test_Down_EveryThankRoleIsAParticipant() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        settleAndMaterialize(r);
        vm.prank(raiser);
        signals.down(stranger, 0, ctx(h)); // THANKED
        vm.prank(giver);
        signals.down(stranger, 0, ctx(h)); // GIVEN
        vm.prank(shakerA);
        signals.down(stranger, 0, ctx(h)); // SHAKEN
        assertEq(signals.balanceOf(stranger, ID_DOWN), 3);
    }

    function test_Down_GuardOrder_TargetAndContextBeforeEligibility() public {
        // a non-participant with a bad target still hears about the target first
        vm.prank(stranger);
        vm.expectRevert(ZeroAddress.selector);
        signals.down(address(0), 0, ctx(1));
        vm.prank(stranger);
        vm.expectRevert(SelfTarget.selector);
        signals.down(stranger, 0, ctx(1));
        vm.prank(stranger);
        vm.expectRevert(ZeroContext.selector);
        signals.down(giver, 0, ctx(0));
        vm.prank(stranger);
        vm.expectRevert(NotParticipant.selector);
        signals.down(giver, type(uint256).max, ctx(1)); // eligibility before the amount
    }

    function test_Down_ToContractWithoutReceiver_NoHook() public {
        earnedActor();
        RevertingReceiver1155 target = new RevertingReceiver1155();
        vm.prank(giver);
        signals.down(address(target), 1e9, ctx(1));
        assertEq(signals.balanceOf(address(target), ID_DOWN), 1);
    }

    /*//////////////////// levels (D39 display surface) ////////////////////*/

    function test_LevelOf_RingsAtOneFiveTwentyFiveHundred() public {
        // a $200 000 Hand at 30 % → $60 000 donation → 3e22 credit each → ≈ 173 Up
        zeroHopHand(paramsWith(200_000e6, 3_000), giver, GIVER_PK);
        uint256 earned = signals.earnedUp(raiser);
        assertGe(earned / 1e9, 130);
        assertEq(signals.levelOf(raiser), 4);
        assertEq(signals.levelOf(stranger), 0);

        address target = makeAddr("target");
        vm.startPrank(raiser);
        signals.up(target, 1, ctx(1));
        assertEq(signals.levelOf(target), 1, "1 Up");
        signals.up(target, 3, ctx(1));
        assertEq(signals.levelOf(target), 1, "4 Up");
        signals.up(target, 1, ctx(1));
        assertEq(signals.levelOf(target), 2, "5 Up");
        signals.up(target, 19, ctx(1));
        assertEq(signals.levelOf(target), 2, "24 Up");
        signals.up(target, 1, ctx(1));
        assertEq(signals.levelOf(target), 3, "25 Up");
        signals.up(target, 74, ctx(1));
        assertEq(signals.levelOf(target), 3, "99 Up");
        signals.up(target, 1, ctx(1));
        assertEq(signals.levelOf(target), 4, "100 Up, received counts");
        vm.stopPrank();
        assertEq(signals.earnedUp(raiser), earned - 100e9);
        assertEq(signals.levelOf(raiser), 3, "about 73 Up left");
    }

    function test_LevelOf_BelowOneUpIsZero() public {
        zeroHopHand(paramsWith(10e6, 1_000), giver, GIVER_PK); // 0.707 Up
        assertEq(signals.levelOf(raiser), 0);
        simpleHand(defaultParams()); // + $5 credit: cumulative 5.5e18 → 2.345 Up
        assertEq(signals.levelOf(raiser), 1);
    }

    /*//////////////////// ERC-1155 surface (D15, D42) ////////////////////*/

    function test_ERC165_ClaimsERC1155AndMetadata() public view {
        assertTrue(signals.supportsInterface(0x01ffc9a7), "ERC-165");
        assertTrue(signals.supportsInterface(0xd9b67a26), "ERC-1155");
        assertTrue(signals.supportsInterface(0x0e89341c), "ERC-1155 metadata URI");
        assertFalse(signals.supportsInterface(0xffffffff), "ERC-165 sentinel");
        assertFalse(signals.supportsInterface(0x4e2312e0), "not a receiver");
        assertFalse(signals.supportsInterface(0x80ac58cd), "not ERC-721");
    }

    function test_BalanceOfBatch_PositionalAndLengthMismatch() public {
        earnedActor();
        address[] memory accounts = new address[](3);
        uint256[] memory ids = new uint256[](3);
        accounts[0] = raiser;
        ids[0] = ID_THANKED;
        accounts[1] = giver;
        ids[1] = ID_UP;
        accounts[2] = raiser;
        ids[2] = ID_GIVEN;
        uint256[] memory balances = signals.balanceOfBatch(accounts, ids);
        assertEq(balances.length, 3);
        assertEq(balances[0], 1);
        assertEq(balances[1], SQRT_5E19);
        assertEq(balances[2], 0);

        uint256[] memory shortIds = new uint256[](2);
        vm.expectRevert(LengthMismatch.selector);
        signals.balanceOfBatch(accounts, shortIds);
        assertEq(signals.balanceOfBatch(new address[](0), new uint256[](0)).length, 0);
    }

    function test_Soulbound_TransfersAndApprovalsRevert() public {
        earnedActor();
        vm.startPrank(raiser);
        vm.expectRevert(Soulbound.selector);
        signals.safeTransferFrom(raiser, giver, ID_UP, 1, "");
        vm.expectRevert(Soulbound.selector);
        signals.safeTransferFrom(raiser, giver, ID_THANKED, 1, "");
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = ID_UP;
        amounts[0] = 1;
        vm.expectRevert(Soulbound.selector);
        signals.safeBatchTransferFrom(raiser, giver, ids, amounts, "");
        vm.expectRevert(Soulbound.selector);
        signals.setApprovalForAll(giver, true);
        vm.expectRevert(Soulbound.selector);
        signals.setApprovalForAll(giver, false);
        vm.stopPrank();
        assertFalse(signals.isApprovedForAll(raiser, giver), "the query answers false, never reverts");
        assertFalse(signals.isApprovedForAll(raiser, raiser));
        assertEq(signals.balanceOf(raiser, ID_UP), SQRT_5E19, "nothing moved");
    }

    function test_NoFallbackNoReceive() public {
        (bool ok,) = address(signals).call("");
        assertFalse(ok, "no fallback");
        (ok,) = address(signals).call{value: 0}(hex"deadbeef");
        assertFalse(ok, "unknown selector reverts");
        vm.deal(address(this), 1 ether);
        (ok,) = address(signals).call{value: 1}("");
        assertFalse(ok, "no receive");
    }

    /*//////////////////// uri() (D39 ⇄ D15) ////////////////////*/

    function test_Uri_RendersRolesAndLevels() public view {
        assertRoleUri(ID_RAISED, unicode"✋", "Raised", "raised a Hand");
        assertRoleUri(ID_SHAKEN, unicode"🤝", "Shaken", "passed a Hand along a settled route");
        assertRoleUri(ID_GIVEN, unicode"🙌", "Given", "gave the solution of a settled Hand");
        assertRoleUri(ID_THANKED, unicode"🙏", "Thanked", "thanked a settled Hand");
        assertRoleUri(ID_UP, unicode"👍", "Up", "level rings at 1, 5, 25 and 100 Up");
        assertRoleUri(ID_DOWN, unicode"👎", "Down", "a Down received");
    }

    function test_Uri_UnknownIdIsEmpty() public view {
        assertEq(bytes(signals.uri(0)).length, 0);
        assertEq(bytes(signals.uri(7)).length, 0);
        assertEq(bytes(signals.uri(type(uint256).max)).length, 0);
    }

    function test_Uri_IsPureOfAccountState() public {
        string memory before = signals.uri(ID_UP);
        earnedActor();
        assertEq(signals.uri(ID_UP), before, "no raw Up number can leak: the URI has no account input");
    }

    /// @dev Decode the data URI, parse the JSON, and pin name, meaning and an on-chain SVG
    ///      that draws the glyph and the title.
    function assertRoleUri(uint256 id, string memory glyph, string memory title, string memory meaningFragment)
        internal
        view
    {
        string memory u = signals.uri(id);
        bytes memory prefix = bytes("data:application/json;base64,");
        assertTrue(startsWith(bytes(u), prefix), "data URI prefix");
        string memory json = string(base64Decode(sliceFrom(bytes(u), prefix.length)));
        assertEq(vm.parseJsonString(json, ".name"), string.concat(glyph, " ", title));
        assertTrue(contains(bytes(vm.parseJsonString(json, ".description")), bytes(meaningFragment)), "meaning");
        bytes memory image = bytes(vm.parseJsonString(json, ".image"));
        bytes memory svgPrefix = bytes("data:image/svg+xml;base64,");
        assertTrue(startsWith(image, svgPrefix), "svg data URI");
        bytes memory svg = base64Decode(sliceFrom(image, svgPrefix.length));
        assertTrue(startsWith(svg, bytes("<svg")), "an SVG");
        assertTrue(contains(svg, bytes(glyph)), "glyph drawn");
        assertTrue(contains(svg, bytes(title)), "title drawn");
    }

    function startsWith(bytes memory data, bytes memory prefix) internal pure returns (bool) {
        if (data.length < prefix.length) return false;
        for (uint256 i; i < prefix.length; ++i) {
            if (data[i] != prefix[i]) return false;
        }
        return true;
    }

    function contains(bytes memory hay, bytes memory needle) internal pure returns (bool) {
        if (needle.length > hay.length) return false;
        for (uint256 i; i + needle.length <= hay.length; ++i) {
            bool hit = true;
            for (uint256 j; j < needle.length; ++j) {
                if (hay[i + j] != needle[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }

    function sliceFrom(bytes memory data, uint256 start) internal pure returns (bytes memory out) {
        out = new bytes(data.length - start);
        for (uint256 i; i < out.length; ++i) {
            out[i] = data[start + i];
        }
    }

    /// @dev Standard base64 (RFC 4648 with '=' padding), the inverse of OZ `Base64.encode`.
    function base64Decode(bytes memory data) internal pure returns (bytes memory out) {
        uint256 len = data.length;
        if (len == 0) return out;
        require(len % 4 == 0, "base64 length");
        uint256 pad;
        if (data[len - 1] == "=") ++pad;
        if (data[len - 2] == "=") ++pad;
        out = new bytes((len / 4) * 3 - pad);
        uint256 o;
        for (uint256 i; i < len; i += 4) {
            uint256 v = (base64Value(data[i]) << 18) | (base64Value(data[i + 1]) << 12) | (base64Value(data[i + 2]) << 6)
                | base64Value(data[i + 3]);
            if (o < out.length) out[o++] = bytes1(uint8(v >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(v >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(v));
        }
    }

    function base64Value(bytes1 c) internal pure returns (uint256) {
        uint8 u = uint8(c);
        if (u >= 0x41 && u <= 0x5A) return u - 0x41; // A–Z
        if (u >= 0x61 && u <= 0x7A) return u - 0x61 + 26; // a–z
        if (u >= 0x30 && u <= 0x39) return u - 0x30 + 52; // 0–9
        if (c == "+") return 62;
        if (c == "/") return 63;
        return 0; // '=' padding
    }

    /*//////////////////// cross-Core isolation ////////////////////*/

    function test_WrongCore_SameIdOtherCore_RejectedAndFlagsIndependent() public {
        AHandCore core2 = deployCore(charity, policyAdmin);
        AHandSignalsV2 signals2 = new AHandSignalsV2(address(core2), address(usd));
        fundFor(core2, address(usd), raiser, 1_000e6);

        // hand 1 on both Cores, settled to different givers
        uint256 h1 = makeRaise();
        RouteBuild memory r1 = newRoute(h1);
        addSelfHop(r1, E1, 10_000);
        vm.recordLogs();
        settle(r1);
        AHandSettlement.SettlementPreimage memory p1 = preimageFromLogsOn(core, vm.getRecordedLogs(), h1);

        uint256 h2 = makeRaiseAs(raiser, core2, defaultParams(), DEFAULT_REF, noTags());
        assertEq(h1, h2, "same id on both Cores");
        RouteBuild memory r2 = newRouteOn(core2, h2, E0);
        addSelfHop(r2, E1, 10_000);
        Terminal memory t2 = buildTerminal(r2, giver2, GIVER2_PK, DEFAULT_SOLUTION, defaultDeadline());
        vm.recordLogs();
        doThank(r2, t2);
        AHandSettlement.SettlementPreimage memory p2 = preimageFromLogsOn(core2, vm.getRecordedLogs(), h2);

        // core2's facts fed to the Core-1 ledger: the commitment binds the Core address
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(p2);
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals2.materializeThank(p1);

        signals2.materializeThank(p2);
        assertTrue(signals2.processedSource(signals2.thankSourceKey(h2)));
        assertFalse(signals.processedSource(signals.thankSourceKey(h1)), "flags never bleed over");
        signals.materializeThank(p1);
        assertEq(signals.balanceOf(giver, ID_GIVEN), 1);
        assertEq(signals2.balanceOf(giver2, ID_GIVEN), 1);
        assertEq(signals.balanceOf(giver2, ID_GIVEN), 0, "no cross-mint");
    }

    function test_WrongCore_HandMissingOnSourceCore() public {
        AHandCore core2 = deployCore(charity, policyAdmin);
        fundFor(core2, address(usd), raiser, 1_000e6);
        uint256 h = makeRaiseAs(raiser, core2, defaultParams(), DEFAULT_REF, noTags());
        vm.expectRevert(NotRaised.selector);
        signals.materializeRaised(h);
        RouteBuild memory r = newRouteOn(core2, h, E0);
        addSelfHop(r, E1, 10_000);
        vm.recordLogs();
        settle(r);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core2, vm.getRecordedLogs(), h);
        vm.expectRevert(NotSettled.selector);
        signals.materializeThank(p);
    }

    /*//////////////////// I-26: Core never depends on Signals ////////////////////*/

    function test_I26_SettledBeforeSignalsExisted_MaterializesLater() public {
        // a Hand settled when no ledger was deployed yet: Core needed none, and a
        // ledger deployed afterwards reads the same immutable facts
        (uint256 h, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        vm.warp(block.timestamp + 365 days);
        AHandSignalsV2 late = new AHandSignalsV2(address(core), address(usd));
        late.materializeRaised(h);
        late.materializeThank(p);
        assertEq(late.balanceOf(shakerA, ID_SHAKEN), 2);
        assertEq(late.earnedUp(raiser), SQRT_5E18, "closedAt before deployment still earns under this profile");
    }

    function test_I26_RevertingMaterializationLeavesCoreUntouched() public {
        (uint256 h, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        bytes32 factsBefore = factsDigest(h);
        uint256 custodyBefore = usd.balanceOf(address(core));
        uint256 giverBefore = usd.balanceOf(giver);

        p.giverAllocation += 1;
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(p);
        AHandSettlement.SettlementPreimage memory q;
        q.handId = h;
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(q);

        assertEq(factsDigest(h), factsBefore, "facts identical");
        assertEq(usd.balanceOf(address(core)), custodyBefore, "custody identical");
        assertEq(usd.balanceOf(giver), giverBefore);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertFalse(signals.processedSource(signals.thankSourceKey(h)), "and nothing was flagged either");
    }

    function test_I26_SuccessfulMaterializationWritesNothingToCore() public {
        (uint256 h, AHandSettlement.SettlementPreimage memory p) = settledMixed();
        bytes32 factsBefore = factsDigest(h);
        uint256 custodyBefore = usd.balanceOf(address(core));
        signals.materializeThank(p);
        signals.materializeRaised(h);
        assertEq(factsDigest(h), factsBefore);
        assertEq(usd.balanceOf(address(core)), custodyBefore);
        // Core stays fully usable: a new Hand raises, settles and reclaims as before
        uint256 h2 = makeRaise();
        settleSimple(h2);
        uint256 h3 = makeRaise();
        warpToExpiry(h3);
        core.reclaim(h3);
        assertEq(uint8(statusOf(h3)), uint8(Status.Reclaimed));
    }

    /// Signals' runtime calls out through STATICCALL alone — the Core's `facts`, once per
    /// materializer — and holds no CALL, DELEGATECALL, CALLCODE, CREATE, CREATE2 or
    /// SELFDESTRUCT: nothing in the periphery can move a token or reach Core's mutators.
    /// (`decimals()` is read in the constructor, which is not in the runtime.)
    function test_I26_RuntimeOpcodes_StaticcallOnly() public view {
        bytes memory code = address(signals).code;
        assertEq(opcodeCount(code, 0xf1), 0, "CALL");
        assertEq(opcodeCount(code, 0xf4), 0, "DELEGATECALL");
        assertEq(opcodeCount(code, 0xf2), 0, "CALLCODE");
        assertEq(opcodeCount(code, 0xf0), 0, "CREATE");
        assertEq(opcodeCount(code, 0xf5), 0, "CREATE2");
        assertEq(opcodeCount(code, 0xff), 0, "SELFDESTRUCT");
        assertEq(opcodeCount(code, 0xfa), 2, "STATICCALL: facts() in materializeRaised and materializeThank");
    }

    function test_I26_UnbuildableSignalsDoesNotBlockSettlement() public {
        // a profile that cannot be deployed over this token changes nothing for the Hand
        NoDecimalsToken nd = new NoDecimalsToken();
        useToken(address(nd));
        fund(address(nd), raiser, 1_000e6);
        vm.expectRevert();
        new AHandSignalsV2(address(core), address(nd));
        uint256 h = makeRaise();
        settleSimple(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        // and the USDC ledger still mints its receipts for the unvalued Hand
        uint256 h2 = makeRaise();
        RouteBuild memory r = newRoute(h2);
        addSelfHop(r, E1, 10_000);
        AHandSettlement.SettlementPreimage memory p = settleAndMaterialize(r);
        assertFalse(signals.earnsUp(p));
        assertEq(signals.balanceOf(raiser, ID_THANKED), 1);
    }
}
