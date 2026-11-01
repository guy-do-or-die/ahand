// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {
    AllocationKind,
    AnonymousShakerWithMargin,
    ArtifactExpired,
    BoundsViolated,
    CapabilityProof,
    CharityNotAllowed,
    ClaimBelowFloor,
    ClaimMismatch,
    ClaimMustNotGrow,
    DeadlineExceedsExpiry,
    ExpiryInPast,
    Give,
    GiverAcceptanceInvalid,
    Hand,
    HandExpired,
    HandNotExpired,
    Hop,
    IAHandFacts,
    InexactDeposit,
    InsufficientGas,
    InvalidVisibilityData,
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
    TagsInvalid,
    Terminal,
    TransferInexact,
    UnexpectedAcceptance,
    UnexpectedCharityRecipient,
    Visibility,
    WrongHand,
    ZeroAddress,
    ZeroCapability,
    ZeroCharityAllocation,
    ZeroClaim,
    ZeroGiver,
    ZeroPotTerms
} from "./AHandTypes.sol";
import {AHandSig} from "./AHandSig.sol";
import {AHandMath, AHandSettlement} from "./AHandFacts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title  AHandCore
/// @author aHand
/// @notice Escrow, route verification, settlement and facts for the aHand protocol.
///         One immutable contract that does exactly four things with money —
///         `raise`, `thank`, `reclaim`, `withdraw` — and one thing with facts: it
///         records, in a form a later contract can verify without an indexer, what
///         was escrowed, what was consented to and what was paid.
/// @dev    Any ERC-20 per Hand in raw units; every deposit is measured as an exact
///         delta on both the payer and custody; every push runs as an exact custody
///         delta inside its own reverting frame (`pushExact`, self-only) behind a
///         gas-starvation guard; a failing push parks exactly its own share as a
///         claim. Core calls out only to the Hand's token, to signers via gas-capped
///         `staticcall`, and to itself for the rollback frame. No receive, no
///         fallback, no delegatecall, no approve, no pause, no rescue, no fee.
///         Settlement is strict checks-effects-interactions: every Hand write and
///         every fact event precedes the first token move. The four entry points
///         share one transient reentrancy lock; the frame carries none on purpose.
contract AHandCore is IAHandFacts, EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /*//////////////////// Constitution ////////////////////*/

    /// @notice Basis-point denominator: every bps value is out of 10 000.
    uint16 public constant BPS_DENOMINATOR = AHandMath.BPS;
    /// @notice Maximum charity share of a pool, in bps (30 %). No setter.
    uint16 public constant MAX_CHARITY_BPS = 3_000;
    /// @notice Maximum number of discovery tags on a raise (ADR-0005).
    uint256 public constant MAX_PUBLIC_TAGS = 8;
    /// @notice Maximum byte length of the discovery ref on a raise (ADR-0007).
    uint256 public constant MAX_DISCOVERY_REF = 128;
    /// @notice Gas cap per ERC-1271 verification: a hostile validator costs the
    ///         submitter at most this per signature and never blocks settlement.
    uint256 public constant ERC1271_GAS = 350_000;
    /// @notice Gas budget of one push frame (`pushExact`): a hostile token or
    ///         recipient wastes at most this per allocation and harms only its share.
    uint256 public constant PUSH_GAS = 200_000;
    /// @notice Gas the parent keeps after a frame: a cold claims SSTORE, the payout
    ///         event and the call overhead, so a passing guard also records the outcome.
    uint256 public constant PUSH_RESERVE = 30_000;

    /// @dev `bytes4(IERC1271.isValidSignature.selector)` as a word: the only accepted
    ///      ERC-1271 answer. A `bytes4` constant is not referenceable inside Yul.
    uint256 private constant ERC1271_MAGIC_WORD = 0x1626ba7e;

    /*//////////////////// Storage (order frozen) ////////////////////*/

    /// @notice Monotonic Hand counter; ids start at 1 and never repeat.
    uint256 public handsCount;
    /// @notice The bounded admin: edits the prospective charity allowlist, nothing else.
    address public policyAdmin;
    /// @notice Nominated next admin awaiting `acceptPolicyAdmin`; zero when none pending.
    address public pendingPolicyAdmin;
    /// @notice Count of real policy changes; snapshotted into `Raised` for provenance.
    uint64 public policyRevision;
    /// @dev The Hand store, exposed read-only through `facts` and `getHand`.
    mapping(uint256 => Hand) private _hands;
    /// @notice Prospective charity allowlist; never contains zero or this contract.
    mapping(address => bool) public charityAllowed;
    /// @notice Pull-payment ledger: `claims[token][beneficiary]`, aggregated across Hands.
    mapping(address => mapping(address => uint256)) public claims;

    /*//////////////////// Events ////////////////////*/

    /// @notice A Hand entered escrow. The full immutable snapshot plus the policy
    ///         revision in force, so an indexer needs no extra read.
    /// @param handId              The new Hand id.
    /// @param raiser              The funder: thank authority and refund destination.
    /// @param token               The escrowed token (zero for a zero-pot Hand).
    /// @param pool                The exact escrowed amount in raw units.
    /// @param expiry              The final expiry timestamp.
    /// @param rootCapability      The route's first signer.
    /// @param visibility          The discovery posture.
    /// @param metadataCommitment  The mandatory per-Hand envelope.
    /// @param discoveryCommitment The discovery envelope (zero in Dark).
    /// @param discoveryRef        The off-chain discovery ref bytes (empty in Dark).
    /// @param minGiverClaimBps    The floor no child claim may go below.
    /// @param charityRecipient    The snapshotted charity (zero when charityBps is zero).
    /// @param charityBps          The charity share in bps.
    /// @param policyRevision      The revision under which the charity check passed.
    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint256 pool,
        uint40 expiry,
        address rootCapability,
        Visibility visibility,
        bytes32 metadataCommitment,
        bytes32 discoveryCommitment,
        bytes discoveryRef,
        uint16 minGiverClaimBps,
        address charityRecipient,
        uint16 charityBps,
        uint64 policyRevision
    );

    /// @notice The discovery tags of a raise (emitted only when non-empty; never in Dark).
    /// @param handId The Hand id.
    /// @param raiser The raiser.
    /// @param tagIds The strictly ascending tag ids.
    event HandTagged(uint256 indexed handId, address indexed raiser, bytes32[] tagIds);

    /// @notice A Hand settled through `thank`: the pool split and every identity a reader needs.
    /// @param handId            The settled Hand id.
    /// @param giver             The terminal giver.
    /// @param token             The Hand's token.
    /// @param pool              P: the full escrowed pool.
    /// @param charityRecipient  The charity paid (zero when charityBps is zero).
    /// @param charityAllocation C = floor(P · charityBps / 10 000).
    /// @param distributable     D = P − C.
    /// @param giverAllocation   G = D − Σ hop allocations (absorbs all dust).
    /// @param routeHash         The verified route identity.
    /// @param giveHash          The EIP-712 struct hash of the accepted Give.
    /// @param solutionHash      The giver's solution commitment, now public.
    /// @param settlementHash    The stored settlement commitment (equals storage).
    /// @param hopCount          The number of hops, hence of `RouteHopSettled` events.
    /// @param closedAt          The settlement timestamp (equals storage).
    event Settled(
        uint256 indexed handId,
        address indexed giver,
        address token,
        uint256 pool,
        address charityRecipient,
        uint256 charityAllocation,
        uint256 distributable,
        uint256 giverAllocation,
        bytes32 routeHash,
        bytes32 giveHash,
        bytes32 solutionHash,
        bytes32 settlementHash,
        uint256 hopCount,
        uint40 closedAt
    );

    /// @notice One per route hop, in route order, including anonymous and zero-margin
    ///         hops. Self-contained: no chaining is needed if a log is missed.
    /// @param handId           The settled Hand id.
    /// @param routeHash        The verified route identity.
    /// @param position         Zero-based hop index.
    /// @param parentCapability The capability that signed this hop.
    /// @param childCapability  The capability this hop delegated to.
    /// @param parentClaimBps   The claim entering the hop.
    /// @param childClaimBps    The claim leaving the hop.
    /// @param shaker           The attributed shaker (zero = anonymous).
    /// @param shakeHash        The EIP-712 struct hash of the Shake.
    /// @param hopDataHash      The app-opaque hop envelope.
    /// @param marginAllocation A_i: the token units this hop's margin earned (zero if none).
    event RouteHopSettled(
        uint256 indexed handId,
        bytes32 indexed routeHash,
        uint256 position,
        address parentCapability,
        address childCapability,
        uint16 parentClaimBps,
        uint16 childClaimBps,
        address shaker,
        bytes32 shakeHash,
        bytes32 hopDataHash,
        uint256 marginAllocation
    );

    /// @notice A Hand was refunded in full to its raiser after expiry.
    /// @param handId The reclaimed Hand id.
    /// @param raiser The refund destination.
    /// @param token  The Hand's token.
    /// @param refund The full pool.
    event Reclaimed(uint256 indexed handId, address indexed raiser, address token, uint256 refund);

    /// @notice One per non-zero allocation: the grant ledger. Order within a thank is
    ///         Charity, ShakerMargin in route order, GiverResidual; RaiserRefund alone.
    /// @param handId      The Hand the allocation belongs to.
    /// @param token       The Hand's token.
    /// @param beneficiary The granted party.
    /// @param kind        Why the allocation was made.
    /// @param position    The hop index for ShakerMargin; zero otherwise.
    /// @param amount      The allocated amount.
    event PayoutAllocated(
        uint256 indexed handId,
        address indexed token,
        address indexed beneficiary,
        AllocationKind kind,
        uint256 position,
        uint256 amount
    );

    /// @notice An allocation was delivered to the beneficiary's wallet, exactly.
    /// @param handId      The Hand the payout belongs to.
    /// @param token       The Hand's token.
    /// @param beneficiary The recipient reached.
    /// @param kind        The allocation's kind (pairs with `PayoutAllocated`).
    /// @param position    The allocation's position (pairs with `PayoutAllocated`).
    /// @param amount      The pushed amount.
    event PayoutPushed(
        uint256 indexed handId,
        address indexed token,
        address indexed beneficiary,
        AllocationKind kind,
        uint256 position,
        uint256 amount
    );

    /// @notice An allocation the push frame could not deliver; parked as a claim,
    ///         withdrawable by anyone to the same beneficiary.
    /// @param handId      The Hand the payout belongs to.
    /// @param token       The Hand's token.
    /// @param beneficiary The recipient whose share was parked.
    /// @param kind        The allocation's kind (pairs with `PayoutAllocated`).
    /// @param position    The allocation's position (pairs with `PayoutAllocated`).
    /// @param amount      The amount now added to `claims[token][beneficiary]`.
    event PayoutDeferred(
        uint256 indexed handId,
        address indexed token,
        address indexed beneficiary,
        AllocationKind kind,
        uint256 position,
        uint256 amount
    );

    /// @notice A claim was drained to its beneficiary through `withdraw`.
    /// @param token       The token.
    /// @param beneficiary The fixed destination paid.
    /// @param amount      The whole aggregate claim.
    event PayoutWithdrawn(address indexed token, address indexed beneficiary, uint256 amount);

    /// @notice A charity was added to or removed from the prospective allowlist.
    /// @param charity        The charity.
    /// @param allowed        The new state.
    /// @param policyRevision The revision after the change (1 for constructor seeds).
    event CharityPolicyUpdated(address indexed charity, bool allowed, uint64 policyRevision);

    /// @notice A two-step admin handover was started; `newAdmin == 0` is the cancel.
    /// @param previousAdmin The current admin.
    /// @param newAdmin      The nominee, or zero.
    event PolicyAdminTransferStarted(address indexed previousAdmin, address indexed newAdmin);

    /// @notice The admin role changed hands (also at construction, from zero).
    /// @param previousAdmin The prior admin.
    /// @param newAdmin      The new admin.
    event PolicyAdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    /*//////////////////// Modifiers ////////////////////*/

    /// @dev Restricts a call to the current `policyAdmin`.
    modifier onlyPolicyAdmin() {
        if (msg.sender != policyAdmin) revert OnlyPolicyAdmin();
        _;
    }

    /*//////////////////// Construction ////////////////////*/

    /// @notice Deploys the escrow: seeds the charity allowlist and installs the policy admin.
    /// @dev    Domain: EIP-712 name "aHand", version "3". `policyRevision` is 1 after
    ///         construction; every seed is logged under revision 1. Seeds must be
    ///         non-zero, not this contract and not repeated.
    /// @param  charities    The genesis charity allowlist.
    /// @param  policyAdmin_ The bounded admin; non-zero.
    constructor(address[] memory charities, address policyAdmin_) EIP712("aHand", "3") {
        if (policyAdmin_ == address(0)) revert ZeroAddress(); // I-20
        policyAdmin = policyAdmin_;
        emit PolicyAdminTransferred(address(0), policyAdmin_);
        policyRevision = 1;
        for (uint256 i; i < charities.length; ++i) {
            _setCharityAllowed(charities[i], true, 1);
        }
    }

    /*//////////////////////////////////////////////////////////
        raise — the deposit enters escrow.
    //////////////////////////////////////////////////////////*/

    /// @notice Raise a Hand: escrow exactly `p.amount` of `p.token` under a fixed
    ///         policy snapshot and return its id. `msg.sender` becomes the raiser:
    ///         the only thank authority and the only refund destination.
    /// @dev    Validation order is fixed: (1) root capability, (2) zero-pot terms,
    ///         (3) bps bounds, (4) charity coherence, (5) expiry, (6) visibility,
    ///         (7) tags, then the policy revision snapshot, then (8) the measured
    ///         deposit, then effects. A zero `amount` makes no token call. Both the
    ///         payer's debit and Core's receipt must equal `amount`.
    /// @param  p            The raise parameters.
    /// @param  discoveryRef Off-chain discovery ref bytes (1..128 bytes; empty in Dark).
    /// @param  tags         Discovery tags, strictly ascending (at most 8; none in Dark).
    /// @return handId       The id of the new Hand.
    function raise(RaiseParams calldata p, bytes calldata discoveryRef, bytes32[] calldata tags)
        external
        nonReentrant
        returns (uint256 handId)
    {
        // (1) the route must start somewhere
        if (p.rootCapability == address(0)) revert ZeroAddress();
        // (2) I-21: a zero pot has no token, a funded pot has one
        if ((p.amount == 0) != (p.token == address(0))) revert ZeroPotTerms();
        // (3) I-22: the only product bounds that exist
        if (p.charityBps > MAX_CHARITY_BPS || p.minGiverClaimBps == 0 || p.minGiverClaimBps > BPS_DENOMINATOR) {
            revert BoundsViolated();
        }
        // (4) I-21: charity coherence — no recipient without a share, no share without
        //     an allowlisted recipient, and a declared donation pays at least one unit
        if (p.charityBps == 0) {
            if (p.charityRecipient != address(0)) revert UnexpectedCharityRecipient();
        } else {
            if (!charityAllowed[p.charityRecipient]) revert CharityNotAllowed();
            if (AHandMath.cut(p.amount, p.charityBps) == 0) revert ZeroCharityAllocation();
        }
        // (5) I-2: a Hand must open a thank window
        if (p.expiry <= block.timestamp) revert ExpiryInPast();
        // (6) visibility coherence; the metadata envelope is mandatory in every mode
        if (p.metadataCommitment == bytes32(0)) revert InvalidVisibilityData();
        if (p.visibility == Visibility.Dark) {
            if (discoveryRef.length != 0 || p.discoveryCommitment != bytes32(0) || tags.length != 0) {
                revert InvalidVisibilityData();
            }
        } else if (
            discoveryRef.length == 0 || discoveryRef.length > MAX_DISCOVERY_REF || p.discoveryCommitment == bytes32(0)
        ) {
            revert InvalidVisibilityData();
        }
        // (7) tags: bounded and strictly ascending — unique and non-zero in one pass
        if (tags.length > MAX_PUBLIC_TAGS) revert TagsInvalid();
        bytes32 previousTag = bytes32(0);
        for (uint256 i; i < tags.length; ++i) {
            if (tags[i] <= previousTag) revert TagsInvalid();
            previousTag = tags[i];
        }
        // The revision under which (4) passed, read before any token call: a hook that
        // reaches setCharityAllowed mid-deposit cannot make Raised name a later one.
        uint64 revision = policyRevision;
        // (8) I-5: exact entry on both sides; a zero pot makes no token call
        if (p.amount != 0) _pullExact(p.token, msg.sender, p.amount);

        // effects — field by field, skipping zero fields (a zero-over-zero SSTORE is not free).
        // The calldata fields of each packed word are bound first: a calldata read carries its
        // own validation branch, and stores on either side of one never merge into one SSTORE.
        handId = ++handsCount; // I-1: ids monotonic from 1
        Hand storage h = _hands[handId];
        uint40 expiry = p.expiry;
        Visibility visibility = p.visibility;
        h.raiser = msg.sender;
        h.expiry = expiry;
        h.visibility = visibility;
        h.status = Status.Active;
        address token = p.token;
        uint16 charityBps = p.charityBps;
        uint16 minGiverClaimBps = p.minGiverClaimBps;
        h.token = token;
        h.charityBps = charityBps;
        h.minGiverClaimBps = minGiverClaimBps;
        if (p.amount != 0) h.pool = p.amount;
        if (charityBps != 0) h.charityRecipient = p.charityRecipient;
        h.rootCapability = p.rootCapability;
        h.metadataCommitment = p.metadataCommitment;
        if (p.discoveryCommitment != bytes32(0)) h.discoveryCommitment = p.discoveryCommitment;

        emit Raised(
            handId,
            msg.sender,
            p.token,
            p.amount,
            p.expiry,
            p.rootCapability,
            p.visibility,
            p.metadataCommitment,
            p.discoveryCommitment,
            discoveryRef,
            p.minGiverClaimBps,
            p.charityRecipient,
            p.charityBps,
            revision
        );
        if (tags.length != 0) emit HandTagged(handId, msg.sender, tags);
    }

    /*//////////////////////////////////////////////////////////
        thank — one atomic settlement in four phases.
        A verify (view) · B math (pure) · C effects and fact events ·
        D pushes, each in its own isolated frame behind the starvation guard.
    //////////////////////////////////////////////////////////*/

    /// @notice Settle a Hand: verify the whole route and the Give, split the pool
    ///         (charity, per-hop margins, giver residual), commit the facts and pay
    ///         every party. Only the raiser may thank, only while Active, only
    ///         strictly before expiry.
    /// @dev    All-or-nothing on verification: the first invalid hop reverts the
    ///         whole call with its index (`hops.length` names the Give). Every Hand
    ///         write and every fact event precedes the first token move. Each push
    ///         either delivers exactly its allocation or parks exactly that share as
    ///         a claim; it can neither re-enter an entry point nor observe a
    ///         half-settled Hand.
    /// @param  handId The Active Hand to settle.
    /// @param  hops   The route hops in order, each with its proofs (any length).
    /// @param  t      The terminal Give with its proofs.
    function thank(uint256 handId, Hop[] calldata hops, Terminal calldata t) external nonReentrant {
        Hand storage h = _hands[handId];

        // Phase A — checks and verification: storage reads, pure hashing, ECDSA and
        // gas-capped staticcalls; zero mutation.
        if (h.status != Status.Active) revert NotActive(); // I-1
        if (block.timestamp >= h.expiry) revert HandExpired(); // I-2: expiry itself belongs to reclaim
        address raiser = h.raiser;
        if (msg.sender != raiser) revert NotRaiser(); // I-10
        uint256 pool = h.pool;
        uint256 charity = AHandMath.cut(pool, h.charityBps); // I-3: charity first, from P
        uint256 distributable = pool - charity;
        RouteFacts memory r = _verifyRoute(h, handId, hops, distributable);
        _verifyGive(h, handId, t, r);

        // Phase B — pure: the giver takes the residual, so P == C + Σ A_i + G exactly.
        uint256 residual = distributable - r.marginTotal; // I-3, I-4

        // Phase C — effects: every Hand write and every fact event before the first push.
        uint40 closedAt = SafeCast.toUint40(block.timestamp);
        h.status = Status.Settled; // I-1: terminal once
        h.closedAt = closedAt; // same slot as status
        address token = h.token;
        address charityRecipient = h.charityRecipient;
        bytes32 settlementHash = AHandSettlement.commitment(
            address(this),
            AHandSettlement.SettlementPreimage({
                handId: handId,
                raiser: raiser,
                giver: t.give.giver,
                token: token,
                charityRecipient: charityRecipient,
                pool: pool,
                charityAllocation: charity,
                giverAllocation: residual,
                routeHash: r.routeHash,
                giveHash: r.giveHash,
                solutionHash: t.give.solutionHash,
                closedAt: closedAt,
                occShakers: r.occShakers,
                occClaimDeltas: r.occClaimDeltas,
                occAllocations: r.hopAllocations
            })
        );
        h.settlementHash = settlementHash; // I-23: the one authenticated settlement fact

        emit Settled(
            handId,
            t.give.giver,
            token,
            pool,
            charityRecipient,
            charity,
            distributable,
            residual,
            r.routeHash,
            r.giveHash,
            t.give.solutionHash,
            settlementHash,
            hops.length,
            closedAt
        );
        address parentCapability = h.rootCapability;
        for (uint256 i; i < hops.length; ++i) {
            Shake calldata s = hops[i].shake;
            emit RouteHopSettled(
                handId,
                r.routeHash,
                i,
                parentCapability,
                s.childCapability,
                s.parentClaimBps,
                s.childClaimBps,
                s.shaker,
                r.shakeHashes[i],
                s.hopDataHash,
                r.hopAllocations[i]
            );
            parentCapability = s.childCapability;
        }
        // I-8: the grant ledger — one PayoutAllocated per non-zero allocation, in the
        // order the pushes follow: Charity, ShakerMargin per hop, GiverResidual.
        if (charity != 0) emit PayoutAllocated(handId, token, charityRecipient, AllocationKind.Charity, 0, charity);
        for (uint256 i; i < hops.length; ++i) {
            uint256 allocation = r.hopAllocations[i];
            if (allocation != 0) {
                emit PayoutAllocated(handId, token, hops[i].shake.shaker, AllocationKind.ShakerMargin, i, allocation);
            }
        }
        if (residual != 0) emit PayoutAllocated(handId, token, t.give.giver, AllocationKind.GiverResidual, 0, residual);

        // Phase D — interactions: one guarded, isolated frame per allocation.
        _pay(handId, token, charityRecipient, AllocationKind.Charity, 0, charity);
        for (uint256 i; i < hops.length; ++i) {
            uint256 allocation = r.hopAllocations[i];
            if (allocation != 0) _pay(handId, token, hops[i].shake.shaker, AllocationKind.ShakerMargin, i, allocation);
        }
        _pay(handId, token, t.give.giver, AllocationKind.GiverResidual, 0, residual);
    }

    /*//////////////////////////////////////////////////////////
        reclaim — expiry settlement. Permissionless; the refund can only
        ever go to the raiser. Success-only charity: the full pool refunds.
    //////////////////////////////////////////////////////////*/

    /// @notice Refund an expired, unsettled Hand in full to its raiser. Anyone may
    ///         call; the destination is fixed in storage.
    /// @dev    Requires Active and `now ≥ expiry`; the thank window is strictly
    ///         before expiry, so the two terminal transitions never overlap. The
    ///         pool stays recorded; the liability is retired by the status change.
    ///         A zero-pot Hand flips status and `closedAt` only.
    /// @param  handId The Active, expired Hand.
    function reclaim(uint256 handId) external nonReentrant {
        Hand storage h = _hands[handId];
        if (h.status != Status.Active) revert NotActive(); // I-1
        if (block.timestamp < h.expiry) revert HandNotExpired(); // I-2

        h.status = Status.Reclaimed; // I-1: terminal once
        h.closedAt = SafeCast.toUint40(block.timestamp); // same slot as status
        (address token, address raiser, uint256 pool) = (h.token, h.raiser, h.pool);

        emit Reclaimed(handId, raiser, token, pool);
        if (pool != 0) emit PayoutAllocated(handId, token, raiser, AllocationKind.RaiserRefund, 0, pool);
        _pay(handId, token, raiser, AllocationKind.RaiserRefund, 0, pool); // I-10: destination fixed
    }

    /*//////////////////////////////////////////////////////////
        withdraw — the exit for deferred value. Permissionless with a fixed
        destination: anyone pays the gas, nobody redirects the funds.
    //////////////////////////////////////////////////////////*/

    /// @notice Drain the whole claim of `beneficiary` in `token`, paying it to
    ///         `beneficiary`. Anyone may call and pay the gas.
    /// @dev    The claim is zeroed before the transfer and the transfer must be
    ///         exact; any failure reverts the whole call, which restores the claim.
    ///         Never gated by policy. A token that blocks the beneficiary leaves the
    ///         claim stranded; there is no redirect by design.
    /// @param  token       The token of the claim.
    /// @param  beneficiary The claimant and the fixed destination.
    function withdraw(address token, address beneficiary) external nonReentrant {
        uint256 amount = claims[token][beneficiary];
        if (amount == 0) revert ZeroClaim(); // covers beneficiary == 0 and unknown tokens
        claims[token][beneficiary] = 0;
        _transferExact(token, beneficiary, amount); // I-7: exact or the whole call reverts
        emit PayoutWithdrawn(token, beneficiary, amount);
    }

    /*//////////////////////////////////////////////////////////
        pushExact — the self-only rollback frame.
    //////////////////////////////////////////////////////////*/

    /// @notice The rollback frame of one push: moves exactly `amount` of `token` to
    ///         `to` or reverts. Callable solely by this contract.
    /// @dev    Exists because the EVM has no sub-transaction other than a call
    ///         frame: a transfer that does not move exactly `amount` units must leave
    ///         no trace, and only a reverted frame guarantees that. Writes no Core
    ///         storage. Carries NO `nonReentrant` on purpose: the transient lock is
    ///         transaction-scoped, so a reflexive modifier would revert every frame
    ///         and silently park every payout as a claim.
    /// @param  token  The token to move.
    /// @param  to     The recipient.
    /// @param  amount The exact amount.
    function pushExact(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert OnlySelf(); // I-17: reachable from no external account
        _transferExact(token, to, amount);
    }

    /*//////////////////// Policy (prospective only) ////////////////////*/

    /// @notice Add or remove a charity for FUTURE donation Hands. Live Hands keep
    ///         their snapshotted recipient; no claim, deadline or formula is touched.
    /// @dev    Bumps `policyRevision` by exactly one per real change. Zero and this
    ///         contract can never be allowlisted. Moves no money, so no lock.
    /// @param  charity The charity.
    /// @param  allowed The new state; must differ from the current one.
    function setCharityAllowed(address charity, bool allowed) external onlyPolicyAdmin {
        _setCharityAllowed(charity, allowed, ++policyRevision); // the bump is undone with any revert below
    }

    /// @notice Start the two-step admin handover; nominating zero cancels a pending one.
    /// @dev    Re-nominating the current nominee (including zero over zero) is `NoChange`.
    ///         No revision bump: the policy itself does not change.
    /// @param  newAdmin The nominee, or zero to cancel.
    // forge-lint: disable-next-line(missing-zero-check) — zero is the cancel by design
    function transferPolicyAdmin(address newAdmin) external onlyPolicyAdmin {
        if (newAdmin == pendingPolicyAdmin) revert NoChange();
        pendingPolicyAdmin = newAdmin;
        emit PolicyAdminTransferStarted(policyAdmin, newAdmin);
    }

    /// @notice Accept the admin role. Only the pending admin may call.
    /// @dev    A zero nomination can never be accepted: no account is the zero address.
    function acceptPolicyAdmin() external {
        if (msg.sender != pendingPolicyAdmin) revert NotPendingAdmin(); // I-20
        emit PolicyAdminTransferred(policyAdmin, msg.sender);
        policyAdmin = msg.sender;
        pendingPolicyAdmin = address(0);
    }

    /*//////////////////// Facts (view; no external calls) ////////////////////*/

    /// @inheritdoc IAHandFacts
    function facts(uint256 handId) external view returns (HandFacts memory) {
        Hand storage h = _hands[handId];
        // I-25: every stored field, in the frozen interface shape
        return HandFacts({
            status: h.status,
            raiser: h.raiser,
            token: h.token,
            pool: h.pool,
            charityBps: h.charityBps,
            charityRecipient: h.charityRecipient,
            minGiverClaimBps: h.minGiverClaimBps,
            rootCapability: h.rootCapability,
            expiry: h.expiry,
            closedAt: h.closedAt,
            visibility: h.visibility,
            metadataCommitment: h.metadataCommitment,
            discoveryCommitment: h.discoveryCommitment,
            settlementHash: h.settlementHash
        });
    }

    /// @notice The full Hand snapshot for apps, the SDK and tests.
    /// @dev    ABI-coupled to THIS Core's layout; contracts bind to `facts` instead.
    /// @param  handId The Hand id.
    /// @return The Hand by value (all zero if never raised).
    function getHand(uint256 handId) external view returns (Hand memory) {
        return _hands[handId];
    }

    /// @notice The EIP-712 domain separator every aHand signature is bound to.
    /// @dev    Cached at deployment and recomputed when the chain id or this address
    ///         differs (fork safety). `eip712Domain()` (ERC-5267) exposes the fields.
    /// @return The current domain separator.
    // forge-lint: disable-next-line(mixed-case-function)
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /*//////////////////// Settlement internals ////////////////////*/

    /// @dev Memory carrier of the verified-route facts: filled by `_verifyRoute`,
    ///      completed by `_verifyGive`, consumed by thank's Phases B–D.
    struct RouteFacts {
        bytes32 routeHash;
        bytes32 giveHash;
        address terminalCapability; // the root itself on a zero-shake route
        uint16 finalClaimBps; // the claim the route leaves to the giver
        uint256 marginTotal; // Σ hopAllocations
        bytes32[] shakeHashes; // per hop
        uint256[] hopAllocations; // per hop: A_i = cut(D, δ_i); zero for zero-margin hops
        address[] occShakers; // per hop: attributed shaker, anonymous zeros preserved
        uint16[] occClaimDeltas; // per hop: δ_i
    }

    /// @dev Walks the delegation chain from the stored root capability at 10 000 bps:
    ///      verifies every hop's signature, claim telescoping, deadlines and shaker
    ///      consent, and records the per-hop facts. Atomic by design: the first
    ///      invalid hop reverts the whole thank with its index.
    /// @param h             The Hand (root, floor, expiry).
    /// @param handId        The Hand id every hop must reference.
    /// @param hops          The route hops in order.
    /// @param distributable D = P − C, the base every margin is floored from.
    /// @return r            The route facts (`giveHash` still unset).
    function _verifyRoute(Hand storage h, uint256 handId, Hop[] calldata hops, uint256 distributable)
        private
        view
        returns (RouteFacts memory r)
    {
        uint256 n = hops.length;
        r.shakeHashes = new bytes32[](n);
        r.hopAllocations = new uint256[](n);
        r.occShakers = new address[](n);
        r.occClaimDeltas = new uint16[](n);

        bytes32 ds = _domainSeparatorV4();
        address expectedCapability = h.rootCapability; // I-11: the chain starts at the stored root
        uint16 expectedClaim = BPS_DENOMINATOR;
        uint40 expiry = h.expiry;
        uint16 floorBps = h.minGiverClaimBps;

        for (uint256 i; i < n; ++i) {
            Hop calldata hop = hops[i];
            Shake calldata s = hop.shake;
            if (s.handId != handId) revert WrongHand(i); // I-14
            if (s.childCapability == address(0)) revert ZeroCapability(i); // I-11
            bytes32 shakeHash = AHandSig.hashShake(s);
            if (!_isValidSig(expectedCapability, AHandSig.digest(ds, shakeHash), hop.capabilitySig)) {
                revert CapabilityProof(i); // I-11: signer_i == child_{i−1}
            }
            if (s.parentClaimBps != expectedClaim) revert ClaimMismatch(i); // I-11
            if (s.childClaimBps > s.parentClaimBps) revert ClaimMustNotGrow(i); // I-11
            if (s.childClaimBps < floorBps) revert ClaimBelowFloor(i); // I-4
            if (block.timestamp > s.deadline) revert ArtifactExpired(i); // I-2
            if (s.deadline > expiry) revert DeadlineExceedsExpiry(i); // I-2

            uint16 margin = s.parentClaimBps - s.childClaimBps;
            uint256 allocation = 0;
            if (margin != 0) {
                // I-12: a paid hop names its payee — attribution is a fact even when money is not
                if (s.shaker == address(0)) revert AnonymousShakerWithMargin(i);
                allocation = AHandMath.cut(distributable, margin); // I-3, I-27: each hop floored from D
                if (allocation == 0 && distributable != 0) revert MarginRoundsToZero(i); // I-21
            }
            // I-12: the consent matrix — explicit shakers prove consent through their own
            // verifier; anonymous and self-attributed hops carry no acceptance bytes
            if (s.shaker != address(0) && s.shaker != expectedCapability) {
                bytes32 acceptanceDigest = AHandSig.digest(ds, AHandSig.hashShakerAcceptance(shakeHash));
                if (!_isValidSig(s.shaker, acceptanceDigest, hop.shakerAcceptanceSig)) {
                    revert ShakerAcceptanceInvalid(i);
                }
            } else if (hop.shakerAcceptanceSig.length != 0) {
                revert UnexpectedAcceptance(i);
            }

            r.shakeHashes[i] = shakeHash;
            r.occShakers[i] = s.shaker;
            r.occClaimDeltas[i] = margin;
            r.hopAllocations[i] = allocation;
            r.marginTotal += allocation;
            expectedCapability = s.childCapability;
            expectedClaim = s.childClaimBps;
        }

        r.terminalCapability = expectedCapability;
        r.finalClaimBps = expectedClaim;
        r.routeHash = AHandSig.hashRoute(AHandSig.handRef(address(this), handId), r.shakeHashes); // I-14
    }

    /// @dev Binds the Give to the verified route and checks both terminal
    ///      signatures: the terminal capability's Give and the giver's acceptance.
    ///      Every indexed error names the Give as position `hops.length`.
    /// @param h      The Hand (expiry).
    /// @param handId The Hand id the Give must reference.
    /// @param t      The terminal Give with its proofs.
    /// @param r      The route facts; `giveHash` is set here.
    function _verifyGive(Hand storage h, uint256 handId, Terminal calldata t, RouteFacts memory r) private view {
        uint256 n = r.shakeHashes.length;
        Give calldata g = t.give;
        if (g.handId != handId) revert WrongHand(n); // I-14
        if (g.routeHash != r.routeHash) revert RouteHashMismatch(); // I-13: the exact route, no substitution
        if (g.finalClaimBps != r.finalClaimBps) revert ClaimMismatch(n); // I-13
        if (g.giver == address(0)) revert ZeroGiver(); // I-13
        if (block.timestamp > g.deadline) revert ArtifactExpired(n); // I-2
        if (g.deadline > h.expiry) revert DeadlineExceedsExpiry(n); // I-2

        bytes32 ds = _domainSeparatorV4();
        bytes32 giveHash = AHandSig.hashGive(g);
        if (!_isValidSig(r.terminalCapability, AHandSig.digest(ds, giveHash), t.capabilitySig)) {
            revert CapabilityProof(n); // I-11
        }
        // I-12: the giver's consent is always required, even when giver == terminal capability
        bytes32 acceptanceDigest = AHandSig.digest(ds, AHandSig.hashGiverAcceptance(giveHash));
        if (!_isValidSig(g.giver, acceptanceDigest, t.giverAcceptanceSig)) revert GiverAcceptanceInvalid();
        r.giveHash = giveHash;
    }

    /// @dev One verifier for all four signature families. ECDSA first (65 bytes,
    ///      low-s, valid v; empty bytes never recover); then, only for a signer with
    ///      code, a gas-capped, mutation-proof ERC-1271 `staticcall` with a fixed
    ///      32-byte out buffer: the only accepted answer is the magic word.
    /// @param signer The expected signer (EOA or contract).
    /// @param digest The EIP-712 digest.
    /// @param sig    The signature bytes (whatever the signer's verifier accepts).
    /// @return ok    True iff `signer` validates `sig` over `digest`.
    function _isValidSig(address signer, bytes32 digest, bytes calldata sig) private view returns (bool ok) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, sig);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
        if (signer.code.length == 0) return false;
        // I-15: staticcall, ≤ ERC1271_GAS, fixed out buffer, strict magic word
        bytes memory cd = abi.encodeCall(IERC1271.isValidSignature, (digest, sig));
        assembly ("memory-safe") {
            let success := staticcall(ERC1271_GAS, signer, add(cd, 0x20), mload(cd), 0x00, 0x20)
            ok := and(success, and(gt(returndatasize(), 0x1f), eq(shr(224, mload(0x00)), ERC1271_MAGIC_WORD)))
        }
    }

    /*//////////////////// Delivery internals ////////////////////*/

    /// @dev Deliver one allocation: a guarded push in an isolated frame, parking
    ///      exactly `amount` as a claim if the frame fails. A zero amount is a no-op
    ///      (zero-pot Hands, 0 % donation, zero residual).
    /// @param handId   The Hand (for the event).
    /// @param token    The token.
    /// @param to       The recipient.
    /// @param kind     The allocation kind.
    /// @param position The allocation position.
    /// @param amount   The allocation; no-op if zero.
    function _pay(uint256 handId, address token, address to, AllocationKind kind, uint256 position, uint256 amount)
        private
    {
        if (amount == 0) return;
        // I-9: EIP-150 forwards at most 63/64 of what is left, so guarantee the frame its
        // full budget — a caller cannot under-fund gas to park someone's share as a claim.
        if (gasleft() < PUSH_GAS * 64 / 63 + PUSH_RESERVE) revert InsufficientGas();
        if (_pushFrame(token, to, amount)) {
            emit PayoutPushed(handId, token, to, kind, position, amount);
        } else {
            claims[token][to] += amount; // I-8: exactly this share, nothing else
            emit PayoutDeferred(handId, token, to, kind, position, amount);
        }
    }

    /// @dev The outer call of the frame, with `out = 0`: the parent never copies
    ///      returndata, so a returndata bomb cannot inflate the parent's cost.
    /// @param token  The token.
    /// @param to     The recipient.
    /// @param amount The exact amount.
    /// @return ok    True iff the frame moved exactly `amount`.
    function _pushFrame(address token, address to, uint256 amount) private returns (bool ok) {
        bytes memory cd = abi.encodeCall(this.pushExact, (token, to, amount));
        assembly ("memory-safe") {
            ok := call(PUSH_GAS, address(), 0, add(cd, 0x20), mload(cd), 0, 0)
        }
    }

    /// @dev Exit: the OpenZeppelin `safeTransfer` return rule (a reverting token
    ///      bubbles its own data; a false, short or odd return reverts
    ///      `SafeERC20FailedOperation`) AND an exact custody debit.
    /// @param token  The token.
    /// @param to     The recipient.
    /// @param amount The exact amount.
    function _transferExact(address token, address to, uint256 amount) private {
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(to, amount);
        if (IERC20(token).balanceOf(address(this)) + amount != before) revert TransferInexact(); // I-7
    }

    /// @dev Entry (raise only): both the payer's debit and Core's receipt must equal
    ///      `amount`, so sender-side fees or burns are rejected at the door and not
    ///      discovered at every exit.
    /// @param token  The token.
    /// @param from   The payer.
    /// @param amount The exact amount.
    function _pullExact(address token, address from, uint256 amount) private {
        uint256 fromBefore = IERC20(token).balanceOf(from);
        uint256 coreBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) != coreBefore + amount) revert InexactDeposit(); // I-5: receipt
        if (IERC20(token).balanceOf(from) + amount != fromBefore) revert InexactDeposit(); // I-5: debit
    }

    /*//////////////////// Policy internals ////////////////////*/

    /// @dev The one door into the allowlist, shared by the constructor and the
    ///      setter: never zero, never this contract, never a no-op.
    /// @param charity  The charity.
    /// @param allowed  The new state.
    /// @param revision The revision to log.
    function _setCharityAllowed(address charity, bool allowed, uint64 revision) private {
        if (charity == address(0)) revert ZeroAddress(); // I-20
        if (charity == address(this)) revert CharityNotAllowed(); // I-20: Core never pays itself
        if (charityAllowed[charity] == allowed) revert NoChange(); // I-20: revision counts real changes
        charityAllowed[charity] = allowed;
        emit CharityPolicyUpdated(charity, allowed, revision);
    }
}
