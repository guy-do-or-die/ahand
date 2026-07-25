// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
                        aHand — Types
//////////////////////////////////////////////////////////////*/

enum Status { None, Active, Settled, Reclaimed }

/// @notice Discovery posture, frozen per Hand at raise.
enum Visibility { Public, Preview, Dark }

/// @notice Reason a claim was credited; carried by PayoutAllocated.
enum AllocationKind { Charity, ShakerMargin, GiverResidual, RaiserRefund }

/// @notice Shake: EIP-712, signed by the parent capability.
struct Shake {
    uint256 handId;
    address childCapability; // bearer: fresh ephemeral key; personal: wallet of the recipient
    address shaker;          // stable attributed account; zero = anonymous (zero-margin only)
    uint16  parentClaimBps;  // = childClaim of the previous hop (honest display during signing)
    uint16  childClaimBps;   // hop margin = parent − child
    bytes32 hopDataHash;     // app-opaque commitment; zero = none
    uint40  deadline;        // explicit, never past the Hand expiry
}

/// @notice Acceptance by a distinct Shaker account: consent to attribution and payout.
struct ShakerAcceptance {
    bytes32 shakeHash;       // EIP-712 struct hash of the accepted Shake
}

/// @notice Give: EIP-712, signed by the last capability of the route.
struct Give {
    uint256 handId;
    bytes32 routeHash;       // binds the complete accepted route — no tail substitution
    address giver;
    bytes32 solutionHash;
    uint16  finalClaimBps;   // binds the giver signature to their terminal share
    uint40  deadline;        // never past the Hand expiry
}

/// @notice Acceptance by the Giver account: consent to attribution and residual payout.
struct GiverAcceptance {
    bytes32 giveHash;        // EIP-712 struct hash of the accepted Give
}

/// @notice Raise inputs; policy values snapshot into the Hand and never change.
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

/// @notice Context attached to a voluntary Up; enriches events, never a balance dimension.
struct UpContext {
    uint256 handId;          // zero = none; implicitly HandRef(chainid, sourceCore, handId)
    bytes32 reasonTag;
    bytes32 evidenceHash;
}

/*//////////////////////////////////////////////////////////////
                            Errors
//////////////////////////////////////////////////////////////*/
error Reentrancy();
error ZeroAddress();
error InsufficientBalance();
error InsufficientEarned();
error LengthMismatch();
error NotPendingOwner();

error WrongHand();
error CapabilityProof();          // signature not from the expected capability
error ClaimMismatch();            // parentClaim != childClaim of the previous hop
error ClaimMustNotGrow();         // telescopic margins
error ClaimBelowFloor();          // < minGiverClaimBps
error TicketExpired();
error DeadlineExceedsExpiry();
error RouteTooLong();             // > MAX_SHAKES
error NotRaiser();
error NotActive();                // settle-once
error NotExpired();
error Expired();                  // thank at or after expiry
error CharityNotWhitelisted();
error ZeroAmount();
error BoundsViolated();           // parameters outside of the constitutional boundaries

error OnlyPolicyAdmin();
error TokenNotEnabled();
error TokenMismatch();
error InexactDeposit();           // received delta != declared amount (fee-on-transfer rejected)
error ZeroCharityAllocation();
error ZeroDistributable();
error AnonymousShakerWithMargin();
error ShakerAcceptanceInvalid();
error UnexpectedAcceptance();     // self/anonymous entry carrying acceptance bytes
error MarginRoundsToZero();
error RouteHashMismatch();
error GiverAcceptanceInvalid();
error InvalidVisibilityData();
error TagsInvalid();
error ZeroClaim();

// Signals
error NotSettled();
error AlreadyMaterialized();
error SourceCommitmentMismatch();
error SelfTarget();
error ZeroContext();

/*//////////////////////////////////////////////////////////////
        EIP-712 — shared between core, SDK and tests
//////////////////////////////////////////////////////////////*/
library AHandSig {
    bytes32 internal constant SHAKE_TYPEHASH = keccak256(
        "Shake(uint256 handId,address childCapability,address shaker,uint16 parentClaimBps,uint16 childClaimBps,bytes32 hopDataHash,uint40 deadline)"
    );
    bytes32 internal constant SHAKER_ACCEPTANCE_TYPEHASH = keccak256(
        "ShakerAcceptance(bytes32 shakeHash)"
    );
    bytes32 internal constant GIVE_TYPEHASH = keccak256(
        "Give(uint256 handId,bytes32 routeHash,address giver,bytes32 solutionHash,uint16 finalClaimBps,uint40 deadline)"
    );
    bytes32 internal constant GIVER_ACCEPTANCE_TYPEHASH = keccak256(
        "GiverAcceptance(bytes32 giveHash)"
    );
    /// @dev Reserved for the relayed-submission extension; no entry point consumes it yet.
    bytes32 internal constant THANK_PERMIT_TYPEHASH = keccak256(
        "ThankPermit(uint256 handId,bytes32 routeHash,bytes32 giveHash,uint256 nonce,uint40 deadline)"
    );

    function domainSeparator(address core) internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("aHand")),
            keccak256(bytes("2")),
            block.chainid,
            core
        ));
    }

    function hashShake(Shake memory s) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            SHAKE_TYPEHASH, s.handId, s.childCapability, s.shaker,
            s.parentClaimBps, s.childClaimBps, s.hopDataHash, s.deadline
        ));
    }

    function hashShakerAcceptance(bytes32 shakeHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(SHAKER_ACCEPTANCE_TYPEHASH, shakeHash));
    }

    function hashGive(Give memory g) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            GIVE_TYPEHASH, g.handId, g.routeHash, g.giver,
            g.solutionHash, g.finalClaimBps, g.deadline
        ));
    }

    function hashGiverAcceptance(bytes32 giveHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(GIVER_ACCEPTANCE_TYPEHASH, giveHash));
    }

    /// @notice Canonical Hand reference — one identity across contracts, SDK and indexers.
    function handRef(address core, uint256 handId) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, core, handId));
    }

    /// @notice Route identity: ordered shake struct hashes under the Hand reference.
    ///         Signature bytes deliberately excluded — malleability cannot rename a route.
    function hashRoute(bytes32 handRef_, bytes32[] memory shakeHashes) internal pure returns (bytes32) {
        return keccak256(abi.encode(handRef_, shakeHashes));
    }

    function digest(bytes32 ds, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", ds, structHash));
    }
}

/*//////////////////////////////////////////////////////////////
        Signals source domains — typed, collision-free keys
//////////////////////////////////////////////////////////////*/
library AHandSource {
    bytes32 internal constant RAISED_SOURCE = keccak256("aHand.signals.source.raised.v1");
    bytes32 internal constant THANK_SOURCE  = keccak256("aHand.signals.source.thank.v1");

    function raisedKey(address core, uint256 handId) internal view returns (bytes32) {
        return keccak256(abi.encode(RAISED_SOURCE, block.chainid, core, handId));
    }

    function thankKey(address core, uint256 handId) internal view returns (bytes32) {
        return keccak256(abi.encode(THANK_SOURCE, block.chainid, core, handId));
    }

    /// @notice Commitment binding the Thank settlement facts Signals later verifies.
    ///         Occurrence arrays keep route order and preserve anonymous zeros.
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

interface IERC20Minimal {
    function transfer(address to, uint256 amt) external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @notice Read surface Signals depends on; an explicit struct getter avoids
///         the auto-getter tuple fragility that positional decoding invites.
interface IAHandCoreView {
    function getHand(uint256 handId) external view returns (Hand memory);
}
