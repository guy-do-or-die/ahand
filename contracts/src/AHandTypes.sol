// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
                        aHand Core v2 — Types
//////////////////////////////////////////////////////////////*/

/// @title  AHandTypes
/// @author aHand
/// @notice The shared type surface of aHand Core v2: the enums, structs, errors and
///         the narrow facts interface that Core, every reader, every signer, the SDK
///         and the indexers agree on. No behaviour lives here.
/// @dev    Enum order, struct field order and the `IAHandFacts` shape are FROZEN:
///         enums are stored and compared numerically, the signed structs feed the
///         EIP-712 type strings in `AHandSig`, `Hand` is the storage layout of this
///         Core, and `HandFacts` is the layout-independent view a later Core must keep.

/*//////////////////////////////////////////////////////////////
                              Enums
//////////////////////////////////////////////////////////////*/

/// @notice Lifecycle of a Hand. One-way: None → Active → {Settled | Reclaimed}.
/// @dev    `None` is the zero default of an unraised id. `Settled` means a thank
///         paid the route; `Reclaimed` means the raiser was refunded after expiry.
///         Both are terminal and a Hand reaches exactly one of them, once.
enum Status { None, Active, Settled, Reclaimed }

/// @notice Discovery posture, frozen per Hand at raise.
/// @dev    `Public` and `Preview` require a discovery ref and commitment; `Dark`
///         forbids both and forbids tags. Core cannot tell Public from Preview.
enum Visibility { Public, Preview, Dark }

/// @notice The reason tag carried by every payout event.
/// @dev    `Charity` and `GiverResidual` at most once per thank; `ShakerMargin` once
///         per paid hop (the event position is the hop index); `RaiserRefund` once per
///         reclaim. No member is ever added: new payout shapes live outside Core.
enum AllocationKind { Charity, ShakerMargin, GiverResidual, RaiserRefund }

/*//////////////////////////////////////////////////////////////
                  Signed artifacts (EIP-712 structs)
//////////////////////////////////////////////////////////////*/

/// @notice One delegation hop, signed by the parent capability (the root capability
///         for hop 0, then the previous hop's `childCapability`).
/// @dev    Field order feeds `AHandSig.SHAKE_TYPEHASH`. Core cannot tell a bearer key
///         from a personal wallet from a contract: a capability is any address that
///         can sign. The hop keeps `parentClaimBps − childClaimBps` as its margin.
struct Shake {
    uint256 handId;           // the Hand this hop belongs to
    address childCapability;  // the capability this hop delegates to; never zero
    address shaker;           // attributed account; zero = anonymous (zero margin only)
    uint16  parentClaimBps;   // == childClaimBps of the previous hop (10 000 at the root)
    uint16  childClaimBps;    // margin = parent − child; never grows, never below the floor
    bytes32 hopDataHash;      // app-opaque typed envelope; zero = none
    uint40  deadline;         // now ≤ deadline ≤ Hand expiry at settlement
}

/// @notice Consent of an explicit shaker to its attribution and payout on one hop.
/// @dev    Required only when `shaker` is distinct from the signing capability and
///         non-zero. Signs the Shake's struct hash, so it is bound to that exact hop.
struct ShakerAcceptance {
    bytes32 shakeHash;        // EIP-712 struct hash of the accepted Shake
}

/// @notice The terminal claim on a Hand, signed by the last capability of the route.
/// @dev    Field order feeds `AHandSig.GIVE_TYPEHASH`. `routeHash` pins the exact
///         route (no prefix or tail substitution); `finalClaimBps` pins the terminal
///         claim; `solutionHash` is an off-chain salted commitment Core never reads.
struct Give {
    uint256 handId;           // the Hand this Give settles
    bytes32 routeHash;        // hashRoute(handRef, ordered shakeHashes) of the exact route
    address giver;            // the payee of the residual; never zero
    bytes32 solutionHash;     // salted solution commitment, computed off-chain
    uint16  finalClaimBps;    // == the terminal claim the route leaves
    uint40  deadline;         // now ≤ deadline ≤ Hand expiry at settlement
}

/// @notice Consent of the giver to its attribution and residual. ALWAYS required,
///         even when the giver is the terminal capability itself.
/// @dev    Signs the Give's struct hash, so it is bound to that exact Give.
struct GiverAcceptance {
    bytes32 giveHash;         // EIP-712 struct hash of the accepted Give
}

/*//////////////////////////////////////////////////////////////
                        Calldata carriers
//////////////////////////////////////////////////////////////*/

/// @notice One route hop as submitted to `thank`: the Shake and its proofs.
/// @dev    `shakerAcceptanceSig` MUST be empty for anonymous and self-attributed hops;
///         for an explicit shaker it is whatever that shaker's verifier accepts (an
///         EOA needs a 65-byte signature; a contract decides, possibly on empty bytes).
struct Hop {
    Shake shake;
    bytes capabilitySig;        // by the expected capability of this hop
    bytes shakerAcceptanceSig;  // by the explicit shaker; empty otherwise
}

/// @notice The terminal of a route as submitted to `thank`: the Give and its proofs.
struct Terminal {
    Give  give;
    bytes capabilitySig;        // by the terminal capability
    bytes giverAcceptanceSig;   // by `give.giver`, always
}

/// @notice Inputs of `raise`. Every field is frozen into the Hand for its whole life.
/// @dev    `token` is any ERC-20 and is zero iff `amount` is zero (a zero-pot Hand).
///         `charityRecipient` is zero iff `charityBps` is zero; otherwise it must be
///         allowlisted at raise time. `discoveryCommitment` is zero iff Dark.
struct RaiseParams {
    address    token;               // any ERC-20; address(0) iff amount == 0
    uint256    amount;              // raw token units escrowed; no cap
    uint40     expiry;              // > block.timestamp; final, never extended
    address    charityRecipient;    // allowlisted iff charityBps > 0; zero iff charityBps == 0
    uint16     charityBps;          // 0 ≤ bps ≤ MAX_CHARITY_BPS
    uint16     minGiverClaimBps;    // 1 ≤ floor ≤ 10 000
    address    rootCapability;      // non-zero; the route's first signer at 10 000 bps
    Visibility visibility;
    bytes32    metadataCommitment;  // mandatory per-Hand typed envelope
    bytes32    discoveryCommitment; // zero iff Dark
}

/*//////////////////////////////////////////////////////////////
                           Hand storage
//////////////////////////////////////////////////////////////*/

/// @notice The full on-chain state of one Hand, hand-packed into eight slots.
/// @dev    Layout is FROZEN for this Core (apps and tests bind to `getHand`; contracts
///         bind to `IAHandFacts` instead). `pool` is written once at raise and never
///         zeroed: the liability keys on `status`. `closedAt` shares the status word,
///         so recording the terminal time costs no extra slot. `settlementHash` is
///         non-zero iff Settled; `closedAt` is non-zero iff terminal.
struct Hand {
    // slot 0 — identity and lifecycle word (256 bits exactly)
    address    raiser;              // funder, thank authority, refund destination
    uint40     expiry;              // final
    uint40     closedAt;            // 0 while Active; timestamp of thank or reclaim
    Visibility visibility;
    Status     status;
    // slot 1 — money terms (192 bits; the remaining 64 bits are unused forever)
    address    token;               // per Hand; address(0) iff pool == 0
    uint16     charityBps;          // 0..MAX_CHARITY_BPS
    uint16     minGiverClaimBps;    // 1..10 000
    // slot 2
    uint256    pool;                // P: the exact measured deposit; never zeroed
    // slot 3 — never written when charityBps == 0
    address    charityRecipient;
    // slot 4
    address    rootCapability;
    // slot 5
    bytes32    metadataCommitment;  // mandatory
    // slot 6 — never written in Dark
    bytes32    discoveryCommitment;
    // slot 7 — written once by thank; stays zero on reclaim
    bytes32    settlementHash;
}

/*//////////////////////////////////////////////////////////////
                              Errors
//////////////////////////////////////////////////////////////*/

// ---- raise ----

/// @notice A required address was the zero address (root capability, policy admin, charity).
error ZeroAddress();
/// @notice `amount` and `token` disagree about being zero: a zero pot has no token and vice versa.
error ZeroPotTerms();
/// @notice `charityBps` exceeds MAX_CHARITY_BPS, or `minGiverClaimBps` is outside 1..10 000.
error BoundsViolated();
/// @notice A charity recipient was supplied although `charityBps` is zero.
error UnexpectedCharityRecipient();
/// @notice The charity recipient is not on the allowlist (also: it can never be zero or Core).
error CharityNotAllowed();
/// @notice A declared donation would pay nothing: floor(amount · charityBps / 10 000) == 0.
error ZeroCharityAllocation();
/// @notice `expiry` is not strictly in the future.
error ExpiryInPast();
/// @notice The metadata commitment, discovery ref, discovery commitment and tags are
///         inconsistent with the chosen visibility.
error InvalidVisibilityData();
/// @notice More than MAX_PUBLIC_TAGS tags, or tags not strictly ascending (hence not unique/non-zero).
error TagsInvalid();
/// @notice The measured deposit did not move exactly `amount` on both the payer and Core.
error InexactDeposit();

// ---- thank / reclaim: Hand state ----

/// @notice The Hand is not Active (never raised, already settled, or already reclaimed).
error NotActive();
/// @notice `thank` was called at or after expiry (that window belongs to reclaim).
error HandExpired();
/// @notice `reclaim` was called before expiry.
error HandNotExpired();
/// @notice `thank` was called by an account other than the Hand's raiser.
error NotRaiser();

// ---- thank: route walk (position = hop index; hops.length names the Give) ----

/// @notice The artifact at `position` references a different Hand.
error WrongHand(uint256 position);
/// @notice The Shake at `position` delegates to the zero address (a dead end).
error ZeroCapability(uint256 position);
/// @notice The artifact at `position` was not signed by the expected capability.
error CapabilityProof(uint256 position);
/// @notice The claim entering `position` does not equal the claim the previous hop left
///         (or, for the Give, the terminal claim of the route).
error ClaimMismatch(uint256 position);
/// @notice The child claim at `position` exceeds its parent claim.
error ClaimMustNotGrow(uint256 position);
/// @notice The child claim at `position` is below the Hand's giver floor.
error ClaimBelowFloor(uint256 position);
/// @notice The artifact at `position` has a deadline already in the past.
error ArtifactExpired(uint256 position);
/// @notice The artifact at `position` has a deadline later than the Hand's expiry.
error DeadlineExceedsExpiry(uint256 position);
/// @notice The hop at `position` keeps a margin but names no shaker.
error AnonymousShakerWithMargin(uint256 position);
/// @notice The hop at `position` keeps a margin that floors to zero token units.
error MarginRoundsToZero(uint256 position);
/// @notice The explicit shaker at `position` did not validate its ShakerAcceptance.
error ShakerAcceptanceInvalid(uint256 position);
/// @notice An anonymous or self-attributed hop at `position` carried acceptance bytes.
error UnexpectedAcceptance(uint256 position);

// ---- thank: Give ----

/// @notice `Give.routeHash` is not the hash of the verified route.
error RouteHashMismatch();
/// @notice `Give.giver` is the zero address.
error ZeroGiver();
/// @notice The giver did not validate its GiverAcceptance.
error GiverAcceptanceInvalid();

// ---- delivery ----

/// @notice Too little gas remains to give a push frame its full budget (the whole
///         transaction reverts so a caller can never starve a push into deferral).
error InsufficientGas();
/// @notice A transfer did not debit Core's custody by exactly `amount`.
error TransferInexact();
/// @notice `pushExact` was called by an account other than Core itself.
error OnlySelf();
/// @notice `withdraw` found no claim for (token, beneficiary).
error ZeroClaim();

// ---- policy ----

/// @notice A policy function was called by an account other than `policyAdmin`.
error OnlyPolicyAdmin();
/// @notice `acceptPolicyAdmin` was called by an account other than `pendingPolicyAdmin`.
error NotPendingAdmin();
/// @notice The policy call would change nothing (same allowlist value, same nomination).
error NoChange();

/*//////////////////////////////////////////////////////////////
                       The stable facts interface
//////////////////////////////////////////////////////////////*/

/// @title  IAHandFacts
/// @author aHand
/// @notice The STABLE read interface contracts bind to. It carries every Raise-time
///         fact and both terminal facts (`closedAt`, `settlementHash`), so a reader
///         never needs the layout-coupled `getHand`. A later Core may re-layout
///         `Hand` and still implement this interface unchanged.
/// @dev    Implemented by `AHandCore.facts`. Pure storage read; no external calls.
interface IAHandFacts {
    /// @notice Every authenticated fact of one Hand. Frozen shape.
    struct HandFacts {
        Status     status;
        address    raiser;
        address    token;
        uint256    pool;
        uint16     charityBps;
        address    charityRecipient;
        uint16     minGiverClaimBps;
        address    rootCapability;
        uint40     expiry;
        uint40     closedAt;
        Visibility visibility;
        bytes32    metadataCommitment;
        bytes32    discoveryCommitment;
        bytes32    settlementHash;
    }

    /// @notice The facts of `handId` (an all-zero struct with `status == None` if never raised).
    /// @param  handId The Hand id.
    /// @return The frozen facts snapshot.
    function facts(uint256 handId) external view returns (HandFacts memory);
}
