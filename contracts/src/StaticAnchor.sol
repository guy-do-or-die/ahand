// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTypes.sol";

/// @notice Value anchor interface (spec §4): anchor is only needed for signals emission.
interface IValueAnchor {
    /// @return usd18 value of `amount` of `token` in USD, scaled to 18 decimals; 0 = token not recognized
    function usdValue(address token, uint256 amount) external view returns (uint256 usd18);
}

/// @notice v1: static rates set by owner (later timelock); unknown token => 0.
contract StaticAnchor is IValueAnchor {
    address public owner;
    address public pendingOwner;

    /// usd18 per whole token (scaled to 1e18, e.g. for USDC 6 decimals, rate = 1e12)
    mapping(address => uint256) public rate;

    event RateSet(address indexed token, uint256 rate);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function setRate(address token, uint256 rate_) external onlyOwner {
        rate[token] = rate_;
        emit RateSet(token, rate_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function usdValue(address token, uint256 amount) external view returns (uint256) {
        return amount * rate[token];
    }
}
