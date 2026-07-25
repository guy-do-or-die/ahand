// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTypes.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title AHandCore
/// @notice Escrow and settlement for the aHand protocol. Single reward token,
///         pure pull payments: thank/reclaim only credit internal claims;
///         value leaves the contract exclusively through withdraw.
///         Success-only charity: reclaim refunds the full pool.
/// @dev No receive() or fallback() by design. No external calls between
///      verification and effects — settlement is checks, math, storage, events.
///      Signals coupling is one-way: Signals reads getHand(); Core never calls out.
contract AHandCore is IAHandCoreView {
    using SafeERC20 for IERC20;

    /*//////////////////// Constitution ////////////////////*/
    uint16  public constant BPS_DENOMINATOR   = 100_00;
    uint16  public constant MIN_CHARITY_BPS   = 1_00;
    uint16  public constant MAX_CHARITY_BPS   = 30_00;
    uint256 public constant MAX_SHAKES        = 6;
    uint40  public constant MIN_EXPIRY        = 1 days;
    uint40  public constant MAX_EXPIRY        = 180 days;
    uint256 public constant MAX_PUBLIC_TAGS   = 8;
    uint256 public constant MAX_DISCOVERY_REF = 128;
    /// @dev Per-verification gas ceiling for ERC-1271 wallets. Worst thank:
    ///      14 verifications (6 shakes + 6 acceptances + give + giver acceptance)
    ///      x 350k ~= 4.9M gas ceiling — acceptable on Base.
    uint256 public constant ERC1271_GAS       = 350_000;

    /// @dev The ERC-1271 selector doubles as the required magic return value.
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e; // isValidSignature(bytes32,bytes)

    /*//////////////////// Immutables ////////////////////*/
    /// @notice The single token every Hand escrows; enforced at raise.
    address public immutable rewardToken;
    /// @notice Token units -> 1e18-scaled USD, snapshot into each Hand at raise.
    uint64  public immutable usdScale; // == 10**(18 - rewardToken.decimals())

    uint256 private immutable _deploymentChainId;
    bytes32 private immutable _deploymentDomainSeparator;

    /*//////////////////// Storage (order frozen) ////////////////////*/
    uint256 public handsCount;
    address public policyAdmin;
    address public pendingPolicyAdmin;
    /// @notice Prospective-only switch: gates new raises, never live Hands or withdrawals.
    bool    public tokenEnabled;
    /// @notice Bumped on every policy mutation; snapshot into Raised for provenance.
    uint64  public policyRevision;
    mapping(uint256 => Hand) private _hands;
    mapping(address => bool) public charityAllowed;
    /// @notice Pull-payment ledger: claims[token][beneficiary] aggregates across Hands.
    mapping(address => mapping(address => uint256)) public claims;

    /*//////////////////// Events ////////////////////*/
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

    event HandTagged(uint256 indexed handId, address indexed raiser, bytes32[] tagIds);

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

    event Reclaimed(uint256 indexed handId, address indexed raiser, address token, uint96 refund);

    /// @notice One per non-zero claim credit; routePosition meaningful for ShakerMargin only.
    event PayoutAllocated(
        uint256 indexed handId,
        address indexed token,
        address indexed beneficiary,
        AllocationKind kind,
        uint8   routePosition,
        uint96  amount
    );

    event PayoutWithdrawn(address indexed token, address indexed beneficiary, uint256 amount);

    event TokenPolicyUpdated(address indexed token, bool enabled, uint64 policyRevision);
    event CharityPolicyUpdated(address indexed charity, bool allowed, uint64 policyRevision);
    event PolicyAdminTransferStarted(address indexed previousAdmin, address indexed newAdmin);
    event PolicyAdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    /*//////////////////// Modifiers ////////////////////*/
    modifier onlyPolicyAdmin() {
        if (msg.sender != policyAdmin) revert OnlyPolicyAdmin();
        _;
    }

    /// @dev Transient storage-based reentrancy guard (Cancun target)
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

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        if (block.chainid == _deploymentChainId) return _deploymentDomainSeparator;
        return AHandSig.domainSeparator(address(this)); // fork-safe recompute
    }

    /// @notice Full Hand snapshot; the read surface Signals materialization depends on.
    function getHand(uint256 handId) external view returns (Hand memory) {
        return _hands[handId];
    }

    /*//////////////////// Policy (prospective-only) ////////////////////*/
    /// @notice Gates NEW raises only; live Hands settle and withdraw regardless.
    function setTokenEnabled(bool enabled) external onlyPolicyAdmin {
        tokenEnabled = enabled;
        uint64 revision = ++policyRevision;
        emit TokenPolicyUpdated(rewardToken, enabled, revision);
    }

    /// @notice Prospective-only: a Hand raised under an allowed charity settles to it
    ///         even if the charity is later removed.
    function setCharityAllowed(address charity, bool allowed) external onlyPolicyAdmin {
        if (charity == address(0)) revert ZeroAddress();
        charityAllowed[charity] = allowed;
        uint64 revision = ++policyRevision;
        emit CharityPolicyUpdated(charity, allowed, revision);
    }

    /// @notice Initiates the two-step admin handover; zero cancels a pending one.
    function transferPolicyAdmin(address newAdmin) external onlyPolicyAdmin {
        pendingPolicyAdmin = newAdmin;
        emit PolicyAdminTransferStarted(policyAdmin, newAdmin);
    }

    /// @notice Claims the admin role. Must be called by the pending admin.
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
        A verification (staticcalls only), B floor math, C effects+events.
        NO external calls after phase A; funds move only via withdraw.
    //////////////////////////////////////////////////////////*/
    /// @param shakerAcceptances Positional with shakes: entry i is the ShakerAcceptance
    ///        signature for hop i when the shaker is an explicit distinct account,
    ///        and MUST be empty bytes for anonymous or self-attributed hops.
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
    function reclaim(uint256 handId) external nonReentrant {
        Hand storage h = _hands[handId];
        if (h.status != Status.Active) revert NotActive();
        if (block.timestamp < h.expiry) revert NotExpired(); // thank window is strictly before

        h.status = Status.Reclaimed; // creditedReward stays intact — liability keys on status

        address token = h.rewardToken;
        address raiser = h.raiser;
        uint96 refund = h.creditedReward;
        claims[token][raiser] += refund;

        emit Reclaimed(handId, raiser, token, refund);
        emit PayoutAllocated(handId, token, raiser, AllocationKind.RaiserRefund, 0, refund);
    }

    /*//////////////////////////////////////////////////////////
        withdraw — the ONLY exit for value. Permissionless with a fixed
        destination: anyone can pay the gas, nobody can redirect the funds.
        No tokenEnabled gate — accrued claims survive policy changes.
    //////////////////////////////////////////////////////////*/
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

    /// @dev Full settlement body. `raiserAuthority` is the account whose consent
    ///      authorizes settlement — msg.sender for thank, a recovered signer for
    ///      a future thankWithPermit.
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

        // Phase C — effects + events. NO external calls.
        h.status = Status.Settled; // creditedReward stays intact — Signals rereads it

        address token = h.rewardToken;
        claims[token][h.charityRecipient] += r.charityAllocation;
        for (uint256 i; i < shakes.length; ++i) {
            if (r.hopAllocations[i] != 0) {
                claims[token][shakes[i].shaker] += r.hopAllocations[i];
            }
        }
        claims[token][give.giver] += r.giverAllocation;

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
    }

    /// @dev Walks the delegation chain from the root capability, verifying each
    ///      hop's signature, telescopic claims, deadlines and shaker consent.
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
    ///      signatures: the capability's Give and the giver's acceptance.
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
    function _isValidSig(address signer, bytes32 digest, bytes memory sig) internal view returns (bool) {
        (address recovered,,) = ECDSA.tryRecover(digest, sig);
        if (recovered != address(0) && recovered == signer) return true;
        if (signer.code.length == 0) return false;

        bytes memory callData = abi.encodeWithSelector(ERC1271_MAGIC, digest, sig);
        bool ok;
        assembly ("memory-safe") {
            let success := staticcall(ERC1271_GAS, signer, add(callData, 0x20), mload(callData), 0x00, 0x20)
            if and(success, gt(returndatasize(), 0x1f)) {
                ok := eq(shr(224, mload(0x00)), 0x1626ba7e) // ERC-1271 magic value
            }
        }
        return ok;
    }
}
