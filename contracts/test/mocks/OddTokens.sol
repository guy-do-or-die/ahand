// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice While `idle`, a transfer answers `true` and moves nothing: the silent no-op that
///         must not count as a payout made, nor as a reward received.
contract IdleToken is MockUSD {
    bool public idle;

    function setIdle(bool isIdle) external {
        idle = isIdle;
    }

    function _move(address from, address to, uint256 amount) internal override {
        if (idle) return;
        super._move(from, to, amount);
    }
}

/// @notice While `generous`, the receiver is credited one unit more than was sent, as a token
///         that settles accrued interest on a transfer would: Core's balance rises by more than
///         the amount it asked for.
contract GenerousToken is MockUSD {
    bool public generous;

    function setGenerous(bool isGenerous) external {
        generous = isGenerous;
    }

    function _move(address from, address to, uint256 amount) internal override {
        super._move(from, to, amount);
        if (generous) {
            balanceOf[to] += 1;
            totalSupply += 1;
        }
    }
}
