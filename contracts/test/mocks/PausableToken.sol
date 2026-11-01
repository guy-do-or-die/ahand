// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice A token that can be paused after Hands are open: every move reverts
///         while paused, so pushes defer, withdraws revert and the reclaim refund
///         parks until it is unpaused — a stop confined to this token.
contract PausableToken is MockUSD {
    bool public paused;

    function setPaused(bool isPaused) external {
        paused = isPaused;
    }

    function _move(address from, address to, uint256 amount) internal override {
        require(!paused, "PAUSED");
        super._move(from, to, amount);
    }
}
