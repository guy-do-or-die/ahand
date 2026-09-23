// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";
import {AHandWitness} from "../src/AHandWitness.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: AHandWitness — namespace separation between the
        blind and typed entry points (a blind pre-occupation
        cannot suppress ShakeWitnessed / GiveWitnessed),
        first-write-wins idempotency, signer attribution,
        signature rejection, and what a typed witness does NOT
        check (locks the NatSpec to the code).
//////////////////////////////////////////////////////////////*/

contract AHandWitnessTest is AHandTestBase {
    AHandWitness witness;

    uint256 constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    /// @dev Explicit clock: under via_ir, block.timestamp read after vm.warp in
    ///      the same test body can be stale, so tests warp to these literals.
    uint40 constant T0 = 1_000_000;

    function setUp() public override {
        super.setUp();
        witness = new AHandWitness(address(core));
        vm.warp(T0);
    }

    /*//////////////////// fixtures ////////////////////*/

    /// @dev A real route: root E0 -> self hop to E1 (10% margin) -> Give to `giver`.
    function _artifacts()
        internal
        returns (Shake memory s, bytes memory shakeSig, Give memory g, bytes memory giveSig)
    {
        uint256 handId = makeRaise();
        RouteBuild memory r = newRoute();
        addSelfHop(r, handId, E1, 9_000);
        s = r.shakes[0];
        shakeSig = r.sigs[0];
        (g, giveSig) = buildGive(handId, r, giver, defaultDeadline());
    }

    function _shakeKey(Shake memory s, bytes memory sig) internal pure returns (bytes32) {
        return keccak256(abi.encode(AHandSig.hashShake(s), sig));
    }

    function _giveKey(Give memory g, bytes memory sig) internal pure returns (bytes32) {
        return keccak256(abi.encode(AHandSig.hashGive(g), sig));
    }

    function _expectShakeWitnessed(Shake memory s, address parent, uint40 at) internal {
        vm.expectEmit(true, true, true, true, address(witness));
        emit AHandWitness.ShakeWitnessed(
            s.handId, parent, s.childCapability, s.shaker,
            s.parentClaimBps - s.childClaimBps, s.hopDataHash, at
        );
    }

    function _expectGiveWitnessed(Give memory g, address cap, uint40 at) internal {
        vm.expectEmit(true, true, true, true, address(witness));
        emit AHandWitness.GiveWitnessed(
            g.handId, cap, g.giver, g.routeHash, g.solutionHash, at
        );
    }

    /*//////////////////// namespace separation ////////////////////*/

    /// @notice The raiser receives the signed Give for review and blind-witnesses
    ///         its typed key first; the giver's later witnessGive still emits.
    function test_blindPreoccupation_doesNotSuppressGiveWitnessed() public {
        (, , Give memory g, bytes memory giveSig) = _artifacts();
        bytes32 key = _giveKey(g, giveSig);

        vm.prank(raiser);
        witness.witness(key);

        vm.warp(T0 + 1 days);
        _expectGiveWitnessed(g, vm.addr(E1), T0 + 1 days);
        vm.prank(giver);
        witness.witnessGive(g, giveSig);

        assertEq(witness.giveWitnessedAt(key), T0 + 1 days, "typed give slot");
        assertEq(witness.witnessedAt(key), T0, "blind slot untouched");
    }

    function test_blindPreoccupation_doesNotSuppressShakeWitnessed() public {
        (Shake memory s, bytes memory shakeSig, , ) = _artifacts();
        bytes32 key = _shakeKey(s, shakeSig);

        vm.prank(raiser);
        witness.witness(key);

        vm.warp(T0 + 1 days);
        _expectShakeWitnessed(s, vm.addr(E0), T0 + 1 days);
        witness.witnessShake(s, shakeSig);

        assertEq(witness.shakeWitnessedAt(key), T0 + 1 days, "typed shake slot");
        assertEq(witness.witnessedAt(key), T0, "blind slot untouched");
    }

    function test_typedFirst_doesNotSuppressBlindWitness() public {
        (Shake memory s, bytes memory shakeSig, Give memory g, bytes memory giveSig) = _artifacts();
        bytes32 shakeKey = _shakeKey(s, shakeSig);
        bytes32 giveKey = _giveKey(g, giveSig);
        witness.witnessShake(s, shakeSig);
        witness.witnessGive(g, giveSig);

        vm.warp(T0 + 1 hours);
        vm.expectEmit(true, true, true, true, address(witness));
        emit AHandWitness.Witnessed(shakeKey, stranger, T0 + 1 hours);
        vm.prank(stranger);
        witness.witness(shakeKey);

        vm.expectEmit(true, true, true, true, address(witness));
        emit AHandWitness.Witnessed(giveKey, stranger, T0 + 1 hours);
        vm.prank(stranger);
        witness.witness(giveKey);

        assertEq(witness.witnessedAt(shakeKey), T0 + 1 hours);
        assertEq(witness.witnessedAt(giveKey), T0 + 1 hours);
        assertEq(witness.shakeWitnessedAt(shakeKey), T0, "typed shake slot untouched");
        assertEq(witness.giveWitnessedAt(giveKey), T0, "typed give slot untouched");
    }

    /// @notice No set of blind hashes submitted beforehand — including the typed
    ///         keys themselves — stops a fresh typed Shake or Give from emitting.
    function testFuzz_blindHashesNeverBlockTypedWitness(
        bytes32 blind,
        bytes32 solutionHash,
        bytes32 hopDataHash,
        uint16 childClaim
    ) public {
        childClaim = uint16(bound(childClaim, 0, 10_000));
        Shake memory s = Shake({
            handId: 7, childCapability: vm.addr(E2), shaker: address(0),
            parentClaimBps: 10_000, childClaimBps: childClaim,
            hopDataHash: hopDataHash, deadline: defaultDeadline()
        });
        Give memory g = Give({
            handId: 7, routeHash: keccak256("route"), giver: giver,
            solutionHash: solutionHash, finalClaimBps: childClaim, deadline: defaultDeadline()
        });
        bytes memory shakeSig = signShake(E1, s);
        bytes memory giveSig = signGive(E2, g);

        witness.witness(blind);
        witness.witness(_shakeKey(s, shakeSig));
        witness.witness(_giveKey(g, giveSig));

        vm.warp(T0 + 1);
        _expectShakeWitnessed(s, vm.addr(E1), T0 + 1);
        witness.witnessShake(s, shakeSig);
        _expectGiveWitnessed(g, vm.addr(E2), T0 + 1);
        witness.witnessGive(g, giveSig);
    }

    /*//////////////////// idempotency ////////////////////*/

    function test_repeat_isSilentNoOp_andKeepsFirstTimestamp_perNamespace() public {
        (Shake memory s, bytes memory shakeSig, Give memory g, bytes memory giveSig) = _artifacts();
        bytes32 blind = keccak256("payload");
        witness.witness(blind);
        witness.witnessShake(s, shakeSig);
        witness.witnessGive(g, giveSig);

        vm.warp(T0 + 7 days);
        vm.recordLogs();
        witness.witness(blind);
        witness.witnessShake(s, shakeSig);
        witness.witnessGive(g, giveSig);
        assertEq(vm.getRecordedLogs().length, 0, "repeats emit nothing");

        assertEq(witness.witnessedAt(blind), T0);
        assertEq(witness.shakeWitnessedAt(_shakeKey(s, shakeSig)), T0);
        assertEq(witness.giveWitnessedAt(_giveKey(g, giveSig)), T0);
    }

    /*//////////////////// attribution ////////////////////*/

    function test_typedWitness_attributesRecoveredSigner_notSubmitter() public {
        (Shake memory s, bytes memory shakeSig, Give memory g, bytes memory giveSig) = _artifacts();

        _expectShakeWitnessed(s, vm.addr(E0), T0);
        vm.prank(stranger);
        witness.witnessShake(s, shakeSig);

        _expectGiveWitnessed(g, vm.addr(E1), T0);
        vm.prank(stranger);
        witness.witnessGive(g, giveSig);
    }

    /*//////////////////// rejection ////////////////////*/

    function test_badSignatures_revert() public {
        (Shake memory s, bytes memory shakeSig, Give memory g, bytes memory giveSig) = _artifacts();

        bytes[] memory bad = new bytes[](4);
        bad[0] = _truncate64(giveSig);          // wrong length
        bad[1] = _highS(giveSig);               // malleated twin
        bad[2] = _withV(giveSig, 29);           // invalid v
        bad[3] = abi.encodePacked(bytes32(0), bytes32(uint256(1)), uint8(27)); // recovers to zero

        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(AHandWitness.BadSignature.selector);
            witness.witnessGive(g, bad[i]);
        }

        bad[0] = _truncate64(shakeSig);
        bad[1] = _highS(shakeSig);
        bad[2] = _withV(shakeSig, 29);
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(AHandWitness.BadSignature.selector);
            witness.witnessShake(s, bad[i]);
        }
    }

    function test_witnessShake_childAboveParent_reverts() public {
        (Shake memory s, , , ) = _artifacts();
        s.childClaimBps = s.parentClaimBps + 1;
        bytes memory sig = signShake(E0, s);
        vm.expectRevert(AHandWitness.InvalidShake.selector);
        witness.witnessShake(s, sig);
    }

    function test_constructor_zeroCore_reverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new AHandWitness(address(0));
    }

    /*//////////////////// what a typed witness does NOT check ////////////////////*/

    /// @notice GiveWitnessed proves only authorship of bytes: a throwaway key can
    ///         anchor a Give for a Hand that does not exist, with an expired deadline,
    ///         no route linkage and no GiverAcceptance. Indexers must not read it as
    ///         a valid Give, let alone a freeriding fact.
    function test_witnessGive_checksOnlyAuthorship() public {
        uint256 throwawayPk = 0xBADBAD;
        Give memory g = Give({
            handId: 424_242, routeHash: keccak256("no such route"), giver: giver,
            solutionHash: keccak256("x"), finalClaimBps: 10_000, deadline: 1
        });
        bytes memory sig = signGive(throwawayPk, g);

        _expectGiveWitnessed(g, vm.addr(throwawayPk), T0);
        witness.witnessGive(g, sig);
    }

    /*//////////////////// signature mutators ////////////////////*/

    function _truncate64(bytes memory sig) internal pure returns (bytes memory out) {
        (bytes32 r, bytes32 s_, ) = _split(sig);
        out = abi.encodePacked(r, s_);
    }

    function _highS(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s_, uint8 v) = _split(sig);
        return abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s_)), v == 27 ? uint8(28) : uint8(27));
    }

    function _withV(bytes memory sig, uint8 v) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s_, ) = _split(sig);
        return abi.encodePacked(r, s_, v);
    }

    function _split(bytes memory sig) internal pure returns (bytes32 r, bytes32 s_, uint8 v) {
        assembly {
            r := mload(add(sig, 0x20))
            s_ := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
    }
}
