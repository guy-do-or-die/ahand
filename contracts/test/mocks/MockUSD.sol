// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BasicToken} from "./BasicToken.sol";

/// @notice Six-decimal USD stand-in with a public faucet mint. Lives under
///         test/mocks (not inside a test file) so deploy scripts can import it
///         without dragging tests into verification bundles.
contract MockUSD is BasicToken {
    string public name = "Mock USD";
    string public symbol = "mUSD";
    uint8 public constant decimals = 6;
}
