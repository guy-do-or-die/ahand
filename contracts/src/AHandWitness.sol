// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Shake, Give, AHandSig, ZeroAddress} from "./AHandTypes.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice The read-only slice of AHandCore that Witness binds signatures to.
interface ICoreDomain {
    /// @notice The core's current EIP-712 domain separator.
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @title  AHandWitness
/// @author aHand
/// @notice Peripheral telemetry for aHand.
///         Core does not know about it: zero connectivity, zero privileges, money is untouchable.
///         Verifies the SAME EIP-712 signatures as core (verifying contract domain is public).
///         Paid by who values it; events are telemetry, not settlement facts.
/// @dev    IMPORTANT for indexers: typed witness proves the AUTHORSHIP of bytes
///         (signer = recovered), but NOT chain membership — anyone can sign
///         any Shake or Give struct with their own key, for any handId, route or
///         deadline. Tree builders MUST verify capability-linkage: parentCapability
///         in {hand's rootCapability, childCapability of previously witnessed hops},
///         and a Give's capability must be the tail of the route its routeHash names
///         — instead of trusting a single event.
///
///         Three separate namespaces: blind `witnessedAt[hash]`, `shakeWitnessedAt[key]`
///         and `giveWitnessedAt[key]` (typed key = keccak256(structHash, sig)). A blind
///         hash can never occupy a typed slot, so whoever holds a signed artifact cannot
///         suppress its typed event by blind-witnessing the key first.
///
///         Idempotency sentinel: a slot `== 0` means "not yet witnessed".
///         Every entry point writes the first-seen timestamp only when the slot is
///         still zero and emits nothing on a repeat, so re-submitting an artifact is
///         a cheap no-op that preserves the original timestamp. block.timestamp is
///         never zero on any live chain, so a written slot can never be mistaken for
///         an unwitnessed one.
contract AHandWitness {
    /// @notice The core whose EIP-712 domain these signatures are verified against.
    ICoreDomain public immutable core;
    /// @notice First-seen block timestamp per blind commitment (0 = never witnessed).
    mapping(bytes32 => uint40) public witnessedAt;
    /// @notice First-seen block timestamp per typed Shake key (0 = never witnessed).
    mapping(bytes32 => uint40) public shakeWitnessedAt;
    /// @notice First-seen block timestamp per typed Give key (0 = never witnessed).
    mapping(bytes32 => uint40) public giveWitnessedAt;

    /// @notice A blind commitment was timestamped for the first time.
    /// @param hash      The witnessed commitment.
    /// @param by        The submitter.
    /// @param timestamp The first-seen block timestamp.
    event Witnessed(bytes32 indexed hash, address indexed by, uint40 timestamp);
    /// @notice A protocol-compliant Shake was anchored, attributed to its recovered signer.
    /// @param handId          The Shake's Hand id.
    /// @param parentCapability The recovered signer (the delegating capability).
    /// @param childCapability  The hop's child capability.
    /// @param shaker           The attributed shaker (zero = anonymous).
    /// @param marginBps        parentClaimBps − childClaimBps.
    /// @param hopDataHash      The app-opaque hop commitment.
    /// @param timestamp        The first-seen block timestamp.
    event ShakeWitnessed(uint256 indexed handId, address indexed parentCapability,
                        address childCapability, address shaker, uint16 marginBps,
                        bytes32 hopDataHash, uint40 timestamp);
    /// @notice A signed Give was anchored, attributed to its recovered signer.
    /// @param handId       The Give's Hand id (not checked to exist).
    /// @param capability   The recovered signer (claims to be the terminal capability; unverified).
    /// @param giver        The giver named in the Give.
    /// @param routeHash    The route the Give claims.
    /// @param solutionHash The giver's solution commitment.
    /// @param timestamp    The first-seen block timestamp.
    event GiveWitnessed(uint256 indexed handId, address indexed capability,
                       address indexed giver, bytes32 routeHash, bytes32 solutionHash,
                       uint40 timestamp);
    /// @notice A relay anchored a Merkle root covering many hops at once.
    /// @param relay  The submitting relay.
    /// @param root   The Merkle root.
    /// @param leaves The number of leaves the root covers.
    event EpochRoot(address indexed relay, bytes32 root, uint256 leaves);

    /// @notice A signature did not recover to a valid, non-zero signer.
    error BadSignature();
    /// @notice A Shake's child claim exceeded its parent claim (not protocol-compliant).
    error InvalidShake();

    /// @notice Binds this Witness to the core whose domain separator it verifies against.
    /// @param  core_ The AHandCore address (must be non-zero).
    constructor(address core_) {
        if (core_ == address(0)) revert ZeroAddress();
        core = ICoreDomain(core_);
    }

    /// @notice Blind timestamp of any commit (payload, metadata, whatever).
    /// @dev    First-write-wins via the witnessedAt == 0 sentinel; a repeat is a no-op.
    /// @param  hash The arbitrary commitment to timestamp.
    function witness(bytes32 hash) external {
        if (witnessedAt[hash] == 0) {
            witnessedAt[hash] = uint40(block.timestamp);
            emit Witnessed(hash, msg.sender, uint40(block.timestamp));
        }
    }

    /// @notice Typed shake anchor. Attribution is recovered from signature:
    ///         you can only anchor a hop you actually own.
    /// @dev    Attests only to protocol-compliant Shakes (child claim <= parent);
    ///         arbitrary payloads should use blind witness(hash). Keyed on
    ///         keccak256(structHash, sig) and idempotent via the shakeWitnessedAt sentinel.
    /// @param  s   The Shake to anchor.
    /// @param  sig The Shake signature (must recover to a non-zero parent capability).
    function witnessShake(Shake calldata s, bytes calldata sig) external {
        if (s.childClaimBps > s.parentClaimBps) revert InvalidShake();
        // witness only attests to protocol-compliant structures;
        // arbitrary payloads should go to blind witness(hash)
        bytes32 h = AHandSig.hashShake(s);
        (address parent, ECDSA.RecoverError err, ) =
            ECDSA.tryRecover(AHandSig.digest(core.DOMAIN_SEPARATOR(), h), sig);
        if (err != ECDSA.RecoverError.NoError || parent == address(0)) revert BadSignature();
        bytes32 key = keccak256(abi.encode(h, sig));
        if (shakeWitnessedAt[key] == 0) {
            shakeWitnessedAt[key] = uint40(block.timestamp);
            emit ShakeWitnessed(s.handId, parent, s.childCapability, s.shaker,
                               s.parentClaimBps - s.childClaimBps, s.hopDataHash,
                               uint40(block.timestamp));
        }
    }

    /// @notice Typed give anchor: proves only that the recovered signer signed these
    ///         Give bytes by the timestamp. It checks neither the Hand, the route, the
    ///         deadline nor giver consent. Joined with verified route linkage, giver
    ///         consent and a later core.Reclaimed it is freeriding-RISK evidence for
    ///         indexers, not guilt (no state changes or mints on Core).
    /// @dev    Keyed on keccak256(structHash, sig) and idempotent via the
    ///         giveWitnessedAt sentinel; a repeat is a no-op that keeps the first timestamp.
    /// @param  g   The Give to anchor.
    /// @param  sig The Give signature (must recover to a non-zero capability).
    function witnessGive(Give calldata g, bytes calldata sig) external {
        bytes32 h = AHandSig.hashGive(g);
        (address cap, ECDSA.RecoverError err, ) =
            ECDSA.tryRecover(AHandSig.digest(core.DOMAIN_SEPARATOR(), h), sig);
        if (err != ECDSA.RecoverError.NoError || cap == address(0)) revert BadSignature();
        bytes32 key = keccak256(abi.encode(h, sig));
        if (giveWitnessedAt[key] == 0) {
            giveWitnessedAt[key] = uint40(block.timestamp);
            emit GiveWitnessed(g.handId, cap, g.giver, g.routeHash, g.solutionHash,
                              uint40(block.timestamp));
        }
    }

    /// @notice Merkle-epoch: relay timestamps thousands of hops in a single transaction.
    /// @dev    Pure telemetry — emits only; no storage, no idempotence, no verification.
    /// @param  root   The Merkle root covering the batch.
    /// @param  leaves The number of leaves the root commits to.
    function witnessRoot(bytes32 root, uint256 leaves) external {
        emit EpochRoot(msg.sender, root, leaves);
    }
}
