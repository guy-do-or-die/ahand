// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC1271_MAGIC} from "./SmartWallet1271.sol";

/// @notice A Safe-shaped signer: the approved-hash profile of Safe's
///         CompatibilityFallbackHandler. `isValidSignature(hash, "")` validates iff
///         the Safe pre-approved the Safe-wrapped hash on-chain via `signMessage`
///         (`signedMessages[messageHash] != 0`); non-empty bytes are checked as the
///         owner's ECDSA signature over the same wrapped hash. There is no
///         un-approve: an approved hash is approved forever, exactly like a Safe.
contract SafeLikeSigner {
    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH =
        keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    bytes32 private constant SAFE_MSG_TYPEHASH = keccak256("SafeMessage(bytes message)");

    address public immutable owner;
    mapping(bytes32 => uint256) public signedMessages;

    event SignMsg(bytes32 indexed msgHash);

    constructor(address owner_) {
        owner = owner_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, address(this)));
    }

    /// @dev Safe's `getMessageHash(abi.encode(message))`: the EIP-712 hash of
    ///      SafeMessage{ message: abi.encode(message) } under the Safe's own domain.
    function getMessageHash(bytes32 message) public view returns (bytes32) {
        bytes32 safeMessageHash = keccak256(abi.encode(SAFE_MSG_TYPEHASH, keccak256(abi.encode(message))));
        return keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeMessageHash));
    }

    /// @notice Approve `message` on-chain. Owner only. Irrevocable.
    function signMessage(bytes32 message) external {
        require(msg.sender == owner, "GS031");
        bytes32 messageHash = getMessageHash(message);
        signedMessages[messageHash] = 1;
        emit SignMsg(messageHash);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        bytes32 messageHash = getMessageHash(hash);
        if (signature.length == 0) {
            require(signedMessages[messageHash] != 0, "Hash not approved");
            return ERC1271_MAGIC;
        }
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(messageHash, signature);
        if (err == ECDSA.RecoverError.NoError && signer == owner) return ERC1271_MAGIC;
        return 0xffffffff;
    }
}
