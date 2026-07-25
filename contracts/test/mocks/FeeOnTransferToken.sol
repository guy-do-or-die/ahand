// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice Six-decimal token that skims 1% on transferFrom: the receiver
///         gets less than declared, so exact-delta deposits must revert
///         with InexactDeposit.
contract FeeOnTransferToken is MockUSD {
    uint256 public constant FEE_BPS = 100; // 1%

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        allowance[from][msg.sender] -= amount;
        uint256 fee = amount * FEE_BPS / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee; // fee burned: the delta shortfall is all that matters
        emit Transfer(from, to, amount - fee);
        return true;
    }
}
