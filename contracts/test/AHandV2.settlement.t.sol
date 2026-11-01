// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {AHandTestBase, IFaucetToken} from "./AHandTestBase.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSig} from "../src/AHandSig.sol";
import {AHandMath, AHandSettlement} from "../src/AHandFacts.sol";
import {
    AllocationKind,
    AnonymousShakerWithMargin,
    ClaimMismatch,
    HandExpired,
    Hop,
    IAHandFacts,
    InsufficientGas,
    MarginRoundsToZero,
    NotActive,
    OnlySelf,
    RaiseParams,
    Shake,
    Status,
    Terminal,
    TransferInexact,
    Visibility
} from "../src/AHandTypes.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {PausableToken} from "./mocks/PausableToken.sol";
import {LateSenderFeeToken} from "./mocks/FeeTokens.sol";
import {GasHogToken} from "./mocks/GasHogToken.sol";
import {HookToken, IHookRecipient} from "./mocks/HookToken.sol";
import {GasHogRecipient, PartialReturnRecipient} from "./mocks/HookRecipients.sol";
import {ReturndataBombToken} from "./mocks/ReturndataBombToken.sol";
import {TransferThenFalseToken} from "./mocks/ReturnShapeTokens.sol";
import {FiatTokenLikeV1} from "./mocks/FiatTokenLike.sol";
import {SmartWallet1271} from "./mocks/SmartWallet1271.sol";
import {AlwaysValid1271} from "./mocks/Signers1271.sol";
import {PushExactCaller} from "./mocks/PushExactCaller.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: settlement — thank, the split, the pushes, the commitment.
        DESIGN §5.2 (arithmetic), §5.3 (delivery), §7 (phases), I-3, I-4,
        I-7, I-8, I-9, I-16, I-23, I-24, I-27; plus the D3 / §17.2 gas series
        (test_gas_*), one line per case appended to ${OUT}/gas-series.txt.
//////////////////////////////////////////////////////////////*/

/*//////////////////// suite-local recipients ////////////////////*/

/// @dev A hook recipient that records the gas it sees inside the push frame and
///      accepts any signature, so it can be the giver of a zero-shake route.
contract GasProbeRecipient is IHookRecipient, AlwaysValid1271 {
    uint256 public observedGas;

    function onTokenReceived(address, uint256) external {
        observedGas = gasleft();
    }
}

/// @dev A hook recipient that does nothing: the honest hook-token push.
contract NoopHookRecipient is IHookRecipient {
    function onTokenReceived(address, uint256) external {}
}

/// @dev A hook recipient that, inside the push frame, reads the Hand's facts and
///      tries to re-enter two entry points; it records what it saw and swallows the
///      failures so its own push still lands (I-16, I-17).
contract SettledStateObserver is IHookRecipient {
    AHandCore public immutable core;
    uint256 public handId;
    Status public seenStatus;
    bytes32 public seenSettlementHash;
    uint40 public seenClosedAt;
    bytes4 public withdrawError;
    bytes4 public reclaimError;

    constructor(AHandCore core_) {
        core = core_;
    }

    function setHand(uint256 handId_) external {
        handId = handId_;
    }

    function onTokenReceived(address, uint256) external {
        IAHandFacts.HandFacts memory f = core.facts(handId);
        seenStatus = f.status;
        seenSettlementHash = f.settlementHash;
        seenClosedAt = f.closedAt;
        try core.withdraw(msg.sender, address(this)) {}
        catch (bytes memory err) {
            withdrawError = bytes4(err);
        }
        try core.reclaim(handId) {}
        catch (bytes memory err) {
            reclaimError = bytes4(err);
        }
    }
}

contract AHandV2SettlementTest is AHandTestBase {
    /*//////////////////// fixtures ////////////////////*/

    /// @dev The secp256k1 group order; generated keys stay inside (0, n).
    uint256 constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    /// @dev A keyed raiser for the raiser == giver case.
    uint256 constant KEYED_RAISER_PK = 0x6Baa;
    /// @dev Where the gas series lands unless OUT says otherwise: a build artifact under
    ///      `out/` (gitignored, wiped by `forge clean`), the one path foundry.toml grants it.
    string constant DEFAULT_OUT = "out/gas";

    enum Signer {
        EOA,
        ERC1271
    }

    enum Delivery {
        Pushed,
        Deferred
    }

    enum Recipients {
        Fresh,
        Existing,
        Duplicate
    }

    struct Payout {
        address beneficiary;
        uint8 kind;
        uint256 position;
        uint256 amount;
    }

    struct SettledLog {
        address giver;
        address token;
        uint256 pool;
        address charityRecipient;
        uint256 charityAllocation;
        uint256 distributable;
        uint256 giverAllocation;
        bytes32 routeHash;
        bytes32 giveHash;
        bytes32 solutionHash;
        bytes32 settlementHash;
        uint256 hopCount;
        uint40 closedAt;
    }

    struct HopLog {
        uint256 position;
        address parentCapability;
        address childCapability;
        uint16 parentClaimBps;
        uint16 childClaimBps;
        address shaker;
        bytes32 shakeHash;
        bytes32 hopDataHash;
        uint256 marginAllocation;
    }

    string gasSeriesDir;
    string gasSeriesPath;

    function setUp() public override {
        super.setUp();
        gasSeriesDir = vm.envOr("OUT", DEFAULT_OUT);
        gasSeriesPath = string.concat(gasSeriesDir, "/gas-series.txt");
    }

    /// @dev Deterministic capability key `i` (key 0 is a route's root).
    function capKey(uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("aHand.test.capability", i))) % (SECP256K1_N - 1) + 1;
    }

    /// @dev Deterministic explicit-shaker key `i`.
    function shakerKey(uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("aHand.test.shaker", i))) % (SECP256K1_N - 1) + 1;
    }

    /// @dev A route with its `n` hop slots preallocated. The base's append builder
    ///      reallocates the array per hop (quadratic memory), which a 257-hop route
    ///      cannot afford twice in one test; `putHop` fills slot `i` in place.
    function newLongRoute(uint256 handId, uint256 rootPk, uint256 n) internal view returns (RouteBuild memory r) {
        r = newRouteOn(core, handId, rootPk);
        r.hops = new Hop[](n);
    }

    /// @dev Fill hop `i` of a preallocated route: same semantics as the base's
    ///      `addHopTo` (zero `shakerPk` leaves the acceptance empty; the tail advances).
    function putHop(
        RouteBuild memory r,
        uint256 i,
        address childCap,
        uint256 childSignerPk,
        address shaker,
        uint256 shakerPk,
        uint16 childClaim
    ) internal view {
        Shake memory s = Shake({
            handId: r.handId,
            childCapability: childCap,
            shaker: shaker,
            parentClaimBps: r.claim,
            childClaimBps: childClaim,
            hopDataHash: bytes32(0),
            deadline: defaultDeadline()
        });
        bytes32 shakeHash = AHandSig.hashShake(s);
        bytes memory acceptance;
        if (shakerPk != 0) {
            acceptance = signStructOn(r.core, shakerPk, AHandSig.hashShakerAcceptance(shakeHash));
        }
        r.hops[i] = Hop({shake: s, capabilitySig: signStructOn(r.core, r.parentPk, shakeHash), shakerAcceptanceSig: acceptance});
        r.parentPk = childSignerPk;
        r.parentCap = childCap;
        r.claim = childClaim;
    }

    /// @dev Self-attributed hop `i` (shaker = the signing capability), key-addressed child.
    function putSelfHop(RouteBuild memory r, uint256 i, uint256 childPk, uint16 childClaim) internal view {
        putHop(r, i, vm.addr(childPk), childPk, r.parentCap, 0, childClaim);
    }

    /// @dev Anonymous hop `i` (zero shaker, zero margin only), key-addressed child.
    function putAnonymousHop(RouteBuild memory r, uint256 i, uint256 childPk, uint16 childClaim) internal view {
        putHop(r, i, vm.addr(childPk), childPk, address(0), 0, childClaim);
    }

    /*//////////////////// log decoding ////////////////////*/

    function decodePayout(Vm.Log memory log) internal pure returns (Payout memory q) {
        q.beneficiary = address(uint160(uint256(log.topics[3])));
        (q.kind, q.position, q.amount) = abi.decode(log.data, (uint8, uint256, uint256));
    }

    function decodeSettled(Vm.Log memory log) internal pure returns (SettledLog memory s) {
        s.giver = address(uint160(uint256(log.topics[2])));
        (
            s.token,
            s.pool,
            s.charityRecipient,
            s.charityAllocation,
            s.distributable,
            s.giverAllocation,
            s.routeHash,
            s.giveHash,
            s.solutionHash,
            s.settlementHash,
            s.hopCount,
            s.closedAt
        ) = abi.decode(
            log.data, (address, uint256, address, uint256, uint256, uint256, bytes32, bytes32, bytes32, bytes32, uint256, uint40)
        );
    }

    function decodeHop(Vm.Log memory log) internal pure returns (HopLog memory x) {
        (
            x.position,
            x.parentCapability,
            x.childCapability,
            x.parentClaimBps,
            x.childClaimBps,
            x.shaker,
            x.shakeHash,
            x.hopDataHash,
            x.marginAllocation
        ) = abi.decode(log.data, (uint256, address, address, uint16, uint16, address, bytes32, bytes32, uint256));
    }

    function assertPayout(Payout memory q, address beneficiary, AllocationKind kind, uint256 position, uint256 amount)
        internal
        pure
    {
        assertEq(q.beneficiary, beneficiary, "payout beneficiary");
        assertEq(q.kind, uint8(kind), "payout kind");
        assertEq(q.position, position, "payout position");
        assertEq(q.amount, amount, "payout amount");
    }

    /// @dev Where `checkPayoutStream` is in the log stream: indices of the ordering
    ///      landmarks and the running sums (a memory struct keeps the walk under the
    ///      via-IR stack limit).
    struct StreamCursor {
        uint256 nextAllocated;
        uint256 nextOutcome;
        uint256 sum;
        uint256 lastFact;
        uint256 lastAllocated;
        uint256 firstAllocated;
        uint256 firstOutcome;
    }

    /// @dev I-8 / §11: every Core payout log of one transaction. Checks the frozen
    ///      order (facts → PayoutAllocated × k → one Pushed|Deferred per allocation,
    ///      same (beneficiary, kind, position, amount), same order) and that the
    ///      allocations sum to `pool`. Returns the allocations and a pushed flag each.
    function checkPayoutStream(Vm.Log[] memory logs, address emitter, uint256 pool)
        internal
        pure
        returns (Payout[] memory allocated, bool[] memory pushed)
    {
        uint256 nAllocated = countLogs(logs, emitter, AHandCore.PayoutAllocated.selector);
        uint256 nOutcomes = countLogs(logs, emitter, AHandCore.PayoutPushed.selector)
            + countLogs(logs, emitter, AHandCore.PayoutDeferred.selector);
        assertEq(nOutcomes, nAllocated, "exactly one Pushed|Deferred per PayoutAllocated");
        allocated = new Payout[](nAllocated);
        pushed = new bool[](nAllocated);

        StreamCursor memory c;
        c.firstAllocated = type(uint256).max;
        c.firstOutcome = type(uint256).max;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != emitter) continue;
            bytes32 sig = logs[i].topics[0];
            if (sig == AHandCore.Settled.selector || sig == AHandCore.RouteHopSettled.selector) {
                c.lastFact = i;
            } else if (sig == AHandCore.PayoutAllocated.selector) {
                allocated[c.nextAllocated] = decodePayout(logs[i]);
                c.sum += allocated[c.nextAllocated].amount;
                ++c.nextAllocated;
                if (c.firstAllocated == type(uint256).max) c.firstAllocated = i;
                c.lastAllocated = i;
            } else if (sig == AHandCore.PayoutPushed.selector || sig == AHandCore.PayoutDeferred.selector) {
                Payout memory expected = allocated[c.nextOutcome];
                assertPayout(
                    decodePayout(logs[i]), expected.beneficiary, AllocationKind(expected.kind), expected.position, expected.amount
                );
                pushed[c.nextOutcome] = sig == AHandCore.PayoutPushed.selector;
                ++c.nextOutcome;
                if (c.firstOutcome == type(uint256).max) c.firstOutcome = i;
            }
        }
        if (nAllocated != 0) {
            assertLt(c.lastFact, c.firstAllocated, "every fact event precedes the first PayoutAllocated");
            assertLt(c.lastAllocated, c.firstOutcome, "every PayoutAllocated precedes the first push outcome");
        }
        assertEq(c.sum, pool, "sum of PayoutAllocated == pool");
    }

    function countLogs(Vm.Log[] memory logs, address emitter, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == sig) ++n;
        }
    }

    /*//////////////////////////////////////////////////////////////
                    §5.2 — arithmetic: conservation, rounding, floors
    //////////////////////////////////////////////////////////////*/

    /// 20.00 USDC, 10 % charity, claims 10000 → 9500 → 9500 → 9000: charity 2.00,
    /// margins 0.90 / 0 / 0.90, giver 16.20. The v1 golden fixture re-cut on the v2
    /// events: Settled, three RouteHopSettled, four PayoutAllocated, then four
    /// (Transfer, PayoutPushed) pairs in the same order.
    function test_Golden_TwentyDollarFixture() public {
        RaiseParams memory p = defaultParams();
        p.amount = 20e6;
        uint256 h = makeRaise(p);

        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_500); // margin 500 → 0.90
        addSelfHop(r, E2, 9_500); // zero margin, shaker = E1
        addExplicitHop(r, E3, shakerB, SHAKER_B_PK, 9_000); // margin 500 → 0.90

        vm.recordLogs();
        Terminal memory t = settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // money
        assertEq(balanceOf(token, charity), 2_000_000, "charity 2.00");
        assertEq(balanceOf(token, shakerA), 900_000, "hop 0 margin 0.90");
        assertEq(balanceOf(token, vm.addr(E1)), 0, "zero-margin hop pays nothing");
        assertEq(balanceOf(token, shakerB), 900_000, "hop 2 margin 0.90");
        assertEq(balanceOf(token, giver), 16_200_000, "giver 16.20");
        assertEq(balanceOf(token, address(core)), 0, "custody empty: nothing deferred");
        uint16[] memory margins = new uint16[](3);
        margins[0] = 500;
        margins[2] = 500;
        (uint256 C, uint256 D, uint256[] memory A, uint256 G) = expectedSplit(h, margins);
        assertEq(C, 2_000_000);
        assertEq(D, 18_000_000);
        assertEq(A[0] + A[1] + A[2], 1_800_000);
        assertEq(G, 16_200_000);

        // event skeleton: 1 + 3 + 4 fact/grant logs, then 4 × (Transfer, PayoutPushed)
        assertEq(logs.length, 16, "8 fact logs + 4 push pairs");
        assertEq(logs[0].topics[0], AHandCore.Settled.selector);
        for (uint256 i = 1; i <= 3; ++i) {
            assertEq(logs[i].topics[0], AHandCore.RouteHopSettled.selector, "hops in route order");
        }
        for (uint256 i = 4; i <= 7; ++i) {
            assertEq(logs[i].topics[0], AHandCore.PayoutAllocated.selector, "grant ledger after the facts");
        }
        for (uint256 i = 8; i < 16; i += 2) {
            assertEq(logs[i].emitter, token, "token Transfer inside the frame");
            assertEq(logs[i].topics[0], keccak256("Transfer(address,address,uint256)"));
            assertEq(logs[i + 1].topics[0], AHandCore.PayoutPushed.selector, "PayoutPushed follows its Transfer");
        }

        // Settled carries the split and every identity
        SettledLog memory s = decodeSettled(logs[0]);
        assertEq(uint256(logs[0].topics[1]), h);
        assertEq(s.giver, giver);
        assertEq(s.token, token);
        assertEq(s.pool, 20e6);
        assertEq(s.charityRecipient, charity);
        assertEq(s.charityAllocation, 2_000_000);
        assertEq(s.distributable, 18_000_000);
        assertEq(s.giverAllocation, 16_200_000);
        assertEq(s.routeHash, routeHashOf(r));
        assertEq(s.giveHash, AHandSig.hashGive(t.give));
        assertEq(s.solutionHash, DEFAULT_SOLUTION);
        assertEq(s.settlementHash, core.facts(h).settlementHash, "event hash equals storage");
        assertEq(s.hopCount, 3);
        assertEq(s.closedAt, uint40(block.timestamp));

        // hop facts, self-contained per position
        address[3] memory parents = [vm.addr(E0), vm.addr(E1), vm.addr(E2)];
        address[3] memory children = [vm.addr(E1), vm.addr(E2), vm.addr(E3)];
        address[3] memory shakers = [shakerA, vm.addr(E1), shakerB];
        uint16[4] memory claims = [uint16(10_000), 9_500, 9_500, 9_000];
        uint256[3] memory allocations = [uint256(900_000), 0, 900_000];
        bytes32[] memory shakeHashes = shakeHashesOf(r);
        for (uint256 i; i < 3; ++i) {
            HopLog memory x = decodeHop(logs[1 + i]);
            assertEq(logs[1 + i].topics[2], routeHashOf(r), "routeHash indexed");
            assertEq(x.position, i);
            assertEq(x.parentCapability, parents[i]);
            assertEq(x.childCapability, children[i]);
            assertEq(x.parentClaimBps, claims[i]);
            assertEq(x.childClaimBps, claims[i + 1]);
            assertEq(x.shaker, shakers[i]);
            assertEq(x.shakeHash, shakeHashes[i]);
            assertEq(x.hopDataHash, bytes32(0));
            assertEq(x.marginAllocation, allocations[i]);
        }

        // the grant ledger and its delivery, in the frozen order
        (Payout[] memory allocated, bool[] memory pushed) = checkPayoutStream(logs, address(core), 20e6);
        assertEq(allocated.length, 4);
        assertPayout(allocated[0], charity, AllocationKind.Charity, 0, 2_000_000);
        assertPayout(allocated[1], shakerA, AllocationKind.ShakerMargin, 0, 900_000);
        assertPayout(allocated[2], shakerB, AllocationKind.ShakerMargin, 2, 900_000);
        assertPayout(allocated[3], giver, AllocationKind.GiverResidual, 0, 16_200_000);
        for (uint256 i; i < 4; ++i) {
            assertTrue(pushed[i], "every allocation delivered");
        }
    }

    /// Any pool up to 2^200, any donation 0..30 %, any floor, any telescope of up
    /// to 64 self hops: P == C + Σ A_i + G to the unit, every floor from the design's
    /// rounding order, the giver never below ceil(D · q_n / 1e4) and never zero, and
    /// Σ PayoutAllocated == P.
    function testFuzz_Conservation_Exact(
        uint256 poolSeed,
        uint16 bpsSeed,
        uint16 floorSeed,
        uint8 hopSeed,
        uint16[64] memory deltaSeeds
    ) public {
        uint256 pool = bound(poolSeed, 1, 1 << 200);
        uint16 bps = uint16(bound(bpsSeed, 0, 3_000));
        if (AHandMath.cut(pool, bps) == 0) bps = 0; // a declared donation must pay ≥ 1 unit
        uint16 floorBps = uint16(bound(floorSeed, 1, 10_000));
        uint256 n = bound(hopSeed, 0, 64);

        RaiseParams memory p = defaultParams();
        p.amount = pool;
        p.charityBps = bps;
        if (bps == 0) p.charityRecipient = address(0);
        p.minGiverClaimBps = floorBps;
        p.rootCapability = vm.addr(capKey(0));
        usd.mint(raiser, pool);
        uint256 h = makeRaise(p);

        uint256 C = AHandMath.cut(pool, bps);
        uint256 D = pool - C;
        RouteBuild memory r = newLongRoute(h, capKey(0), n);
        uint256 sumA;
        for (uint256 i; i < n; ++i) {
            uint16 delta = uint16(bound(deltaSeeds[i], 0, r.claim - floorBps));
            if (delta != 0 && AHandMath.cut(D, delta) == 0) delta = 0; // MarginRoundsToZero is a revert, not a target
            sumA += AHandMath.cut(D, delta);
            putSelfHop(r, i, capKey(i + 1), r.claim - delta); // margin accrues to vm.addr(capKey(i))
        }
        uint16 finalClaim = r.claim;

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(balanceOf(token, charity), C, "charity = floor(P * b / 1e4)");
        uint256 G = balanceOf(token, giver);
        assertEq(G, D - sumA, "giver = D - sum floor(D * delta_i / 1e4)");
        uint256 total = C + G;
        for (uint256 i; i < n; ++i) {
            total += balanceOf(token, vm.addr(capKey(i)));
        }
        assertEq(total, pool, "P == C + sum A_i + G, exactly");
        assertEq(balanceOf(token, address(core)), 0, "nothing left in custody");
        assertGe(G, (D * finalClaim + 9_999) / 10_000, "G >= ceil(D * q_n / 1e4): dust lands on the giver");
        assertGe(G, 1, "a funded Hand never leaves the giver with zero");
        checkPayoutStream(logs, address(core), pool);
        assertEq(core.facts(h).settlementHash, settlementHashOf(preimageFromLogsOn(core, logs, h)), "commitment round-trips");
    }

    /// Rounding order is charity from P, hops from D, giver last: with P = 999 and
    /// b = 10 %, C = 99 and a 10 % hop earns floor(900 · 0.1) = 90 — not 99 (from P)
    /// and not 89.9 rounded anywhere else.
    function test_RoundingOrder_CharityFromPool_HopsFromDistributable() public {
        RaiseParams memory p = defaultParams();
        p.amount = 999;
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        settle(r);

        assertEq(balanceOf(token, charity), 99, "C = floor(999 * 0.1)");
        assertEq(balanceOf(token, shakerA), 90, "A = floor((999 - 99) * 0.1), floored from D");
        assertTrue(balanceOf(token, shakerA) != AHandMath.cut(999, 1_000), "not floored from P");
        assertEq(balanceOf(token, giver), 810, "G = D - A");
        assertEq(uint256(99 + 90 + 810), 999);
    }

    /// Six-decimal dust: P = 1 000 003 at 30 % and three 33.33 % hops down to a 1 bps
    /// floor. Every hop floors independently (0.9999 lost each), the giver takes the
    /// residual 73 ≥ ceil(D · 1 / 1e4) = 71 ≥ 1.
    function test_GiverFloor_DustLandsOnGiver() public {
        RaiseParams memory p = defaultParams();
        p.amount = 1_000_003;
        p.charityBps = 3_000;
        p.minGiverClaimBps = 1;
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 6_667);
        addSelfHop(r, E2, 3_334);
        addSelfHop(r, E3, 1);
        settle(r);

        assertEq(balanceOf(token, charity), 300_000, "C = floor(1 000 003 * 0.3)");
        uint256 D = 700_003;
        assertEq(balanceOf(token, vm.addr(E0)), 233_310, "A_0 = floor(700 003 * 0.3333)");
        assertEq(balanceOf(token, vm.addr(E1)), 233_310);
        assertEq(balanceOf(token, vm.addr(E2)), 233_310);
        uint256 G = balanceOf(token, giver);
        assertEq(G, 73, "giver residual absorbs the three floorings");
        assertGe(G, (D * 1 + 9_999) / 10_000, "G >= ceil(D * q_n / 1e4) = 71");
        assertEq(300_000 + 3 * 233_310 + G, 1_000_003);
    }

    /// A margin that floors to zero on a funded Hand is a revert, never a silent
    /// absorption: P = 4 at 30 % leaves D = 3, and a 10 % hop would pay nothing.
    function test_MarginRoundsToZero_Reverts() public {
        RaiseParams memory p = defaultParams();
        p.amount = 4;
        p.charityBps = 3_000; // C = 1, D = 3
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        expectThankRevert(err(MarginRoundsToZero.selector, 0), r, buildTerminal(r));
    }

    /// I-27 on the formula itself: splitting one margin across two hops never
    /// increases what the hops receive (Σ floor ≤ floor Σ), and loses at most one unit.
    function testFuzz_Telescoping_SplitNeverIncreasesSum(uint256 D, uint16 deltaSeed, uint16 kSeed) public pure {
        uint256 delta = bound(deltaSeed, 1, 10_000);
        uint256 k = bound(kSeed, 0, delta);
        uint256 whole = AHandMath.cut(D, delta);
        uint256 split = AHandMath.cut(D, k) + AHandMath.cut(D, delta - k);
        assertLe(split, whole, "splitting a margin never earns more");
        assertGe(split + 1, whole, "and loses at most one unit of dust");
    }

    /// I-27 on-chain (T-ATK-07): a giver inserting a sybil hop inside its own claim
    /// cannot profit — sybil margin plus giver residual never exceeds the honest
    /// residual, and the giver side still gets at least its floored share.
    function testFuzz_Telescoping_CoalitionBound(uint16 splitSeed) public {
        uint16 split = uint16(bound(splitSeed, 0, 4_000)); // the sybil claim stays above the 50 % floor
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();

        RouteBuild memory honest = newRoute(h1);
        addExplicitHop(honest, E1, shakerA, SHAKER_A_PK, 9_000);
        settle(honest);
        uint256 honestResidual = balanceOf(token, giver);

        RouteBuild memory coalition = newRoute(h2);
        addExplicitHop(coalition, E1, shakerA, SHAKER_A_PK, 9_000);
        addSelfHop(coalition, E3, 9_000 - split); // E1 carves `split` out of the giver's own claim
        settle(coalition);
        uint256 giverPart = balanceOf(token, giver) - honestResidual;
        uint256 sybilPart = balanceOf(token, vm.addr(E1));

        assertLe(giverPart + sybilPart, honestResidual, "self-insertion never beats the honest route");
        assertGe(giverPart, AHandMath.cut(90e6, 9_000 - split), "the giver side keeps its floored share");
        assertEq(giverPart + sybilPart + balanceOf(token, shakerA) / 2 + 10e6, DEPOSIT, "conserved");
    }

    /// A zero-pot Hand settles with every amount zero: Settled and RouteHopSettled
    /// are emitted, no PayoutAllocated / Pushed / Deferred, no token call; a
    /// positive margin is allowed without money but still needs a shaker.
    function test_ZeroPot_SettlesWithZeroAmounts() public {
        uint256 h = makeRaise(zeroPotParams());
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000); // margin without money: attribution is still a fact
        addAnonymousHop(r, E2, 9_000);

        vm.recordLogs();
        Terminal memory t = settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 3, "Settled + two hops, nothing else");
        SettledLog memory s = decodeSettled(logs[0]);
        assertEq(s.token, address(0));
        assertEq(s.pool, 0);
        assertEq(s.charityRecipient, address(0));
        assertEq(s.charityAllocation, 0);
        assertEq(s.distributable, 0);
        assertEq(s.giverAllocation, 0);
        assertEq(s.hopCount, 2);
        assertEq(decodeHop(logs[1]).marginAllocation, 0);
        assertEq(decodeHop(logs[1]).shaker, vm.addr(E0));
        assertEq(decodeHop(logs[2]).marginAllocation, 0);
        assertEq(decodeHop(logs[2]).shaker, address(0));
        assertEq(countLogs(logs, address(core), AHandCore.PayoutAllocated.selector), 0);
        assertEq(countLogs(logs, address(core), AHandCore.PayoutPushed.selector), 0);
        assertEq(countLogs(logs, address(core), AHandCore.PayoutDeferred.selector), 0);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        bytes32 stored = core.facts(h).settlementHash;
        assertTrue(stored != bytes32(0), "a zero-pot settlement is still committed");
        assertEq(stored, settlementHashOf(preimageOf(r, t, uint40(block.timestamp))));
        assertEq(stored, settlementHashOf(preimageFromLogsOn(core, logs, h)));

        // money or not, a paid hop names its payee
        uint256 h2 = makeRaise(zeroPotParams());
        RouteBuild memory r2 = newRoute(h2);
        addAnonymousHop(r2, E1, 9_000);
        expectThankRevert(err(AnonymousShakerWithMargin.selector, 0), r2, buildTerminal(r2));
    }

    /// The raiser may be its own giver: it thanks, consents as giver and receives
    /// the residual; Core sees two roles on one address and nothing special.
    function test_RaiserEqualsGiver_Settles() public {
        address keyedRaiser = vm.addr(KEYED_RAISER_PK);
        fund(address(usd), keyedRaiser, DEPOSIT);
        uint256 h = makeRaiseAs(keyedRaiser, core, defaultParams(), DEFAULT_REF, noTags());
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        Terminal memory t = buildTerminal(r, keyedRaiser, KEYED_RAISER_PK, DEFAULT_SOLUTION, defaultDeadline());

        vm.recordLogs();
        doThankAs(keyedRaiser, r, t);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(balanceOf(token, keyedRaiser), 81e6, "the raiser-giver receives the residual");
        assertEq(balanceOf(token, vm.addr(E0)), 9e6);
        assertEq(balanceOf(token, charity), 10e6);
        assertEq(decodeSettled(logs[0]).giver, keyedRaiser);
        assertEq(core.facts(h).raiser, keyedRaiser);
        (Payout[] memory allocated,) = checkPayoutStream(logs, address(core), DEPOSIT);
        assertPayout(allocated[2], keyedRaiser, AllocationKind.GiverResidual, 0, 81e6);
    }

    /// 0 % donation: no charity allocation, no Charity event of any kind, D = P.
    function test_NoDonation_NoCharityAllocationOrEvents() public {
        uint256 h = makeRaise(noCharityParams());
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        SettledLog memory s = decodeSettled(logs[0]);
        assertEq(s.charityRecipient, address(0));
        assertEq(s.charityAllocation, 0);
        assertEq(s.distributable, DEPOSIT, "D = P");
        assertEq(s.giverAllocation, 90e6);
        (Payout[] memory allocated, bool[] memory pushed) = checkPayoutStream(logs, address(core), DEPOSIT);
        assertEq(allocated.length, 2, "margin and residual only");
        for (uint256 i; i < allocated.length; ++i) {
            assertTrue(allocated[i].kind != uint8(AllocationKind.Charity), "no Charity allocation");
            assertTrue(pushed[i]);
        }
        assertPayout(allocated[0], shakerA, AllocationKind.ShakerMargin, 0, 10e6);
        assertPayout(allocated[1], giver, AllocationKind.GiverResidual, 0, 90e6);
        assertEq(balanceOf(token, charity), 0);
        assertEq(balanceOf(token, shakerA) + balanceOf(token, giver), DEPOSIT);
    }

    /// The same shaker on two hops: one fact and one payout per occurrence (no
    /// dedup), both delivered to the one wallet.
    function test_DuplicateShaker_PerOccurrencePayouts() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000); // 9.0
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_500); // 4.5

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (Payout[] memory allocated, bool[] memory pushed) = checkPayoutStream(logs, address(core), DEPOSIT);
        assertEq(allocated.length, 4);
        assertPayout(allocated[1], shakerA, AllocationKind.ShakerMargin, 0, 9e6);
        assertPayout(allocated[2], shakerA, AllocationKind.ShakerMargin, 1, 4_500_000);
        assertTrue(pushed[1] && pushed[2]);
        assertEq(balanceOf(token, shakerA), 13_500_000, "both margins land in one wallet");
        assertEq(balanceOf(token, giver), 76_500_000);
        assertEq(claimOf(token, shakerA), 0, "delivered, not deferred");
    }

    /*//////////////////////////////////////////////////////////////
                §5.3 — delivery: frames, deferral, exactly its own share
    //////////////////////////////////////////////////////////////*/

    /// A blocked shaker and a blocked giver each park exactly their share while the
    /// charity and the other shaker are pushed in the same transaction; custody holds
    /// exactly the parked shares, which drain once the token lets them through.
    function test_Deferral_Blacklist_ParksExactlyItsShare() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, DEPOSIT);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000); // 9.0
        addExplicitHop(r, E2, shakerB, SHAKER_B_PK, 8_500); // 4.5
        bl.setBlocked(shakerA, true);
        bl.setBlocked(giver, true);

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (Payout[] memory allocated, bool[] memory pushed) = checkPayoutStream(logs, address(core), DEPOSIT);
        assertPayout(allocated[0], charity, AllocationKind.Charity, 0, 10e6);
        assertPayout(allocated[1], shakerA, AllocationKind.ShakerMargin, 0, 9e6);
        assertPayout(allocated[2], shakerB, AllocationKind.ShakerMargin, 1, 4_500_000);
        assertPayout(allocated[3], giver, AllocationKind.GiverResidual, 0, 76_500_000);
        assertTrue(pushed[0] && !pushed[1] && pushed[2] && !pushed[3], "pushed, deferred, pushed, deferred");

        assertEq(bl.balanceOf(charity), 10e6);
        assertEq(bl.balanceOf(shakerB), 4_500_000);
        assertEq(bl.balanceOf(shakerA) + bl.balanceOf(giver), 0, "blocked recipients received nothing");
        assertEq(claimOf(address(bl), shakerA), 9e6, "exactly the margin");
        assertEq(claimOf(address(bl), giver), 76_500_000, "exactly the residual");
        assertEq(claimOf(address(bl), charity) + claimOf(address(bl), shakerB), 0, "pushed shares never become claims");
        assertEq(bl.balanceOf(address(core)), 85_500_000, "custody == sum claims");
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "delivery never blocks settlement");

        bl.setBlocked(shakerA, false);
        bl.setBlocked(giver, false);
        core.withdraw(address(bl), shakerA);
        core.withdraw(address(bl), giver);
        assertEq(bl.balanceOf(shakerA), 9e6);
        assertEq(bl.balanceOf(giver), 76_500_000);
        assertEq(bl.balanceOf(address(core)), 0);
    }

    /// Every recipient blocked (a token-wide stop seen from one Hand): nothing moves,
    /// the Hand still settles, custody equals the claims, no token Transfer at all.
    function test_Deferral_EveryRecipientBlocked_StillSettles() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, DEPOSIT);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        bl.setBlocked(charity, true);
        bl.setBlocked(shakerA, true);
        bl.setBlocked(giver, true);

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter != address(bl), "no token event: nothing moved");
        }
        (, bool[] memory pushed) = checkPayoutStream(logs, address(core), DEPOSIT);
        assertEq(pushed.length, 3);
        for (uint256 i; i < 3; ++i) {
            assertFalse(pushed[i]);
        }
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(claimOf(address(bl), charity), 10e6);
        assertEq(claimOf(address(bl), shakerA), 9e6);
        assertEq(claimOf(address(bl), giver), 81e6);
        assertEq(bl.balanceOf(address(core)), DEPOSIT, "custody == sum claims");
    }

    /// One blocked shaker on two hops: one PayoutDeferred per occurrence, one claim
    /// holding their sum, one withdraw paying it.
    function test_Deferral_DuplicateShaker_OneAggregateClaim() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, DEPOSIT);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        addExplicitHop(r, E2, shakerA, SHAKER_A_PK, 8_500);
        bl.setBlocked(shakerA, true);

        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(bl), shakerA, AllocationKind.ShakerMargin, 0, 9e6);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(bl), shakerA, AllocationKind.ShakerMargin, 1, 4_500_000);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h, address(bl), giver, AllocationKind.GiverResidual, 0, 76_500_000);
        settle(r);

        assertEq(claimOf(address(bl), shakerA), 13_500_000, "both occurrences in one claim");
        bl.setBlocked(shakerA, false);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutWithdrawn(address(bl), shakerA, 13_500_000);
        core.withdraw(address(bl), shakerA);
        assertEq(bl.balanceOf(shakerA), 13_500_000);
    }

    /// A proxied USDC-shaped token blacklists the giver: the string revert stays inside
    /// the frame (the thank succeeds, the share parks), `withdraw` bubbles the same
    /// string, and un-blacklisting drains the claim.
    function test_Deferral_FiatTokenBlacklist_RevertStaysInFrame() public {
        FiatTokenLikeV1 usdc = deployFiatToken();
        usdc.mint(raiser, DEPOSIT);
        vm.prank(raiser);
        usdc.approve(address(core), type(uint256).max);
        useToken(address(usdc));
        uint256 h = makeRaise();
        usdc.blacklist(giver);

        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h, address(usdc), charity, AllocationKind.Charity, 0, 10e6);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(usdc), giver, AllocationKind.GiverResidual, 0, 90e6);
        settleSimple(h);

        assertEq(usdc.balanceOf(giver), 0);
        assertEq(claimOf(address(usdc), giver), 90e6);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        core.withdraw(address(usdc), giver);
        assertEq(claimOf(address(usdc), giver), 90e6, "claim intact after the failed drain");

        usdc.unBlacklist(giver);
        core.withdraw(address(usdc), giver);
        assertEq(usdc.balanceOf(giver), 90e6);
        assertEq(usdc.balanceOf(address(core)), 0);
    }

    /// A token paused after the raise stops every exit of that token and nothing
    /// else: all three shares park, no Transfer is emitted, withdraw reverts with the
    /// token's own reason, and everything drains once unpaused.
    function test_Deferral_PausedToken_ConfinedTotalStop() public {
        PausableToken pt = new PausableToken();
        useToken(address(pt));
        fund(address(pt), raiser, DEPOSIT);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000);
        pt.setPaused(true);

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (, bool[] memory pushed) = checkPayoutStream(logs, address(core), DEPOSIT);
        assertEq(pushed.length, 3);
        assertFalse(pushed[0] || pushed[1] || pushed[2], "every push parked");
        assertEq(countLogs(logs, address(pt), keccak256("Transfer(address,address,uint256)")), 0);
        assertEq(pt.balanceOf(address(core)), DEPOSIT);
        assertEq(claimOf(address(pt), charity) + claimOf(address(pt), vm.addr(E0)) + claimOf(address(pt), giver), DEPOSIT);

        vm.expectRevert(bytes("PAUSED"));
        core.withdraw(address(pt), giver);

        pt.setPaused(false);
        core.withdraw(address(pt), charity);
        core.withdraw(address(pt), vm.addr(E0));
        core.withdraw(address(pt), giver);
        assertEq(pt.balanceOf(charity), 10e6);
        assertEq(pt.balanceOf(vm.addr(E0)), 9e6);
        assertEq(pt.balanceOf(giver), 81e6);
        assertEq(pt.balanceOf(address(core)), 0);
    }

    /// A transfer that costs more than PUSH_GAS defers without failing the thank;
    /// `withdraw` is not budget-bound and drains it; a heavy-but-honest transfer
    /// under the budget lands.
    function test_Push_GasHogToken_OverBudgetDefers_UnderBudgetLands() public {
        GasHogToken gh = new GasHogToken();
        useToken(address(gh));
        fund(address(gh), raiser, 2 * DEPOSIT);
        assertGt(gh.hogGas(), core.PUSH_GAS());
        gh.setHog(giver, true);

        uint256 h1 = makeRaise();
        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h1, address(gh), charity, AllocationKind.Charity, 0, 10e6);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h1, address(gh), giver, AllocationKind.GiverResidual, 0, 90e6);
        settleSimple(h1);
        assertEq(claimOf(address(gh), giver), 90e6, "budget exhaustion parks exactly the share");
        assertEq(gh.balanceOf(giver), 0);
        core.withdraw(address(gh), giver);
        assertEq(gh.balanceOf(giver), 90e6, "withdraw forwards all the gas there is");

        gh.setHogGas(100_000);
        uint256 h2 = makeRaise();
        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h2, address(gh), giver, AllocationKind.GiverResidual, 0, 90e6);
        settleSimple(h2);
        assertEq(gh.balanceOf(giver), 180e6);
        assertEq(claimOf(address(gh), giver), 0);
    }

    /// A hooked recipient that burns more than PUSH_GAS parks only its own share
    /// under a conforming hook token; the other recipients are paid in the same thank.
    function test_Push_GasHogRecipient_ParksOnlyItself() public {
        HookToken hk = new HookToken();
        useToken(address(hk));
        fund(address(hk), raiser, DEPOSIT);
        GasHogRecipient hog = new GasHogRecipient();
        vm.prank(policyAdmin);
        core.setCharityAllowed(address(hog), true);
        hk.setHooked(address(hog), true);
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(hog);
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);

        vm.recordLogs();
        settle(r);
        (, bool[] memory pushed) = checkPayoutStream(vm.getRecordedLogs(), address(core), DEPOSIT);
        assertFalse(pushed[0], "hog charity parked");
        assertTrue(pushed[1] && pushed[2], "shaker and giver paid");
        assertEq(claimOf(address(hk), address(hog)), 10e6);
        assertEq(hk.balanceOf(address(hog)), 0);
        assertEq(hk.balanceOf(shakerA), 9e6);
        assertEq(hk.balanceOf(giver), 81e6);
        assertEq(hk.balanceOf(address(core)), 10e6);

        core.withdraw(address(hk), address(hog));
        assertEq(hk.balanceOf(address(hog)), 10e6, "unbounded gas drains the hog");
    }

    /// A 1 MiB returndata bomb from `transfer` is paid inside the frame (the token
    /// runs out of its 200k and the share parks); the parent never copies it, so the
    /// thank costs at most the frame budgets more than an honest one; a small return
    /// lands; at top level `withdraw` succeeds and the caller alone pays the bomb.
    function test_Push_ReturndataBomb_PaidInsideFrame() public {
        ReturndataBombToken rb = new ReturndataBombToken();
        useToken(address(rb));
        fund(address(rb), raiser, 2 * DEPOSIT);

        uint256 h1 = makeRaise(); // 1 MiB bomb on transfer
        vm.recordLogs();
        settleSimple(h1);
        uint256 gasBombed = gasOfLastCall();
        (, bool[] memory pushed) = checkPayoutStream(vm.getRecordedLogs(), address(core), DEPOSIT);
        assertFalse(pushed[0] || pushed[1], "both frames ran out of gas on the bomb");
        assertEq(claimOf(address(rb), charity), 10e6);
        assertEq(claimOf(address(rb), giver), 90e6);
        assertEq(rb.balanceOf(address(core)), DEPOSIT);

        rb.setBomb(1_024, true, false);
        uint256 h2 = makeRaise();
        vm.recordLogs();
        settleSimple(h2);
        uint256 gasPlain = gasOfLastCall();
        (, pushed) = checkPayoutStream(vm.getRecordedLogs(), address(core), DEPOSIT);
        assertTrue(pushed[0] && pushed[1], "a 1 KiB return is an ordinary success");
        assertEq(rb.balanceOf(giver), 90e6);
        // the parent paid at most the two exhausted frames plus the deferral bookkeeping
        assertLe(gasBombed, gasPlain + 2 * (core.PUSH_GAS() + core.PUSH_RESERVE()), "no returndata copied by the parent");

        rb.setBomb(1 << 20, true, false);
        core.withdraw(address(rb), giver);
        uint256 gasWithdraw = gasOfLastCall();
        assertEq(rb.balanceOf(giver), 180e6, "top-level drain succeeds");
        assertGt(gasWithdraw, 2_000_000, "the caller who chose the token pays its bomb");
    }

    /// S1 made harmless: a token that MOVES the funds and then returns false reverts
    /// the frame, so nothing stays moved and exactly the share parks. The frame's
    /// reason is OpenZeppelin's; `withdraw` reverts the same way with the claim intact.
    function test_Deferral_TransferThenFalse_FrameRollsBackTheMove() public {
        TransferThenFalseToken tf = new TransferThenFalseToken();
        useToken(address(tf));
        fund(address(tf), raiser, DEPOSIT);
        uint256 h = makeRaise();
        tf.setFalseTo(giver, true);

        vm.recordLogs();
        settleSimple(h);
        (, bool[] memory pushed) = checkPayoutStream(vm.getRecordedLogs(), address(core), DEPOSIT);
        assertTrue(pushed[0] && !pushed[1]);
        assertEq(tf.balanceOf(giver), 0, "the move was rolled back");
        assertEq(tf.balanceOf(charity), 10e6);
        assertEq(claimOf(address(tf), giver), 90e6, "exactly the share parked");
        assertEq(tf.balanceOf(address(core)), 90e6, "custody == claim");

        bytes memory ozFailure = abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tf));
        vm.prank(address(core));
        vm.expectRevert(ozFailure);
        core.pushExact(address(tf), giver, 90e6);

        vm.expectRevert(ozFailure);
        core.withdraw(address(tf), giver);
        assertEq(claimOf(address(tf), giver), 90e6, "claim restored by the revert");

        tf.setFalseTo(giver, false);
        core.withdraw(address(tf), giver);
        assertEq(tf.balanceOf(giver), 90e6);
    }

    /// The §18 #2 case: a consenting-but-hostile recipient sends half of its push
    /// back to Core during the token's hook. The custody delta is inexact, the frame
    /// reverts `TransferInexact`, only that recipient's share parks, everyone else is
    /// paid — one hostile hop never kills the settlement.
    function test_Deferral_PartialReturnRecipient_ParksOnlyItsShare() public {
        HookToken hk = new HookToken();
        useToken(address(hk));
        fund(address(hk), raiser, DEPOSIT);
        PartialReturnRecipient prr = new PartialReturnRecipient();
        vm.prank(policyAdmin);
        core.setCharityAllowed(address(prr), true);
        hk.setHooked(address(prr), true);
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(prr);
        uint256 h = makeRaise(p);
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);

        vm.recordLogs();
        settle(r);
        (Payout[] memory allocated, bool[] memory pushed) = checkPayoutStream(vm.getRecordedLogs(), address(core), DEPOSIT);
        assertPayout(allocated[0], address(prr), AllocationKind.Charity, 0, 10e6);
        assertFalse(pushed[0], "the partial move rolled back and parked");
        assertTrue(pushed[1] && pushed[2], "the honest recipients were paid");
        assertEq(hk.balanceOf(address(prr)), 0, "nothing stayed with the hostile recipient");
        assertEq(claimOf(address(hk), address(prr)), 10e6);
        assertEq(hk.balanceOf(shakerA), 9e6);
        assertEq(hk.balanceOf(giver), 81e6);
        assertEq(hk.balanceOf(address(core)), 10e6, "custody == the one claim");
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));

        vm.prank(address(core));
        vm.expectRevert(TransferInexact.selector);
        core.pushExact(address(hk), address(prr), 10e6);

        hk.setHooked(address(prr), false);
        core.withdraw(address(hk), address(prr));
        assertEq(hk.balanceOf(address(prr)), 10e6);
    }

    /// A sender-side fee switched on after entry is the documented total stop for
    /// that token: every push defers, nothing moves, `withdraw` reverts
    /// `TransferInexact`; exits resume only if the token becomes exact again.
    function test_Deferral_LateSenderFee_EveryPushDefers() public {
        LateSenderFeeToken lf = new LateSenderFeeToken();
        useToken(address(lf));
        fund(address(lf), raiser, DEPOSIT);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        lf.setFeeOn(true);

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (, bool[] memory pushed) = checkPayoutStream(logs, address(core), DEPOSIT);
        assertEq(pushed.length, 3);
        assertFalse(pushed[0] || pushed[1] || pushed[2], "every push deferred");
        assertEq(lf.balanceOf(address(core)), DEPOSIT, "nothing left custody");
        assertEq(lf.balanceOf(charity) + lf.balanceOf(shakerA) + lf.balanceOf(giver), 0);
        assertEq(claimOf(address(lf), charity) + claimOf(address(lf), shakerA) + claimOf(address(lf), giver), DEPOSIT);

        vm.expectRevert(TransferInexact.selector);
        core.withdraw(address(lf), giver);
        assertEq(claimOf(address(lf), giver), 81e6, "claim intact: the stop is a revert, not a loss");

        lf.setFeeOn(false);
        core.withdraw(address(lf), giver);
        assertEq(lf.balanceOf(giver), 81e6);
    }

    /// I-16: a hook running inside a push frame sees a Hand that is already Settled
    /// with its final commitment, and cannot re-enter an entry point (the transient
    /// lock answers); its own push still lands because it swallowed the failures.
    function test_HookInsideFrame_SeesSettledHand_CannotReenter() public {
        HookToken hk = new HookToken();
        useToken(address(hk));
        fund(address(hk), raiser, DEPOSIT);
        SettledStateObserver obs = new SettledStateObserver(core);
        vm.prank(policyAdmin);
        core.setCharityAllowed(address(obs), true);
        hk.setHooked(address(obs), true);
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(obs);
        uint256 h = makeRaise(p);
        obs.setHand(h);

        vm.recordLogs();
        settleSimple(h);
        (, bool[] memory pushed) = checkPayoutStream(vm.getRecordedLogs(), address(core), DEPOSIT);

        assertEq(uint8(obs.seenStatus()), uint8(Status.Settled), "Hand state final before the first transfer");
        assertEq(obs.seenSettlementHash(), core.facts(h).settlementHash, "commitment already stored");
        assertEq(obs.seenClosedAt(), uint40(block.timestamp));
        bytes4 lock = ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector;
        assertEq(obs.withdrawError(), lock, "withdraw under the frame hits the lock");
        assertEq(obs.reclaimError(), lock, "reclaim under the frame hits the lock");
        assertTrue(pushed[0] && pushed[1], "the observer's own push landed");
        assertEq(hk.balanceOf(address(obs)), 10e6);
    }

    /// The frame has no reflexive lock: a push under `thank` is delivered, not parked.
    function test_PushFrame_UnderThankLock_Delivers() public {
        uint256 h = makeRaise();
        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h, token, charity, AllocationKind.Charity, 0, 10e6);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h, token, giver, AllocationKind.GiverResidual, 0, 90e6);
        settleSimple(h);
        assertEq(claimOf(token, charity) + claimOf(token, giver), 0, "no lock-induced deferral");
        assertEq(balanceOf(token, giver), 90e6);
    }

    /// `pushExact` is reachable from no external account — EOA, contract, raiser or
    /// policy admin — even while Core holds the token.
    function test_PushExact_OnlySelf() public {
        usd.mint(address(core), 1e6); // inert surplus, there to be stolen if the door were open
        vm.prank(stranger);
        vm.expectRevert(OnlySelf.selector);
        core.pushExact(address(usd), stranger, 1e6);
        vm.prank(raiser);
        vm.expectRevert(OnlySelf.selector);
        core.pushExact(address(usd), raiser, 1e6);
        vm.prank(policyAdmin);
        vm.expectRevert(OnlySelf.selector);
        core.pushExact(address(usd), policyAdmin, 1e6);
        PushExactCaller caller = new PushExactCaller();
        vm.expectRevert(OnlySelf.selector);
        caller.push(core, address(usd), address(caller), 1e6);
        assertEq(usd.balanceOf(address(core)), 1e6, "nothing moved");
    }

    /*//////////////////// I-9: the starvation guard ////////////////////*/

    /// @dev One attempt at `thank` with exactly `gas`; the state change is the caller's to keep or revert.
    function tryThankWithGas(RouteBuild memory r, Terminal memory t, uint256 gas)
        internal
        returns (bool ok, bytes memory revertData)
    {
        vm.prank(raiser);
        try r.core.thank{gas: gas}(r.handId, r.hops, t) {
            ok = true;
        } catch (bytes memory e) {
            revertData = e;
        }
    }

    /// @dev The least gas at which `thank` succeeds, by bisection on reverted snapshots.
    function minThankGas(RouteBuild memory r, Terminal memory t) internal returns (uint256 hi) {
        uint256 lo = 30_000;
        hi = 5_000_000;
        uint256 snap = vm.snapshotState();
        (bool okHi,) = tryThankWithGas(r, t, hi);
        vm.revertToState(snap);
        assertTrue(okHi, "ample gas settles");
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            snap = vm.snapshotState();
            (bool ok,) = tryThankWithGas(r, t, mid);
            vm.revertToState(snap);
            if (ok) hi = mid;
            else lo = mid;
        }
    }

    /// Just below the guard the whole thank reverts `InsufficientGas` (nothing parks,
    /// the Hand stays Active); just above, it settles and the frame receives exactly
    /// PUSH_GAS — the gas a hooked recipient observes inside the frame is the same as
    /// under ample gas (EIP-150: min(PUSH_GAS, 63/64 of what is left) == PUSH_GAS).
    function test_gas_guard_boundary_pushed() public {
        HookToken hk = new HookToken();
        useToken(address(hk));
        fund(address(hk), raiser, DEPOSIT);
        GasProbeRecipient probe = new GasProbeRecipient();
        hk.setHooked(address(probe), true);
        uint256 h = makeRaise(noCharityParams());
        RouteBuild memory r = newRoute(h); // zero-shake route: the root signs the Give, one push
        Terminal memory t = buildTerminal(r, address(probe), 0, DEFAULT_SOLUTION, defaultDeadline());

        uint256 base = vm.snapshotState();
        vm.prank(raiser);
        core.thank(h, r.hops, t);
        uint256 ampleObserved = probe.observedGas();
        assertGt(ampleObserved, 0);
        vm.revertToState(base);

        uint256 least = minThankGas(r, t);
        uint256 guard = core.PUSH_GAS() * 64 / 63 + core.PUSH_RESERVE();
        assertGt(least, guard, "the guard threshold sits below the least settling gas");

        (bool ok, bytes memory revertData) = tryThankWithGas(r, t, least - 1);
        assertFalse(ok);
        assertEq(revertData, err(InsufficientGas.selector), "one unit short: InsufficientGas, not a deferral");
        assertEq(uint8(statusOf(h)), uint8(Status.Active), "whole transaction reverted");
        assertEq(claimOf(address(hk), address(probe)), 0, "nothing parked");
        assertEq(probe.observedGas(), 0, "the frame never ran");

        vm.prank(raiser);
        core.thank{gas: least}(h, r.hops, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(hk.balanceOf(address(probe)), DEPOSIT, "pushed, not deferred");
        assertEq(probe.observedGas(), ampleObserved, "the frame got its full PUSH_GAS at the boundary");

        record(
            string.concat(
                "guard case=pushed least_thank_gas=",
                vm.toString(least),
                " guard_threshold=",
                vm.toString(guard),
                " frame_observed_gas=",
                vm.toString(ampleObserved)
            )
        );
    }

    /// The reserve: a recipient that exhausts the whole frame budget still lets the
    /// parent record the deferral (cold claims SSTORE + event) when the guard passed
    /// by one unit; one unit less is `InsufficientGas`, never an out-of-gas after the frame.
    function test_gas_guard_boundary_deferred() public {
        GasHogToken gh = new GasHogToken();
        useToken(address(gh));
        fund(address(gh), raiser, DEPOSIT);
        gh.setHog(giver, true); // burns 250k > PUSH_GAS: the frame dies at its budget
        uint256 h = makeRaise(noCharityParams());
        RouteBuild memory r = newRoute(h);
        Terminal memory t = buildTerminal(r);

        uint256 least = minThankGas(r, t);
        (bool ok, bytes memory revertData) = tryThankWithGas(r, t, least - 1);
        assertFalse(ok);
        assertEq(revertData, err(InsufficientGas.selector), "the guard, not the parent, is what fails");
        assertEq(uint8(statusOf(h)), uint8(Status.Active));

        vm.prank(raiser);
        core.thank{gas: least}(h, r.hops, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(claimOf(address(gh), giver), DEPOSIT, "the exhausted frame parked exactly the share");
        assertEq(gh.balanceOf(giver), 0);

        record(
            string.concat(
                "guard case=deferred_after_exhausted_frame least_thank_gas=",
                vm.toString(least),
                " guard_threshold=",
                vm.toString(core.PUSH_GAS() * 64 / 63 + core.PUSH_RESERVE())
            )
        );
    }

    /*//////////////////////////////////////////////////////////////
                        I-23 — the settlement commitment
    //////////////////////////////////////////////////////////////*/

    /// @dev Explicit, anonymous and self hops in one route: the preimage shape with a
    ///      zero in the middle (32-byte-padded array hashing, §3.5).
    function threeHopMixedRoute(uint256 h) internal view returns (RouteBuild memory r) {
        r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        addAnonymousHop(r, E2, 9_000);
        addSelfHop(r, E3, 8_000); // shaker = E2
    }

    /// The stored hash equals the commitment of the preimage rebuilt from Settled +
    /// RouteHopSettled, and of the preimage computed from the known route.
    function test_SettlementHash_RoundTripsFromEvents() public {
        uint256 h = makeRaise();
        RouteBuild memory r = threeHopMixedRoute(h);
        vm.recordLogs();
        Terminal memory t = settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 stored = core.facts(h).settlementHash;
        assertTrue(stored != bytes32(0));
        AHandSettlement.SettlementPreimage memory fromLogs = preimageFromLogsOn(core, logs, h);
        AHandSettlement.SettlementPreimage memory expected = preimageOf(r, t, uint40(block.timestamp));
        assertEq(settlementHashOf(fromLogs), stored, "events rebuild the commitment");
        assertEq(settlementHashOf(expected), stored, "the route predicts the commitment");
        assertEq(decodeSettled(logs[0]).settlementHash, stored, "Settled carries the stored hash");
        assertEq(fromLogs.occShakers.length, 3);
        assertEq(fromLogs.occShakers[1], address(0), "anonymous zero preserved");
        assertEq(fromLogs.occClaimDeltas[0], 1_000);
        assertEq(fromLogs.occClaimDeltas[1], 0);
        assertEq(fromLogs.occClaimDeltas[2], 1_000);
        assertEq(fromLogs.occAllocations[0], 9e6);
        assertEq(fromLogs.occAllocations[1], 0);
        assertEq(fromLogs.occAllocations[2], 9e6);
        assertEq(fromLogs.giverAllocation, 72e6);
        assertEq(fromLogs.charityAllocation, 10e6);
    }

    function assertMismatch(AHandSettlement.SettlementPreimage memory p, bytes32 stored, string memory what) internal view {
        assertTrue(settlementHashOf(p) != stored, what);
    }

    /// Every preimage field, every occurrence array element, a dropped anonymous zero,
    /// a reordering and an appended zero hop all break the commitment; the untouched
    /// preimage matches again after each probe.
    function test_SettlementHash_MutationMatrix() public {
        uint256 h = makeRaise();
        RouteBuild memory r = threeHopMixedRoute(h);
        vm.recordLogs();
        settle(r);
        AHandSettlement.SettlementPreimage memory p = preimageFromLogsOn(core, vm.getRecordedLogs(), h);
        bytes32 stored = core.facts(h).settlementHash;
        assertEq(settlementHashOf(p), stored);

        p.handId += 1;
        assertMismatch(p, stored, "handId");
        p.handId -= 1;
        p.raiser = stranger;
        assertMismatch(p, stored, "raiser");
        p.raiser = raiser;
        p.giver = stranger;
        assertMismatch(p, stored, "giver");
        p.giver = giver;
        p.token = address(t18);
        assertMismatch(p, stored, "token");
        p.token = token;
        p.charityRecipient = stranger;
        assertMismatch(p, stored, "charityRecipient");
        p.charityRecipient = charity;
        p.pool += 1;
        assertMismatch(p, stored, "pool");
        p.pool -= 1;
        p.charityAllocation -= 1;
        assertMismatch(p, stored, "charityAllocation");
        p.charityAllocation += 1;
        p.giverAllocation += 1;
        assertMismatch(p, stored, "giverAllocation");
        p.giverAllocation -= 1;
        bytes32 keep = p.routeHash;
        p.routeHash = keccak256("other route");
        assertMismatch(p, stored, "routeHash");
        p.routeHash = keep;
        keep = p.giveHash;
        p.giveHash = keccak256("other give");
        assertMismatch(p, stored, "giveHash");
        p.giveHash = keep;
        keep = p.solutionHash;
        p.solutionHash = keccak256("other solution");
        assertMismatch(p, stored, "solutionHash");
        p.solutionHash = keep;
        p.closedAt += 1;
        assertMismatch(p, stored, "closedAt");
        p.closedAt -= 1;

        p.occShakers[1] = shakerB;
        assertMismatch(p, stored, "anonymous zero replaced by an address");
        p.occShakers[1] = address(0);
        p.occShakers[0] = shakerB;
        assertMismatch(p, stored, "shaker of hop 0");
        p.occShakers[0] = shakerA;
        p.occClaimDeltas[0] = 999;
        assertMismatch(p, stored, "claim delta of hop 0");
        p.occClaimDeltas[0] = 1_000;
        p.occAllocations[2] += 1;
        assertMismatch(p, stored, "allocation of hop 2");
        p.occAllocations[2] -= 1;
        assertEq(settlementHashOf(p), stored, "restored preimage matches again");

        // reorder hops 0 and 2 (same multiset of facts, different route order)
        (p.occShakers[0], p.occShakers[2]) = (p.occShakers[2], p.occShakers[0]);
        (p.occAllocations[0], p.occAllocations[2]) = (p.occAllocations[2], p.occAllocations[0]);
        assertMismatch(p, stored, "reordered occurrences");
        (p.occShakers[0], p.occShakers[2]) = (p.occShakers[2], p.occShakers[0]);
        (p.occAllocations[0], p.occAllocations[2]) = (p.occAllocations[2], p.occAllocations[0]);

        // drop the anonymous zero occurrence
        AHandSettlement.SettlementPreimage memory dropped = copyWithout(p, 1);
        assertMismatch(dropped, stored, "dropped anonymous occurrence");

        // append a zero hop
        AHandSettlement.SettlementPreimage memory appended = copyWithExtraZero(p);
        assertMismatch(appended, stored, "appended zero occurrence");

        assertEq(settlementHashOf(p), stored, "the original is untouched");
    }

    /// @dev A fresh preimage with `p`'s scalar fields and empty occurrence arrays
    ///      (a memory struct assignment would alias `p`).
    function cloneScalars(AHandSettlement.SettlementPreimage memory p)
        internal
        pure
        returns (AHandSettlement.SettlementPreimage memory q)
    {
        q.handId = p.handId;
        q.raiser = p.raiser;
        q.giver = p.giver;
        q.token = p.token;
        q.charityRecipient = p.charityRecipient;
        q.pool = p.pool;
        q.charityAllocation = p.charityAllocation;
        q.giverAllocation = p.giverAllocation;
        q.routeHash = p.routeHash;
        q.giveHash = p.giveHash;
        q.solutionHash = p.solutionHash;
        q.closedAt = p.closedAt;
    }

    function copyWithout(AHandSettlement.SettlementPreimage memory p, uint256 skip)
        internal
        pure
        returns (AHandSettlement.SettlementPreimage memory q)
    {
        q = cloneScalars(p);
        uint256 n = p.occShakers.length - 1;
        q.occShakers = new address[](n);
        q.occClaimDeltas = new uint16[](n);
        q.occAllocations = new uint256[](n);
        uint256 j;
        for (uint256 i; i <= n; ++i) {
            if (i == skip) continue;
            q.occShakers[j] = p.occShakers[i];
            q.occClaimDeltas[j] = p.occClaimDeltas[i];
            q.occAllocations[j] = p.occAllocations[i];
            ++j;
        }
    }

    function copyWithExtraZero(AHandSettlement.SettlementPreimage memory p)
        internal
        pure
        returns (AHandSettlement.SettlementPreimage memory q)
    {
        q = cloneScalars(p);
        uint256 n = p.occShakers.length;
        q.occShakers = new address[](n + 1);
        q.occClaimDeltas = new uint16[](n + 1);
        q.occAllocations = new uint256[](n + 1);
        for (uint256 i; i < n; ++i) {
            q.occShakers[i] = p.occShakers[i];
            q.occClaimDeltas[i] = p.occClaimDeltas[i];
            q.occAllocations[i] = p.occAllocations[i];
        }
    }

    /*//////////////////////////////////////////////////////////////
                    I-24 — positions beyond a byte; I-1 / I-2 windows
    //////////////////////////////////////////////////////////////*/

    /// 257 hops: positions 255 and 256 are emitted exactly (no byte truncation) in
    /// RouteHopSettled and in the paired payout events; the Give is position 257.
    function test_Positions_Exact_At_255_256_257() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newLongRoute(h, E0, 257);
        for (uint256 i; i < 255; ++i) {
            putAnonymousHop(r, i, capKey(i + 1), 10_000);
        }
        putHop(r, 255, vm.addr(capKey(256)), capKey(256), shakerA, SHAKER_A_PK, 9_900); // position 255
        putHop(r, 256, vm.addr(capKey(257)), capKey(257), shakerB, SHAKER_B_PK, 9_800); // position 256

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(decodeSettled(logs[0]).hopCount, 257);
        for (uint256 i; i < 257; ++i) {
            assertEq(logs[1 + i].topics[0], AHandCore.RouteHopSettled.selector);
            assertEq(decodeHop(logs[1 + i]).position, i, "position == hop index");
        }
        HopLog memory x255 = decodeHop(logs[256]);
        HopLog memory x256 = decodeHop(logs[257]);
        assertEq(x255.position, 255);
        assertEq(x255.shaker, shakerA);
        assertEq(x255.marginAllocation, 900_000);
        assertEq(x256.position, 256);
        assertEq(x256.shaker, shakerB);
        assertEq(x256.marginAllocation, 900_000);

        (Payout[] memory allocated, bool[] memory pushed) = checkPayoutStream(logs, address(core), DEPOSIT);
        assertEq(allocated.length, 4);
        assertPayout(allocated[1], shakerA, AllocationKind.ShakerMargin, 255, 900_000);
        assertPayout(allocated[2], shakerB, AllocationKind.ShakerMargin, 256, 900_000);
        assertPayout(allocated[3], giver, AllocationKind.GiverResidual, 0, 88_200_000);
        assertTrue(pushed[0] && pushed[1] && pushed[2] && pushed[3]);

        // the Give of a 257-hop route is position 257 in every indexed error
        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newLongRoute(h2, E0, 257);
        for (uint256 i; i < 257; ++i) {
            putAnonymousHop(r2, i, capKey(i + 1), 10_000);
        }
        Terminal memory t2 = buildTerminal(r2);
        t2.give.finalClaimBps = 9_999;
        expectThankRevert(err(ClaimMismatch.selector, 257), r2, t2);
    }

    /// A settled Hand is terminal: the identical bundle replays to `NotActive`, and
    /// expiry cannot reopen it through reclaim.
    function test_SettleOnce_NotActive() public {
        uint256 h = makeRaise();
        (RouteBuild memory r, Terminal memory t) = settleSimple(h);
        bytes32 stored = core.facts(h).settlementHash;
        expectThankRevert(err(NotActive.selector), r, t);
        warpToExpiry(h);
        vm.expectRevert(NotActive.selector);
        core.reclaim(h);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(core.facts(h).settlementHash, stored, "the commitment never changes");
        assertEq(balanceOf(token, giver), 90e6, "paid once");
    }

    /// The thank window is strictly before expiry: the last second settles (with
    /// artifact deadlines equal to expiry), expiry itself is `HandExpired`.
    function test_Thank_ExpiryBoundary() public {
        uint256 h = makeRaise();
        uint256 h2 = makeRaise(); // same expiry
        uint40 expiry = core.facts(h).expiry;
        assertEq(core.facts(h2).expiry, expiry);
        RouteBuild memory r = newRoute(h);
        addHop(r, E1, vm.addr(E0), 0, 10_000, expiry); // deadline == expiry is legal
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, expiry);
        RouteBuild memory r2 = newRoute(h2);
        addHop(r2, E1, vm.addr(E0), 0, 10_000, expiry);
        Terminal memory t2 = buildTerminal(r2, giver, GIVER_PK, DEFAULT_SOLUTION, expiry);

        vm.warp(expiry - 1);
        doThank(r, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled), "last valid second");
        assertEq(core.facts(h).closedAt, expiry - 1);

        vm.warp(expiry);
        expectThankRevert(err(HandExpired.selector), r2, t2);
        assertEq(uint8(statusOf(h2)), uint8(Status.Active), "expiry belongs to reclaim");
    }

    /*//////////////////////////////////////////////////////////////
            GAS SERIES (D3, §7.3, §17.2) — one line per case to gas-series.txt
    //////////////////////////////////////////////////////////////*/

    function record(string memory line) internal {
        vm.createDir(gasSeriesDir, true); // mkdir -p: `out/` exists after a build, `out/gas` may not yet
        vm.writeLine(gasSeriesPath, line);
    }

    /// @dev Intrinsic transaction gas of `cd`: 21 000 + 4 per zero byte + 16 per non-zero byte.
    function intrinsicGas(bytes memory cd) internal pure returns (uint256 gas) {
        gas = 21_000;
        for (uint256 i; i < cd.length; ++i) {
            gas += cd[i] == 0 ? 4 : 16;
        }
    }

    function nameOf(Signer s) internal pure returns (string memory) {
        return s == Signer.EOA ? "eoa" : "erc1271";
    }

    function nameOf(Delivery d) internal pure returns (string memory) {
        return d == Delivery.Pushed ? "pushed" : "deferred";
    }

    function nameOf(Recipients x) internal pure returns (string memory) {
        return x == Recipients.Fresh ? "fresh" : x == Recipients.Existing ? "existing" : "duplicate";
    }

    /// @dev An account of the series' signer kind standing for `eoa` (itself, or a wallet it owns).
    function seriesAccount(Signer s, address eoa) internal returns (address) {
        return s == Signer.EOA ? eoa : address(new SmartWallet1271(eoa));
    }

    /// @dev Capability `i` of the series' signer kind.
    function seriesCapability(Signer s, uint256 i) internal returns (address) {
        return seriesAccount(s, vm.addr(capKey(i)));
    }

    /// @dev A Hand over `bl` with `n` paid explicit hops of 1 bps each (A_i = 9 000 units
    ///      on the default pool), the series' signer kind for every capability, shaker
    ///      and giver, the recipient mode applied to the shakers, and every recipient
    ///      blocked when the delivery is `Deferred`. Every run of the series (one per
    ///      hop count, all inside one test) gets its own shakers, giver and charity, so
    ///      `fresh` really is cold storage; `existing` pre-mints one unit to each
    ///      recipient; `duplicate` repeats one shaker on every hop.
    function seriesRoute(BlacklistToken bl, uint256 n, Signer signer, Delivery delivery, Recipients recipients)
        internal
        returns (RouteBuild memory r, Terminal memory t)
    {
        uint256 run = n << 16; // per-run key space
        RaiseParams memory p = defaultParams();
        p.minGiverClaimBps = 1;
        p.rootCapability = seriesCapability(signer, 0);
        p.charityRecipient = makeAddr(string.concat("series-charity-", vm.toString(n)));
        vm.prank(policyAdmin);
        core.setCharityAllowed(p.charityRecipient, true);
        uint256 h = makeRaise(p);
        r = newLongRoute(h, capKey(0), n);
        r.parentCap = p.rootCapability;
        address duplicate = recipients == Recipients.Duplicate ? seriesAccount(signer, vm.addr(shakerKey(run))) : address(0);
        for (uint256 i; i < n; ++i) {
            address shaker;
            uint256 shakerPk;
            if (duplicate != address(0)) {
                (shaker, shakerPk) = (duplicate, shakerKey(run));
            } else {
                shakerPk = shakerKey(run | (i + 1));
                shaker = seriesAccount(signer, vm.addr(shakerPk));
            }
            if (recipients == Recipients.Existing) bl.mint(shaker, 1);
            if (delivery == Delivery.Deferred) bl.setBlocked(shaker, true);
            putHop(r, i, seriesCapability(signer, i + 1), capKey(i + 1), shaker, shakerPk, r.claim - 1);
        }
        uint256 giverPk = shakerKey(run | 0xFFFF);
        address giver_ = seriesAccount(signer, vm.addr(giverPk));
        if (recipients == Recipients.Existing) {
            bl.mint(giver_, 1);
            bl.mint(p.charityRecipient, 1);
        }
        if (delivery == Delivery.Deferred) {
            bl.setBlocked(p.charityRecipient, true);
            bl.setBlocked(giver_, true);
        }
        t = buildTerminal(r, giver_, giverPk, DEFAULT_SOLUTION, defaultDeadline());
    }

    function thankSeries(Signer signer, Delivery delivery, Recipients recipients) internal {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000_000e6);
        uint256[8] memory hopCounts = [uint256(0), 1, 6, 7, 32, 255, 256, 257];
        for (uint256 k; k < hopCounts.length; ++k) {
            (RouteBuild memory r, Terminal memory t) = seriesRoute(bl, hopCounts[k], signer, delivery, recipients);
            bytes memory cd = abi.encodeCall(AHandCore.thank, (r.handId, r.hops, t));
            uint256 intrinsic = intrinsicGas(cd);
            uint256 exec = measureThank(r, t);
            assertEq(uint8(statusOf(r.handId)), uint8(Status.Settled));
            record(
                string.concat(
                    "thank hops=",
                    vm.toString(hopCounts[k]),
                    " signer=",
                    nameOf(signer),
                    " delivery=",
                    nameOf(delivery),
                    " recipients=",
                    nameOf(recipients),
                    " pushes=",
                    vm.toString(hopCounts[k] + 2),
                    " exec=",
                    vm.toString(exec),
                    " intrinsic=",
                    vm.toString(intrinsic),
                    " total=",
                    vm.toString(exec + intrinsic),
                    " calldata_bytes=",
                    vm.toString(cd.length)
                )
            );
        }
    }

    function test_gas_thank_eoa_pushed_fresh() public {
        thankSeries(Signer.EOA, Delivery.Pushed, Recipients.Fresh);
    }

    function test_gas_thank_eoa_pushed_existing() public {
        thankSeries(Signer.EOA, Delivery.Pushed, Recipients.Existing);
    }

    function test_gas_thank_eoa_pushed_duplicate() public {
        thankSeries(Signer.EOA, Delivery.Pushed, Recipients.Duplicate);
    }

    function test_gas_thank_eoa_deferred_fresh() public {
        thankSeries(Signer.EOA, Delivery.Deferred, Recipients.Fresh);
    }

    function test_gas_thank_eoa_deferred_existing() public {
        thankSeries(Signer.EOA, Delivery.Deferred, Recipients.Existing);
    }

    function test_gas_thank_eoa_deferred_duplicate() public {
        thankSeries(Signer.EOA, Delivery.Deferred, Recipients.Duplicate);
    }

    function test_gas_thank_erc1271_pushed_fresh() public {
        thankSeries(Signer.ERC1271, Delivery.Pushed, Recipients.Fresh);
    }

    function test_gas_thank_erc1271_pushed_existing() public {
        thankSeries(Signer.ERC1271, Delivery.Pushed, Recipients.Existing);
    }

    function test_gas_thank_erc1271_pushed_duplicate() public {
        thankSeries(Signer.ERC1271, Delivery.Pushed, Recipients.Duplicate);
    }

    function test_gas_thank_erc1271_deferred_fresh() public {
        thankSeries(Signer.ERC1271, Delivery.Deferred, Recipients.Fresh);
    }

    function test_gas_thank_erc1271_deferred_existing() public {
        thankSeries(Signer.ERC1271, Delivery.Deferred, Recipients.Existing);
    }

    function test_gas_thank_erc1271_deferred_duplicate() public {
        thankSeries(Signer.ERC1271, Delivery.Deferred, Recipients.Duplicate);
    }

    /// raise: first on a fresh Core (counter and custody cold), funded Public with two
    /// tags and a 60-byte ref, funded Dark 0 %, zero-pot Dark, funded through a proxied
    /// USDC-shaped token.
    function test_gas_raise() public {
        bytes memory ref60 = new bytes(60);
        for (uint256 i; i < 60; ++i) {
            ref60[i] = 0x61;
        }
        bytes32[] memory tags = tags2(bytes32(uint256(1)), bytes32(uint256(2)));
        RaiseParams memory p = defaultParams();

        vm.prank(raiser);
        core.raise(p, ref60, tags);
        record(string.concat("raise case=first_on_core funded public tags=2 ref=60 exec=", vm.toString(gasOfLastCall())));

        vm.prank(raiser);
        core.raise(p, ref60, tags);
        record(string.concat("raise case=funded_public tags=2 ref=60 exec=", vm.toString(gasOfLastCall())));

        RaiseParams memory dark = noCharityParams();
        dark.visibility = Visibility.Dark;
        dark.discoveryCommitment = bytes32(0);
        vm.prank(raiser);
        core.raise(dark, "", noTags());
        record(string.concat("raise case=funded_dark_0pct exec=", vm.toString(gasOfLastCall())));

        RaiseParams memory zero = zeroPotParams();
        zero.visibility = Visibility.Dark;
        zero.discoveryCommitment = bytes32(0);
        vm.prank(raiser);
        core.raise(zero, "", noTags());
        record(string.concat("raise case=zero_pot_dark exec=", vm.toString(gasOfLastCall())));

        FiatTokenLikeV1 usdc = deployFiatToken();
        usdc.mint(raiser, 10 * DEPOSIT);
        vm.prank(raiser);
        usdc.approve(address(core), type(uint256).max);
        p.token = address(usdc);
        vm.prank(raiser);
        core.raise(p, ref60, tags);
        record(string.concat("raise case=funded_public_fiat_proxy tags=2 ref=60 exec=", vm.toString(gasOfLastCall())));
    }

    /// reclaim: refund pushed, refund deferred (blacklisted raiser), zero pot; withdraw:
    /// to a fresh and to an existing balance; setCharityAllowed: add and remove.
    function test_gas_reclaim_withdraw_policy() public {
        uint256 h1 = makeRaise();
        warpToExpiry(h1);
        record(string.concat("reclaim case=pushed exec=", vm.toString(measureReclaim(core, stranger, h1))));

        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 3 * DEPOSIT); // the raiser keeps a balance: its refund lands on an existing slot
        uint256 h2 = makeRaise();
        uint256 h3 = makeRaise();
        bl.setBlocked(raiser, true);
        bl.setBlocked(giver, true);
        settleSimple(h3); // giver's 90e6 parks
        warpToExpiry(h2);
        record(string.concat("reclaim case=deferred exec=", vm.toString(measureReclaim(core, stranger, h2))));
        bl.setBlocked(raiser, false);
        bl.setBlocked(giver, false);
        core.withdraw(address(bl), giver);
        record(string.concat("withdraw case=fresh_recipient exec=", vm.toString(gasOfLastCall())));
        core.withdraw(address(bl), raiser);
        record(string.concat("withdraw case=existing_recipient exec=", vm.toString(gasOfLastCall())));

        useToken(address(usd));
        uint256 h4 = makeRaise(zeroPotParams());
        warpToExpiry(h4);
        record(string.concat("reclaim case=zero_pot exec=", vm.toString(measureReclaim(core, stranger, h4))));

        vm.prank(policyAdmin);
        core.setCharityAllowed(stranger, true);
        record(string.concat("setCharityAllowed case=add exec=", vm.toString(gasOfLastCall())));
        vm.prank(policyAdmin);
        core.setCharityAllowed(stranger, false);
        record(string.concat("setCharityAllowed case=remove exec=", vm.toString(gasOfLastCall())));
    }

    /// @dev One push frame as Core runs it: `pushExact` from Core's own address with
    ///      exactly PUSH_GAS; returns whether it landed and the gas the frame consumed.
    function frameCost(address token_, address to, uint256 amount) internal returns (bool ok, uint256 gas) {
        uint256 budget = core.PUSH_GAS();
        vm.prank(address(core));
        try core.pushExact{gas: budget}(token_, to, amount) {
            ok = true;
        } catch {}
        gas = gasOfLastCall();
        // an out-of-gas frame reports no gas figure: by definition it consumed the whole budget
        if (!ok && gas == 0) gas = budget;
    }

    function recordPush(string memory label, bool ok, uint256 gas) internal {
        record(string.concat("push case=", label, " ok=", ok ? "1" : "0", " frame_gas=", vm.toString(gas)));
    }

    /// The push-cost series for PUSH_GAS calibration: the gas consumed inside the
    /// frame per token shape and recipient, honest and hostile, and the headroom of
    /// PUSH_GAS over the heaviest honest push.
    function test_gas_push_cost() public {
        uint256 amount = 10e6;
        uint256 heaviestHonest;
        bool ok;
        uint256 gas;

        usd.mint(address(core), 10 * amount);
        (ok, gas) = frameCost(address(usd), makeAddr("fresh-usd"), amount);
        assertTrue(ok);
        recordPush("mockusd_fresh", ok, gas);
        heaviestHonest = gas > heaviestHonest ? gas : heaviestHonest;
        (ok, gas) = frameCost(address(usd), makeAddr("fresh-usd"), amount);
        assertTrue(ok);
        recordPush("mockusd_existing", ok, gas);

        FiatTokenLikeV1 usdc = deployFiatToken();
        usdc.mint(address(core), 10 * amount);
        (ok, gas) = frameCost(address(usdc), makeAddr("fresh-usdc"), amount);
        assertTrue(ok);
        recordPush("fiat_proxy_fresh", ok, gas);
        heaviestHonest = gas > heaviestHonest ? gas : heaviestHonest;
        (ok, gas) = frameCost(address(usdc), makeAddr("fresh-usdc"), amount);
        assertTrue(ok);
        recordPush("fiat_proxy_existing", ok, gas);
        usdc.blacklist(makeAddr("blocked-usdc"));
        (ok, gas) = frameCost(address(usdc), makeAddr("blocked-usdc"), amount);
        assertFalse(ok);
        recordPush("fiat_proxy_blacklisted_revert", ok, gas);

        BlacklistToken bl = new BlacklistToken();
        bl.mint(address(core), 10 * amount);
        bl.setBlocked(makeAddr("blocked-bl"), true);
        (ok, gas) = frameCost(address(bl), makeAddr("blocked-bl"), amount);
        assertFalse(ok);
        recordPush("blacklist_token_revert", ok, gas);

        HookToken hk = new HookToken();
        hk.mint(address(core), 10 * amount);
        NoopHookRecipient noop = new NoopHookRecipient();
        hk.setHooked(address(noop), true);
        (ok, gas) = frameCost(address(hk), address(noop), amount);
        assertTrue(ok);
        recordPush("hook_token_noop_recipient_fresh", ok, gas);
        heaviestHonest = gas > heaviestHonest ? gas : heaviestHonest;
        GasHogRecipient hog = new GasHogRecipient();
        hk.setHooked(address(hog), true);
        hog.setBurn(100_000);
        (ok, gas) = frameCost(address(hk), address(hog), amount);
        assertTrue(ok);
        recordPush("hook_token_gashog_100k_lands", ok, gas);
        hog.setBurn(250_000);
        (ok, gas) = frameCost(address(hk), address(hog), amount);
        assertFalse(ok);
        recordPush("hook_token_gashog_250k_oog", ok, gas);

        ReturndataBombToken rb = new ReturndataBombToken();
        rb.mint(address(core), 10 * amount);
        rb.setBomb(1_024, true, false);
        (ok, gas) = frameCost(address(rb), makeAddr("fresh-rb"), amount);
        assertTrue(ok);
        recordPush("returndata_bomb_1KiB_lands", ok, gas);
        heaviestHonest = gas > heaviestHonest ? gas : heaviestHonest;
        rb.setBomb(1 << 20, true, false);
        (ok, gas) = frameCost(address(rb), makeAddr("fresh-rb"), amount);
        assertFalse(ok);
        recordPush("returndata_bomb_1MiB_oog", ok, gas);

        GasHogToken gh = new GasHogToken();
        gh.mint(address(core), 10 * amount);
        gh.setHog(makeAddr("hog-gh"), true);
        gh.setHogGas(100_000);
        (ok, gas) = frameCost(address(gh), makeAddr("hog-gh"), amount);
        assertTrue(ok);
        recordPush("gashog_token_100k_lands", ok, gas);
        gh.setHogGas(250_000);
        (ok, gas) = frameCost(address(gh), makeAddr("hog-gh"), amount);
        assertFalse(ok);
        recordPush("gashog_token_250k_oog", ok, gas);

        uint256 budget = core.PUSH_GAS();
        record(
            string.concat(
                "push_headroom heaviest_honest_frame_gas=",
                vm.toString(heaviestHonest),
                " push_gas=",
                vm.toString(budget),
                " ratio_x100=",
                vm.toString(budget * 100 / heaviestHonest),
                " push_reserve=",
                vm.toString(core.PUSH_RESERVE()),
                " erc1271_gas=",
                vm.toString(core.ERC1271_GAS())
            )
        );
        assertGe(budget * 10, heaviestHonest * 14, "PUSH_GAS keeps >= 1.4x headroom over the heaviest honest push");
    }
}
