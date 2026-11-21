// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Test code, deployed on the local chain (31337) only. The smallest smart account
///         owned by one key: it confirms (ERC-1271) a plain 65-byte signature by its owner,
///         as the `Wallet` in Core.t.sol does, and its owner can make it call out, so that money
///         paid to it is never stuck. It stands in for a smart wallet that a giver has not
///         deployed yet: its address is known before its code exists (`KeyAccountFactory`).
contract KeyAccount {
    address public immutable owner;

    error NotOwner();

    constructor(address owner_) {
        owner = owner_;
    }

    /// @notice ERC-1271. A signature that cannot be read, or that another key made, is refused
    ///         with a non-magic answer, never a revert.
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, signature);
        return err == ECDSA.RecoverError.NoError && recovered == owner ? this.isValidSignature.selector : bytes4(0);
    }

    /// @notice The owner moves what the account holds: one call, its result returned as is.
    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, bytes memory result) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }

    receive() external payable {}
}

/// @notice Test code, deployed on the local chain (31337) only. Makes `KeyAccount`s by CREATE2:
///         the address follows from the owner and the salt alone, so a giver can sign with an
///         account before it exists (ERC-6492 names this factory and `createAccount`'s calldata).
contract KeyAccountFactory {
    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    /// @notice Deploys the owner's account for `salt`, or returns it if it is already there:
    ///         calling twice is harmless, as ERC-6492's setup call requires.
    function createAccount(address owner, uint256 salt) external returns (KeyAccount account) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length != 0) return KeyAccount(payable(predicted));

        account = new KeyAccount{salt: bytes32(salt)}(owner);
        emit AccountCreated(address(account), owner, salt);
    }

    /// @notice The address `createAccount(owner, salt)` deploys to, with or without code there yet.
    function getAddress(address owner, uint256 salt) public view returns (address) {
        bytes32 initcodeHash = keccak256(abi.encodePacked(type(KeyAccount).creationCode, abi.encode(owner)));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), initcodeHash))))
        );
    }
}
