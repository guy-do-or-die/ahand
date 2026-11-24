// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";
import {AHandCore} from "../../src/AHandCore.sol";
import {HandView, handOf} from "../Helpers.sol";

/// @notice A token shaped like an overlay in front of Core: a wrapper whose transfer *from Core*
///         pays the payee in something else. Here that something else is a second ledger,
///         `redeemed`, standing for the underlying asset a real wrapper would withdraw from a
///         lending pool. The token also writes down what it sees of Core on the way in
///         (`transferFrom` during `raise` and `fund`) and on the way out (`transfer` during
///         `thank`, `refund` and `withdraw`), so the tests can pin what an overlay may rely on.
///         With `poolDown` set it behaves as a plain token again: shares move, nothing is redeemed.
contract OverlayToken is MockUSD {
    AHandCore public immutable core;

    bool public poolDown;
    mapping(address => uint256) public redeemed;

    uint256 public inboundCalls;
    bool public inboundSenderIsCore;
    uint256 public inboundHandsCount;
    address public inboundRaiser;
    uint256 public inboundReward;

    uint256 public outboundCalls;
    bool public outboundSenderIsCore;

    constructor(AHandCore core_) {
        core = core_;
    }

    function setPoolDown(bool isDown) external {
        poolDown = isDown;
    }

    /// The way in. Core pulls the reward with `transferFrom`; the overlay reads Core while the
    /// pull is in flight: the newest Hand's number and the Hand itself.
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (msg.sender == address(core)) {
            inboundCalls++;
            inboundSenderIsCore = true;
            inboundHandsCount = core.handsCount();
            HandView memory hand = handOf(core, inboundHandsCount);
            inboundRaiser = hand.raiser;
            inboundReward = hand.reward;
        }
        return super.transferFrom(from, to, amount);
    }

    /// The way out. Core pays with `transfer`; the overlay burns Core's shares and credits the
    /// payee in the other ledger. Core's balance falls by exactly `amount`, which is all Core
    /// checks. Shares move instead when the pool is down.
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (msg.sender != address(core)) return super.transfer(to, amount);

        outboundCalls++;
        outboundSenderIsCore = true;
        if (poolDown) return super.transfer(to, amount);

        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
        redeemed[to] += amount;
        return true;
    }
}
