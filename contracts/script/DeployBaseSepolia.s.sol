// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script, console2} from "forge-std/Script.sol";
import {AHandCore} from "../src/AHandCore.sol";

/// @notice Base Sepolia stand: public demo deployment. Hands escrow any ERC-20; the
///         canonical testnet USDC is the token the app and Signals v2 default to.
///   CHARITY_ADDR=0x... [POLICY_ADMIN_ADDR=0x...] \
///   forge script script/DeployBaseSepolia.s.sol --rpc-url $BASE_SEPOLIA_RPC \
///       --private-key $DEPLOYER_PK --broadcast
/// Record the logged deploy block — it becomes the subgraph startBlock.
/// Fund demo actors with testnet USDC via faucet.circle.com.
/// @dev   Signals v2 (the Seam-3 reference reader with the USDC-only profile) is
///        deployed here by the step that lands AHandSignalsV2.sol; until then this
///        stand is Core-only. Core itself never references USDC.
contract DeployBaseSepolia is Script {
    /// Circle's canonical USDC on Base Sepolia: the Signals v2 qualification profile.
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        // Team-controlled EOAs; no anvil conventions on a public chain.
        address charity = vm.envAddress("CHARITY_ADDR");
        address usdc = vm.envOr("USDC_ADDR", USDC);
        address policyAdmin = vm.envOr("POLICY_ADMIN_ADDR", msg.sender); // default: broadcaster

        vm.startBroadcast();

        address[] memory charities = new address[](1);
        charities[0] = charity;
        AHandCore core = new AHandCore(charities, policyAdmin);
        // Signals v2: `new AHandSignalsV2(address(core), usdc)` lands with that contract.

        vm.stopBroadcast();

        console2.log("AHandCore  :", address(core));
        console2.log("USDC       :", usdc);
        console2.log("charity    :", charity);
        console2.log("policyAdmin:", policyAdmin);
        console2.log("block      :", block.number); // subgraph startBlock
        console2.log("DOMAIN_SEPARATOR:");
        console2.logBytes32(core.DOMAIN_SEPARATOR());
    }
}
