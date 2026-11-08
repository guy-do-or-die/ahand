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
///         Every payment is tried on its own: one that fails stays pending for its payee
///         and can be withdrawn later, so no single payee can block the others.
contract AHandCore is EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @dev Field order is the storage packing. A Hand is open while both outcome
    ///      times are zero; it exists if `raisedAt` is not zero.
    struct Hand {
        // slot 0: set by raise
        address raiser;
        uint40 expiry;
        uint40 raisedAt;
        // slot 1: the token and the gas each payment may use, in thousands, set by raise;
        // then the outcome — exactly one of the two times is ever set
        address token;
        uint16 payoutGasK;
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
        uint16 payoutGasK,
        bytes32 dataHash
    );
    event Reclaimed(uint256 indexed handId);
    event Thanked(uint256 indexed handId, address indexed giver, bytes32 dataHash);
    event Paid(address indexed token, address indexed payee, uint256 amount);
    event Pending(address indexed token, address indexed payee, uint256 amount);
    event Withdrawn(address indexed token, address indexed payee, address to, uint256 amount);

    error ExpiryNotInFuture();
    error NotActive();
    error NotExpired();
    error NotRaiser();
    error GiverIsRaiser();
    error InvalidGive();
    error Expired();
    error InexactTransfer();
    error NotCore();
    error NotPayee();
    error NothingPending();

    bytes32 private constant GIVE_TYPEHASH = keccak256("Give(uint256 handId,bytes32 dataHash)");

    uint256 public handsCount;
    mapping(uint256 => Hand) public hands;
    /// @notice What waits for each payee per token, after a payment that could not be made.
    mapping(address token => mapping(address payee => uint256)) public pending;

    constructor() EIP712("aHand", "core") {}

    /// @notice Locks `amount` of `token` from the caller until `expiry`. Each payment of
    ///         this Hand may use `payoutGasK` thousand gas. `dataHash` is a commitment Core
    ///         never reads: the application owns the data and its schema.
    function raise(address token, uint256 amount, uint40 expiry, uint16 payoutGasK, bytes32 dataHash)
        external
        nonReentrant
        returns (uint256 handId)
    {
        if (expiry <= block.timestamp) revert ExpiryNotInFuture();

        handId = ++handsCount;
        hands[handId] = Hand(msg.sender, expiry, uint40(block.timestamp), token, payoutGasK, 0, 0, amount, dataHash);
        emit Raised(handId, msg.sender, token, amount, expiry, payoutGasK, dataHash);
        if (amount == 0) return handId; // a Hand without a reward never touches a token

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

        _tryPay(hand.token, giver, hand.amount, hand.payoutGasK);
    }

    /// @notice Refunds an expired Hand to its raiser. Anyone may call.
    function reclaim(uint256 handId) external nonReentrant whenOpen(handId) {
        Hand storage hand = hands[handId];
        if (block.timestamp < hand.expiry) revert NotExpired();

        hand.reclaimedAt = uint40(block.timestamp);
        emit Reclaimed(handId);

        _tryPay(hand.token, hand.raiser, hand.amount, hand.payoutGasK);
    }

    /// @notice Sends what is pending for `payee` in `token` to `to`. Anyone may send it to
    ///         the payee; only the payee may send it elsewhere, for example away from an
    ///         address the token has blocked.
    function withdraw(address token, address payee, address to) external nonReentrant {
        if (to != payee && msg.sender != payee) revert NotPayee();
        uint256 amount = pending[token][payee];
        if (amount == 0) revert NothingPending();

        pending[token][payee] = 0;
        emit Withdrawn(token, payee, to, amount);

        _transferExact(token, to, amount);
    }

    /// @notice Core calls this on itself, so that each payment runs in a frame of its own
    ///         and a failing one undoes only itself. Nobody else may call it.
    function pay(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert NotCore();
        _transferExact(token, to, amount);
    }

    /// @dev Raised and neither thanked nor reclaimed.
    modifier whenOpen(uint256 handId) {
        Hand storage hand = hands[handId];
        if (hand.raisedAt == 0 || hand.thankedAt != 0 || hand.reclaimedAt != 0) revert NotActive();
        _;
    }

    /// @dev A payment that fails for any reason — a blocked or refusing payee, a paused or
    ///      broken token, the Hand's payout gas running out — stays pending for the same
    ///      payee instead. The Hand is closed either way. A zero amount touches no token.
    ///      Sent with too little gas on purpose, a payment that itself needs a lot of gas
    ///      can end up pending too; it is never lost, and anyone can withdraw it to the payee.
    function _tryPay(address token, address payee, uint256 amount, uint16 payoutGasK) private {
        if (amount == 0) return;
        try this.pay{gas: uint256(payoutGasK) * 1_000}(token, payee, amount) {
            emit Paid(token, payee, amount);
        } catch {
            pending[token][payee] += amount;
            emit Pending(token, payee, amount);
        }
    }

    /// @dev One token balance serves every Hand in that token, so a payment that takes more
    ///      than it pays out would be paid from other Hands' pots.
    function _transferExact(address token, address to, uint256 amount) private {
        uint256 coreBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(to, amount);
        if (IERC20(token).balanceOf(address(this)) + amount != coreBefore) revert InexactTransfer();
    }
}
