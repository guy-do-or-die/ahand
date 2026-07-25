// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
    Signals materialization suite — SELF-CONTAINED by design.
    Does not import AHandTestBase (parallel stream); carries its
    own minimal fixture: MockUSD + Core + Signals + route helper.
//////////////////////////////////////////////////////////////*/

import {Test, Vm, stdError} from "forge-std/Test.sol";
import "../src/AHandTypes.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {MockUSD} from "./mocks/MockUSD.sol";

/// @dev Contract actor that loudly rejects ERC-1155 hook calls — proves Signals
///      mints are hook-free — and accepts any ERC-1271 signature so it can act
///      as a giver (empty acceptance bytes route through the 1271 path).
contract RevertingReceiver1155 {
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

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

contract SignalsMaterializeTest is Test {
    /*//////////////////// Fixture ////////////////////*/
    MockUSD internal usd;
    AHandCore internal core;
    AHandSignals internal signals;

    address internal charity;
    address internal admin;

    // Actor keys — capabilities and signers driven through vm.sign + AHandSig.
    uint256 internal constant RAISER_PK = 0xA11;
    uint256 internal constant GIVER_PK = 0xB22;
    uint256 internal constant GIVER2_PK = 0xB33;
    uint256 internal constant ROOT_PK = 0xC44;
    uint256 internal constant CAP1_PK = 0xC55;
    uint256 internal constant CAP2_PK = 0xC66;
    uint256 internal constant CAP3_PK = 0xC77;
    uint256 internal constant CAP4_PK = 0xC88;
    uint256 internal constant SHAKER_PK = 0xD88;
    uint256 internal constant SHAKER2_PK = 0xD99;

    address internal RAISER;
    address internal GIVER;
    address internal GIVER2;
    address internal SHAKER;
    address internal SHAKER2;

    // Signal ids
    uint256 internal constant ID_RAISED = 1;
    uint256 internal constant ID_SHAKEN = 2;
    uint256 internal constant ID_GIVEN = 3;
    uint256 internal constant ID_THANKED = 4;
    uint256 internal constant ID_UP = 5;

    // Canonical sqrt expectations (test-notes table)
    uint256 internal constant SQRT_HALF_DOLLAR = 707106781; // floor(sqrt(5e17))
    uint256 internal constant SQRT_HALF_CENT = 70710678; // floor(sqrt(5e15))
    uint256 internal constant SQRT_ONE_DOLLAR = 1000000000; // floor(sqrt(1e18)) — merged roles

    bytes32 internal constant TRANSFER_SINGLE_SIG =
        keccak256("TransferSingle(address,address,address,uint256,uint256)");
    bytes32 internal constant EARNED_UP_SIG =
        keccak256("EarnedUpMaterialized(bytes32,address,uint8,uint256,uint256,uint256,uint256)");
    bytes32 internal constant THANK_MATERIALIZED_SIG =
        keccak256("ThankSignalsMaterialized(bytes32,uint256,address,address,uint96,uint256,uint256)");

    function setUp() public {
        charity = makeAddr("charity");
        admin = makeAddr("admin");
        RAISER = vm.addr(RAISER_PK);
        GIVER = vm.addr(GIVER_PK);
        GIVER2 = vm.addr(GIVER2_PK);
        SHAKER = vm.addr(SHAKER_PK);
        SHAKER2 = vm.addr(SHAKER2_PK);

        usd = new MockUSD();
        core = _deployCore();
        signals = new AHandSignals(address(core));
    }

    function _deployCore() internal returns (AHandCore) {
        address[] memory charities = new address[](1);
        charities[0] = charity;
        return new AHandCore(address(usd), 1e12, charities, admin);
    }

    /*//////////////////// Route helper ////////////////////*/
    struct Hop {
        uint256 capPk; // child capability key (signs the NEXT artifact)
        address shaker; // zero = anonymous
        uint256 shakerPk; // nonzero => explicit acceptance signed with this key
        uint16 childClaimBps;
    }

    function _sign(AHandCore c, uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, AHandSig.digest(c.DOMAIN_SEPARATOR(), structHash));
        return abi.encodePacked(r, s, v);
    }

    function _raiseOn(AHandCore c, address raiser, uint96 amount, uint16 charityBps) internal returns (uint256) {
        usd.mint(raiser, amount);
        vm.prank(raiser);
        usd.approve(address(c), amount);
        RaiseParams memory p = RaiseParams({
            token: address(usd),
            amount: amount,
            expiry: uint40(block.timestamp + 30 days),
            charityRecipient: charity,
            charityBps: charityBps,
            minGiverClaimBps: 1,
            rootCapability: vm.addr(ROOT_PK),
            visibility: Visibility.Dark,
            metadataCommitment: bytes32(uint256(1)),
            discoveryCommitment: bytes32(0)
        });
        vm.prank(raiser);
        return c.raise(p, "", new bytes32[](0));
    }

    /// @dev Settles `handId` on core `c` over a configurable route. Shake i is
    ///      signed by the parent capability key, the Give by the terminal one,
    ///      acceptances per the consent matrix. giverPk == 0 sends empty
    ///      acceptance bytes (contract givers ride the ERC-1271 path).
    function _thankOn(AHandCore c, uint256 handId, Hop[] memory hops, address giver, uint256 giverPk) internal {
        uint256 n = hops.length;
        Shake[] memory shakes = new Shake[](n);
        bytes[] memory shakeSigs = new bytes[](n);
        bytes[] memory acceptances = new bytes[](n);
        bytes32[] memory shakeHashes = new bytes32[](n);
        uint16 parentClaim = 10_000;
        uint256 parentPk = ROOT_PK;
        uint40 deadline = uint40(block.timestamp + 1 days);

        for (uint256 i; i < n; ++i) {
            shakes[i] = Shake({
                handId: handId,
                childCapability: vm.addr(hops[i].capPk),
                shaker: hops[i].shaker,
                parentClaimBps: parentClaim,
                childClaimBps: hops[i].childClaimBps,
                hopDataHash: bytes32(0),
                deadline: deadline
            });
            bytes32 shakeHash = AHandSig.hashShake(shakes[i]);
            shakeHashes[i] = shakeHash;
            shakeSigs[i] = _sign(c, parentPk, shakeHash);
            if (hops[i].shakerPk != 0) {
                acceptances[i] = _sign(c, hops[i].shakerPk, AHandSig.hashShakerAcceptance(shakeHash));
            }
            parentClaim = hops[i].childClaimBps;
            parentPk = hops[i].capPk;
        }

        bytes32 routeHash = AHandSig.hashRoute(AHandSig.handRef(address(c), handId), shakeHashes);
        Give memory g = Give({
            handId: handId,
            routeHash: routeHash,
            giver: giver,
            solutionHash: keccak256("solution"),
            finalClaimBps: parentClaim,
            deadline: deadline
        });
        bytes32 giveHash = AHandSig.hashGive(g);
        bytes memory giveSig = _sign(c, parentPk, giveHash);
        bytes memory giverAcc =
            giverPk != 0 ? _sign(c, giverPk, AHandSig.hashGiverAcceptance(giveHash)) : bytes("");

        address raiser = c.getHand(handId).raiser;
        vm.prank(raiser);
        c.thank(handId, shakes, shakeSigs, acceptances, g, giveSig, giverAcc);
    }

    /// @dev Zero-shake settled hand: raiser -> root capability gives directly.
    function _settledHand(address raiser, uint96 amount, uint16 charityBps, address giver, uint256 giverPk)
        internal
        returns (uint256 handId)
    {
        handId = _raiseOn(core, raiser, amount, charityBps);
        _thankOn(core, handId, new Hop[](0), giver, giverPk);
    }

    /// @dev $10 hand, $1 charity, 4-hop route [S1, anon, S1, S2]: repeat shaker,
    ///      anonymous zero preserved, two distinct attributed shakers.
    function _settleDedupHand() internal returns (uint256 handId, address[] memory occ, uint16[] memory deltas) {
        handId = _raiseOn(core, RAISER, 10_000_000, 1000);
        Hop[] memory hops = new Hop[](4);
        hops[0] = Hop(CAP1_PK, SHAKER, SHAKER_PK, 9000);
        hops[1] = Hop(CAP2_PK, address(0), 0, 9000);
        hops[2] = Hop(CAP3_PK, SHAKER, SHAKER_PK, 8000);
        hops[3] = Hop(CAP4_PK, SHAKER2, SHAKER2_PK, 7000);
        _thankOn(core, handId, hops, GIVER, GIVER_PK);

        occ = new address[](4);
        occ[0] = SHAKER;
        occ[1] = address(0);
        occ[2] = SHAKER;
        occ[3] = SHAKER2;
        deltas = new uint16[](4);
        deltas[0] = 1000;
        deltas[1] = 0;
        deltas[2] = 1000;
        deltas[3] = 1000;
    }

    function _emptyOcc() internal pure returns (address[] memory, uint16[] memory) {
        return (new address[](0), new uint16[](0));
    }

    /*//////////////////// Log helpers ////////////////////*/
    /// @dev Both counters filter on emitter == signals: recordLogs also captures
    ///      the pattern events the test contract itself emits for expectEmit.
    function _countTopic0(Vm.Log[] memory logs, bytes32 sig) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(signals) && logs[i].topics[0] == sig) ++n;
        }
    }

    function _countUpMintsTo(Vm.Log[] memory logs, address to, uint256 id) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(signals) && logs[i].topics[0] == TRANSFER_SINGLE_SIG
                    && logs[i].topics[2] == bytes32(0) && logs[i].topics[3] == bytes32(uint256(uint160(to)))
            ) {
                (uint256 logId,) = abi.decode(logs[i].data, (uint256, uint256));
                if (logId == id) ++n;
            }
        }
    }

    /*//////////////////////////////////////////////////////////
                Source keys — derivation and independence
    //////////////////////////////////////////////////////////*/

    function test_KeyViews_MatchCanonicalDerivation() public view {
        assertEq(signals.RAISED_SOURCE(), keccak256("aHand.signals.source.raised.v1"), "RAISED_SOURCE literal");
        assertEq(signals.THANK_SOURCE(), keccak256("aHand.signals.source.thank.v1"), "THANK_SOURCE literal");

        uint256 handId = 42;
        bytes32 expectedRaised =
            keccak256(abi.encode(signals.RAISED_SOURCE(), block.chainid, address(core), handId));
        bytes32 expectedThank =
            keccak256(abi.encode(signals.THANK_SOURCE(), block.chainid, address(core), handId));
        assertEq(signals.raisedSourceKey(handId), expectedRaised, "raisedSourceKey");
        assertEq(signals.thankSourceKey(handId), expectedThank, "thankSourceKey");
        assertTrue(expectedRaised != expectedThank, "domains separate the keys");
    }

    function test_KeyIndependence_ThankWithoutRaised() public {
        uint256 handId = _settledHand(RAISER, 10_000_000, 1000, GIVER, GIVER_PK);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();

        // Thank materializes with the raised key untouched.
        signals.materializeThank(handId, GIVER, occ, deltas);
        assertTrue(signals.processedSource(signals.thankSourceKey(handId)), "thank key processed");
        assertFalse(signals.processedSource(signals.raisedSourceKey(handId)), "raised key untouched");
        assertEq(signals.balanceOf(RAISER, ID_RAISED), 0, "no RAISED yet");
        assertEq(signals.balanceOf(RAISER, ID_THANKED), 1, "THANKED minted");

        // And raised still materializes afterwards.
        signals.materializeRaised(handId);
        assertEq(signals.balanceOf(RAISER, ID_RAISED), 1, "RAISED minted after");
    }

    function test_KeyIndependence_RaisedWithoutThank() public {
        uint256 handId = _raiseOn(core, RAISER, 10_000_000, 1000);

        signals.materializeRaised(handId);
        assertTrue(signals.processedSource(signals.raisedSourceKey(handId)), "raised key processed");
        assertFalse(signals.processedSource(signals.thankSourceKey(handId)), "thank key untouched");

        _thankOn(core, handId, new Hop[](0), GIVER, GIVER_PK);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        signals.materializeThank(handId, GIVER, occ, deltas);
        assertEq(signals.balanceOf(RAISER, ID_THANKED), 1, "THANKED minted after raised");
    }

    /*//////////////////////////////////////////////////////////
                        Idempotence (double-call)
    //////////////////////////////////////////////////////////*/

    function test_MaterializeRaised_Twice_AlreadyMaterialized() public {
        uint256 handId = _raiseOn(core, RAISER, 10_000_000, 1000);
        signals.materializeRaised(handId);
        vm.expectRevert(AlreadyMaterialized.selector);
        signals.materializeRaised(handId);
    }

    function test_MaterializeThank_Twice_AlreadyMaterialized() public {
        uint256 handId = _settledHand(RAISER, 10_000_000, 1000, GIVER, GIVER_PK);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        signals.materializeThank(handId, GIVER, occ, deltas);
        vm.expectRevert(AlreadyMaterialized.selector);
        signals.materializeThank(handId, GIVER, occ, deltas);
    }

    /*//////////////////////////////////////////////////////////
                    materializeRaised status coverage
    //////////////////////////////////////////////////////////*/

    function test_MaterializeRaised_StatusNone_WrongHand() public {
        vm.expectRevert(WrongHand.selector);
        signals.materializeRaised(777); // never raised
    }

    function test_MaterializeRaised_Active() public {
        uint256 handId = _raiseOn(core, RAISER, 10_000_000, 1000);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.TransferSingle(address(this), address(0), RAISER, ID_RAISED, 1);
        signals.materializeRaised(handId);
        assertEq(signals.balanceOf(RAISER, ID_RAISED), 1);
        assertEq(signals.totalSupply(ID_RAISED), 1);
    }

    function test_MaterializeRaised_Settled() public {
        uint256 handId = _settledHand(RAISER, 10_000_000, 1000, GIVER, GIVER_PK);
        signals.materializeRaised(handId);
        assertEq(signals.balanceOf(RAISER, ID_RAISED), 1);
    }

    function test_MaterializeRaised_Reclaimed() public {
        uint256 handId = _raiseOn(core, RAISER, 10_000_000, 1000);
        vm.warp(block.timestamp + 31 days);
        core.reclaim(handId);
        signals.materializeRaised(handId);
        assertEq(signals.balanceOf(RAISER, ID_RAISED), 1, "raise happened regardless of outcome");
    }

    /*//////////////////////////////////////////////////////////
                    materializeThank guards
    //////////////////////////////////////////////////////////*/

    function test_MaterializeThank_ActiveHand_NotSettled() public {
        uint256 handId = _raiseOn(core, RAISER, 10_000_000, 1000);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        vm.expectRevert(NotSettled.selector);
        signals.materializeThank(handId, GIVER, occ, deltas);
    }

    function test_MaterializeThank_Reclaimed_NotSettled() public {
        uint256 handId = _raiseOn(core, RAISER, 10_000_000, 1000);
        vm.warp(block.timestamp + 31 days);
        core.reclaim(handId);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        vm.expectRevert(NotSettled.selector);
        signals.materializeThank(handId, GIVER, occ, deltas);
    }

    function test_MaterializeThank_WrongGiver_SourceCommitmentMismatch() public {
        (uint256 handId, address[] memory occ, uint16[] memory deltas) = _settleDedupHand();
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(handId, GIVER2, occ, deltas); // settled with GIVER
    }

    function test_MaterializeThank_WrongShakerList_SourceCommitmentMismatch() public {
        (uint256 handId, address[] memory occ, uint16[] memory deltas) = _settleDedupHand();
        occ[0] = SHAKER2; // was SHAKER
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(handId, GIVER, occ, deltas);
    }

    function test_MaterializeThank_WrongDeltas_SourceCommitmentMismatch() public {
        (uint256 handId, address[] memory occ, uint16[] memory deltas) = _settleDedupHand();
        deltas[3] = 999; // was 1000
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(handId, GIVER, occ, deltas);
    }

    function test_MaterializeThank_ReorderedOccurrences_SourceCommitmentMismatch() public {
        (uint256 handId, address[] memory occ, uint16[] memory deltas) = _settleDedupHand();
        // Consistent swap of positions 0 and 1 in BOTH arrays — order is committed.
        (occ[0], occ[1]) = (occ[1], occ[0]);
        (deltas[0], deltas[1]) = (deltas[1], deltas[0]);
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(handId, GIVER, occ, deltas);
    }

    function test_MaterializeThank_DroppedAnonymousZero_SourceCommitmentMismatch() public {
        (uint256 handId,,) = _settleDedupHand();
        // Occurrence arrays with the anonymous zero (position 1) stripped:
        // length mismatch surfaces as SourceCommitmentMismatch, no separate error.
        address[] memory occ = new address[](3);
        occ[0] = SHAKER;
        occ[1] = SHAKER;
        occ[2] = SHAKER2;
        uint16[] memory deltas = new uint16[](3);
        deltas[0] = 1000;
        deltas[1] = 1000;
        deltas[2] = 1000;
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(handId, GIVER, occ, deltas);
    }

    /*//////////////////////////////////////////////////////////
                Sqrt curve — canonical table from test-notes
    //////////////////////////////////////////////////////////*/

    /// $1 charity: charityAmount 1e6, charityUsd 1e18, roleCredit 5e17,
    /// first-time delta = floor(sqrt(5e17)) = 707106781 per role.
    /// Also pins the full event shapes and their order.
    function test_Sqrt_OneDollar_707106781PerRole() public {
        uint256 handId = _settledHand(RAISER, 10_000_000, 1000, GIVER, GIVER_PK); // $10, 10% => $1 charity
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        bytes32 key = signals.thankSourceKey(handId);

        // Exact event order: THANKED, GIVEN, per-actor (UP mint then
        // EarnedUpMaterialized), ThankSignalsMaterialized last.
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.TransferSingle(address(this), address(0), RAISER, ID_THANKED, 1);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.TransferSingle(address(this), address(0), GIVER, ID_GIVEN, 1);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.TransferSingle(address(this), address(0), RAISER, ID_UP, SQRT_HALF_DOLLAR);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.EarnedUpMaterialized(key, RAISER, 1, 5e17, 0, 5e17, SQRT_HALF_DOLLAR);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.TransferSingle(address(this), address(0), GIVER, ID_UP, SQRT_HALF_DOLLAR);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.EarnedUpMaterialized(key, GIVER, 2, 5e17, 0, 5e17, SQRT_HALF_DOLLAR);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.ThankSignalsMaterialized(key, handId, RAISER, GIVER, 1e6, 1e18, 0);

        signals.materializeThank(handId, GIVER, occ, deltas);

        assertEq(signals.cumulativeUsd(RAISER), 5e17, "raiser cumulativeUsd");
        assertEq(signals.cumulativeUsd(GIVER), 5e17, "giver cumulativeUsd");
        assertEq(signals.prevSqrt(RAISER), SQRT_HALF_DOLLAR, "raiser prevSqrt");
        assertEq(signals.earnedUp(RAISER), SQRT_HALF_DOLLAR, "raiser earnedUp");
        assertEq(signals.earnedUp(GIVER), SQRT_HALF_DOLLAR, "giver earnedUp");
        assertEq(signals.balanceOf(RAISER, ID_UP), SQRT_HALF_DOLLAR, "raiser UP balance");
        assertEq(signals.balanceOf(GIVER, ID_UP), SQRT_HALF_DOLLAR, "giver UP balance");
        assertEq(signals.totalSupply(ID_UP), 2 * SQRT_HALF_DOLLAR, "UP supply");
    }

    /// $0.01 charity: roleCredit 5e15 -> delta 70710678 per role.
    function test_Sqrt_OneCent_70710678PerRole() public {
        uint256 handId = _settledHand(RAISER, 100_000, 1000, GIVER, GIVER_PK); // $0.10, 10% => $0.01 charity
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        signals.materializeThank(handId, GIVER, occ, deltas);

        assertEq(signals.cumulativeUsd(RAISER), 5e15, "raiser cumulativeUsd");
        assertEq(signals.earnedUp(RAISER), SQRT_HALF_CENT, "raiser earnedUp");
        assertEq(signals.earnedUp(GIVER), SQRT_HALF_CENT, "giver earnedUp");
        assertEq(signals.balanceOf(RAISER, ID_UP), SQRT_HALF_CENT, "raiser UP balance");
    }

    /// raiser == giver, $1: ONE update with the merged credit 1e18 ->
    /// delta 1000000000 (exactly 1 Up; sqrt subadditivity favors merging).
    function test_Sqrt_RaiserEqGiver_OneDollar_SingleMergedUpdate() public {
        uint256 handId = _settledHand(RAISER, 10_000_000, 1000, RAISER, RAISER_PK);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        bytes32 key = signals.thankSourceKey(handId);

        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.EarnedUpMaterialized(key, RAISER, 3, 1e18, 0, 1e18, SQRT_ONE_DOLLAR);
        signals.materializeThank(handId, RAISER, occ, deltas);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(_countTopic0(logs, EARNED_UP_SIG), 1, "exactly one merged update");
        assertEq(signals.cumulativeUsd(RAISER), 1e18, "merged cumulativeUsd");
        assertEq(signals.earnedUp(RAISER), SQRT_ONE_DOLLAR, "exactly 1 whole UP");
        assertEq(signals.balanceOf(RAISER, ID_UP), SQRT_ONE_DOLLAR);
        assertEq(signals.balanceOf(RAISER, ID_THANKED), 1, "still gets THANKED");
        assertEq(signals.balanceOf(RAISER, ID_GIVEN), 1, "still gets GIVEN");
        // Merged delta strictly exceeds the 2x split path: 1e9 > 2 * 707106781? No —
        // it is SMALLER: splitting mints 1414213562, merging mints 1000000000.
        assertLt(SQRT_ONE_DOLLAR, 2 * SQRT_HALF_DOLLAR, "sub-additivity: merged mints less");
    }

    /// Repeat credit: second identical hand mints only the incremental delta.
    /// 5e17 -> 707106781, then cum 1e18 -> floor(sqrt) 1e9 -> delta 292893219.
    function test_Sqrt_RepeatCredit_IncrementalDeltas() public {
        uint256 h1 = _settledHand(RAISER, 10_000_000, 1000, GIVER, GIVER_PK);
        uint256 h2 = _settledHand(RAISER, 10_000_000, 1000, GIVER2, GIVER2_PK);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();

        signals.materializeThank(h1, GIVER, occ, deltas);
        assertEq(signals.earnedUp(RAISER), SQRT_HALF_DOLLAR, "first delta 707106781");

        bytes32 key2 = signals.thankSourceKey(h2);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.EarnedUpMaterialized(key2, RAISER, 1, 5e17, 5e17, 1e18, 292893219);
        signals.materializeThank(h2, GIVER2, occ, deltas);

        assertEq(signals.earnedUp(RAISER), SQRT_ONE_DOLLAR, "707106781 + 292893219 == 1e9");
        assertEq(signals.prevSqrt(RAISER), SQRT_ONE_DOLLAR, "watermark == floor(sqrt(cum))");
        assertEq(signals.cumulativeUsd(RAISER), 1e18);
    }

    /// delta == 0: tiny credit on a large watermark still emits
    /// EarnedUpMaterialized and bumps cumulativeUsd, with NO TransferSingle.
    /// cum 6.25e22 is a perfect square (sqrt exactly 2.5e11); +5e11 stays below
    /// the next square (needs +2*2.5e11+1).
    function test_Sqrt_ZeroDelta_EmitsWithoutMint() public {
        // Hand 1: raiser==giver so cum lands exactly on 6.25e22 ($62,500 charity merged).
        uint256 h1 = _settledHand(RAISER, 625_000_000_000, 1000, RAISER, RAISER_PK);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        signals.materializeThank(h1, RAISER, occ, deltas);
        assertEq(signals.cumulativeUsd(RAISER), 62_500_000_000_000_000_000_000);
        assertEq(signals.prevSqrt(RAISER), 250_000_000_000, "perfect-square watermark");
        uint256 earnedBefore = signals.earnedUp(RAISER);
        uint256 balBefore = signals.balanceOf(RAISER, ID_UP);

        // Hand 2: 1-unit charity ($0.000001) -> raiser roleCredit 5e11.
        uint256 h2 = _settledHand(RAISER, 100, 100, GIVER2, GIVER2_PK);
        bytes32 key2 = signals.thankSourceKey(h2);

        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.EarnedUpMaterialized(
            key2,
            RAISER,
            1,
            5e11,
            62_500_000_000_000_000_000_000,
            62_500_000_000_000_000_000_000 + 5e11,
            0
        );
        signals.materializeThank(h2, GIVER2, occ, deltas);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(_countUpMintsTo(logs, RAISER, ID_UP), 0, "NO TransferSingle on zero delta");
        assertEq(signals.cumulativeUsd(RAISER), 62_500_000_000_000_000_000_000 + 5e11, "cum still bumps");
        assertEq(signals.earnedUp(RAISER), earnedBefore, "earnedUp unchanged");
        assertEq(signals.balanceOf(RAISER, ID_UP), balBefore, "UP balance unchanged");
        // The distinct giver of the tiny hand DOES mint: floor(sqrt(5e11)) = 707106.
        assertEq(signals.earnedUp(GIVER2), 707106, "tiny first-time credit still mints");
    }

    /*//////////////////////////////////////////////////////////
        Order independence — same two hands, both materialization
        orders, identical final state.
        Hands: $1 charity (giver G) and $0.01 charity (giver G2),
        same raiser. Final: cum 5.05e17, earned floor(sqrt) 710633520,
        totalSupply[UP] 710633520 + 707106781 + 70710678 = 1488450979.
    //////////////////////////////////////////////////////////*/

    uint256 internal constant FINAL_RAISER_CUM = 505_000_000_000_000_000;
    uint256 internal constant FINAL_RAISER_EARNED = 710633520; // floor(sqrt(5.05e17))
    uint256 internal constant FINAL_UP_SUPPLY = 1488450979;

    function _twoHands() internal returns (uint256 hBig, uint256 hSmall) {
        hBig = _settledHand(RAISER, 10_000_000, 1000, GIVER, GIVER_PK); // $1 charity
        hSmall = _settledHand(RAISER, 100_000, 1000, GIVER2, GIVER2_PK); // $0.01 charity
    }

    function _assertFinalState() internal view {
        assertEq(signals.cumulativeUsd(RAISER), FINAL_RAISER_CUM, "final cumulativeUsd");
        assertEq(signals.earnedUp(RAISER), FINAL_RAISER_EARNED, "final earnedUp");
        assertEq(signals.prevSqrt(RAISER), FINAL_RAISER_EARNED, "final watermark");
        assertEq(signals.balanceOf(RAISER, ID_UP), FINAL_RAISER_EARNED, "final UP balance");
        assertEq(signals.earnedUp(GIVER), SQRT_HALF_DOLLAR, "big-hand giver earned");
        assertEq(signals.earnedUp(GIVER2), SQRT_HALF_CENT, "small-hand giver earned");
        assertEq(signals.totalSupply(ID_UP), FINAL_UP_SUPPLY, "final UP totalSupply");
    }

    function test_OrderIndependence_BigThenSmall() public {
        (uint256 hBig, uint256 hSmall) = _twoHands();
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();

        signals.materializeThank(hBig, GIVER, occ, deltas);
        assertEq(signals.earnedUp(RAISER), SQRT_HALF_DOLLAR, "intermediate: 707106781");
        signals.materializeThank(hSmall, GIVER2, occ, deltas);
        // second delta = 710633520 - 707106781 = 3526739
        assertEq(FINAL_RAISER_EARNED - SQRT_HALF_DOLLAR, 3526739, "incremental delta big->small");

        _assertFinalState();
    }

    function test_OrderIndependence_SmallThenBig() public {
        (uint256 hBig, uint256 hSmall) = _twoHands();
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();

        signals.materializeThank(hSmall, GIVER2, occ, deltas);
        assertEq(signals.earnedUp(RAISER), SQRT_HALF_CENT, "intermediate: 70710678");
        signals.materializeThank(hBig, GIVER, occ, deltas);
        // second delta = 710633520 - 70710678 = 639922842
        assertEq(FINAL_RAISER_EARNED - SQRT_HALF_CENT, 639922842, "incremental delta small->big");

        _assertFinalState();
    }

    /*//////////////////////////////////////////////////////////
                        Shaker dedup semantics
    //////////////////////////////////////////////////////////*/

    function test_Dedup_RepeatShakerOnce_AnonymousSkipped() public {
        (uint256 handId, address[] memory occ, uint16[] memory deltas) = _settleDedupHand();
        bytes32 key = signals.thankSourceKey(handId);

        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.ThankSignalsMaterialized(key, handId, RAISER, GIVER, 1_000_000, 1e18, 2);
        signals.materializeThank(handId, GIVER, occ, deltas);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(signals.balanceOf(SHAKER, ID_SHAKEN), 1, "repeat shaker minted ONCE");
        assertEq(signals.balanceOf(SHAKER2, ID_SHAKEN), 1, "second distinct shaker");
        assertEq(signals.balanceOf(address(0), ID_SHAKEN), 0, "anonymous zero skipped");
        assertEq(signals.totalSupply(ID_SHAKEN), 2, "SHAKEN supply == unique shakers");
        assertEq(_countUpMintsTo(logs, SHAKER, ID_SHAKEN), 1, "one SHAKEN TransferSingle for repeat");
        assertEq(_countUpMintsTo(logs, address(0), ID_SHAKEN), 0, "no mint to zero");
    }

    /*//////////////////////////////////////////////////////////
        Hook-free mints — contract actors with reverting ERC-1155
        hooks materialize fine (Signals never calls out on mint).
    //////////////////////////////////////////////////////////*/

    function test_HookFree_ContractRaiserAndGiver_Materialize() public {
        RevertingReceiver1155 contractRaiser = new RevertingReceiver1155();
        RevertingReceiver1155 contractGiver = new RevertingReceiver1155();

        uint256 handId = _raiseOn(core, address(contractRaiser), 10_000_000, 1000);
        // giverPk == 0 -> empty acceptance bytes -> ERC-1271 accept-all path.
        _thankOn(core, handId, new Hop[](0), address(contractGiver), 0);

        signals.materializeRaised(handId);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        signals.materializeThank(handId, address(contractGiver), occ, deltas);

        assertEq(signals.balanceOf(address(contractRaiser), ID_RAISED), 1);
        assertEq(signals.balanceOf(address(contractRaiser), ID_THANKED), 1);
        assertEq(signals.balanceOf(address(contractGiver), ID_GIVEN), 1);
        assertEq(signals.balanceOf(address(contractRaiser), ID_UP), SQRT_HALF_DOLLAR);
        assertEq(signals.balanceOf(address(contractGiver), ID_UP), SQRT_HALF_DOLLAR);
    }

    /*//////////////////////////////////////////////////////////
        Wrong-core substitution — materialization is keyed per
        sourceCore; cross-core payloads cannot leak through.
    //////////////////////////////////////////////////////////*/

    function test_WrongCore_KeysDiffer() public {
        AHandCore core2 = _deployCore();
        AHandSignals signals2 = new AHandSignals(address(core2));
        assertTrue(signals.raisedSourceKey(1) != signals2.raisedSourceKey(1), "raised keys per core");
        assertTrue(signals.thankSourceKey(1) != signals2.thankSourceKey(1), "thank keys per core");
    }

    function test_WrongCore_CrossPayloadRejected_FlagsIndependent() public {
        AHandCore core2 = _deployCore();
        AHandSignals signals2 = new AHandSignals(address(core2));

        // Same handId (1) on both cores, settled with DIFFERENT givers.
        uint256 h1 = _settledHand(RAISER, 10_000_000, 1000, GIVER, GIVER_PK);
        address raiser2 = makeAddr("raiser2");
        uint256 h2 = _raiseOn(core2, raiser2, 10_000_000, 1000);
        _thankOn(core2, h2, new Hop[](0), GIVER2, GIVER2_PK);
        assertEq(h1, h2, "same id on both cores");

        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();

        // core2's facts fed to signals1: commitment rebuilt against core1's
        // stored hand cannot match -> SourceCommitmentMismatch.
        vm.expectRevert(SourceCommitmentMismatch.selector);
        signals.materializeThank(h1, GIVER2, occ, deltas);

        // Each pair materializes its own facts; processed flags never bleed over.
        signals2.materializeThank(h2, GIVER2, occ, deltas);
        assertTrue(signals2.processedSource(signals2.thankSourceKey(h2)), "signals2 processed");
        assertFalse(signals.processedSource(signals.thankSourceKey(h1)), "signals1 untouched");

        signals.materializeThank(h1, GIVER, occ, deltas);
        assertEq(signals.balanceOf(GIVER, ID_GIVEN), 1, "core1 giver on signals1");
        assertEq(signals2.balanceOf(GIVER2, ID_GIVEN), 1, "core2 giver on signals2");
        assertEq(signals.balanceOf(GIVER2, ID_GIVEN), 0, "no cross-mint");
    }

    function test_WrongCore_HandMissingOnSourceCore() public {
        AHandCore core2 = _deployCore();
        // Hand 1 exists only on core2; signals (bound to core1) sees Status.None.
        address raiser2 = makeAddr("raiser2");
        uint256 h = _raiseOn(core2, raiser2, 10_000_000, 1000);

        vm.expectRevert(WrongHand.selector);
        signals.materializeRaised(h);

        _thankOn(core2, h, new Hop[](0), GIVER2, GIVER2_PK);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        vm.expectRevert(NotSettled.selector);
        signals.materializeThank(h, GIVER2, occ, deltas);
    }

    /*//////////////////////////////////////////////////////////
        up() — guard order, recursion cut, conservation, event
    //////////////////////////////////////////////////////////*/

    function _earnedActor() internal returns (address) {
        // $100 charity -> roleCredit 5e19 -> raiser earns floor(sqrt(5e19)) =
        // 7071067811 (~7 whole UP).
        uint256 handId = _settledHand(RAISER, 1_000_000_000, 1000, GIVER, GIVER_PK);
        (address[] memory occ, uint16[] memory deltas) = _emptyOcc();
        signals.materializeThank(handId, GIVER, occ, deltas);
        assertEq(signals.earnedUp(RAISER), 7071067811);
        return RAISER;
    }

    function _ctx(uint256 handId, bytes32 reason) internal pure returns (UpContext memory) {
        return UpContext({handId: handId, reasonTag: reason, evidenceHash: bytes32(0)});
    }

    function test_Up_GuardOrder_ZeroAmountFirst() public {
        // Everything else invalid too — ZeroAmount still wins.
        vm.expectRevert(ZeroAmount.selector);
        signals.up(address(0), 0, _ctx(0, 0));
    }

    function test_Up_GuardOrder_OverflowPanicBeforeInsufficientEarned() public {
        // Caller has zero earned; the checked multiplication still fires first.
        uint256 count = type(uint256).max / signals.ONE_UP() + 1;
        vm.expectRevert(stdError.arithmeticError);
        signals.up(address(0xBEEF), count, _ctx(0, 0));
    }

    function test_Up_GuardOrder_InsufficientEarnedBeforeZeroAddress() public {
        // No earned UP, zero target, zero context: InsufficientEarned wins.
        vm.expectRevert(InsufficientEarned.selector);
        signals.up(address(0), 1, _ctx(0, 0));
    }

    function test_Up_GuardOrder_ZeroAddress_SelfTarget_ZeroContext() public {
        address actor = _earnedActor();

        vm.prank(actor);
        vm.expectRevert(ZeroAddress.selector);
        signals.up(address(0), 1, _ctx(0, 0)); // zero ctx too — ZeroAddress first

        vm.prank(actor);
        vm.expectRevert(SelfTarget.selector);
        signals.up(actor, 1, _ctx(0, 0)); // zero ctx too — SelfTarget first

        vm.prank(actor);
        vm.expectRevert(ZeroContext.selector);
        signals.up(address(0xBEEF), 1, _ctx(0, 0)); // all three fields zero

        // Any single non-zero context field is enough.
        vm.prank(actor);
        signals.up(address(0xBEEF), 1, _ctx(0, "because"));
        assertEq(signals.balanceOf(address(0xBEEF), ID_UP), signals.ONE_UP());
    }

    function test_Up_ReceivedCannotRecurse_SupplyConserved() public {
        address actor = _earnedActor();
        address target = makeAddr("target");

        uint256 supplyBefore = signals.totalSupply(ID_UP);
        uint256 actorEarnedBefore = signals.earnedUp(actor);
        uint256 actorBalBefore = signals.balanceOf(actor, ID_UP);

        vm.prank(actor);
        signals.up(target, 2, _ctx(1, "solid work"));

        uint256 amount = 2 * signals.ONE_UP();
        // Conservation: burn+mint nets to zero supply change.
        assertEq(signals.totalSupply(ID_UP), supplyBefore, "up() conserves UP supply");
        assertEq(signals.balanceOf(actor, ID_UP), actorBalBefore - amount, "sender burned");
        assertEq(signals.earnedUp(actor), actorEarnedBefore - amount, "sender earned spent");
        // Received, not earned: the recursion cut.
        assertEq(signals.balanceOf(target, ID_UP), amount, "target balance grows");
        assertEq(signals.receivedOf(target), amount, "receivedOf grows");
        assertEq(signals.earnedUp(target), 0, "target earnedUp unchanged");

        vm.prank(target);
        vm.expectRevert(InsufficientEarned.selector);
        signals.up(actor, 1, _ctx(1, "regift")); // received UP is not spendable
    }

    function test_Up_EventShape() public {
        address actor = _earnedActor();
        address target = makeAddr("target");
        UpContext memory ctx =
            UpContext({handId: 42, reasonTag: bytes32("why"), evidenceHash: keccak256("evidence")});

        vm.prank(actor);
        vm.expectEmit(true, true, true, true, address(signals));
        emit AHandSignals.Upped(actor, target, 42, 3, 3 * 1e9, bytes32("why"), keccak256("evidence"));
        signals.up(target, 3, ctx);
    }

    /*//////////////////////////////////////////////////////////
            Interface surface — ERC-165 only, soulbound by
            ABSENCE of transfer/approval selectors.
    //////////////////////////////////////////////////////////*/

    function test_SupportsInterface_OnlyERC165() public view {
        assertTrue(signals.supportsInterface(0x01ffc9a7), "ERC-165 itself");
        assertFalse(signals.supportsInterface(0xd9b67a26), "must NOT claim ERC-1155");
        assertFalse(signals.supportsInterface(0x0e89341c), "must NOT claim ERC-1155 metadata");
        assertFalse(signals.supportsInterface(0x4e2312e0), "not a 1155 receiver");
        assertFalse(signals.supportsInterface(0xffffffff), "165 sentinel");
    }

    function test_TransferApprovalSelectorsAbsent_NoFallback() public {
        // Soulbound reframe: the selectors are not on the ABI at all; with no
        // fallback, dispatch itself reverts. Raw calls, plausible calldata.
        (bool ok,) = address(signals).call(
            abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256,uint256,bytes)",
                address(this),
                address(0xBEEF),
                ID_UP,
                uint256(1),
                bytes("")
            )
        );
        assertFalse(ok, "safeTransferFrom absent");

        (ok,) = address(signals).call(
            abi.encodeWithSignature(
                "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
                address(this),
                address(0xBEEF),
                new uint256[](0),
                new uint256[](0),
                bytes("")
            )
        );
        assertFalse(ok, "safeBatchTransferFrom absent");

        (ok,) = address(signals).call(
            abi.encodeWithSignature("setApprovalForAll(address,bool)", address(0xBEEF), true)
        );
        assertFalse(ok, "setApprovalForAll absent");

        (ok,) = address(signals).call(
            abi.encodeWithSignature("isApprovedForAll(address,address)", address(this), address(0xBEEF))
        );
        assertFalse(ok, "isApprovedForAll absent");

        // No receive/fallback either: empty calldata reverts.
        (ok,) = address(signals).call("");
        assertFalse(ok, "no fallback");
    }
}
