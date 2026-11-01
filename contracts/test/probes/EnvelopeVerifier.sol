// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IAHandFacts, Shake} from "../../src/AHandTypes.sol";

/// @notice Conformance probe, §9.2 (Seam 2): a reader of the envelope convention
///         `keccak256(abi.encode(schemaTag, keccak256(payload)))` for
///         `metadataCommitment` and `hopDataHash`. It knows nothing about Core's
///         layout: the per-Hand envelope comes from `IAHandFacts.facts` and the
///         per-hop envelope from the signed Shake itself. Readers that know a tag
///         verify the payload; Core never interprets either. Compiled against
///         `IAHandFacts` only — never `getHand`.
contract EnvelopeVerifier {
    /// @notice The Core, through its stable facts interface only.
    IAHandFacts public immutable facts;

    /// @param facts_ The Core (facts interface).
    constructor(IAHandFacts facts_) {
        facts = facts_;
    }

    /// @notice The §9.2 envelope of a payload hash under a schema tag.
    function envelope(bytes32 schemaTag, bytes32 payloadHash) public pure returns (bytes32) {
        return keccak256(abi.encode(schemaTag, payloadHash));
    }

    /// @notice Whether the Hand's `metadataCommitment` is the envelope of `payload` under `schemaTag`.
    function verifyMetadata(uint256 handId, bytes32 schemaTag, bytes memory payload) external view returns (bool) {
        return facts.facts(handId).metadataCommitment == envelope(schemaTag, keccak256(payload));
    }

    /// @notice Whether the Hand's `discoveryCommitment` is the envelope of `payload` under `schemaTag`.
    function verifyDiscovery(uint256 handId, bytes32 schemaTag, bytes memory payload) external view returns (bool) {
        return facts.facts(handId).discoveryCommitment == envelope(schemaTag, keccak256(payload));
    }

    /// @notice Whether a signed Shake's `hopDataHash` is the envelope of `payload` under `schemaTag`.
    function verifyHop(Shake memory s, bytes32 schemaTag, bytes memory payload) external pure returns (bool) {
        return s.hopDataHash == envelope(schemaTag, keccak256(payload));
    }
}
