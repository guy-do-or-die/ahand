// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title  AHandCore
/// @notice A Hand is a pot of one ERC-20 locked until a fixed moment. Before that
///         moment the raiser can pay it to whoever helped; from that moment anyone can
///         send it back to the raiser. Nothing else can move it.
contract AHandCore {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Active,
        Reclaimed,
        Thanked
    }

    struct Hand {
        address raiser;
        uint40 expiry;
        Status status;
        address token;
        uint256 amount;
    }

    event Raised(uint256 indexed handId, address indexed raiser, address indexed token, uint256 amount, uint40 expiry);
    event Reclaimed(uint256 indexed handId);
    event Thanked(uint256 indexed handId, address indexed giver);

    error ExpiryNotInFuture();
    error NotActive();
    error NotExpired();
    error NotRaiser();
    error GiverIsRaiser();
    error Expired();
    error InexactTransfer();

    uint256 public handsCount;
    mapping(uint256 => Hand) public hands;

    /// @notice Locks `amount` of `token` from the caller until `expiry`.
    function raise(address token, uint256 amount, uint40 expiry) external returns (uint256 handId) {
        if (expiry <= block.timestamp) revert ExpiryNotInFuture();

        handId = ++handsCount;
        hands[handId] = Hand(msg.sender, expiry, Status.Active, token, amount);
        emit Raised(handId, msg.sender, token, amount, expiry);

        // Both sides are measured: a token that moves any other amount is refused here,
        // not discovered when the money has to leave.
        uint256 payerBefore = IERC20(token).balanceOf(msg.sender);
        uint256 coreBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(msg.sender) + amount != payerBefore) revert InexactTransfer();
        if (IERC20(token).balanceOf(address(this)) != coreBefore + amount) revert InexactTransfer();
    }

    /// @notice Pays the whole pot to `giver`, who is never the raiser. Only the raiser,
    ///         only before expiry.
    function thank(uint256 handId, address giver) external {
        Hand storage hand = hands[handId];
        if (hand.status != Status.Active) revert NotActive();
        if (msg.sender != hand.raiser) revert NotRaiser();
        if (giver == msg.sender) revert GiverIsRaiser();
        if (block.timestamp >= hand.expiry) revert Expired();

        hand.status = Status.Thanked;
        emit Thanked(handId, giver);

        _pay(hand, giver);
    }

    /// @notice Refunds an expired Hand to its raiser. Anyone may call.
    function reclaim(uint256 handId) external {
        Hand storage hand = hands[handId];
        if (hand.status != Status.Active) revert NotActive();
        if (block.timestamp < hand.expiry) revert NotExpired();

        hand.status = Status.Reclaimed;
        emit Reclaimed(handId);

        _pay(hand, hand.raiser);
    }

    /// @dev Custody is shared per token, so a payment that debits more than this Hand's
    ///      pot would be paid with another Hand's money.
    function _pay(Hand storage hand, address to) private {
        IERC20 token = IERC20(hand.token);
        uint256 coreBefore = token.balanceOf(address(this));
        token.safeTransfer(to, hand.amount);
        if (token.balanceOf(address(this)) + hand.amount != coreBefore) revert InexactTransfer();
    }
}
