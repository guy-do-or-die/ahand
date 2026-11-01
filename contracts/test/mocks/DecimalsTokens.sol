// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BasicToken} from "./BasicToken.sol";

/// @notice A conforming token with no `decimals()` at all. Core never reads it,
///         so a Hand over this token raises, settles and reclaims like any other.
contract NoDecimalsToken is BasicToken {}

/// @notice A conforming token with 30 decimals: pots far above 2^96 are ordinary here.
contract Token30Decimals is BasicToken {
    string public constant name = "Thirty";
    string public constant symbol = "T30";
    uint8 public constant decimals = 30;
}

/// @notice A plain 18-decimal token with a large pre-minted supply (one billion
///         whole units to the deployer) on top of the faucet mint.
contract Token18 is BasicToken {
    string public constant name = "Eighteen";
    string public constant symbol = "T18";
    uint8 public constant decimals = 18;

    constructor() {
        totalSupply = 1_000_000_000 ether;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }
}
