// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Script.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {MockERC20} from "../test/AHand.attacks.t.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {StaticAnchor} from "../src/StaticAnchor.sol";

/// @notice Local stand: anvil-only.
///   anvil --chain-id 31337
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
///       --private-key $ANVIL_PK0 --broadcast
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        // anvil actors by convention: [1]=charity, [2]=maintainer
        address charity    = vm.addr(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d); // anvil #1
        address maintainer = vm.addr(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a); // anvil #2

        address[] memory ch = new address[](1);
        ch[0] = charity;
        AHandCore core = new AHandCore(ch, maintainer);
        AHandSignals signals = new AHandSignals(address(core));
        core.setSignals(address(signals));
        StaticAnchor anchor = new StaticAnchor();
        signals.setAnchor(address(anchor));

        MockERC20 usd = new MockERC20("mockUSD");
        anchor.setRate(address(usd), 1e12); // USDC-like 6dec
        usd.mint(msg.sender, 1_000_000e6);
        usd.approve(address(core), type(uint256).max);

        vm.stopBroadcast();

        console2.log("AHandCore :", address(core));
        console2.log("Signals   :", address(signals));
        console2.log("Anchor    :", address(anchor));
        console2.log("mockUSD   :", address(usd));
        console2.log("charity   :", charity);
        console2.log("maintainer:", maintainer);
        console2.log("DOMAIN_SEPARATOR:");
        console2.logBytes32(core.DOMAIN_SEPARATOR());
    }
}
