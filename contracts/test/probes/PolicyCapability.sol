// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Give, Shake} from "../../src/AHandTypes.sol";
import {AHandSig} from "../../src/AHandSig.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Conformance probe, §9.3 #8: a policy-bounded capability (Seam 1). It is
///         the `childCapability` of a hop; its `isValidSignature` accepts a Shake
///         only if the margin it keeps is at most `maxMarginBps`, the next capability
///         is allowed, and the deadline is within `window` — and a Give only within
///         `window`. The holder's key still signs every artifact; the policy bounds
///         what that key can commit the capability to. A delegated agent's over-reach
///         is bounded without a Core field. Test-only: never deployed as protocol.
/// @dev    Core hands a verifier only the digest, so the bytes must carry the
///         artifact: `signature = abi.encode(uint8 kind, bytes artifact, bytes ownerSig)`
///         with kind 0 = `abi.encode(Shake)`, 1 = `abi.encode(Give)`. The capability
///         recomputes the digest from the artifact under the Core's domain and only
///         then checks the policy and the owner's ECDSA over that digest; malformed
///         bytes revert inside Core's staticcall and count as invalid.
contract PolicyCapability {
    /// @notice The artifact kinds the capability signs.
    uint8 public constant KIND_SHAKE = 0;
    uint8 public constant KIND_GIVE = 1;

    bytes4 private constant MAGIC = 0x1626ba7e;
    bytes4 private constant INVALID = 0xffffffff;

    /// @notice The Core whose domain binds the artifacts.
    address public immutable core;
    /// @notice The holder's key: every accepted artifact carries its ECDSA signature.
    address public immutable owner;
    /// @notice The largest margin (parent − child, bps) a Shake may keep.
    uint16 public immutable maxMarginBps;
    /// @notice The latest artifact deadline the capability signs.
    uint40 public immutable window;
    /// @notice The capabilities a Shake may delegate to.
    mapping(address => bool) public allowedChild;

    /// @param core_         The Core.
    /// @param owner_        The holder's key.
    /// @param maxMarginBps_ The margin bound.
    /// @param window_       The deadline bound.
    /// @param children      The allowed child capabilities.
    constructor(address core_, address owner_, uint16 maxMarginBps_, uint40 window_, address[] memory children) {
        core = core_;
        owner = owner_;
        maxMarginBps = maxMarginBps_;
        window = window_;
        for (uint256 i; i < children.length; ++i) {
            allowedChild[children[i]] = true;
        }
    }

    /// @notice ERC-1271: valid iff the bytes carry an artifact that hashes to `hash`
    ///         under the Core's domain, the artifact is within policy, and the owner
    ///         signed `hash`.
    /// @param  hash      The EIP-712 digest Core asks about.
    /// @param  signature `abi.encode(kind, artifact, ownerSig)`.
    /// @return The magic word, or 0xffffffff.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (uint8 kind, bytes memory artifact, bytes memory ownerSig) = abi.decode(signature, (uint8, bytes, bytes));
        bytes32 structHash;
        if (kind == KIND_SHAKE) {
            Shake memory s = abi.decode(artifact, (Shake));
            if (s.childClaimBps > s.parentClaimBps || s.parentClaimBps - s.childClaimBps > maxMarginBps) return INVALID;
            if (!allowedChild[s.childCapability]) return INVALID;
            if (s.deadline > window) return INVALID;
            structHash = AHandSig.hashShake(s);
        } else if (kind == KIND_GIVE) {
            Give memory g = abi.decode(artifact, (Give));
            if (g.deadline > window) return INVALID;
            structHash = AHandSig.hashGive(g);
        } else {
            return INVALID;
        }
        // the bytes must describe exactly the digest Core is verifying
        if (AHandSig.digest(AHandSig.domainSeparator(core), structHash) != hash) return INVALID;
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, ownerSig);
        return (err == ECDSA.RecoverError.NoError && signer == owner) ? MAGIC : INVALID;
    }

    /// @notice Pack a Shake and its owner signature into the bytes this capability validates.
    function encodeShake(Shake memory s, bytes memory ownerSig) external pure returns (bytes memory) {
        return abi.encode(KIND_SHAKE, abi.encode(s), ownerSig);
    }

    /// @notice Pack a Give and its owner signature into the bytes this capability validates.
    function encodeGive(Give memory g, bytes memory ownerSig) external pure returns (bytes memory) {
        return abi.encode(KIND_GIVE, abi.encode(g), ownerSig);
    }
}
