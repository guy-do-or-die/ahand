// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice The USDC-only qualification profile of Signals v2, by chain id (§18 #10):
///         Circle's canonical USDC on Base and on Base Sepolia. A deploy script
///         passes `usdcOf(block.chainid)` as the Signals constructor's profile token.
library UsdcProfile {
    /// @notice Base mainnet chain id.
    uint256 internal constant BASE = 8453;
    /// @notice Base Sepolia chain id.
    uint256 internal constant BASE_SEPOLIA = 84532;

    /// @notice USDC on Base mainnet.
    address internal constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    /// @notice USDC on Base Sepolia.
    address internal constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    /// @notice No USDC profile is recorded for this chain.
    error UnknownChain(uint256 chainId);

    /// @notice The profile token of `chainId`.
    function usdcOf(uint256 chainId) internal pure returns (address) {
        if (chainId == BASE) return USDC_BASE;
        if (chainId == BASE_SEPOLIA) return USDC_BASE_SEPOLIA;
        revert UnknownChain(chainId);
    }
}
