// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice A transfer toward a hog recipient burns HOG_GAS before moving
///         funds: more than the core's push stipend, far less than a
///         top-level withdraw forwards.
contract GasHogToken is MockUSD {
    uint256 public constant HOG_GAS = 150_000;

    mapping(address => bool) public hog;

    function setHog(address account, bool isHog) external {
        hog[account] = isHog;
    }

    function _move(address from, address to, uint256 amount) internal override {
        if (hog[to]) {
            uint256 start = gasleft();
            while (start - gasleft() < HOG_GAS) {}
        }
        super._move(from, to, amount);
    }
}
