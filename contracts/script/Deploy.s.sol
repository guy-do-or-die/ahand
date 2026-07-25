// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Script.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {AHandWitness} from "../src/AHandWitness.sol";
import {MockUSD} from "../test/mocks/MockUSD.sol";

/// @notice Local stand: anvil-only.
///   anvil --chain-id 31337
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
///       --private-key $ANVIL_PK0 --broadcast
contract Deploy is Script {
    /// mockUSD has 6 decimals -> usdScale 10 ** (18 - 6).
    uint64 constant USD_SCALE = 1e12;

    function run() external {
        vm.startBroadcast();

        // anvil actors by convention: [0]=deployer=policyAdmin, [1]=charity
        address charity = vm.addr(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d); // anvil #1
        address policyAdmin = msg.sender; // deployer keeps policy on the local stand

        MockUSD usd = new MockUSD();

        address[] memory ch = new address[](1);
        ch[0] = charity;
        AHandCore core = new AHandCore(address(usd), USD_SCALE, ch, policyAdmin);
        AHandSignals signals = new AHandSignals(address(core));
        AHandWitness witness = new AHandWitness(address(core));

        usd.mint(msg.sender, 1_000_000e6);
        usd.approve(address(core), type(uint256).max);

        // Fund user's Rabby wallet
        address user = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        (bool funded, ) = user.call{value: 100 ether}("");
        require(funded, "dev wallet funding failed");
        usd.mint(user, 1_000_000e6);

        vm.stopBroadcast();

        console2.log("AHandCore  :", address(core));
        console2.log("Signals    :", address(signals));
        console2.log("Witness    :", address(witness));
        console2.log("mockUSD    :", address(usd));
        console2.log("charity    :", charity);
        console2.log("policyAdmin:", policyAdmin);
        console2.log("block      :", block.number);
        console2.log("DOMAIN_SEPARATOR:");
        console2.logBytes32(core.DOMAIN_SEPARATOR());
    }
}
