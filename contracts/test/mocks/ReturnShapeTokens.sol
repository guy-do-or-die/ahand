// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice `transfer` toward a listed recipient MOVES the funds and then returns
///         `false`: the S1 shape. Inside the push frame the false word reverts the
///         frame, so nothing stays moved and exactly the share parks as a claim;
///         a top-level withdraw reverts `SafeERC20FailedOperation` with the claim intact.
contract TransferThenFalseToken is MockUSD {
    mapping(address => bool) public falseTo;

    function setFalseTo(address account, bool isFalse) external {
        falseTo[account] = isFalse;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _move(msg.sender, to, amount);
        return !falseTo[to];
    }
}

/// @notice `transfer` moves the funds and returns the word 2 instead of `true`.
///         The OpenZeppelin rule accepts only the word 1: every push defers and
///         every withdraw reverts `SafeERC20FailedOperation`. `transferFrom` is
///         honest, so the deposit enters.
contract Returns2Token is MockUSD {
    function transfer(address to, uint256 amount) public override returns (bool) {
        _move(msg.sender, to, amount);
        assembly ("memory-safe") {
            mstore(0x00, 2)
            return(0x00, 0x20)
        }
    }
}

/// @notice `transfer` moves the funds and returns a single byte (0x01): returndata
///         shorter than a word is not `true`, so pushes defer and withdraw reverts
///         `SafeERC20FailedOperation`. `transferFrom` is honest.
contract ShortReturnToken is MockUSD {
    function transfer(address to, uint256 amount) public override returns (bool) {
        _move(msg.sender, to, amount);
        assembly ("memory-safe") {
            mstore8(0x00, 1)
            return(0x00, 0x01)
        }
    }
}
