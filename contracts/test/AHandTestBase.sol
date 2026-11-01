// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test, Vm} from "forge-std/Test.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Give, Hop, IAHandFacts, RaiseParams, Shake, Status, Terminal, Visibility} from "../src/AHandTypes.sol";
import {AHandSig} from "../src/AHandSig.sol";
import {AHandMath, AHandSettlement} from "../src/AHandFacts.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {Token18} from "./mocks/DecimalsTokens.sol";
import {SmartWallet1271} from "./mocks/SmartWallet1271.sol";
import {SafeLikeSigner} from "./mocks/SafeLikeSigner.sol";
import {FiatTokenLikeV1, FiatTokenLikeProxy} from "./mocks/FiatTokenLike.sol";

/// @dev The faucet surface every token mock shares (mint, approve, balanceOf).
interface IFaucetToken {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/*//////////////////////////////////////////////////////////////
        BASE: actors, capability keys, raise / route / terminal builders,
        EIP-712 signing, settlement-preimage rebuild, gas measurement
//////////////////////////////////////////////////////////////*/

/// @notice Shared fixture for every AHand.*.t.sol suite. Deploys the canonical
///         stack (MockUSD 6 dec as the default Hand token, Token18 as a second
///         asset, one Core seeded with one charity) and provides builders so suites
///         assert protocol behaviour, not plumbing. Every route builder is bound to
///         a Core, so secondary Cores (other tokens, fork-safety, cross-Core replay)
///         use the same helpers.
contract AHandTestBase is Test {
    AHandCore core;
    MockUSD usd;
    Token18 t18;
    /// @dev The token `defaultParams()` escrows; `useToken` swaps it.
    address token;

    address raiser = makeAddr("raiser");
    address charity = makeAddr("charity");
    address policyAdmin = makeAddr("policyAdmin");
    address stranger = makeAddr("stranger");

    /// Capability keys for the delegation chain: root E0, children E1..E5.
    uint256 constant E0 = 0xE0aa;
    uint256 constant E1 = 0xE1aa;
    uint256 constant E2 = 0xE2aa;
    uint256 constant E3 = 0xE3aa;
    uint256 constant E4 = 0xE4aa;
    uint256 constant E5 = 0xE5aa;

    /// Attributed accounts that co-sign acceptances.
    uint256 constant SHAKER_A_PK = 0x5Aaa;
    uint256 constant SHAKER_B_PK = 0x5Baa;
    uint256 constant GIVER_PK = 0x61aa;
    address shakerA;
    address shakerB;
    address giver;

    uint256 constant DEPOSIT = 100e6; // 100.000000 in 6-dec units
    bytes constant DEFAULT_REF = "aHand:discovery"; // any 1..128 bytes
    bytes32 constant DEFAULT_SOLUTION = keccak256("solution");

    function setUp() public virtual {
        shakerA = vm.addr(SHAKER_A_PK);
        shakerB = vm.addr(SHAKER_B_PK);
        giver = vm.addr(GIVER_PK);
        vm.label(shakerA, "shakerA");
        vm.label(shakerB, "shakerB");
        vm.label(giver, "giver");

        usd = new MockUSD();
        t18 = new Token18();
        token = address(usd);
        core = deployCore(charity, policyAdmin);

        fund(address(usd), raiser, 1_000_000e6);
        fund(address(t18), raiser, 1_000_000 ether);
    }

    /*//////////////////// deployment ////////////////////*/

    /// @dev A Core seeded with `charities` under `admin`.
    function deployCore(address[] memory charities, address admin) internal returns (AHandCore) {
        return new AHandCore(charities, admin);
    }

    /// @dev A Core seeded with one charity.
    function deployCore(address charity_, address admin) internal returns (AHandCore) {
        address[] memory charities = new address[](1);
        charities[0] = charity_;
        return deployCore(charities, admin);
    }

    /// @dev Mint `amount` of a faucet token to `who` and approve the default Core for it.
    function fund(address token_, address who, uint256 amount) internal {
        fundFor(core, token_, who, amount);
    }

    /// @dev Same, approving Core `c`.
    function fundFor(AHandCore c, address token_, address who, uint256 amount) internal {
        IFaucetToken(token_).mint(who, amount);
        vm.prank(who);
        IFaucetToken(token_).approve(address(c), type(uint256).max);
    }

    /// @dev Make `token_` the token `defaultParams()` escrows (funding is the caller's job).
    function useToken(address token_) internal {
        token = token_;
    }

    /// @dev A FiatToken-shaped USDC behind a delegating proxy, owned by this test
    ///      (so it can mint, pause, blacklist). Returned through the implementation ABI.
    function deployFiatToken() internal returns (FiatTokenLikeV1 usdc) {
        FiatTokenLikeV1 implementation = new FiatTokenLikeV1();
        usdc = FiatTokenLikeV1(address(new FiatTokenLikeProxy(address(implementation))));
        usdc.initialize(address(this));
    }

    /// @dev An honest ERC-1271 wallet whose owner key is `ownerPk`.
    function newSmartWallet(uint256 ownerPk) internal returns (SmartWallet1271) {
        return new SmartWallet1271(vm.addr(ownerPk));
    }

    /// @dev A Safe-shaped signer owned by `ownerPk`; consent by `safeApprove` + empty bytes.
    function newSafe(uint256 ownerPk) internal returns (SafeLikeSigner) {
        return new SafeLikeSigner(vm.addr(ownerPk));
    }

    /// @dev Pre-approve an aHand `digest` on-chain in a Safe-like signer (irrevocable).
    function safeApprove(SafeLikeSigner safe, uint256 ownerPk, bytes32 digest) internal {
        vm.prank(vm.addr(ownerPk));
        safe.signMessage(digest);
    }

    /*//////////////////// raise ////////////////////*/

    /// @dev Canonical valid params: the active token, DEPOSIT, Public, 10 % charity,
    ///      50 % giver floor, 30 days, root E0.
    function defaultParams() internal view returns (RaiseParams memory) {
        return RaiseParams({
            token: token,
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

    /// @dev Default params with no donation (0 %, zero recipient).
    function noCharityParams() internal view returns (RaiseParams memory p) {
        p = defaultParams();
        p.charityBps = 0;
        p.charityRecipient = address(0);
    }

    /// @dev Default params for a zero-pot Hand (no token, no amount, no donation).
    function zeroPotParams() internal view returns (RaiseParams memory p) {
        p = noCharityParams();
        p.token = address(0);
        p.amount = 0;
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
        return makeRaiseAs(raiser, core, p, discoveryRef, tags);
    }

    /// @dev Raise as `who` on Core `c`.
    function makeRaiseAs(address who, AHandCore c, RaiseParams memory p, bytes memory discoveryRef, bytes32[] memory tags)
        internal
        returns (uint256 handId)
    {
        vm.prank(who);
        handId = c.raise(p, discoveryRef, tags);
    }

    function expectRaiseRevert(bytes4 selector, RaiseParams memory p) internal {
        expectRaiseRevert(selector, p, DEFAULT_REF, noTags());
    }

    function expectRaiseRevert(bytes4 selector, RaiseParams memory p, bytes memory discoveryRef, bytes32[] memory tags)
        internal
    {
        vm.prank(raiser);
        vm.expectRevert(selector);
        core.raise(p, discoveryRef, tags);
    }

    /*//////////////////// EIP-712 signing ////////////////////*/

    /// @dev The library mirror of a Core's domain (name "aHand", version "3").
    function domainSeparatorOf(AHandCore c) internal view returns (bytes32) {
        return AHandSig.domainSeparator(address(c));
    }

    /// @dev The signing digest of `structHash` under the default Core's live domain.
    function digestOf(bytes32 structHash) internal view returns (bytes32) {
        return digestOn(core, structHash);
    }

    /// @dev The signing digest of `structHash` under Core `c`'s live domain.
    function digestOn(AHandCore c, bytes32 structHash) internal view returns (bytes32) {
        return AHandSig.digest(c.DOMAIN_SEPARATOR(), structHash);
    }

    /// @dev 65-byte ECDSA signature (r ‖ s ‖ v) of an arbitrary digest by `pk`.
    function signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev EIP-712 signature over `structHash` under the default Core's domain.
    function signStruct(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        return signStructWithDomain(pk, core.DOMAIN_SEPARATOR(), structHash);
    }

    /// @dev Same under Core `c`'s domain.
    function signStructOn(AHandCore c, uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        return signStructWithDomain(pk, c.DOMAIN_SEPARATOR(), structHash);
    }

    /// @dev Same under an arbitrary domain separator (fork-safety suites sign with stale ones).
    function signStructWithDomain(uint256 pk, bytes32 ds, bytes32 structHash) internal pure returns (bytes memory) {
        return signDigest(pk, AHandSig.digest(ds, structHash));
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

    /// @dev A growable route bound to one Core and one Hand. `parentPk` is the key
    ///      that produces bytes the tail capability accepts (its own key for an EOA,
    ///      the owner key for a SmartWallet1271); `parentCap` is the tail capability
    ///      address; `claim` is the claim the tail carries (10 000 before any hop).
    struct RouteBuild {
        AHandCore core;
        uint256 handId;
        Hop[] hops;
        uint256 parentPk;
        address parentCap;
        uint16 claim;
    }

    /// @dev A fresh route on the default Core, rooted at E0.
    function newRoute(uint256 handId) internal view returns (RouteBuild memory r) {
        return newRouteOn(core, handId, E0);
    }

    /// @dev A fresh route on Core `c`, rooted at `rootPk` (the Hand's rootCapability key).
    function newRouteOn(AHandCore c, uint256 handId, uint256 rootPk) internal pure returns (RouteBuild memory r) {
        r.core = c;
        r.handId = handId;
        r.hops = new Hop[](0);
        r.parentPk = rootPk;
        r.parentCap = vm.addr(rootPk);
        r.claim = 10_000;
    }

    /// @dev Full-control hop append: the child capability is an arbitrary address
    ///      whose future artifacts `childSignerPk` signs (its own key for an EOA, the
    ///      owner key for a contract wallet). `shakerPk == 0` leaves the acceptance
    ///      empty (anonymous, self, or a contract shaker that accepts empty bytes).
    function addHopTo(
        RouteBuild memory r,
        address childCap,
        uint256 childSignerPk,
        address shaker,
        uint256 shakerPk,
        uint16 childClaim,
        bytes32 hopDataHash,
        uint40 deadline
    ) internal view {
        Shake memory s = Shake({
            handId: r.handId,
            childCapability: childCap,
            shaker: shaker,
            parentClaimBps: r.claim,
            childClaimBps: childClaim,
            hopDataHash: hopDataHash,
            deadline: deadline
        });
        bytes32 shakeHash = AHandSig.hashShake(s);
        bytes memory acceptance;
        if (shakerPk != 0) {
            acceptance = signStructOn(r.core, shakerPk, AHandSig.hashShakerAcceptance(shakeHash));
        }
        addRawHop(r, Hop({shake: s, capabilitySig: signStructOn(r.core, r.parentPk, shakeHash), shakerAcceptanceSig: acceptance}));
        r.parentPk = childSignerPk;
        r.parentCap = childCap;
    }

    /// @dev Append an already-built hop (any bytes) and advance the tail claim only;
    ///      the caller keeps `parentPk` / `parentCap` in step when it needs them.
    function addRawHop(RouteBuild memory r, Hop memory hop) internal pure {
        r.hops = _pushHop(r.hops, hop);
        r.claim = hop.shake.childClaimBps;
    }

    /// @dev Key-based hop: child capability = vm.addr(childPk).
    function addHop(
        RouteBuild memory r,
        uint256 childPk,
        address shaker,
        uint256 shakerPk,
        uint16 childClaim,
        uint40 deadline
    ) internal view {
        addHopTo(r, vm.addr(childPk), childPk, shaker, shakerPk, childClaim, bytes32(0), deadline);
    }

    /// @dev Anonymous hop: zero shaker, no acceptance. Zero margin only, by protocol law.
    function addAnonymousHop(RouteBuild memory r, uint256 childPk, uint16 childClaim) internal view {
        addHop(r, childPk, address(0), 0, childClaim, defaultDeadline());
    }

    /// @dev Self-attributed hop: shaker == the capability that signs this Shake.
    function addSelfHop(RouteBuild memory r, uint256 childPk, uint16 childClaim) internal view {
        addHop(r, childPk, r.parentCap, 0, childClaim, defaultDeadline());
    }

    /// @dev Explicit distinct shaker: acceptance co-signed by `shakerPk`.
    function addExplicitHop(RouteBuild memory r, uint256 childPk, address shaker, uint256 shakerPk, uint16 childClaim)
        internal
        view
    {
        addHop(r, childPk, shaker, shakerPk, childClaim, defaultDeadline());
    }

    /// @dev hashStruct(Shake) of every hop, route order.
    function shakeHashesOf(RouteBuild memory r) internal pure returns (bytes32[] memory hashes) {
        hashes = new bytes32[](r.hops.length);
        for (uint256 i; i < r.hops.length; ++i) {
            hashes[i] = AHandSig.hashShake(r.hops[i].shake);
        }
    }

    /// @dev The route identity — byte-matches the Core's computation.
    function routeHashOf(RouteBuild memory r) internal view returns (bytes32) {
        return AHandSig.hashRoute(AHandSig.handRef(address(r.core), r.handId), shakeHashesOf(r));
    }

    /*//////////////////// terminal + thank ////////////////////*/

    /// @dev Give bound to the built route, signed by the tail capability key; the
    ///      giver's acceptance by `giverPk` (0 leaves it empty for contract givers
    ///      that accept empty bytes).
    function buildTerminal(RouteBuild memory r, address giver_, uint256 giverPk, bytes32 solutionHash, uint40 deadline)
        internal
        view
        returns (Terminal memory t)
    {
        t.give = Give({
            handId: r.handId,
            routeHash: routeHashOf(r),
            giver: giver_,
            solutionHash: solutionHash,
            finalClaimBps: r.claim,
            deadline: deadline
        });
        bytes32 giveHash = AHandSig.hashGive(t.give);
        t.capabilitySig = signStructOn(r.core, r.parentPk, giveHash);
        if (giverPk != 0) t.giverAcceptanceSig = signStructOn(r.core, giverPk, AHandSig.hashGiverAcceptance(giveHash));
    }

    /// @dev Terminal to the default giver with the default solution and deadline.
    function buildTerminal(RouteBuild memory r) internal view returns (Terminal memory) {
        return buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, defaultDeadline());
    }

    /// @dev `thank` by the raiser on the route's Core.
    function doThank(RouteBuild memory r, Terminal memory t) internal {
        doThankAs(raiser, r, t);
    }

    /// @dev `thank` by `who` on the route's Core.
    function doThankAs(address who, RouteBuild memory r, Terminal memory t) internal {
        vm.prank(who);
        r.core.thank(r.handId, r.hops, t);
    }

    /// @dev `thank` by the raiser expecting `revertData` (abi-encoded error, args included).
    function expectThankRevert(bytes memory revertData, RouteBuild memory r, Terminal memory t) internal {
        vm.prank(raiser);
        vm.expectRevert(revertData);
        r.core.thank(r.handId, r.hops, t);
    }

    /// @dev The abi-encoded revert data of an argument-less protocol error.
    function err(bytes4 selector) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(selector);
    }

    /// @dev The abi-encoded revert data of a hop-indexed protocol error (`hops.length` names the Give).
    function err(bytes4 selector, uint256 position) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(selector, position);
    }

    /// @dev The transient lock's revert data.
    function locked() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
    }

    /// @dev Full consensual settlement of the built route to the default giver.
    function settle(RouteBuild memory r) internal returns (Terminal memory t) {
        t = buildTerminal(r);
        doThank(r, t);
    }

    /// @dev Smoke settlement: one zero-margin self hop E0 → E1; the giver takes the
    ///      whole distributable pool.
    function settleSimple(uint256 handId) internal returns (RouteBuild memory r, Terminal memory t) {
        r = newRoute(handId);
        addSelfHop(r, E1, 10_000);
        t = settle(r);
    }

    /*//////////////////// settlement preimage ////////////////////*/

    /// @dev The preimage a correct thank of `r` with `t` commits at `closedAt`,
    ///      computed from the Hand's facts and the route — the expected value.
    function preimageOf(RouteBuild memory r, Terminal memory t, uint40 closedAt)
        internal
        view
        returns (AHandSettlement.SettlementPreimage memory p)
    {
        IAHandFacts.HandFacts memory f = r.core.facts(r.handId);
        uint256 n = r.hops.length;
        p.handId = r.handId;
        p.raiser = f.raiser;
        p.giver = t.give.giver;
        p.token = f.token;
        p.charityRecipient = f.charityRecipient;
        p.pool = f.pool;
        p.charityAllocation = AHandMath.cut(f.pool, f.charityBps);
        uint256 distributable = f.pool - p.charityAllocation;
        p.routeHash = routeHashOf(r);
        p.giveHash = AHandSig.hashGive(t.give);
        p.solutionHash = t.give.solutionHash;
        p.closedAt = closedAt;
        p.occShakers = new address[](n);
        p.occClaimDeltas = new uint16[](n);
        p.occAllocations = new uint256[](n);
        uint256 marginTotal;
        for (uint256 i; i < n; ++i) {
            Shake memory s = r.hops[i].shake;
            uint16 margin = s.parentClaimBps - s.childClaimBps;
            p.occShakers[i] = s.shaker;
            p.occClaimDeltas[i] = margin;
            p.occAllocations[i] = margin == 0 ? 0 : AHandMath.cut(distributable, margin);
            marginTotal += p.occAllocations[i];
        }
        p.giverAllocation = distributable - marginTotal;
    }

    /// @dev Rebuild the preimage of `handId` from recorded logs (`vm.recordLogs()`
    ///      before the thank, `vm.getRecordedLogs()` after): the `Settled` event plus
    ///      its `RouteHopSettled` events, exactly as an indexer or Signals v2 would.
    function preimageFromLogs(Vm.Log[] memory logs, uint256 handId)
        internal
        pure
        returns (AHandSettlement.SettlementPreimage memory p)
    {
        bytes32 settledSig = AHandCore.Settled.selector;
        bytes32 hopSig = AHandCore.RouteHopSettled.selector;
        bytes32 id = bytes32(handId);
        p.handId = handId;
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (log.topics.length < 2 || log.topics[1] != id) continue;
            if (log.topics[0] == settledSig) {
                // Settled carries no raiser (a Raise-time fact): preimageFromLogsOn fills it from facts()
                p.giver = address(uint160(uint256(log.topics[2])));
                uint256 hopCount;
                (
                    p.token,
                    p.pool,
                    p.charityRecipient,
                    p.charityAllocation,
                    ,
                    p.giverAllocation,
                    p.routeHash,
                    p.giveHash,
                    p.solutionHash,
                    ,
                    hopCount,
                    p.closedAt
                ) = abi.decode(
                    log.data,
                    (address, uint256, address, uint256, uint256, uint256, bytes32, bytes32, bytes32, bytes32, uint256, uint40)
                );
                p.occShakers = new address[](hopCount);
                p.occClaimDeltas = new uint16[](hopCount);
                p.occAllocations = new uint256[](hopCount);
                found = true;
            } else if (log.topics[0] == hopSig) {
                require(found, "RouteHopSettled before Settled");
                (uint256 position,,, uint16 parentClaimBps, uint16 childClaimBps, address shaker,,, uint256 allocation) =
                    abi.decode(log.data, (uint256, address, address, uint16, uint16, address, bytes32, bytes32, uint256));
                p.occShakers[position] = shaker;
                p.occClaimDeltas[position] = parentClaimBps - childClaimBps;
                p.occAllocations[position] = allocation;
            }
        }
        require(found, "no Settled log for handId");
    }

    /// @dev `preimageFromLogs` completed with the Hand's raiser from `facts` (the only
    ///      preimage field the settlement events do not carry).
    function preimageFromLogsOn(AHandCore c, Vm.Log[] memory logs, uint256 handId)
        internal
        view
        returns (AHandSettlement.SettlementPreimage memory p)
    {
        p = preimageFromLogs(logs, handId);
        p.raiser = c.facts(handId).raiser;
    }

    /// @dev The commitment of `p` under the default Core.
    function settlementHashOf(AHandSettlement.SettlementPreimage memory p) internal view returns (bytes32) {
        return settlementHashOn(core, p);
    }

    /// @dev The commitment of `p` under Core `c`.
    function settlementHashOn(AHandCore c, AHandSettlement.SettlementPreimage memory p)
        internal
        view
        returns (bytes32)
    {
        return AHandSettlement.commitment(address(c), p);
    }

    /*//////////////////// money helpers ////////////////////*/

    /// @dev The exact split a thank of `handId` with route margins `margins` pays:
    ///      C from P, each A_i from D, G = D − Σ A_i.
    function expectedSplit(uint256 handId, uint16[] memory margins)
        internal
        view
        returns (uint256 charityAllocation, uint256 distributable, uint256[] memory allocations, uint256 residual)
    {
        IAHandFacts.HandFacts memory f = core.facts(handId);
        charityAllocation = AHandMath.cut(f.pool, f.charityBps);
        distributable = f.pool - charityAllocation;
        allocations = new uint256[](margins.length);
        residual = distributable;
        for (uint256 i; i < margins.length; ++i) {
            allocations[i] = margins[i] == 0 ? 0 : AHandMath.cut(distributable, margins[i]);
            residual -= allocations[i];
        }
    }

    function balanceOf(address token_, address who) internal view returns (uint256) {
        return IFaucetToken(token_).balanceOf(who);
    }

    function claimOf(address token_, address who) internal view returns (uint256) {
        return core.claims(token_, who);
    }

    /*//////////////////// gas measurement ////////////////////*/

    /// @dev Gas consumed by the most recent external call made by this test.
    function gasOfLastCall() internal view returns (uint256) {
        return vm.lastFrameGas().gasTotalUsed;
    }

    /// @dev `thank` by the raiser, returning the gas the call consumed.
    function measureThank(RouteBuild memory r, Terminal memory t) internal returns (uint256 gasUsed) {
        doThank(r, t);
        gasUsed = gasOfLastCall();
    }

    /// @dev `reclaim` by `who`, returning the gas the call consumed.
    function measureReclaim(AHandCore c, address who, uint256 handId) internal returns (uint256 gasUsed) {
        vm.prank(who);
        c.reclaim(handId);
        gasUsed = gasOfLastCall();
    }

    /*//////////////////// small utilities ////////////////////*/

    function defaultDeadline() internal view returns (uint40) {
        return uint40(block.timestamp + 1 days);
    }

    /// @dev Jump to the Hand's expiry (the first reclaimable second).
    function warpToExpiry(uint256 handId) internal {
        vm.warp(core.facts(handId).expiry);
    }

    function statusOf(uint256 handId) internal view returns (Status) {
        return core.facts(handId).status;
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

    function _pushHop(Hop[] memory arr, Hop memory hop) internal pure returns (Hop[] memory out) {
        out = new Hop[](arr.length + 1);
        for (uint256 i; i < arr.length; ++i) {
            out[i] = arr[i];
        }
        out[arr.length] = hop;
    }

    /*//////////////////// runtime bytecode (I-18 static gates) ////////////////////*/

    /// @dev Length of `code` without its trailing CBOR metadata (whose last two bytes hold its length).
    function runtimeEnd(bytes memory code) internal pure returns (uint256 end) {
        end = code.length;
        if (end >= 2) {
            uint256 metaLen = (uint256(uint8(code[end - 2])) << 8) | uint256(uint8(code[end - 1]));
            if (metaLen + 2 <= end) end -= metaLen + 2;
        }
    }

    /// @dev Occurrences of opcode `op` in the runtime `code`: a linear walk that skips
    ///      PUSH immediates and the metadata, so every byte counted is an instruction.
    function opcodeCount(bytes memory code, uint8 op) internal pure returns (uint256 n) {
        uint256 end = runtimeEnd(code);
        uint256 i;
        while (i < end) {
            uint8 current = uint8(code[i]);
            if (current == op) ++n;
            i += (current >= 0x60 && current <= 0x7f) ? 1 + (current - 0x5f) : 1;
        }
    }
}
