// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
                        aHand — Types
//////////////////////////////////////////////////////////////*/

/// @title  AHandTypes
/// @author aHand
/// @notice Shared type surface for the aHand protocol: the enums, structs,
///         errors and EIP-712 helpers that Core, Signals, the SDK and the
///         indexers all agree on. No behaviour lives here — these are the
///         frozen data shapes and the canonical hashing rules built on them.
/// @dev    Struct field order and the EIP-712 type strings are FROZEN: the
///         storage layout, the ABI and the off-chain signers all depend on
///         them byte-for-byte. Changing a field order or a type string forks
///         every signature ever produced.

/// @notice Lifecycle of a Hand. Enum order is FROZEN (values are stored on-chain
///         and compared numerically).
/// @dev    `None` is the zero default for an unraised slot; the three live states
///         are mutually exclusive terminal-or-active. Transitions are one-way:
///         None -> Active -> {Settled | Reclaimed}. `Settled` and `Reclaimed` are
///         both terminal; Settled means a Thank paid the route, Reclaimed means
///         the raiser was refunded after expiry.
enum Status { None, Active, Settled, Reclaimed }

/// @notice Discovery posture, frozen per Hand at raise.
/// @dev    `Public`/`Preview` require a discovery ref + commitment; `Dark`
///         forbids both and forbids tags. Enforced in AHandCore.raise.
enum Visibility { Public, Preview, Dark }

/// @notice Reason a claim was credited; carried by PayoutAllocated.
/// @dev    `Charity` and `GiverResidual` fire once per settlement; `ShakerMargin`
///         once per paid hop (routePosition meaningful); `RaiserRefund` once on reclaim.
enum AllocationKind { Charity, ShakerMargin, GiverResidual, RaiserRefund }

/// @notice A single delegation hop, signed under EIP-712 by the parent capability.
/// @dev    Field order is FROZEN (feeds SHAKE_TYPEHASH and hashShake). One Shake
///         proves the parent handed a share down to `childCapability`; the margin
///         it keeps is `parentClaimBps - childClaimBps`.
struct Shake {
    uint256 handId;
    address childCapability; // bearer: fresh ephemeral key; personal: wallet of the recipient
    address shaker;          // stable attributed account; zero = anonymous (zero-margin only)
    uint16  parentClaimBps;  // = childClaim of the previous hop (honest display during signing)
    uint16  childClaimBps;   // hop margin = parent − child
    bytes32 hopDataHash;     // app-opaque commitment; zero = none
    uint40  deadline;        // explicit, never past the Hand expiry
}

/// @notice Consent signed by a distinct attributed Shaker account, agreeing to
///         its attribution and payout on a specific hop.
/// @dev    Only the single `shakeHash` field is signed (see SHAKER_ACCEPTANCE_TYPEHASH);
///         the deadline is inherited from the referenced Shake. Required only for an
///         explicit shaker (distinct, non-zero, not the parent capability itself).
struct ShakerAcceptance {
    bytes32 shakeHash;       // EIP-712 struct hash of the accepted Shake
}

/// @notice The terminal claim on a Hand, signed under EIP-712 by the last
///         capability of the route.
/// @dev    Field order is FROZEN (feeds GIVE_TYPEHASH and hashGive). `routeHash`
///         pins the exact accepted route so no prefix of hops can be substituted,
///         and `finalClaimBps` pins the giver's terminal share.
struct Give {
    uint256 handId;
    bytes32 routeHash;       // binds the complete accepted route — no tail substitution
    address giver;
    bytes32 solutionHash;
    uint16  finalClaimBps;   // binds the giver signature to their terminal share
    uint40  deadline;        // never past the Hand expiry
}

/// @notice Consent signed by the Giver account, agreeing to its attribution and
///         residual payout. ALWAYS required at settlement.
/// @dev    Only the single `giveHash` field is signed (see GIVER_ACCEPTANCE_TYPEHASH);
///         the deadline is inherited from the referenced Give.
struct GiverAcceptance {
    bytes32 giveHash;        // EIP-712 struct hash of the accepted Give
}

/// @notice Calldata inputs to AHandCore.raise. The policy fields snapshot into the
///         Hand and are immutable for its entire life.
/// @dev    Not a storage struct; passed by the raiser. `charityBps` must sit within
///         [MIN_CHARITY_BPS, MAX_CHARITY_BPS] and `metadataCommitment` must be non-zero.
struct RaiseParams {
    address    token;
    uint96     amount;
    uint40     expiry;
    address    charityRecipient;
    uint16     charityBps;        // within [MIN_CHARITY_BPS, MAX_CHARITY_BPS]
    uint16     minGiverClaimBps;
    address    rootCapability;
    Visibility visibility;
    bytes32    metadataCommitment;
    bytes32    discoveryCommitment;
}

/// @notice The full on-chain state of one Hand: escrow, policy snapshot and the
///         settlement commitment Signals later verifies against.
/// @dev    Storage layout is FROZEN and hand-packed into 7 slots (comments mark
///         the boundaries) — the contract is deployed, so field order and widths
///         must not change. `creditedReward` is written once at raise and NEVER
///         zeroed (Signals rereads it after settlement); the outstanding liability
///         is derived from `status`, not from zeroing the amount.
struct Hand {
    // slot 0
    address    raiser;
    uint40     expiry;
    uint16     charityBps;
    uint16     minGiverClaimBps;
    Visibility visibility;
    Status     status;
    // slot 1 — creditedReward is a snapshot, never mutated; liability keys on status
    address    rewardToken;
    uint96     creditedReward;
    // slot 2
    address    charityRecipient;
    uint64     usdScaleAtRaise;
    // slot 3
    address    rootCapability;
    // slots 4–6
    bytes32    metadataCommitment;
    bytes32    discoveryCommitment;
    bytes32    thankSignalSourceHash; // zero until Thank; stays zero on Reclaim
}

/// @notice Optional context attached to a voluntary Up. It enriches the emitted
///         event only; it is never a balance dimension and cannot change amounts.
/// @dev    At least one field must be non-zero (AHandSignals.up reverts ZeroContext
///         otherwise). `handId` zero means "none"; when set it implicitly references
///         HandRef(chainid, sourceCore, handId).
struct UpContext {
    uint256 handId;          // zero = none; implicitly HandRef(chainid, sourceCore, handId)
    bytes32 reasonTag;
    bytes32 evidenceHash;
}

/*//////////////////////////////////////////////////////////////
                            Errors
//////////////////////////////////////////////////////////////*/

/// @notice A reentrant call was detected by the transient-storage guard.
error Reentrancy();
/// @notice A required address argument was the zero address.
error ZeroAddress();
/// @notice A signal burn/spend exceeded the holder's balance.
error InsufficientBalance();
/// @notice An Up spend exceeded the caller's spendable (earned) balance.
error InsufficientEarned();
/// @notice Two positional arrays that must match length did not.
error LengthMismatch();
/// @notice acceptPolicyAdmin was called by an account that is not the pending admin.
error NotPendingOwner();

/// @notice A signed artifact references a different Hand than the one being settled.
error WrongHand();
/// @notice A signature did not recover to (or ERC-1271-validate as) the expected capability.
error CapabilityProof();          // signature not from the expected capability
/// @notice A hop's parentClaimBps did not equal the previous hop's childClaimBps.
error ClaimMismatch();            // parentClaim != childClaim of the previous hop
/// @notice A hop's child claim exceeded its parent claim (margins must telescope down).
error ClaimMustNotGrow();         // telescopic margins
/// @notice A hop's child claim fell below the Hand's minGiverClaimBps floor.
error ClaimBelowFloor();          // < minGiverClaimBps
/// @notice A Shake or Give deadline had already passed at settlement time.
error TicketExpired();
/// @notice A Shake or Give deadline was set later than the Hand's own expiry.
error DeadlineExceedsExpiry();
/// @notice The submitted route carried more than MAX_SHAKES hops.
error RouteTooLong();             // > MAX_SHAKES
/// @notice thank was authorized by an account other than the Hand's raiser.
error NotRaiser();
/// @notice The Hand is not Active (already settled, reclaimed, or never raised).
error NotActive();                // settle-once
/// @notice reclaim was called before the Hand's expiry.
error NotExpired();
/// @notice thank was called at or after the Hand's expiry (that window is reclaim's).
error Expired();                  // thank at or after expiry
/// @notice The chosen charity recipient is not on the allowlist.
error CharityNotWhitelisted();
/// @notice A zero amount was supplied where a positive value is required.
error ZeroAmount();
/// @notice A parameter fell outside the constitutional bounds (bps, expiry, decimals).
error BoundsViolated();           // parameters outside of the constitutional boundaries

/// @notice A policy-only function was called by an account other than policyAdmin.
error OnlyPolicyAdmin();
/// @notice A new raise was attempted while the reward token is disabled.
error TokenNotEnabled();
/// @notice RaiseParams.token did not equal the single immutable reward token.
error TokenMismatch();
/// @notice The measured deposit delta did not equal the declared amount (fee-on-transfer rejected).
error InexactDeposit();           // received delta != declared amount (fee-on-transfer rejected)
/// @notice The charity split floored to zero — the charity would receive nothing.
error ZeroCharityAllocation();
/// @notice The distributable pool (amount − charity) floored to zero — nothing left to route.
error ZeroDistributable();
/// @notice A paid hop (margin > 0) carried an anonymous (zero) shaker.
error AnonymousShakerWithMargin();
/// @notice An explicit shaker's ShakerAcceptance signature was missing or invalid.
error ShakerAcceptanceInvalid();
/// @notice An anonymous or self-attributed hop carried acceptance bytes it must not.
error UnexpectedAcceptance();     // self/anonymous entry carrying acceptance bytes
/// @notice A hop's margin floored to a zero token allocation (dust hop).
error MarginRoundsToZero();
/// @notice Give.routeHash did not match the hash of the verified route.
error RouteHashMismatch();
/// @notice The Giver's acceptance signature was missing or invalid.
error GiverAcceptanceInvalid();
/// @notice The discovery ref / commitment / tags were inconsistent with the visibility.
error InvalidVisibilityData();
/// @notice Public tags were not strictly ascending, unique, non-zero, or within bound.
error TagsInvalid();
/// @notice A withdraw found no claim credited to (token, beneficiary).
error ZeroClaim();

// Signals
/// @notice materializeThank was called for a Hand that is not in the Settled state.
error NotSettled();
/// @notice The source key for this materialization was already processed.
error AlreadyMaterialized();
/// @notice Rebuilt commitment did not match the Hand's stored thankSignalSourceHash.
error SourceCommitmentMismatch();
/// @notice An Up targeted the caller itself.
error SelfTarget();
/// @notice An Up supplied a UpContext with every field zero.
error ZeroContext();

/*//////////////////////////////////////////////////////////////
        EIP-712 — shared between core, SDK and tests
//////////////////////////////////////////////////////////////*/

/// @title  AHandSig
/// @author aHand
/// @notice The canonical EIP-712 hashing rules for aHand's four signature
///         families (Shake, ShakerAcceptance, Give, GiverAcceptance) plus the
///         route and Hand identities they build on.
/// @dev    The type strings are FROZEN literals and MUST byte-match the SDK and
///         the tests — the type hash is keccak256 of the exact string, so a single
///         character change forks every signature. The domain uses name "aHand",
///         version "2".
library AHandSig {
    /// @dev EIP-712 typeHash for the Shake struct. Frozen literal — must byte-match the SDK.
    bytes32 internal constant SHAKE_TYPEHASH = keccak256(
        "Shake(uint256 handId,address childCapability,address shaker,uint16 parentClaimBps,uint16 childClaimBps,bytes32 hopDataHash,uint40 deadline)"
    );
    /// @dev EIP-712 typeHash for the ShakerAcceptance struct.
    bytes32 internal constant SHAKER_ACCEPTANCE_TYPEHASH = keccak256(
        "ShakerAcceptance(bytes32 shakeHash)"
    );
    /// @dev EIP-712 typeHash for the Give struct. Frozen literal — must byte-match the SDK.
    bytes32 internal constant GIVE_TYPEHASH = keccak256(
        "Give(uint256 handId,bytes32 routeHash,address giver,bytes32 solutionHash,uint16 finalClaimBps,uint40 deadline)"
    );
    /// @dev EIP-712 typeHash for the GiverAcceptance struct.
    bytes32 internal constant GIVER_ACCEPTANCE_TYPEHASH = keccak256(
        "GiverAcceptance(bytes32 giveHash)"
    );
    /// @dev Reserved for the relayed-submission extension; no entry point consumes it yet.
    bytes32 internal constant THANK_PERMIT_TYPEHASH = keccak256(
        "ThankPermit(uint256 handId,bytes32 routeHash,bytes32 giveHash,uint256 nonce,uint40 deadline)"
    );

    /// @notice The EIP-712 domain separator binding signatures to this chain and core.
    /// @dev    Recomputed from live block.chainid, so callers can cache it while
    ///         staying fork-safe (see AHandCore.DOMAIN_SEPARATOR).
    /// @param  core The verifying contract address to bind into the domain.
    /// @return The domain separator for (name "aHand", version "2", chainId, core).
    function domainSeparator(address core) internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("aHand")),
            keccak256(bytes("2")),
            block.chainid,
            core
        ));
    }

    /// @notice EIP-712 struct hash of a Shake (the shakeHash used everywhere).
    /// @dev    Deliberately excludes signature bytes — this is the identity a
    ///         ShakerAcceptance and the route hash reference.
    /// @param  s The Shake to hash.
    /// @return The EIP-712 hashStruct(Shake).
    function hashShake(Shake memory s) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            SHAKE_TYPEHASH, s.handId, s.childCapability, s.shaker,
            s.parentClaimBps, s.childClaimBps, s.hopDataHash, s.deadline
        ));
    }

    /// @notice EIP-712 struct hash of a ShakerAcceptance over a given shakeHash.
    /// @param  shakeHash The hashStruct(Shake) the shaker consents to.
    /// @return The EIP-712 hashStruct(ShakerAcceptance).
    function hashShakerAcceptance(bytes32 shakeHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(SHAKER_ACCEPTANCE_TYPEHASH, shakeHash));
    }

    /// @notice EIP-712 struct hash of a Give (the giveHash used everywhere).
    /// @param  g The Give to hash.
    /// @return The EIP-712 hashStruct(Give).
    function hashGive(Give memory g) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            GIVE_TYPEHASH, g.handId, g.routeHash, g.giver,
            g.solutionHash, g.finalClaimBps, g.deadline
        ));
    }

    /// @notice EIP-712 struct hash of a GiverAcceptance over a given giveHash.
    /// @param  giveHash The hashStruct(Give) the giver consents to.
    /// @return The EIP-712 hashStruct(GiverAcceptance).
    function hashGiverAcceptance(bytes32 giveHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(GIVER_ACCEPTANCE_TYPEHASH, giveHash));
    }

    /// @notice Canonical Hand reference — one identity across contracts, SDK and indexers.
    /// @dev    Binds chain and core so the same handId on another chain/core is a
    ///         distinct reference. Feeds hashRoute and the Signals source keys.
    /// @param  core   The core contract that owns the Hand.
    /// @param  handId The Hand id.
    /// @return keccak256(abi.encode(chainId, core, handId)).
    function handRef(address core, uint256 handId) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, core, handId));
    }

    /// @notice Route identity: ordered shake struct hashes under the Hand reference.
    ///         Signature bytes deliberately excluded — malleability cannot rename a route.
    /// @dev    An empty `shakeHashes` array is valid: the zero-shake (direct) route.
    /// @param  handRef_    The canonical Hand reference from handRef.
    /// @param  shakeHashes The ordered list of hashStruct(Shake), route order.
    /// @return keccak256(abi.encode(handRef_, shakeHashes)).
    function hashRoute(bytes32 handRef_, bytes32[] memory shakeHashes) internal pure returns (bytes32) {
        return keccak256(abi.encode(handRef_, shakeHashes));
    }

    /// @notice EIP-712 signing digest: the 0x1901 envelope over a struct hash.
    /// @param  ds         The domain separator.
    /// @param  structHash The EIP-712 hashStruct of the signed artifact.
    /// @return keccak256(0x1901 || ds || structHash) — the value that is signed/recovered.
    function digest(bytes32 ds, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", ds, structHash));
    }
}

/*//////////////////////////////////////////////////////////////
        Signals source domains — typed, collision-free keys
//////////////////////////////////////////////////////////////*/

/// @title  AHandSource
/// @author aHand
/// @notice The domain-tagged keys and commitment Signals uses to pull settled
///         facts out of Core. Keeping the keys typed and chain/core-bound makes a
///         source key mean exactly one event forever.
/// @dev    `thankCommitment` is computed identically by Core at settlement (stored
///         in Hand.thankSignalSourceHash) and by Signals at materialization
///         (recomputed and compared) — the two call sites MUST stay in lockstep.
library AHandSource {
    /// @dev Domain tag for the RAISED receipt source key.
    bytes32 internal constant RAISED_SOURCE = keccak256("aHand.signals.source.raised.v1");
    /// @dev Domain tag for the THANK settlement source key and commitment.
    bytes32 internal constant THANK_SOURCE  = keccak256("aHand.signals.source.thank.v1");

    /// @notice Idempotence key for the RAISED materialization of a Hand.
    /// @param  core   The source core address.
    /// @param  handId The Hand id.
    /// @return keccak256(abi.encode(RAISED_SOURCE, chainId, core, handId)).
    function raisedKey(address core, uint256 handId) internal view returns (bytes32) {
        return keccak256(abi.encode(RAISED_SOURCE, block.chainid, core, handId));
    }

    /// @notice Idempotence key for the THANK materialization of a Hand.
    /// @param  core   The source core address.
    /// @param  handId The Hand id.
    /// @return keccak256(abi.encode(THANK_SOURCE, chainId, core, handId)).
    function thankKey(address core, uint256 handId) internal view returns (bytes32) {
        return keccak256(abi.encode(THANK_SOURCE, block.chainid, core, handId));
    }

    /// @notice Commitment binding the Thank settlement facts Signals later verifies.
    ///         Occurrence arrays keep route order and preserve anonymous zeros.
    /// @dev    Core stores the result in Hand.thankSignalSourceHash at settlement;
    ///         Signals recomputes it from the same inputs and requires equality
    ///         (SourceCommitmentMismatch). Anonymous hops are encoded as zero
    ///         addresses so route order and length round-trip exactly.
    /// @param  core               The source core address.
    /// @param  handId             The Hand id.
    /// @param  raiser             The Hand's raiser.
    /// @param  giver              The settled giver.
    /// @param  charityTokenAmount The floored charity allocation in token units.
    /// @param  usdScaleAtRaise    The raise-time USD scale snapshot.
    /// @param  occShakers         Per-hop attributed shaker, route order (zero = anonymous).
    /// @param  occClaimDeltas     Per-hop margin bps, route order.
    /// @return The Thank source commitment hash.
    function thankCommitment(
        address core,
        uint256 handId,
        address raiser,
        address giver,
        uint96  charityTokenAmount,
        uint64  usdScaleAtRaise,
        address[] memory occShakers,
        uint16[]  memory occClaimDeltas
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(
            THANK_SOURCE, block.chainid, core, handId,
            raiser, giver, charityTokenAmount, usdScaleAtRaise,
            keccak256(abi.encodePacked(occShakers)),
            keccak256(abi.encodePacked(occClaimDeltas))
        ));
    }
}

/// @notice The minimal ERC-20 surface Core needs from the reward token.
/// @dev    `decimals` is read once at construction to validate `usdScale`; the
///         value transfer paths use OpenZeppelin SafeERC20 over the full IERC20.
interface IERC20Minimal {
    function transfer(address to, uint256 amt) external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @notice Read surface Signals depends on; an explicit struct getter avoids
///         the auto-getter tuple fragility that positional decoding invites.
/// @dev    Implemented by AHandCore.getHand. Signals holds only this view
///         interface over an immutable core address — the coupling is one-way
///         and read-only, so Signals can never touch escrowed value.
interface IAHandCoreView {
    /// @notice The full Hand snapshot for `handId` (zeroed struct if never raised).
    /// @param  handId The Hand id to read.
    /// @return The Hand storage struct by value.
    function getHand(uint256 handId) external view returns (Hand memory);
}
