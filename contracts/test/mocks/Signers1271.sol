// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC1271_MAGIC} from "./SmartWallet1271.sol";

/// @notice Accepts ANY signature bytes — including empty — for any digest. Models a
///         wallet whose authorization does not live in the signature payload.
///         Pins the rule that empty acceptance bytes on an explicit hop are decided
///         by the shaker's own verifier.
contract AlwaysValid1271 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return ERC1271_MAGIC;
    }
}

/// @notice A live validator whose consent can be withdrawn: the owner key's ECDSA
///         signatures validate until `revoked` is set or the owner is rotated.
///         Models key rotation / module removal between signing and settlement:
///         consent is re-checked at Thank and may have gone away.
contract Revocable1271Signer {
    address public owner;
    bool public revoked;

    constructor(address owner_) {
        owner = owner_;
    }

    function setRevoked(bool isRevoked) external {
        revoked = isRevoked;
    }

    function rotateOwner(address newOwner) external {
        owner = newOwner;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (revoked) return 0xffffffff;
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && signer == owner) return ERC1271_MAGIC;
        return 0xffffffff;
    }
}

/// @notice Answers the magic word followed by `bombSize − 32` bytes of junk. Core
///         reads a fixed 32-byte buffer, so the answer validates whenever the
///         validator can afford its own memory expansion under ERC1271_GAS (a 1 MiB
///         bomb cannot: it runs out of gas and the signature is simply invalid).
contract ReturndataBombValidator {
    uint256 public bombSize = 1 << 20; // 1 MiB

    function setBombSize(uint256 size) external {
        bombSize = size;
    }

    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        uint256 size = bombSize;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0x1626ba7e))
            return(ptr, size)
        }
    }
}

/// @notice A hostile validator that calls an arbitrary target with arbitrary data
///         before approving. Core reaches validators by STATICCALL, so a
///         state-changing call reverts inside the validator and the signature
///         comes back invalid; outside a static context the call goes through.
contract Reentrant1271 {
    address public immutable target;
    bytes public data;

    constructor(address target_, bytes memory data_) {
        target = target_;
        data = data_;
    }

    function isValidSignature(bytes32, bytes calldata) external returns (bytes4) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ERC1271_MAGIC;
    }
}
