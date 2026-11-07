// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";

/// Random raises, reclaims and time jumps by three actors over two tokens.
contract Handler is Test {
    AHandCore public core;
    MockUSD[2] public tokens;
    address[3] public actors = [address(0xA11CE), address(0xB0B), address(0xCA401)];

    mapping(address => uint256) public open; // token => sum of Active pots, kept independently of Core
    mapping(address => mapping(address => uint256)) public paidIn; // actor => token => deposits
    mapping(address => mapping(address => uint256)) public paidOut; // actor => token => refunds

    constructor(AHandCore core_, MockUSD a, MockUSD b) {
        core = core_;
        tokens = [a, b];
    }

    function raise(uint256 who, uint256 which, uint256 amount, uint256 ahead) external {
        address actor = actors[who % 3];
        MockUSD token = tokens[which % 2];
        amount = bound(amount, 0, 1e30);
        token.mint(actor, amount);
        vm.startPrank(actor);
        token.approve(address(core), amount);
        core.raise(address(token), amount, uint40(block.timestamp + bound(ahead, 1, 90 days)));
        vm.stopPrank();
        open[address(token)] += amount;
        paidIn[actor][address(token)] += amount;
    }

    function reclaim(uint256 seed) external {
        uint256 count = core.handsCount();
        if (count == 0) return;
        uint256 id = seed % count + 1;
        (address raiser, uint40 expiry, AHandCore.Status status, address token, uint256 amount) = core.hands(id);
        if (status != AHandCore.Status.Active || block.timestamp < expiry) return;
        core.reclaim(id);
        open[token] -= amount;
        paidOut[raiser][token] += amount;
    }

    function warp(uint256 by) external {
        vm.warp(block.timestamp + bound(by, 1, 30 days));
    }
}

contract CoreInvariantTest is Test {
    AHandCore core;
    MockUSD a;
    MockUSD b;
    Handler handler;

    function setUp() public {
        core = new AHandCore();
        a = new MockUSD();
        b = new MockUSD();
        handler = new Handler(core, a, b);
        targetContract(address(handler));
    }

    /// Core holds exactly the open pots of each token: not a unit more, not a unit less.
    function invariant_custodyEqualsOpenPots() public view {
        assertEq(a.balanceOf(address(core)), handler.open(address(a)));
        assertEq(b.balanceOf(address(core)), handler.open(address(b)));
    }

    /// Nobody ever gets back more than they put in.
    function invariant_nobodyProfits() public view {
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actors(i);
            assertLe(handler.paidOut(actor, address(a)), handler.paidIn(actor, address(a)));
            assertLe(handler.paidOut(actor, address(b)), handler.paidIn(actor, address(b)));
        }
    }
}
