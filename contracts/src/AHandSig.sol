// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Shake, Give} from "./AHandTypes.sol";

/// @title  AHandSig
/// @author aHand
/// @notice The canonical EIP-712 hashing rules of aHand's four signature families
///         (Shake, ShakerAcceptance, Give, GiverAcceptance) and the two identities
///         they build on: the Hand reference and the route hash.
/// @dev    The type strings are FROZEN literals and MUST byte-match the SDK and the
///         test vectors: a type hash is keccak256 of the exact string, so one changed
///         character forks every signature. The domain is (name "aHand", version "3",
///         chainId, Core). Core derives its live domain from OpenZeppelin `EIP712`;
///         `domainSeparator(core)` is the same formula as a library mirror for
///         vectors and tests, and a test pins their equality.
library AHandSig {
    /// @dev EIP-712 type hash of the Shake struct.
    bytes32 internal constant SHAKE_TYPEHASH = keccak256(
        "Shake(uint256 handId,address childCapability,address shaker,uint16 parentClaimBps,uint16 childClaimBps,bytes32 hopDataHash,uint40 deadline)"
    );
    /// @dev EIP-712 type hash of the ShakerAcceptance struct.
    bytes32 internal constant SHAKER_ACCEPTANCE_TYPEHASH = keccak256("ShakerAcceptance(bytes32 shakeHash)");
    /// @dev EIP-712 type hash of the Give struct.
    bytes32 internal constant GIVE_TYPEHASH = keccak256(
        "Give(uint256 handId,bytes32 routeHash,address giver,bytes32 solutionHash,uint16 finalClaimBps,uint40 deadline)"
    );
    /// @dev EIP-712 type hash of the GiverAcceptance struct.
    bytes32 internal constant GIVER_ACCEPTANCE_TYPEHASH = keccak256("GiverAcceptance(bytes32 giveHash)");

    /// @dev EIP-712 domain type hash (the standard four-field domain).
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    /// @dev keccak256 of the domain name "aHand".
    bytes32 internal constant DOMAIN_NAME_HASH = keccak256("aHand");
    /// @dev keccak256 of the domain version "3".
    bytes32 internal constant DOMAIN_VERSION_HASH = keccak256("3");

    /// @notice The EIP-712 domain separator binding signatures to this chain and `core`.
    /// @dev    Computed from the live `block.chainid`, so it is fork-safe by construction.
    ///         Mirrors OpenZeppelin `EIP712("aHand", "3")` as instantiated by Core.
    /// @param  core The verifying contract.
    /// @return The domain separator for (name "aHand", version "3", chainId, core).
    function domainSeparator(address core) internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, block.chainid, core));
    }

    /// @notice EIP-712 struct hash of a Shake: the `shakeHash` every acceptance and route hash reference.
    /// @dev    Signature bytes are not part of the struct, so malleability cannot rename a hop.
    /// @param  s The Shake.
    /// @return hashStruct(Shake).
    function hashShake(Shake memory s) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SHAKE_TYPEHASH,
                s.handId,
                s.childCapability,
                s.shaker,
                s.parentClaimBps,
                s.childClaimBps,
                s.hopDataHash,
                s.deadline
            )
        );
    }

    /// @notice EIP-712 struct hash of a ShakerAcceptance over `shakeHash`.
    /// @param  shakeHash hashStruct(Shake) the shaker consents to.
    /// @return hashStruct(ShakerAcceptance).
    function hashShakerAcceptance(bytes32 shakeHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(SHAKER_ACCEPTANCE_TYPEHASH, shakeHash));
    }

    /// @notice EIP-712 struct hash of a Give: the `giveHash` the GiverAcceptance references.
    /// @param  g The Give.
    /// @return hashStruct(Give).
    function hashGive(Give memory g) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(GIVE_TYPEHASH, g.handId, g.routeHash, g.giver, g.solutionHash, g.finalClaimBps, g.deadline)
        );
    }

    /// @notice EIP-712 struct hash of a GiverAcceptance over `giveHash`.
    /// @param  giveHash hashStruct(Give) the giver consents to.
    /// @return hashStruct(GiverAcceptance).
    function hashGiverAcceptance(bytes32 giveHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(GIVER_ACCEPTANCE_TYPEHASH, giveHash));
    }

    /// @notice The canonical Hand reference: one identity across chains, Cores, SDK and indexers.
    /// @dev    The same `handId` on another chain or Core is a different reference.
    /// @param  core   The Core that owns the Hand.
    /// @param  handId The Hand id.
    /// @return keccak256(abi.encode(chainId, core, handId)).
    function handRef(address core, uint256 handId) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, core, handId));
    }

    /// @notice The route identity: the ordered Shake struct hashes under the Hand reference.
    /// @dev    An empty `shakeHashes` is the zero-shake route (the root signs the Give).
    ///         Signature bytes are excluded, so malleability cannot rename a route.
    /// @param  handRef_    The Hand reference from `handRef`.
    /// @param  shakeHashes hashStruct(Shake) of every hop, in route order.
    /// @return keccak256(abi.encode(handRef_, shakeHashes)).
    function hashRoute(bytes32 handRef_, bytes32[] memory shakeHashes) internal pure returns (bytes32) {
        return keccak256(abi.encode(handRef_, shakeHashes));
    }

    /// @notice The EIP-712 signing digest: the 0x1901 envelope over a struct hash.
    /// @param  ds         The domain separator.
    /// @param  structHash hashStruct of the signed artifact.
    /// @return keccak256("\x19\x01" ‖ ds ‖ structHash): the value signed and recovered.
    function digest(bytes32 ds, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", ds, structHash));
    }
}
