// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title  AHandCore
/// @notice A Hand is a pot of one ERC-20 locked until a fixed moment. Before that
///         moment the raiser can pay it to a giver who signed for this Hand; from that
///         moment anyone can send it back to the raiser. Nothing else can move it.
contract AHandCore is EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @dev Field order is the storage packing. A Hand is open while both outcome
    ///      times are zero; it exists if `raisedAt` is not zero.
    struct Hand {
        // slot 0: set by raise
        address raiser;
        uint40 expiry;
        uint40 raisedAt;
        // slot 1: the token, then the outcome — exactly one of the two times is ever set
        address token;
        uint40 thankedAt;
        uint40 reclaimedAt;
        // set by raise
        uint256 amount;
        bytes32 dataHash;
    }

    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint256 amount,
        uint40 expiry,
        bytes32 dataHash
    );
    event Reclaimed(uint256 indexed handId);
    event Thanked(uint256 indexed handId, address indexed giver, bytes32 dataHash);

    error ExpiryNotInFuture();
    error NotActive();
    error NotExpired();
    error NotRaiser();
    error GiverIsRaiser();
    error InvalidGive();
    error Expired();
    error InexactTransfer();

    bytes32 private constant GIVE_TYPEHASH = keccak256("Give(uint256 handId,bytes32 dataHash)");

    uint256 public handsCount;
    mapping(uint256 => Hand) public hands;

    constructor() EIP712("aHand", "core") {}

    /// @notice Locks `amount` of `token` from the caller until `expiry`. `dataHash` is
    ///         a commitment Core never reads: the application owns the data and its schema.
    function raise(address token, uint256 amount, uint40 expiry, bytes32 dataHash)
        external
        nonReentrant
        returns (uint256 handId)
    {
        if (expiry <= block.timestamp) revert ExpiryNotInFuture();

        handId = ++handsCount;
        hands[handId] = Hand(msg.sender, expiry, uint40(block.timestamp), token, 0, 0, amount, dataHash);
        emit Raised(handId, msg.sender, token, amount, expiry, dataHash);

        // Both sides are measured: a token that moves any other amount is refused here,
        // not discovered when the money has to leave.
        uint256 payerBefore = IERC20(token).balanceOf(msg.sender);
        uint256 coreBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(msg.sender) + amount != payerBefore) revert InexactTransfer();
        if (IERC20(token).balanceOf(address(this)) != coreBefore + amount) revert InexactTransfer();
    }

    /// @notice Pays the whole pot to `giver`, who signed a Give for this Hand and is never
    ///         the raiser. Only the raiser, only before expiry. `dataHash` is a
    ///         commitment Core never reads: it is signed, logged and nothing else.
    function thank(uint256 handId, address giver, bytes32 dataHash, bytes calldata signature)
        external
        nonReentrant
        whenOpen(handId)
    {
        Hand storage hand = hands[handId];
        if (msg.sender != hand.raiser) revert NotRaiser();
        if (giver == msg.sender) revert GiverIsRaiser();
        if (block.timestamp >= hand.expiry) revert Expired();

        // The expected signer is passed in and compared: recovery alone returns some
        // address for any input, so a wrong signature would pay a stranger.
        bytes32 give = keccak256(abi.encode(GIVE_TYPEHASH, handId, dataHash));
        if (ECDSA.recoverCalldata(_hashTypedDataV4(give), signature) != giver) revert InvalidGive();

        hand.thankedAt = uint40(block.timestamp);
        emit Thanked(handId, giver, dataHash);

        _pay(hand, giver);
    }

    /// @notice Refunds an expired Hand to its raiser. Anyone may call.
    function reclaim(uint256 handId) external nonReentrant whenOpen(handId) {
        Hand storage hand = hands[handId];
        if (block.timestamp < hand.expiry) revert NotExpired();

        hand.reclaimedAt = uint40(block.timestamp);
        emit Reclaimed(handId);

        _pay(hand, hand.raiser);
    }

    /// @dev Raised and neither thanked nor reclaimed.
    modifier whenOpen(uint256 handId) {
        Hand storage hand = hands[handId];
        if (hand.raisedAt == 0 || hand.thankedAt != 0 || hand.reclaimedAt != 0) revert NotActive();
        _;
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
