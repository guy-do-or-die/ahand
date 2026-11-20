// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Test code, deployed on the local chain (31337) only. Stands in for Multicall3 on the
///         stand: one function with Multicall3's `aggregate3` signature and behaviour (each call
///         made from this contract; a failing call reverts the whole batch with Multicall3's own
///         message unless `allowFailure`).
///         Why it exists (D-62): the setup call of an account that is not deployed yet names any
///         "factory" and any calldata. Sent from a raiser's own account it could spend the
///         raiser's money; sent through this contract, which holds nothing and has no allowance,
///         it can only act as a stranger. Unlike Multicall3 it takes no ether, so it cannot hold
///         any by mistake.
contract Forwarder {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external returns (Result[] memory returnData) {
        returnData = new Result[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            Call3 calldata call = calls[i];
            (bool success, bytes memory ret) = call.target.call(call.callData);
            if (!success && !call.allowFailure) revert("Multicall3: call failed");
            returnData[i] = Result(success, ret);
        }
    }
}
