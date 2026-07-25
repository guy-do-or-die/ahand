// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Script.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {StaticAnchor} from "../src/StaticAnchor.sol";
import {AHandWitness} from "../src/AHandWitness.sol";

/// @notice Base Sepolia stand: public demo deployment over canonical testnet USDC.
///   CHARITY_ADDR=0x... MAINTAINER_ADDR=0x... \
///   forge script script/DeployBaseSepolia.s.sol --rpc-url $BASE_SEPOLIA_RPC \
///       --private-key $DEPLOYER_PK --broadcast
/// Record the logged deploy block — it becomes the subgraph startBlock.
/// Fund demo actors with testnet USDC via faucet.circle.com.
contract DeployBaseSepolia is Script {
    /// Circle's canonical USDC on Base Sepolia.
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        // Team-controlled EOAs; no anvil conventions on a public chain.
        address charity = vm.envAddress("CHARITY_ADDR");
        address maintainer = vm.envAddress("MAINTAINER_ADDR");
        address usdc = vm.envOr("USDC_ADDR", USDC);

        vm.startBroadcast();

        address[] memory ch = new address[](1);
        ch[0] = charity;
        AHandCore core = new AHandCore(ch, maintainer);
        AHandSignals signals = new AHandSignals(address(core));
        core.setSignals(address(signals));
        StaticAnchor anchor = new StaticAnchor();
        signals.setAnchor(address(anchor));
        AHandWitness witness = new AHandWitness(address(core));

        anchor.setRate(usdc, 1e12); // USDC 6dec

        vm.stopBroadcast();

        console2.log("AHandCore :", address(core));
        console2.log("Signals   :", address(signals));
        console2.log("Anchor    :", address(anchor));
        console2.log("Witness   :", address(witness));
        console2.log("USDC      :", usdc);
        console2.log("charity   :", charity);
        console2.log("maintainer:", maintainer);
        console2.log("block     :", block.number);
        console2.log("DOMAIN_SEPARATOR:");
        console2.logBytes32(core.DOMAIN_SEPARATOR());
    }
}
