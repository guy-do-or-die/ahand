// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice USDC-like blacklist: any transfer toward a blocked address
///         reverts. Exercises withdraw retryability — claims must stay
///         credited when the payout leg reverts.
contract BlacklistToken is MockUSD {
    mapping(address => bool) public blocked;

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function _move(address from, address to, uint256 amount) internal override {
        require(!blocked[to], "BLACKLISTED");
        super._move(from, to, amount);
    }
}
