// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice A conforming token that answers with `bombSize` bytes of returndata
///         (first word honest, the rest junk) from `transfer` and, when enabled,
///         from `balanceOf`. The payout frame copies no returndata and the memory
///         expansion is paid inside the frame's budget; outside a frame the caller
///         who chose this token pays for its own `balanceOf`.
contract ReturndataBombToken is MockUSD {
    uint256 public bombSize = 1 << 20; // 1 MiB
    bool public bombOnTransfer = true;
    bool public bombOnBalanceOf;

    function setBomb(uint256 size, bool onTransfer, bool onBalanceOf) external {
        bombSize = size;
        bombOnTransfer = onTransfer;
        bombOnBalanceOf = onBalanceOf;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _move(msg.sender, to, amount);
        if (bombOnTransfer) _bomb(1);
        return true;
    }

    function balanceOfBombed(address account) external view returns (uint256) {
        uint256 balance = balanceOf[account];
        if (bombOnBalanceOf) _bomb(balance);
        return balance;
    }

    /// @dev Returns `word` followed by `bombSize − 32` bytes of memory.
    function _bomb(uint256 word) private view {
        uint256 size = bombSize;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, word)
            return(ptr, size)
        }
    }
}
