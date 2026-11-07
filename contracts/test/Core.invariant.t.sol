// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";

/// Random raises, thanks, reclaims and time jumps by three actors over two tokens.
contract Handler is Test {
    AHandCore public core;
    MockUSD[2] public tokens;
    address[3] public actors = [address(0xA11CE), address(0xB0B), address(0xCA401)];

    mapping(address => uint256) public open; // token => sum of Active pots, kept independently of Core
    mapping(address => uint256) public paidIn; // token => all deposits
    mapping(address => uint256) public paidOut; // token => all payments and refunds
    uint256 public closed; // Hands this handler closed

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
        paidIn[address(token)] += amount;
    }

    function reclaim(uint256 seed) external {
        uint256 count = core.handsCount();
        if (count == 0) return;
        uint256 id = seed % count + 1;
        (, uint40 expiry, AHandCore.Status status, address token, uint256 amount) = core.hands(id);
        if (status != AHandCore.Status.Active || block.timestamp < expiry) return;
        core.reclaim(id);
        _closed(token, amount);
    }

    function thank(uint256 seed, uint256 to) external {
        uint256 count = core.handsCount();
        if (count == 0) return;
        uint256 id = seed % count + 1;
        (address raiser, uint40 expiry, AHandCore.Status status, address token, uint256 amount) = core.hands(id);
        if (status != AHandCore.Status.Active || block.timestamp >= expiry) return;
        address giver = actors[to % 3];
        if (giver == raiser) giver = actors[(to % 3 + 1) % 3];
        vm.prank(raiser);
        core.thank(id, giver);
        _closed(token, amount);
    }

    function _closed(address token, uint256 amount) private {
        open[token] -= amount;
        paidOut[token] += amount;
        ++closed;
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

    /// Every unit that came in is either still held or left exactly once.
    function invariant_moneyIsConserved() public view {
        assertEq(handler.paidIn(address(a)), handler.paidOut(address(a)) + a.balanceOf(address(core)));
        assertEq(handler.paidIn(address(b)), handler.paidOut(address(b)) + b.balanceOf(address(core)));
    }

    /// A closed Hand stays closed: Core counts exactly the Hands the handler closed.
    function invariant_closedHandsStayClosed() public view {
        uint256 closed;
        for (uint256 id = 1; id <= core.handsCount(); ++id) {
            (,, AHandCore.Status status,,) = core.hands(id);
            if (status != AHandCore.Status.Active) ++closed;
        }
        assertEq(closed, handler.closed());
    }
}
