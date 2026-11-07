// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {MockUSD} from "./MockUSD.sol";

/// @notice The recipient hook a HookToken calls after crediting a hooked recipient.
interface IHookRecipient {
    function onTokenReceived(address from, uint256 amount) external;
}

/// @notice A conforming token with two kinds of callbacks, both off by default:
///         (1) a recipient hook — after a move toward a `hooked` address it calls
///         `onTokenReceived` on it (ERC-777 style), so a recipient can burn gas,
///         re-enter or send part of the amount back during a push; (2) a re-entry
///         probe — on `transferFrom` and/or `transfer` it calls an arbitrary
///         target with arbitrary calldata (any Core entry point, or
///         `setCharityAllowed` mid-raise when the token is the policy admin) and
///         records the outcome, bubbling the failure when `mustSucceed` is set.
contract HookToken is MockUSD {
    mapping(address => bool) public hooked;

    address public reentryTarget;
    bytes public reentryData;
    bool public reentryOnTransferFrom;
    bool public reentryOnTransfer;
    bool public reentryMustSucceed;

    bool public lastReentryOk;
    bytes public lastReentryReturn;

    function setHooked(address account, bool isHooked) external {
        hooked[account] = isHooked;
    }

    /// @dev Configure the re-entry probe; `target == 0` disables it.
    function setReentry(address target, bytes calldata data, bool onTransferFrom, bool onTransfer, bool mustSucceed)
        external
    {
        reentryTarget = target;
        reentryData = data;
        reentryOnTransferFrom = onTransferFrom;
        reentryOnTransfer = onTransfer;
        reentryMustSucceed = mustSucceed;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        if (reentryOnTransfer) _reenter();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        if (reentryOnTransferFrom) _reenter();
        return true;
    }

    function _move(address from, address to, uint256 amount) internal override {
        super._move(from, to, amount);
        if (hooked[to]) IHookRecipient(to).onTokenReceived(from, amount);
    }

    function _reenter() private {
        if (reentryTarget == address(0)) return;
        (bool ok, bytes memory ret) = reentryTarget.call(reentryData);
        lastReentryOk = ok;
        lastReentryReturn = ret;
        if (reentryMustSucceed && !ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}
