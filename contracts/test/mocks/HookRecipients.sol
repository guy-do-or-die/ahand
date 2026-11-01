// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IHookRecipient} from "./HookToken.sol";

/// @dev Burns at least `amount` gas, or everything if `amount` exceeds what is left.
function burnGas(uint256 amount) view {
    uint256 start = gasleft();
    uint256 spin;
    while (start - gasleft() < amount) {
        spin = uint256(keccak256(abi.encode(spin)));
    }
}

/// @notice A recipient whose hook burns `burn` gas (default: more than PUSH_GAS).
///         Under a HookToken the push frame runs out of gas and defers exactly this
///         share; a top-level withdraw with unbounded gas still drains it.
contract GasHogRecipient is IHookRecipient {
    uint256 public burn = 250_000;

    function setBurn(uint256 amount) external {
        burn = amount;
    }

    function onTokenReceived(address, uint256) external view {
        burnGas(burn);
    }
}

/// @notice A recipient that behaves in simulation and misbehaves on-chain: its hook
///         burns every unit of gas it is handed only when `tx.origin` equals
///         `hostileOrigin`. An `eth_estimateGas` run from another origin passes;
///         the real transaction then reverts `InsufficientGas` after the burned
///         budget — one wasted transaction, never a parked share.
contract TxOriginHostileRecipient is IHookRecipient {
    address public hostileOrigin;

    function setHostileOrigin(address origin) external {
        hostileOrigin = origin;
    }

    function onTokenReceived(address, uint256) external view {
        if (tx.origin == hostileOrigin) burnGas(type(uint256).max);
    }
}

/// @notice A consenting-but-hostile recipient that sends `returnBps` of every push
///         straight back to the payer during the token's hook. Under the rollback
///         frame the partial custody delta reverts `TransferInexact` inside
///         `pushExact`, so only this recipient's share parks — the case that keeps
///         one hostile hop from killing a whole thank.
contract PartialReturnRecipient is IHookRecipient {
    uint256 public returnBps = 5_000;

    function setReturnBps(uint256 bps) external {
        returnBps = bps;
    }

    function onTokenReceived(address from, uint256 amount) external {
        // msg.sender is the token; `from` is the payer (Core during a push)
        (bool ok,) = msg.sender.call(abi.encodeWithSignature("transfer(address,uint256)", from, amount * returnBps / 10_000));
        require(ok, "RETURN_FAILED");
    }
}
