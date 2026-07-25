// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Test.sol";
import "../src/AHandTypes.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {MockUSD} from "./mocks/MockUSD.sol";

/*//////////////////////////////////////////////////////////////
        BASE: actors, capability keys, raise + route builders
//////////////////////////////////////////////////////////////*/

/// @notice Shared fixture for every AHand.*.t.sol suite. Deploys the canonical
///         stack (MockUSD 6dec, Core at usdScale 1e12, Signals over Core) and
///         provides raise/route/signature helpers so suites assert protocol
///         behavior, not plumbing.
contract AHandTestBase is Test {
    AHandCore core;
    AHandSignals signals;
    MockUSD usd;

    address raiser      = makeAddr("raiser");
    address charity     = makeAddr("charity");
    address policyAdmin = makeAddr("policyAdmin");
    address stranger    = makeAddr("stranger");

    /// Capability keys for the delegation chain: root E0, children E1..E5.
    uint256 constant E0 = 0xE0aa; uint256 constant E1 = 0xE1aa;
    uint256 constant E2 = 0xE2aa; uint256 constant E3 = 0xE3aa;
    uint256 constant E4 = 0xE4aa; uint256 constant E5 = 0xE5aa;

    /// Attributed accounts that must be able to co-sign acceptances.
    uint256 constant SHAKER_A_PK = 0x5Aaa;
    uint256 constant SHAKER_B_PK = 0x5Baa;
    uint256 constant GIVER_PK    = 0x61aa;
    address shakerA;
    address shakerB;
    address giver;

    uint96 constant DEPOSIT = 100e6;                 // $100 in 6-dec units
    uint64 constant USD_SCALE = 1e12;                // 6 decimals -> 1e18 USD
    bytes  constant DEFAULT_REF = "aHand:discovery"; // any 1..128 bytes

    function setUp() public virtual {
        shakerA = vm.addr(SHAKER_A_PK);
        shakerB = vm.addr(SHAKER_B_PK);
        giver = vm.addr(GIVER_PK);

        usd = new MockUSD();
        address[] memory ch = new address[](1);
        ch[0] = charity;
        core = new AHandCore(address(usd), USD_SCALE, ch, policyAdmin);
        signals = new AHandSignals(address(core));

        usd.mint(raiser, 1_000_000e6);
        vm.prank(raiser);
        usd.approve(address(core), type(uint256).max);
    }

    /// @dev Secondary Core over another 6-dec token (FoT / blacklist scenarios).
    function deployCore(address token) internal returns (AHandCore) {
        address[] memory ch = new address[](1);
        ch[0] = charity;
        return new AHandCore(token, USD_SCALE, ch, policyAdmin);
    }

    /*//////////////////// raise ////////////////////*/

    /// @dev Canonical valid params: Public, 10% charity, 50% giver floor, 30 days.
    function defaultParams() internal view returns (RaiseParams memory) {
        return RaiseParams({
            token: address(usd),
            amount: DEPOSIT,
            expiry: uint40(block.timestamp + 30 days),
            charityRecipient: charity,
            charityBps: 1_000,
            minGiverClaimBps: 5_000,
            rootCapability: vm.addr(E0),
            visibility: Visibility.Public,
            metadataCommitment: keccak256("meta"),
            discoveryCommitment: keccak256("discovery")
        });
    }

    function makeRaise() internal returns (uint256 handId) {
        return makeRaise(defaultParams());
    }

    function makeRaise(RaiseParams memory p) internal returns (uint256 handId) {
        return makeRaise(p, DEFAULT_REF, noTags());
    }

    function makeRaise(RaiseParams memory p, bytes memory discoveryRef, bytes32[] memory tags)
        internal
        returns (uint256 handId)
    {
        vm.prank(raiser);
        handId = core.raise(p, discoveryRef, tags);
    }

    function expectRaiseRevert(bytes4 err, RaiseParams memory p) internal {
        expectRaiseRevert(err, p, DEFAULT_REF, noTags());
    }

    function expectRaiseRevert(bytes4 err, RaiseParams memory p, bytes memory discoveryRef, bytes32[] memory tags)
        internal
    {
        vm.prank(raiser);
        vm.expectRevert(err);
        core.raise(p, discoveryRef, tags);
    }

    /*//////////////////// signatures ////////////////////*/

    /// @dev EIP-712 signature over structHash under the live core domain.
    function signStruct(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        return signStructWithDomain(pk, core.DOMAIN_SEPARATOR(), structHash);
    }

    /// @dev Same, under an arbitrary domain — fork-safety suites sign with stale separators.
    function signStructWithDomain(uint256 pk, bytes32 ds, bytes32 structHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, AHandSig.digest(ds, structHash));
        return abi.encodePacked(r, s, v);
    }

    function signShake(uint256 pk, Shake memory s) internal view returns (bytes memory) {
        return signStruct(pk, AHandSig.hashShake(s));
    }

    function signShakerAcceptance(uint256 pk, bytes32 shakeHash) internal view returns (bytes memory) {
        return signStruct(pk, AHandSig.hashShakerAcceptance(shakeHash));
    }

    function signGive(uint256 pk, Give memory g) internal view returns (bytes memory) {
        return signStruct(pk, AHandSig.hashGive(g));
    }

    function signGiverAcceptance(uint256 pk, Give memory g) internal view returns (bytes memory) {
        return signStruct(pk, AHandSig.hashGiverAcceptance(AHandSig.hashGive(g)));
    }

    /*//////////////////// route building ////////////////////*/

    /// @dev Growable route under construction. parentPk / claim track the tail:
    ///      the key that signs the next artifact and the claim it must carry.
    struct RouteBuild {
        Shake[] shakes;
        bytes[] sigs;
        bytes[] acceptances;
        uint256 parentPk; // tail capability key (root E0 before any hop)
        uint16  claim;    // childClaim of the last hop; 10_000 before any hop
    }

    function newRoute() internal pure returns (RouteBuild memory r) {
        r.parentPk = E0;
        r.claim = 10_000;
        r.shakes = new Shake[](0);
        r.sigs = new bytes[](0);
        r.acceptances = new bytes[](0);
    }

    /// @dev Full-control hop append. shakerPk == 0 leaves acceptance bytes empty
    ///      (correct for anonymous and self-attributed hops).
    function addHop(
        RouteBuild memory r,
        uint256 handId,
        uint256 childPk,
        address shaker,
        uint256 shakerPk,
        uint16 childClaim,
        uint40 deadline
    ) internal view {
        Shake memory s = Shake({
            handId: handId,
            childCapability: vm.addr(childPk),
            shaker: shaker,
            parentClaimBps: r.claim,
            childClaimBps: childClaim,
            hopDataHash: bytes32(0),
            deadline: deadline
        });
        bytes32 shakeHash = AHandSig.hashShake(s);
        bytes memory acceptance;
        if (shakerPk != 0) acceptance = signShakerAcceptance(shakerPk, shakeHash);

        r.shakes = _pushShake(r.shakes, s);
        r.sigs = _pushBytes(r.sigs, signStruct(r.parentPk, shakeHash));
        r.acceptances = _pushBytes(r.acceptances, acceptance);
        r.parentPk = childPk;
        r.claim = childClaim;
    }

    /// @dev Anonymous hop: shaker zero, no acceptance. Zero-margin only by protocol law.
    function addAnonymousHop(RouteBuild memory r, uint256 handId, uint256 childPk, uint16 childClaim) internal view {
        addHop(r, handId, childPk, address(0), 0, childClaim, defaultDeadline());
    }

    /// @dev Self-attributed hop: shaker == the capability that signs this Shake.
    function addSelfHop(RouteBuild memory r, uint256 handId, uint256 childPk, uint16 childClaim) internal view {
        addHop(r, handId, childPk, vm.addr(r.parentPk), 0, childClaim, defaultDeadline());
    }

    /// @dev Explicit distinct shaker: acceptance co-signed by shakerPk.
    function addExplicitHop(
        RouteBuild memory r,
        uint256 handId,
        uint256 childPk,
        address shaker,
        uint256 shakerPk,
        uint16 childClaim
    ) internal view {
        addHop(r, handId, childPk, shaker, shakerPk, childClaim, defaultDeadline());
    }

    /// @dev Canonical route identity — byte-matches the core's computation.
    function routeHashOf(uint256 handId, RouteBuild memory r) internal view returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](r.shakes.length);
        for (uint256 i; i < r.shakes.length; ++i) {
            hashes[i] = AHandSig.hashShake(r.shakes[i]);
        }
        return AHandSig.hashRoute(AHandSig.handRef(address(core), handId), hashes);
    }

    /*//////////////////// give + thank ////////////////////*/

    /// @dev Give bound to the built route; signed by the tail capability.
    function buildGive(uint256 handId, RouteBuild memory r, address giver_, uint40 deadline)
        internal
        view
        returns (Give memory g, bytes memory giveSig)
    {
        g = Give({
            handId: handId,
            routeHash: routeHashOf(handId, r),
            giver: giver_,
            solutionHash: keccak256("solution"),
            finalClaimBps: r.claim,
            deadline: deadline
        });
        giveSig = signGive(r.parentPk, g);
    }

    function doThank(
        uint256 handId,
        RouteBuild memory r,
        Give memory g,
        bytes memory giveSig,
        bytes memory giverAcceptanceSig
    ) internal {
        vm.prank(raiser);
        core.thank(handId, r.shakes, r.sigs, r.acceptances, g, giveSig, giverAcceptanceSig);
    }

    /// @dev Full consensual settlement of the built route to the default giver.
    function settle(uint256 handId, RouteBuild memory r) internal returns (Give memory g) {
        bytes memory giveSig;
        (g, giveSig) = buildGive(handId, r, giver, defaultDeadline());
        doThank(handId, r, g, giveSig, signGiverAcceptance(GIVER_PK, g));
    }

    /// @dev Smoke settlement: one zero-margin self hop E0 -> E1, giver residual
    ///      takes the whole distributable pool.
    function settleSimple(uint256 handId) internal returns (Give memory g) {
        RouteBuild memory r = newRoute();
        addSelfHop(r, handId, E1, 10_000);
        g = settle(handId, r);
    }

    /*//////////////////// small utilities ////////////////////*/

    function defaultDeadline() internal view returns (uint40) {
        return uint40(block.timestamp + 1 days);
    }

    function noTags() internal pure returns (bytes32[] memory t) {
        t = new bytes32[](0);
    }

    function tags1(bytes32 a) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](1);
        t[0] = a;
    }

    function tags2(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](2);
        t[0] = a;
        t[1] = b;
    }

    function tags3(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](3);
        t[0] = a;
        t[1] = b;
        t[2] = c;
    }

    function _pushShake(Shake[] memory arr, Shake memory s) internal pure returns (Shake[] memory out) {
        out = new Shake[](arr.length + 1);
        for (uint256 i; i < arr.length; ++i) out[i] = arr[i];
        out[arr.length] = s;
    }

    function _pushBytes(bytes[] memory arr, bytes memory b) internal pure returns (bytes[] memory out) {
        out = new bytes[](arr.length + 1);
        for (uint256 i; i < arr.length; ++i) out[i] = arr[i];
        out[arr.length] = b;
    }
}
