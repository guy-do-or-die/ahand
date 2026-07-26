// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTypes.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title  AHandCore
/// @author aHand
/// @notice Escrow and settlement for the aHand protocol. A single immutable
///         reward token, success-only charity, and consensual route attribution.
///         thank settles a successful Hand and pays every party; reclaim refunds
///         the raiser the full pool after expiry. Any payout a direct push cannot
///         deliver (blacklisted or hostile recipient) is parked as a claim and
///         drained later through the permissionless, fixed-destination withdraw.
/// @dev    No receive() or fallback() by design. Settlement follows strict
///         checks-effects-interactions: all verification is view-only (Phase A),
///         all math is pure (Phase B), ALL state is finalized and events emitted
///         (Phase C) BEFORE any token is moved — and the whole entry point is
///         nonReentrant. The reward token is a known, hookless USDC-style token,
///         so the trailing pushes cannot re-enter or observe a half-settled Hand.
///         Signals coupling is one-way: Signals reads getHand(); Core never calls out.
contract AHandCore is IAHandCoreView {
    using SafeERC20 for IERC20;

    /*//////////////////// Constitution ////////////////////*/
    /// @notice Basis-point denominator: every bps value is out of 10000.
    uint16  public constant BPS_DENOMINATOR   = 100_00;
    /// @notice Minimum charity share of a raise, in bps (1%).
    uint16  public constant MIN_CHARITY_BPS   = 1_00;
    /// @notice Maximum charity share of a raise, in bps (30%).
    uint16  public constant MAX_CHARITY_BPS   = 30_00;
    /// @notice Maximum number of hops (Shakes) a single route may carry.
    uint256 public constant MAX_SHAKES        = 6;
    /// @notice Minimum lifetime of a Hand from raise to expiry.
    uint40  public constant MIN_EXPIRY        = 1 days;
    /// @notice Maximum lifetime of a Hand from raise to expiry.
    uint40  public constant MAX_EXPIRY        = 180 days;
    /// @notice Maximum number of public discovery tags on a raise.
    uint256 public constant MAX_PUBLIC_TAGS   = 8;
    /// @notice Maximum byte length of the off-chain discovery ref on a raise.
    uint256 public constant MAX_DISCOVERY_REF = 128;
    /// @dev Per-verification gas ceiling for ERC-1271 wallets. Worst thank:
    ///      14 verifications (6 shakes + 6 acceptances + give + giver acceptance)
    ///      x 350k ~= 4.9M gas ceiling — acceptable on Base.
    uint256 public constant ERC1271_GAS       = 350_000;
    /// @dev Gas forwarded to each settlement push. Enough for USDC's transfer
    ///      (proxy delegatecall + blacklist check + balance writes, ~65k), bounded
    ///      so a pathological recipient can waste at most this before we defer.
    uint256 public constant PUSH_GAS_STIPEND  = 120_000;

    /// @notice The ERC-1271 `isValidSignature(bytes32,bytes)` selector.
    /// @dev The selector doubles as the required magic return value on success.
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e; // isValidSignature(bytes32,bytes)

    /*//////////////////// Immutables ////////////////////*/
    /// @notice The single token every Hand escrows; enforced at raise.
    address public immutable rewardToken;
    /// @notice Token units -> 1e18-scaled USD, snapshot into each Hand at raise.
    uint64  public immutable usdScale; // == 10**(18 - rewardToken.decimals())

    /// @dev Chain id captured at deployment; the domain separator cache is only
    ///      trusted while block.chainid still equals this (fork safety).
    uint256 private immutable _deploymentChainId;
    /// @dev Domain separator cached at deployment; recomputed on a forked chain.
    bytes32 private immutable _deploymentDomainSeparator;

    /*//////////////////// Storage (order frozen) ////////////////////*/
    /// @notice Monotonic Hand counter; also the id of the most recent Hand.
    uint256 public handsCount;
    /// @notice The bounded admin: may flip the token switch and edit the charity allowlist.
    address public policyAdmin;
    /// @notice Nominated next admin awaiting acceptPolicyAdmin; zero when none pending.
    address public pendingPolicyAdmin;
    /// @notice Prospective-only switch: gates new raises, never live Hands or withdrawals.
    bool    public tokenEnabled;
    /// @notice Bumped on every policy mutation; snapshot into Raised for provenance.
    uint64  public policyRevision;
    /// @dev The Hand store, keyed by handId; exposed read-only via getHand().
    mapping(uint256 => Hand) private _hands;
    /// @notice Charity allowlist snapshotted at raise; prospective-only edits.
    mapping(address => bool) public charityAllowed;
    /// @notice Pull-payment ledger: claims[token][beneficiary] aggregates across Hands.
    mapping(address => mapping(address => uint256)) public claims;

    /*//////////////////// Events ////////////////////*/
    /// @notice A new Hand entered escrow. Carries the full immutable policy snapshot
    ///         (plus policyRevision for provenance) so indexers need no extra reads.
    /// @param handId              The new Hand id.
    /// @param raiser              The account that raised and funded the Hand.
    /// @param token               The reward token escrowed (always the immutable rewardToken).
    /// @param credited            The exact deposited amount now escrowed.
    /// @param usdScaleAtRaise     The USD scale snapshot for this Hand.
    /// @param policyRevision      The policy counter value at raise time.
    /// @param expiry              The Hand expiry timestamp.
    /// @param rootCapability      The route's root capability address.
    /// @param visibility          The discovery posture.
    /// @param metadataCommitment  Mandatory metadata commitment.
    /// @param discoveryCommitment Discovery commitment (zero only in Dark mode).
    /// @param discoveryRef        Off-chain discovery ref bytes (empty in Dark mode).
    /// @param minGiverClaimBps    The floor a child claim may not go below.
    /// @param charityRecipient    The allowlisted charity recipient.
    /// @param charityBps          The charity share in bps.
    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint96     credited,
        uint64     usdScaleAtRaise,
        uint64     policyRevision,
        uint40     expiry,
        address    rootCapability,
        Visibility visibility,
        bytes32    metadataCommitment,
        bytes32    discoveryCommitment,
        bytes      discoveryRef,
        uint16     minGiverClaimBps,
        address    charityRecipient,
        uint16     charityBps
    );

    /// @notice The public discovery tags attached to a raise (emitted only if non-empty).
    /// @param handId The Hand id.
    /// @param raiser The raiser.
    /// @param tagIds The strictly-ascending tag ids.
    event HandTagged(uint256 indexed handId, address indexed raiser, bytes32[] tagIds);

    /// @notice A Hand settled successfully via thank. Summarizes the pool split.
    /// @param handId            The settled Hand id.
    /// @param giver             The terminal giver.
    /// @param solutionHash      The giver's solution commitment.
    /// @param routeHash         The verified route identity.
    /// @param giveHash          The EIP-712 hash of the accepted Give.
    /// @param token             The reward token.
    /// @param creditedPool      P — the full escrowed pool.
    /// @param distributablePool D = P − charity — the routed portion.
    /// @param giverAllocation   The giver's residual share (absorbs flooring dust).
    /// @param charityRecipient  The charity paid.
    /// @param charityAllocation C = floor(P * charityBps / 1e4).
    /// @param usdScale          The Hand's USD scale snapshot.
    /// @param charityUsd        charityAllocation * usdScale (1e18-scaled USD).
    event Settled(
        uint256 indexed handId,
        address indexed giver,
        bytes32 solutionHash,
        bytes32 routeHash,
        bytes32 giveHash,
        address token,
        uint96  creditedPool,
        uint96  distributablePool,
        uint96  giverAllocation,
        address charityRecipient,
        uint96  charityAllocation,
        uint64  usdScale,
        uint256 charityUsd
    );

    /// @notice One per route hop, including anonymous and zero-margin occurrences.
    /// @param handId           The settled Hand id.
    /// @param routeHash        The verified route identity.
    /// @param position         Zero-based hop index in route order.
    /// @param parentCapability The capability that delegated into this hop.
    /// @param childCapability  The capability this hop delegated to.
    /// @param parentClaimBps   The parent's claim entering the hop.
    /// @param childClaimBps    The child's claim leaving the hop.
    /// @param shaker           The attributed shaker (zero = anonymous).
    /// @param shakeHash        The EIP-712 hash of the hop's Shake.
    /// @param hopDataHash      The app-opaque hop commitment.
    /// @param marginAllocation The token amount credited for this hop's margin (zero if none).
    event RouteHopSettled(
        uint256 indexed handId,
        bytes32 indexed routeHash,
        uint8   position,
        address parentCapability,
        address childCapability,
        uint16  parentClaimBps,
        uint16  childClaimBps,
        address shaker,
        bytes32 shakeHash,
        bytes32 hopDataHash,
        uint96  marginAllocation
    );

    /// @notice A Hand was refunded to its raiser after expiry.
    /// @param handId The reclaimed Hand id.
    /// @param raiser The refunded raiser.
    /// @param token  The reward token.
    /// @param refund The full refunded pool.
    event Reclaimed(uint256 indexed handId, address indexed raiser, address token, uint96 refund);

    /// @notice One per non-zero claim credit; routePosition meaningful for ShakerMargin only.
    /// @param handId        The Hand the allocation belongs to.
    /// @param token         The reward token.
    /// @param beneficiary   The credited party.
    /// @param kind          Why the allocation was made.
    /// @param routePosition Hop index (meaningful for ShakerMargin; zero otherwise).
    /// @param amount        The allocated token amount.
    event PayoutAllocated(
        uint256 indexed handId,
        address indexed token,
        address indexed beneficiary,
        AllocationKind kind,
        uint8   routePosition,
        uint96  amount
    );

    /// @notice A settlement allocation delivered straight to the beneficiary's wallet.
    /// @param handId      The Hand the payout belongs to.
    /// @param token       The reward token.
    /// @param beneficiary The recipient the push reached.
    /// @param amount      The pushed amount.
    event PayoutPushed(uint256 indexed handId, address indexed token, address indexed beneficiary, uint96 amount);
    /// @notice A settlement allocation the push could not deliver (e.g. a blacklisted
    ///         or reverting recipient); parked as a claim, withdrawable by anyone.
    /// @param handId      The Hand the payout belongs to.
    /// @param token       The reward token.
    /// @param beneficiary The recipient whose funds were deferred to a claim.
    /// @param amount      The deferred amount now credited to claims[token][beneficiary].
    event PayoutDeferred(uint256 indexed handId, address indexed token, address indexed beneficiary, uint96 amount);

    /// @notice A deferred claim was drained to its beneficiary via withdraw.
    /// @param token       The reward token.
    /// @param beneficiary The fixed destination the claim paid.
    /// @param amount      The withdrawn aggregate.
    event PayoutWithdrawn(address indexed token, address indexed beneficiary, uint256 amount);

    /// @notice The prospective token switch was flipped.
    /// @param token          The reward token.
    /// @param enabled        The new enabled state (gates new raises only).
    /// @param policyRevision The policy counter after the change.
    event TokenPolicyUpdated(address indexed token, bool enabled, uint64 policyRevision);
    /// @notice A charity was added to or removed from the allowlist (prospective-only).
    /// @param charity        The charity address.
    /// @param allowed        The new allowlist state.
    /// @param policyRevision The policy counter after the change.
    event CharityPolicyUpdated(address indexed charity, bool allowed, uint64 policyRevision);
    /// @notice A two-step admin handover was initiated (or cancelled, if newAdmin is zero).
    /// @param previousAdmin The current admin that initiated the handover.
    /// @param newAdmin      The nominated admin (zero cancels a pending handover).
    event PolicyAdminTransferStarted(address indexed previousAdmin, address indexed newAdmin);
    /// @notice The admin role was transferred (also emitted at construction from the zero address).
    /// @param previousAdmin The prior admin.
    /// @param newAdmin      The new admin.
    event PolicyAdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    /*//////////////////// Modifiers ////////////////////*/
    /// @dev Restricts a call to the current policyAdmin.
    modifier onlyPolicyAdmin() {
        if (msg.sender != policyAdmin) revert OnlyPolicyAdmin();
        _;
    }

    /// @dev Transient storage-based reentrancy guard (Cancun target). Guards raise,
    ///      thank, reclaim and withdraw; the lock is set on entry and cleared on
    ///      exit within the same transaction, so the settlement pushes cannot
    ///      re-enter any guarded entry point.
    modifier nonReentrant() {
        bytes32 slot = 0xb7a1c4371fbfb1e7fa8f6cdb642ec34b9d038fa8d390a78622f99092ec0b6389; // keccak256("AHandCore.reentrancy.slot")
        bool locked;
        assembly {
            locked := tload(slot)
            tstore(slot, 1)
        }
        if (locked) revert Reentrancy();
        _;
        assembly {
            tstore(slot, 0)
        }
    }

    /*//////////////////// Construction ////////////////////*/
    /// @notice Deploys the escrow: pins the reward token and its USD scale, seeds
    ///         the charity allowlist, and installs the initial policy admin.
    /// @dev    Validates usdScale_ against the token's on-chain decimals and caches
    ///         the domain separator. Seeds tokenEnabled = true and policyRevision = 1.
    /// @param token       The single reward token (enforced against every raise).
    /// @param usdScale_   Must equal 10**(18 - token.decimals()); snapshot per Hand.
    /// @param charities   Genesis charity allowlist; all non-zero.
    /// @param policyAdmin_ Bounded admin: token switch + charity allowlist only.
    constructor(address token, uint64 usdScale_, address[] memory charities, address policyAdmin_) {
        if (token == address(0) || policyAdmin_ == address(0)) revert ZeroAddress();
        uint8 dec = IERC20Minimal(token).decimals();
        if (dec > 18 || uint256(usdScale_) != 10 ** (18 - uint256(dec))) revert BoundsViolated();

        rewardToken = token;
        usdScale = usdScale_;
        _deploymentChainId = block.chainid;
        _deploymentDomainSeparator = AHandSig.domainSeparator(address(this));

        policyAdmin = policyAdmin_;
        emit PolicyAdminTransferred(address(0), policyAdmin_);

        tokenEnabled = true;
        policyRevision = 1;
        emit TokenPolicyUpdated(token, true, 1);
        for (uint256 i; i < charities.length; ++i) {
            if (charities[i] == address(0)) revert ZeroAddress();
            charityAllowed[charities[i]] = true;
            emit CharityPolicyUpdated(charities[i], true, 1);
        }
    }

    /// @notice The EIP-712 domain separator every aHand signature is bound to.
    /// @dev    Returns the cached value on the deployment chain and recomputes it
    ///         from live block.chainid on a fork, so signatures never silently
    ///         become valid across a chain split.
    /// @return The current domain separator for this contract.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        if (block.chainid == _deploymentChainId) return _deploymentDomainSeparator;
        return AHandSig.domainSeparator(address(this)); // fork-safe recompute
    }

    /// @notice Full Hand snapshot; the read surface Signals materialization depends on.
    /// @param  handId The Hand id to read.
    /// @return The Hand struct by value (zeroed if the Hand was never raised).
    function getHand(uint256 handId) external view returns (Hand memory) {
        return _hands[handId];
    }

    /*//////////////////// Policy (prospective-only) ////////////////////*/
    /// @notice Gates NEW raises only; live Hands settle and withdraw regardless.
    /// @dev    Bumps policyRevision so the change is provable from event history.
    /// @param  enabled Whether new raises are permitted going forward.
    function setTokenEnabled(bool enabled) external onlyPolicyAdmin {
        tokenEnabled = enabled;
        uint64 revision = ++policyRevision;
        emit TokenPolicyUpdated(rewardToken, enabled, revision);
    }

    /// @notice Prospective-only: a Hand raised under an allowed charity settles to it
    ///         even if the charity is later removed.
    /// @dev    Bumps policyRevision. Live Hands keep their snapshotted recipient.
    /// @param  charity The charity address to toggle.
    /// @param  allowed Whether the charity may be chosen by future raises.
    function setCharityAllowed(address charity, bool allowed) external onlyPolicyAdmin {
        if (charity == address(0)) revert ZeroAddress();
        charityAllowed[charity] = allowed;
        uint64 revision = ++policyRevision;
        emit CharityPolicyUpdated(charity, allowed, revision);
    }

    /// @notice Initiates the two-step admin handover; zero cancels a pending one.
    /// @dev    By design, passing address(0) intentionally cancels any pending
    ///         handover: it sets pendingPolicyAdmin to zero, which acceptPolicyAdmin
    ///         can never satisfy because a zero msg.sender is impossible — so a
    ///         zero pendingPolicyAdmin is unacceptable by construction and safe.
    /// @param  newAdmin The nominated next admin, or address(0) to cancel.
    function transferPolicyAdmin(address newAdmin) external onlyPolicyAdmin {
        pendingPolicyAdmin = newAdmin;
        emit PolicyAdminTransferStarted(policyAdmin, newAdmin);
    }

    /// @notice Claims the admin role. Must be called by the pending admin.
    /// @dev    Reverts NotPendingOwner for any caller other than the current
    ///         pendingPolicyAdmin; since that value is zero when no handover is
    ///         pending, and no account is address(0), an empty nomination can never
    ///         be accepted. Clears the nomination on success.
    function acceptPolicyAdmin() external {
        if (msg.sender != pendingPolicyAdmin) revert NotPendingOwner();
        emit PolicyAdminTransferred(policyAdmin, msg.sender);
        policyAdmin = msg.sender;
        pendingPolicyAdmin = address(0);
    }

    /*//////////////////////////////////////////////////////////
        raise — deposit enters escrow.
        Balance-delta accounting with STRICT equality: fee-on-transfer
        and rebasing surprises are rejected, not absorbed.
    //////////////////////////////////////////////////////////*/
    /// @notice Raise a new Hand: escrow `p.amount` of the reward token under a
    ///         fixed policy snapshot and return its id.
    /// @dev    Validation runs in a fixed order (token identity, participants, bps
    ///         bounds, split viability, expiry window, visibility coherence, tags),
    ///         then the deposit, then effects+events.
    ///
    ///         Reentrancy note (audit HIGH "state change after external call" is a
    ///         FALSE POSITIVE here): the only external call before storage is the
    ///         balance-delta transferFrom. It is measured, not trusted — the
    ///         subsequent balanceOf minus balBefore MUST equal p.amount exactly
    ///         (InexactDeposit otherwise), and the Hand is only written after that
    ///         check passes. A reentrant callback during the transfer cannot forge
    ///         the delta, and the whole function is nonReentrant, so no state read
    ///         before the transfer can be corrupted by it. The reward token is a
    ///         known hookless USDC-style token with no transfer callback anyway.
    /// @param  p            The raise parameters (token, amount, policy, commitments).
    /// @param  discoveryRef Off-chain discovery ref bytes (empty in Dark mode).
    /// @param  publicTags   Strictly-ascending, unique, non-zero discovery tags.
    /// @return handId       The id of the newly created Hand.
    function raise(RaiseParams calldata p, bytes calldata discoveryRef, bytes32[] calldata publicTags)
        external
        nonReentrant
        returns (uint256 handId)
    {
        // (1) token identity + prospective policy
        if (p.token != rewardToken) revert TokenMismatch();
        if (!tokenEnabled) revert TokenNotEnabled();

        // (2) non-degenerate participants
        if (p.amount == 0) revert ZeroAmount();
        if (p.rootCapability == address(0)) revert ZeroAddress();
        if (!charityAllowed[p.charityRecipient]) revert CharityNotWhitelisted();

        // (3) constitutional bps bounds
        if (p.charityBps < MIN_CHARITY_BPS || p.charityBps > MAX_CHARITY_BPS) revert BoundsViolated();
        if (p.minGiverClaimBps == 0 || p.minGiverClaimBps > BPS_DENOMINATOR) revert BoundsViolated();

        // (4) settlement must be able to pay both charity and route
        uint256 charityAllocation = (uint256(p.amount) * p.charityBps) / BPS_DENOMINATOR;
        if (charityAllocation == 0) revert ZeroCharityAllocation();
        if (uint256(p.amount) - charityAllocation == 0) revert ZeroDistributable();

        // (5) expiry window
        if (p.expiry < block.timestamp + MIN_EXPIRY || p.expiry > block.timestamp + MAX_EXPIRY) {
            revert BoundsViolated();
        }

        // (6) visibility coherence; metadata commitment is mandatory in every mode
        if (p.metadataCommitment == bytes32(0)) revert InvalidVisibilityData();
        if (p.visibility == Visibility.Dark) {
            if (discoveryRef.length != 0 || p.discoveryCommitment != bytes32(0) || publicTags.length != 0) {
                revert InvalidVisibilityData();
            }
        } else {
            if (discoveryRef.length == 0 || discoveryRef.length > MAX_DISCOVERY_REF || p.discoveryCommitment == bytes32(0)) {
                revert InvalidVisibilityData();
            }
        }

        // (7) tags: bound + strictly ascending — order, uniqueness and non-zero in one pass
        if (publicTags.length > MAX_PUBLIC_TAGS) revert TagsInvalid();
        bytes32 prevTag;
        for (uint256 i; i < publicTags.length; ++i) {
            if (publicTags[i] <= prevTag) revert TagsInvalid();
            prevTag = publicTags[i];
        }

        // (8) exact-delta deposit; the balance is never read again after this
        uint256 balBefore = IERC20(p.token).balanceOf(address(this));
        IERC20(p.token).safeTransferFrom(msg.sender, address(this), p.amount);
        if (IERC20(p.token).balanceOf(address(this)) - balBefore != uint256(p.amount)) revert InexactDeposit();

        // (9) effects + events
        handId = ++handsCount;
        _hands[handId] = Hand({
            raiser: msg.sender,
            expiry: p.expiry,
            charityBps: p.charityBps,
            minGiverClaimBps: p.minGiverClaimBps,
            visibility: p.visibility,
            status: Status.Active,
            rewardToken: p.token,
            creditedReward: p.amount,
            charityRecipient: p.charityRecipient,
            usdScaleAtRaise: usdScale,
            rootCapability: p.rootCapability,
            metadataCommitment: p.metadataCommitment,
            discoveryCommitment: p.discoveryCommitment,
            thankSignalSourceHash: bytes32(0)
        });

        emit Raised(
            handId,
            msg.sender,
            p.token,
            p.amount,
            usdScale,
            policyRevision,
            p.expiry,
            p.rootCapability,
            p.visibility,
            p.metadataCommitment,
            p.discoveryCommitment,
            discoveryRef,
            p.minGiverClaimBps,
            p.charityRecipient,
            p.charityBps
        );
        if (publicTags.length != 0) emit HandTagged(handId, msg.sender, publicTags);
    }

    /*//////////////////////////////////////////////////////////
        thank — success settlement. Three phases:
        A verification (staticcalls only), B floor math, C effects then
        interactions. Allocations are pushed to recipients directly; any push
        that fails defers only that share to a withdrawable claim.
    //////////////////////////////////////////////////////////*/
    /// @notice Settle a successful Hand: verify the whole route and Give, split the
    ///         pool (charity + per-hop margins + giver residual) and pay every party.
    ///         Only the raiser may thank, and only while the Hand is Active and
    ///         strictly before expiry.
    /// @dev    Thin wrapper over _settle with msg.sender as the raiser authority.
    ///
    ///         Reentrancy note (audit HIGH is a FALSE POSITIVE): all external calls
    ///         are the trailing _pay pushes in Phase C, which run AFTER status is
    ///         set to Settled, the source commitment is stored, and every event is
    ///         emitted — strict checks-effects-interactions. The entry point is
    ///         nonReentrant and the reward token is the immutable hookless USDC, so
    ///         a push can neither re-enter thank nor observe a half-settled Hand.
    ///         See _settle for the phase-by-phase invariant.
    /// @param  handId             The Active Hand to settle.
    /// @param  shakes             The route hops in order (at most MAX_SHAKES).
    /// @param  shakeSigs          Positional Shake signatures, one per hop.
    /// @param  shakerAcceptances  Positional with shakes: entry i is the ShakerAcceptance
    ///                            signature for hop i when the shaker is an explicit distinct
    ///                            account, and MUST be empty bytes for anonymous or
    ///                            self-attributed hops.
    /// @param  give               The terminal Give claim.
    /// @param  giveSig            The Give signature by the terminal capability.
    /// @param  giverAcceptanceSig The giver's acceptance signature (always required).
    function thank(
        uint256 handId,
        Shake[] calldata shakes,
        bytes[] calldata shakeSigs,
        bytes[] calldata shakerAcceptances,
        Give calldata give,
        bytes calldata giveSig,
        bytes calldata giverAcceptanceSig
    ) external nonReentrant {
        _settle(msg.sender, handId, shakes, shakeSigs, shakerAcceptances, give, giveSig, giverAcceptanceSig);
    }

    /*//////////////////////////////////////////////////////////
        reclaim — expiry settlement. Permissionless: anyone may finalize,
        the refund can only ever be credited to the raiser.
        Success-only charity: the FULL pool refunds, zero charity cut.
    //////////////////////////////////////////////////////////*/
    /// @notice Refund an expired, unsettled Hand to its raiser in full (no charity
    ///         cut on failure). Permissionless — anyone may finalize — but the
    ///         refund destination is fixed to the raiser.
    /// @dev    Requires Active and now >= expiry; the thank and reclaim windows are
    ///         disjoint (thank is strictly before expiry). creditedReward is left
    ///         intact — the liability is retired by moving status to Reclaimed.
    ///
    ///         Reentrancy note (audit HIGH is a FALSE POSITIVE): status, event and
    ///         allocation are all committed BEFORE the single _pay push, which is
    ///         the only external call. Combined with nonReentrant and the hookless
    ///         reward token, the push cannot re-enter or see a half-finalized Hand.
    /// @param  handId The Active, expired Hand to reclaim.
    function reclaim(uint256 handId) external nonReentrant {
        Hand storage h = _hands[handId];
        if (h.status != Status.Active) revert NotActive();
        if (block.timestamp < h.expiry) revert NotExpired(); // thank window is strictly before

        h.status = Status.Reclaimed; // creditedReward stays intact — liability keys on status

        address token = h.rewardToken;
        address raiser = h.raiser;
        uint96 refund = h.creditedReward;

        emit Reclaimed(handId, raiser, token, refund);
        emit PayoutAllocated(handId, token, raiser, AllocationKind.RaiserRefund, 0, refund);
        _pay(handId, token, raiser, refund); // push the refund; defers to a claim on failure
    }

    /*//////////////////////////////////////////////////////////
        withdraw — the exit for DEFERRED value: allocations a settlement push
        could not deliver land as claims here. Permissionless with a fixed
        destination: anyone can pay the gas, nobody can redirect the funds.
        No tokenEnabled gate — accrued claims survive policy changes.
    //////////////////////////////////////////////////////////*/
    /// @notice Drain the aggregate claim credited to `beneficiary` for `token`,
    ///         paying it to `beneficiary`. Permissionless (anyone may trigger and
    ///         pay the gas) but the destination is fixed to the beneficiary.
    /// @dev    Fixed-destination is a deliberate anti-theft choice: because the
    ///         recipient is never a caller-supplied redirect, no one can sweep
    ///         another party's claim to themselves.
    ///
    ///         KNOWN LIMITATION (audit Low #3, documented not fixed): a claim whose
    ///         original push failed because the reward token blocks transfers TO the
    ///         beneficiary (e.g. a USDC blacklist) is effectively unwithdrawable —
    ///         withdraw retries the same fixed-destination transfer, which fails for
    ///         the same reason. This is accepted in v1: adding a redirect would
    ///         reintroduce exactly the theft vector the fixed destination prevents,
    ///         so blacklisted-recipient funds are intentionally not rescuable here.
    ///
    ///         No tokenEnabled gate: disabling a token never strands already-accrued
    ///         claims. safeTransfer reverts on failure, so a failed drain simply
    ///         leaves the claim in place to retry.
    /// @param  token       The token whose claim to drain (typically the reward token).
    /// @param  beneficiary The party whose claim is paid; also the fixed destination.
    function withdraw(address token, address beneficiary) external nonReentrant {
        uint256 amount = claims[token][beneficiary];
        if (amount == 0) revert ZeroClaim(); // covers beneficiary == 0: nothing is ever credited there
        claims[token][beneficiary] = 0;
        IERC20(token).safeTransfer(beneficiary, amount);
        emit PayoutWithdrawn(token, beneficiary, amount);
    }

    /*//////////////////// Settlement internals ////////////////////*/

    /// @dev Memory carrier for verified-route facts; keeps frames shallow and
    ///      lets a future thankWithPermit reuse the whole pipeline via _settle.
    ///      Populated by _verifyRoute/_verifyGive, consumed by _settle Phases B/C.
    ///      Conservation holds by construction: P == charityAllocation +
    ///      sum(hopAllocations) + giverAllocation, with the giver absorbing dust.
    struct RouteFacts {
        bytes32 routeHash;
        bytes32 giveHash;
        address terminalCapability;
        uint16  finalClaimBps;
        uint96  charityAllocation;   // C = floor(P * charityBps / 1e4)
        uint96  distributable;       // D = P - C
        uint96  giverAllocation;     // D - sum(hopAllocations): residual absorbs dust
        bytes32[] shakeHashes;
        uint96[]  hopAllocations;    // floor(D * margin_i / 1e4); zero for zero-margin hops
        address[] occShakers;        // route order, anonymous zeros preserved
        uint16[]  occClaimDeltas;    // route order margins
    }

    /// @dev Full settlement body, structured as three strict phases:
    ///      A verification (view-only staticcalls, zero mutation), B floor math
    ///      (pure), C effects then interactions. All state — status, source
    ///      commitment, every event — is finalized in Phase C BEFORE the first
    ///      _pay push, which is the ONLY external call and the point the audit
    ///      HIGH flags. The invariant that makes it safe: at the first push the
    ///      Hand is already Settled and fully accounted, the function holds the
    ///      transient nonReentrant lock, and the reward token is the immutable
    ///      hookless USDC — so no push can re-enter or read partial state.
    ///      `raiserAuthority` is the account whose consent authorizes settlement —
    ///      msg.sender for thank, a recovered signer for a future thankWithPermit.
    /// @param raiserAuthority   The consenting account (must equal the Hand's raiser).
    /// @param handId            The Active Hand to settle.
    /// @param shakes            The route hops in order.
    /// @param shakeSigs         Positional Shake signatures.
    /// @param shakerAcceptances Positional ShakerAcceptance signatures (empty where not required).
    /// @param give              The terminal Give claim.
    /// @param giveSig           The Give signature by the terminal capability.
    /// @param giverAcceptanceSig The giver's always-required acceptance signature.
    function _settle(
        address raiserAuthority,
        uint256 handId,
        Shake[] calldata shakes,
        bytes[] calldata shakeSigs,
        bytes[] calldata shakerAcceptances,
        Give calldata give,
        bytes calldata giveSig,
        bytes calldata giverAcceptanceSig
    ) internal {
        Hand storage h = _hands[handId];

        // Phase A — verification. View-only: staticcalls, zero state mutation.
        if (h.status != Status.Active) revert NotActive();
        if (block.timestamp >= h.expiry) revert Expired(); // strict: expiry belongs to reclaim
        if (raiserAuthority != h.raiser) revert NotRaiser();
        if (shakes.length > MAX_SHAKES) revert RouteTooLong();
        if (shakeSigs.length != shakes.length || shakerAcceptances.length != shakes.length) revert LengthMismatch();

        RouteFacts memory r;
        {
            // Pool split precomputed: MarginRoundsToZero needs D during the walk.
            uint96 pool = h.creditedReward;
            r.charityAllocation = uint96((uint256(pool) * h.charityBps) / BPS_DENOMINATOR);
            r.distributable = pool - r.charityAllocation; // > 0 by raise bounds
        }

        _verifyRoute(h, handId, shakes, shakeSigs, shakerAcceptances, r);
        _verifyGive(h, handId, give, giveSig, giverAcceptanceSig, r);

        // Phase B — floor math. Giver takes the residual, so by construction
        // P == C + sum(hopAllocations) + giverAllocation: conservation is exact.
        {
            uint96 marginTotal;
            for (uint256 i; i < shakes.length; ++i) {
                marginTotal += r.hopAllocations[i];
            }
            r.giverAllocation = r.distributable - marginTotal;
        }

        // Phase C — effects, then interactions (checks-effects-interactions).
        // ALL state is finalized before any token transfer, and the whole
        // function is nonReentrant, so the stipended pushes below cannot
        // observe or corrupt a half-settled hand.
        h.status = Status.Settled; // creditedReward stays intact — Signals rereads it

        address token = h.rewardToken;

        // Commit the settlement facts Signals later verifies against.
        h.thankSignalSourceHash = AHandSource.thankCommitment(
            address(this),
            handId,
            h.raiser,
            give.giver,
            r.charityAllocation,
            h.usdScaleAtRaise,
            r.occShakers,
            r.occClaimDeltas
        );

        emit Settled(
            handId,
            give.giver,
            give.solutionHash,
            r.routeHash,
            r.giveHash,
            token,
            h.creditedReward,
            r.distributable,
            r.giverAllocation,
            h.charityRecipient,
            r.charityAllocation,
            h.usdScaleAtRaise,
            uint256(r.charityAllocation) * h.usdScaleAtRaise
        );

        address parentCap = h.rootCapability;
        for (uint256 i; i < shakes.length; ++i) {
            Shake calldata s = shakes[i];
            emit RouteHopSettled(
                handId,
                r.routeHash,
                uint8(i),
                parentCap,
                s.childCapability,
                s.parentClaimBps,
                s.childClaimBps,
                s.shaker,
                r.shakeHashes[i],
                s.hopDataHash,
                r.hopAllocations[i]
            );
            parentCap = s.childCapability;
        }

        emit PayoutAllocated(handId, token, h.charityRecipient, AllocationKind.Charity, 0, r.charityAllocation);
        for (uint256 i; i < shakes.length; ++i) {
            if (r.hopAllocations[i] != 0) {
                emit PayoutAllocated(
                    handId, token, shakes[i].shaker, AllocationKind.ShakerMargin, uint8(i), r.hopAllocations[i]
                );
            }
        }
        emit PayoutAllocated(handId, token, give.giver, AllocationKind.GiverResidual, 0, r.giverAllocation);

        // Interactions — deliver each allocation. A recipient that reverts
        // (blacklist, hostile contract) only defers ITS OWN share to a claim;
        // every other payout still lands in the same transaction.
        _pay(handId, token, h.charityRecipient, r.charityAllocation);
        for (uint256 i; i < shakes.length; ++i) {
            if (r.hopAllocations[i] != 0) {
                _pay(handId, token, shakes[i].shaker, r.hopAllocations[i]);
            }
        }
        _pay(handId, token, give.giver, r.giverAllocation);
    }

    /// @dev Deliver a settlement allocation: try a gas-bounded push, and on any
    ///      failure park the amount as a claim withdrawable by anyone. Amount is
    ///      always non-zero at the call sites that matter, but guarded for safety.
    ///      A recipient that reverts defers only ITS OWN share; every other payout
    ///      in the same settlement still lands.
    /// @param handId The Hand being settled (for the emitted event).
    /// @param token  The reward token to move.
    /// @param to     The recipient of the allocation.
    /// @param amt    The token amount to deliver (no-op if zero).
    function _pay(uint256 handId, address token, address to, uint96 amt) internal {
        if (amt == 0) return;
        if (_tryPush(token, to, amt)) {
            emit PayoutPushed(handId, token, to, amt);
        } else {
            claims[token][to] += amt;
            emit PayoutDeferred(handId, token, to, amt);
        }
    }

    /// @dev Bounded-gas ERC20 transfer that never bubbles a revert. Returns true
    ///      only on a call that succeeded AND returned either nothing or `true`
    ///      (the SafeERC20 success shape, inlined so failure is catchable). Capped
    ///      at PUSH_GAS_STIPEND so a hostile recipient can waste at most the stipend
    ///      before its share is deferred to a claim.
    /// @param token The reward token to transfer.
    /// @param to    The recipient.
    /// @param amt   The amount to transfer.
    /// @return ok   True if the transfer succeeded per the SafeERC20 success shape.
    function _tryPush(address token, address to, uint96 amt) internal returns (bool ok) {
        bytes memory cd = abi.encodeCall(IERC20.transfer, (to, amt));
        assembly ("memory-safe") {
            let success := call(PUSH_GAS_STIPEND, token, 0, add(cd, 0x20), mload(cd), 0x00, 0x20)
            ok := and(success, or(iszero(returndatasize()), and(gt(returndatasize(), 31), mload(0x00))))
        }
    }

    /// @dev Walks the delegation chain from the root capability, verifying each
    ///      hop's signature, telescopic claims, deadlines and shaker consent, and
    ///      filling r with the per-hop facts (hashes, allocations, occurrences).
    ///
    ///      By design the loop is ATOMIC — all-or-nothing: the first invalid hop
    ///      reverts the entire thank, so a route is either fully valid and settles
    ///      as one unit or is rejected wholesale. There is no partial acceptance of
    ///      a route prefix; this is intentional, not a missing early-exit path.
    /// @param h                 The Hand being settled (root capability, floor, expiry).
    /// @param handId            The Hand id each hop must reference.
    /// @param shakes            The route hops in order.
    /// @param shakeSigs         Positional Shake signatures.
    /// @param shakerAcceptances Positional ShakerAcceptance signatures.
    /// @param r                 The RouteFacts carrier to populate (mutated in place).
    function _verifyRoute(
        Hand storage h,
        uint256 handId,
        Shake[] calldata shakes,
        bytes[] calldata shakeSigs,
        bytes[] calldata shakerAcceptances,
        RouteFacts memory r
    ) internal view {
        uint256 n = shakes.length;
        r.shakeHashes = new bytes32[](n);
        r.hopAllocations = new uint96[](n);
        r.occShakers = new address[](n);
        r.occClaimDeltas = new uint16[](n);

        bytes32 ds = DOMAIN_SEPARATOR();
        address expectedCap = h.rootCapability;
        uint16 expectedClaim = BPS_DENOMINATOR;
        uint40 expiry = h.expiry;
        uint16 floorBps = h.minGiverClaimBps;

        for (uint256 i; i < n; ++i) {
            Shake calldata s = shakes[i];
            if (s.handId != handId) revert WrongHand();

            bytes32 shakeHash = AHandSig.hashShake(s);
            if (!_isValidSig(expectedCap, AHandSig.digest(ds, shakeHash), shakeSigs[i])) revert CapabilityProof();
            if (s.parentClaimBps != expectedClaim) revert ClaimMismatch();
            if (s.childClaimBps > s.parentClaimBps) revert ClaimMustNotGrow();
            if (s.childClaimBps < floorBps) revert ClaimBelowFloor();
            if (block.timestamp > s.deadline) revert TicketExpired();
            if (s.deadline > expiry) revert DeadlineExceedsExpiry();

            uint16 margin = s.parentClaimBps - s.childClaimBps;
            if (margin != 0) {
                // A paid hop must have a payable, attributed shaker.
                if (s.shaker == address(0)) revert AnonymousShakerWithMargin();
                uint96 alloc = uint96((uint256(r.distributable) * margin) / BPS_DENOMINATOR);
                if (alloc == 0) revert MarginRoundsToZero();
                r.hopAllocations[i] = alloc;
            }

            // Consent matrix: an explicit shaker — a distinct attributed account —
            // must co-sign the ShakerAcceptance; anonymous and self-attributed
            // hops MUST NOT carry acceptance bytes.
            if (s.shaker != address(0) && s.shaker != expectedCap) {
                if (
                    !_isValidSig(
                        s.shaker, AHandSig.digest(ds, AHandSig.hashShakerAcceptance(shakeHash)), shakerAcceptances[i]
                    )
                ) revert ShakerAcceptanceInvalid();
            } else if (shakerAcceptances[i].length != 0) {
                revert UnexpectedAcceptance();
            }

            r.shakeHashes[i] = shakeHash;
            r.occShakers[i] = s.shaker;
            r.occClaimDeltas[i] = margin;
            expectedCap = s.childCapability;
            expectedClaim = s.childClaimBps;
        }

        r.terminalCapability = expectedCap; // root itself on a zero-shake route
        r.finalClaimBps = expectedClaim;
        // Signature bytes deliberately excluded from the route identity —
        // malleability cannot rename a route.
        r.routeHash = AHandSig.hashRoute(AHandSig.handRef(address(this), handId), r.shakeHashes);
    }

    /// @dev Binds the Give to the verified route and checks both terminal
    ///      signatures: the capability's Give and the giver's acceptance. The
    ///      routeHash equality is what forbids tail substitution — a Give may only
    ///      claim the exact route that was verified.
    /// @param h                  The Hand being settled (expiry bound).
    /// @param handId             The Hand id the Give must reference.
    /// @param give               The terminal Give claim.
    /// @param giveSig            The Give signature by the terminal capability.
    /// @param giverAcceptanceSig The giver's always-required acceptance signature.
    /// @param r                  The RouteFacts from _verifyRoute; r.giveHash is set here.
    function _verifyGive(
        Hand storage h,
        uint256 handId,
        Give calldata give,
        bytes calldata giveSig,
        bytes calldata giverAcceptanceSig,
        RouteFacts memory r
    ) internal view {
        if (give.handId != handId) revert WrongHand();
        if (give.routeHash != r.routeHash) revert RouteHashMismatch(); // no tail substitution
        if (give.finalClaimBps != r.finalClaimBps) revert ClaimMismatch();
        if (give.giver == address(0)) revert ZeroAddress();
        if (block.timestamp > give.deadline) revert TicketExpired();
        if (give.deadline > h.expiry) revert DeadlineExceedsExpiry();

        bytes32 ds = DOMAIN_SEPARATOR();
        bytes32 giveHash = AHandSig.hashGive(give);
        if (!_isValidSig(r.terminalCapability, AHandSig.digest(ds, giveHash), giveSig)) revert CapabilityProof();
        // Giver acceptance is ALWAYS required — attribution and residual are consensual.
        if (!_isValidSig(give.giver, AHandSig.digest(ds, AHandSig.hashGiverAcceptance(giveHash)), giverAcceptanceSig)) {
            revert GiverAcceptanceInvalid();
        }
        r.giveHash = giveHash;
    }

    /// @dev One verifier for all four signature families (Shake, ShakerAcceptance,
    ///      Give, GiverAcceptance). ECDSA first; if the signer has code, fall back
    ///      to ERC-1271 via a MANUAL staticcall — mutation-proof by construction —
    ///      capped at ERC1271_GAS so a hostile wallet cannot gas-bomb settlement.
    /// @param signer The expected signer (EOA or ERC-1271 contract wallet).
    /// @param digest The EIP-712 signing digest to validate against.
    /// @param sig    The signature bytes.
    /// @return True iff `sig` is a valid signature of `digest` by `signer`.
    function _isValidSig(address signer, bytes32 digest, bytes memory sig) internal view returns (bool) {
        (address recovered,,) = ECDSA.tryRecover(digest, sig);
        if (recovered != address(0) && recovered == signer) return true;
        if (signer.code.length == 0) return false;

        bytes memory callData = abi.encodeWithSelector(ERC1271_MAGIC, digest, sig);
        bool ok;
        assembly ("memory-safe") {
            let success := staticcall(ERC1271_GAS, signer, add(callData, 0x20), mload(callData), 0x00, 0x20)
            if and(success, gt(returndatasize(), 0x1f)) {
                // Literal equals the ERC1271_MAGIC constant (0x1626ba7e); inlined
                // here because a bytes4 constant is not referenceable inside Yul.
                ok := eq(shr(224, mload(0x00)), 0x1626ba7e) // ERC-1271 magic value
            }
        }
        return ok;
    }
}
