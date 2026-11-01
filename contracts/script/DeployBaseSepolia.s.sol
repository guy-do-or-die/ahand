// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script, console2} from "forge-std/Script.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignalsV2} from "../src/AHandSignalsV2.sol";
import {UsdcProfile} from "./UsdcProfile.sol";

/// @notice Base Sepolia stand: public demo deployment. Hands escrow any ERC-20; the
///         canonical testnet USDC is the token the app defaults to and the one token
///         of the Signals v2 qualification profile.
///   CHARITY_ADDR=0x... [POLICY_ADMIN_ADDR=0x...] [USDC_ADDR=0x...] \
///   forge script script/DeployBaseSepolia.s.sol --rpc-url $BASE_SEPOLIA_RPC \
///       --private-key $DEPLOYER_PK --broadcast
/// Record the logged deploy block — it becomes the subgraph startBlock.
/// Fund demo actors with testnet USDC via faucet.circle.com.
/// @dev   The profile token is selected by chain id (`UsdcProfile`, §18 #10);
///        `USDC_ADDR` overrides it for a stand on a mock. Core itself never
///        references USDC: only Signals v2 binds it, immutably.
contract DeployBaseSepolia is Script {
    function run() external {
        // Team-controlled EOAs; no anvil conventions on a public chain.
        address charity = vm.envAddress("CHARITY_ADDR");
        address usdc = vm.envOr("USDC_ADDR", UsdcProfile.usdcOf(block.chainid));
        address policyAdmin = vm.envOr("POLICY_ADMIN_ADDR", msg.sender); // default: broadcaster

        vm.startBroadcast();

        address[] memory charities = new address[](1);
        charities[0] = charity;
        AHandCore core = new AHandCore(charities, policyAdmin);
        AHandSignalsV2 signals = new AHandSignalsV2(address(core), usdc); // Seam-3 reference reader, USDC-only profile

        vm.stopBroadcast();

        console2.log("AHandCore     :", address(core));
        console2.log("AHandSignalsV2:", address(signals));
        console2.log("USDC          :", usdc);
        console2.log("charity       :", charity);
        console2.log("policyAdmin   :", policyAdmin);
        console2.log("block         :", block.number); // subgraph startBlock
        console2.log("DOMAIN_SEPARATOR:");
        console2.logBytes32(core.DOMAIN_SEPARATOR());
    }
}
