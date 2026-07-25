// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

bytes4 constant ERC1271_MAGIC = 0x1626ba7e;

/// @notice Minimal honest ERC-1271 wallet: a signature is valid iff the
///         bytes are an ECDSA signature over the digest by the owner key.
contract SmartWallet1271 {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && signer == owner) return ERC1271_MAGIC;
        return 0xffffffff;
    }
}

/// @notice Burns every unit of gas it is handed — probes the verifier's
///         fixed 1271 gas cap. Callers without a cap never return.
contract GasBomb1271 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        uint256 spin;
        while (true) {
            spin = uint256(keccak256(abi.encode(spin)));
        }
    }
}

/// @notice Tries to write state before approving. Under the verifier's
///         staticcall the SSTORE must abort the call, never validate.
contract EvilMutator1271 {
    uint256 public poked;

    function isValidSignature(bytes32, bytes calldata) external returns (bytes4) {
        poked++;
        return ERC1271_MAGIC;
    }
}

/// @notice Answers cleanly but with an off-by-one selector — a non-revert
///         response that must not count as valid. Catches verifiers that
///         test against the 0xffffffff sentinel instead of the magic value.
contract WrongMagic1271 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7d;
    }
}
