// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Script.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {AHandWitness} from "../src/AHandWitness.sol";

/// @notice Base Sepolia stand: public demo deployment over canonical testnet USDC.
///   CHARITY_ADDR=0x... [POLICY_ADMIN_ADDR=0x...] \
///   forge script script/DeployBaseSepolia.s.sol --rpc-url $BASE_SEPOLIA_RPC \
///       --private-key $DEPLOYER_PK --broadcast
/// Record the logged deploy block — it becomes the subgraph startBlock.
/// Fund demo actors with testnet USDC via faucet.circle.com.
contract DeployBaseSepolia is Script {
    /// Circle's canonical USDC on Base Sepolia.
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    /// USDC has 6 decimals -> usdScale 10 ** (18 - 6).
    uint64 constant USD_SCALE = 1e12;

    function run() external {
        // Team-controlled EOAs; no anvil conventions on a public chain.
        address charity = vm.envAddress("CHARITY_ADDR");
        address usdc = vm.envOr("USDC_ADDR", USDC);
        address policyAdmin = vm.envOr("POLICY_ADMIN_ADDR", msg.sender); // default: broadcaster

        vm.startBroadcast();

        address[] memory ch = new address[](1);
        ch[0] = charity;
        AHandCore core = new AHandCore(usdc, USD_SCALE, ch, policyAdmin);
        AHandSignals signals = new AHandSignals(address(core));
        AHandWitness witness = new AHandWitness(address(core));

        vm.stopBroadcast();

        console2.log("AHandCore  :", address(core));
        console2.log("Signals    :", address(signals));
        console2.log("Witness    :", address(witness));
        console2.log("USDC       :", usdc);
        console2.log("charity    :", charity);
        console2.log("policyAdmin:", policyAdmin);
        console2.log("block      :", block.number); // subgraph startBlock
        console2.log("DOMAIN_SEPARATOR:");
        console2.logBytes32(core.DOMAIN_SEPARATOR());
    }
}
