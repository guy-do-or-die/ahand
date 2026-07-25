// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Shake, Give, AHandSig, ZeroAddress} from "./AHandTypes.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface ICoreDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice Peripheral telemetry for aHand.
///         Core does not know about it: zero connectivity, zero privileges, money is untouchable.
///         Verifies the SAME EIP-712 signatures as core (verifying contract domain is public).
///         Paid by who values it; events are telemetry, not settlement facts.
/// IMPORTANT for indexers: typed witness proves the AUTHORSHIP of bytes
/// (signer = recovered), but NOT chain membership — anyone can sign
/// any Shake struct with their own key. Tree builders MUST verify
/// capability-linkage: parentCapability in {hand's rootCapability, childCapability
/// of previously witnessed hops} — instead of trusting a single event.
contract AHandWitness {
    ICoreDomain public immutable core;
    mapping(bytes32 => uint40) public witnessedAt; // artifact -> first timestamp

    event Witnessed(bytes32 indexed hash, address indexed by, uint40 timestamp);
    event ShakeWitnessed(uint256 indexed handId, address indexed parentCapability,
                        address childCapability, address shaker, uint16 marginBps,
                        bytes32 hopDataHash, uint40 timestamp);
    event GiveWitnessed(uint256 indexed handId, address indexed capability,
                       address indexed giver, bytes32 routeHash, bytes32 solutionHash,
                       uint40 timestamp);
    event EpochRoot(address indexed relay, bytes32 root, uint256 leaves);

    error BadSignature();
    error InvalidShake();

    constructor(address core_) {
        if (core_ == address(0)) revert ZeroAddress();
        core = ICoreDomain(core_);
    }

    /// Blind timestamp of any commit (payload, metadata, whatever).
    function witness(bytes32 hash) external {
        if (witnessedAt[hash] == 0) {
            witnessedAt[hash] = uint40(block.timestamp);
            emit Witnessed(hash, msg.sender, uint40(block.timestamp));
        }
    }

    /// Typed shake anchor. Attribution is recovered from signature:
    /// you can only anchor a hop you actually own.
    function witnessShake(Shake calldata s, bytes calldata sig) external {
        if (s.childClaimBps > s.parentClaimBps) revert InvalidShake();
        // witness only attests to protocol-compliant structures;
        // arbitrary payloads should go to blind witness(hash)
        bytes32 h = AHandSig.hashShake(s);
        (address parent, ECDSA.RecoverError err, ) =
            ECDSA.tryRecover(AHandSig.digest(core.DOMAIN_SEPARATOR(), h), sig);
        if (err != ECDSA.RecoverError.NoError || parent == address(0)) revert BadSignature();
        bytes32 key = keccak256(abi.encode(h, sig));
        if (witnessedAt[key] == 0) {
            witnessedAt[key] = uint40(block.timestamp);
            emit ShakeWitnessed(s.handId, parent, s.childCapability, s.shaker,
                               s.parentClaimBps - s.childClaimBps, s.hopDataHash,
                               uint40(block.timestamp));
        }
    }

    /// Typed give anchor. GiveWitnessed and core.Reclaimed = freerider-fact
    /// (indexer composability; no state changes or mints on Core).
    function witnessGive(Give calldata g, bytes calldata sig) external {
        bytes32 h = AHandSig.hashGive(g);
        (address cap, ECDSA.RecoverError err, ) =
            ECDSA.tryRecover(AHandSig.digest(core.DOMAIN_SEPARATOR(), h), sig);
        if (err != ECDSA.RecoverError.NoError || cap == address(0)) revert BadSignature();
        bytes32 key = keccak256(abi.encode(h, sig));
        if (witnessedAt[key] == 0) {
            witnessedAt[key] = uint40(block.timestamp);
            emit GiveWitnessed(g.handId, cap, g.giver, g.routeHash, g.solutionHash,
                              uint40(block.timestamp));
        }
    }

    /// Merkle-epoch: relay timestamps thousands of hops in a single transaction.
    function witnessRoot(bytes32 root, uint256 leaves) external {
        emit EpochRoot(msg.sender, root, leaves);
    }
}
