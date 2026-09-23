// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Six-decimal token whose `transfer` to a refusing recipient returns
///         `false` without moving funds instead of reverting — the silent
///         failure shape a settlement push must still treat as undelivered.
contract ReturnsFalseToken {
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public refuses;

    function setRefuses(address account, bool isRefusing) external {
        refuses[account] = isRefusing;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (refuses[to]) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
