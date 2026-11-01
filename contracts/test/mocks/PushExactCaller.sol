// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AHandCore} from "../../src/AHandCore.sol";

/// @notice A contract account that forwards to `pushExact`: the self-only frame must
///         refuse a contract caller exactly as it refuses an EOA (I-17).
contract PushExactCaller {
    function push(AHandCore core, address token, address to, uint256 amount) external {
        core.pushExact(token, to, amount);
    }
}
