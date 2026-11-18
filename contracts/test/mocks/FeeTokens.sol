// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice Sender-side fee on BOTH legs: moving 100 debits the sender 110 (the 10 is
///         burned) and credits the receiver 100. Core's receipt is exact but the
///         raiser's debit is not, so `raise` reverts `InexactTransfer` at the door.
contract SenderFeeToken is MockUSD {
    uint256 public constant FEE_BPS = 1_000; // 10 %

    function _move(address from, address to, uint256 amount) internal override {
        uint256 fee = amount * FEE_BPS / 10_000;
        balanceOf[from] -= amount + fee;
        totalSupply -= fee;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice The same sender-side fee, but switched on AFTER Hands are open. The
///         entry check only guards the door: once the fee is on, every transfer out of
///         Core is inexact: every payout stays pending and every withdraw reverts
///         `InexactTransfer`. The documented total stop.
contract LateSenderFeeToken is MockUSD {
    uint256 public constant FEE_BPS = 1_000; // 10 %
    bool public feeOn;

    function setFeeOn(bool on) external {
        feeOn = on;
    }

    function _move(address from, address to, uint256 amount) internal override {
        uint256 fee = feeOn ? amount * FEE_BPS / 10_000 : 0;
        balanceOf[from] -= amount + fee;
        totalSupply -= fee;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice Receiver-side fee on BOTH legs: moving 100 debits the sender 100 and
///         credits the receiver 99 (the 1 is burned). `raise` fails Core's
///         receipt check (`InexactTransfer`); on the way out Core's debit IS exact,
///         so a payout lands and the payee simply receives the token's net.
contract ReceiverFeeToken is MockUSD {
    uint256 public constant FEE_BPS = 100; // 1 %

    function _move(address from, address to, uint256 amount) internal override {
        uint256 fee = amount * FEE_BPS / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(from, to, amount - fee);
    }
}

/// @notice A receiver-side fee switched on AFTER Hands are open: moving 100 debits the
///         sender 100 and credits the receiver 99. Core's debit stays exact, so a payout
///         goes through and the payee receives the token's net.
contract LateReceiverFeeToken is MockUSD {
    uint256 public constant FEE_BPS = 100; // 1 %
    bool public feeOn;

    function setFeeOn(bool on) external {
        feeOn = on;
    }

    function _move(address from, address to, uint256 amount) internal override {
        uint256 fee = feeOn ? amount * FEE_BPS / 10_000 : 0;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(from, to, amount - fee);
    }
}
