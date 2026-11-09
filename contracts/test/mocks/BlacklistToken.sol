// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice USDC-like blacklist: any transfer toward a blocked address
///         reverts. Exercises withdraw retries: a payout that reverts
///         must stay pending.
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
