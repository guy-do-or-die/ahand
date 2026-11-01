// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice A transfer toward a hog recipient burns `hogGas` before moving funds.
///         Set it below PUSH_GAS to prove a heavy-but-honest push still lands, and
///         above it to prove the frame defers while a top-level withdraw (unbounded
///         gas) still drains the claim.
contract GasHogToken is MockUSD {
    uint256 public hogGas = 250_000;

    mapping(address => bool) public hog;

    function setHog(address account, bool isHog) external {
        hog[account] = isHog;
    }

    function setHogGas(uint256 gas) external {
        hogGas = gas;
    }

    function _move(address from, address to, uint256 amount) internal override {
        if (hog[to]) {
            uint256 start = gasleft();
            uint256 spin;
            while (start - gasleft() < hogGas) {
                spin = uint256(keccak256(abi.encode(spin)));
            }
        }
        super._move(from, to, amount);
    }
}
