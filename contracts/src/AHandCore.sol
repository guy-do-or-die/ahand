// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Memory} from "@openzeppelin/contracts/utils/Memory.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @notice One hand-over: the holder of the current key passes the Hand on to `nextKey`
///         and keeps `claimBps - nextClaimBps` of the reward for `payee`. `claimBps` is the
///         share that reached this hand-over, `nextClaimBps` the share passed on.
struct Shake {
    address nextKey;
    address payee;
    uint16 claimBps;
    uint16 nextClaimBps;
    bytes32 dataHash;
}

/// @notice The giver's acceptance of a route: the share that reached its end, `claimBps`,
///         goes to `payee`. Signed by the last key of the route and by `signer`, the giver.
struct Give {
    bytes32 routeHash;
    address signer;
    address payee;
    uint16 claimBps;
    bytes32 dataHash;
}

/// @notice A Shake and the signature of the key it comes from.
struct SignedShake {
    Shake shake;
    bytes keySig;
}

/// @title  AHandCore
/// @notice A Hand locks a reward in one ERC-20 until a fixed moment. Its link starts at a
///         root key, and each holder may pass it on with a signed Shake, keeping a margin.
///         Before that moment the raiser can pay the reward along a route to a giver who signed
///         a Give at its end: every shaker gets its margin, the giver the rest. From that moment
///         anyone can send the reward back to the raiser. Nothing else can move it.
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
        uint16 minGiverClaimBps;
        uint40 raisedAt;
        // slot 1: the token and the gas each payment may use, in thousands, set by raise;
        // then the outcome — exactly one of the two times is ever set
        address token;
        uint16 payoutGasK;
        uint40 thankedAt;
        uint40 reclaimedAt;
        // set by raise
        uint256 reward;
        address rootKey;
        bytes32 dataHash;
        // set by thank
        bytes32 giveHash;
    }

    bytes32 private constant SHAKE_TYPEHASH = keccak256(
        "Shake(uint256 handId,address nextKey,address payee,uint16 claimBps,uint16 nextClaimBps,bytes32 dataHash)"
    );
    bytes32 private constant GIVE_TYPEHASH = keccak256(
        "Give(uint256 handId,bytes32 routeHash,address signer,address payee,uint16 claimBps,bytes32 dataHash)"
    );

    uint16 private constant BPS = 10_000; // the whole reward

    uint256 public handsCount;
    mapping(uint256 => Hand) public hands;

    /// @notice What waits for each payee per token, after a payment that could not be made.
    mapping(address token => mapping(address payee => uint256)) public pending;

    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint256 reward,
        uint40 expiry,
        address rootKey,
        uint16 minGiverClaimBps,
        uint16 payoutGasK,
        bytes32 dataHash
    );
    event Thanked(
        uint256 indexed handId,
        address indexed signer,
        address indexed payee,
        bytes32 routeHash,
        uint16 claimBps,
        bytes32 dataHash
    );
    event Shaken(
        uint256 indexed handId,
        uint256 position,
        address nextKey,
        address indexed payee,
        uint16 claimBps,
        uint16 nextClaimBps,
        uint256 margin,
        bytes32 dataHash
    );
    event Reclaimed(uint256 indexed handId);
    event Paid(address indexed token, address indexed payee, uint256 amount);
    event Pending(address indexed token, address indexed payee, uint256 amount);
    event Withdrawn(address indexed token, address indexed payee, address to, uint256 amount);

    // raise
    error ExpiryNotInFuture();
    error MinGiverClaimTooHigh();
    error ZeroRootKey();
    // thank and reclaim
    error NotOpen();
    // thank
    error NotRaiser();
    error GiverIsRaiser();
    error ZeroPayee();
    error Expired();
    error InvalidClaim(uint256 position);
    error AnonymousMargin(uint256 position);
    error InvalidShake(uint256 position);
    error BelowMinGiverClaim();
    error InvalidGive();
    // reclaim
    error NotExpired();
    // withdraw
    error NotPayee();
    error ZeroDestination();
    error NothingPending();
    // token transfers
    error InexactTransfer();
    error NotCore();

    /// @dev Raised and neither thanked nor reclaimed.
    modifier whenOpen(uint256 handId) {
        Hand storage hand = hands[handId];
        if (hand.raisedAt == 0 || hand.thankedAt != 0 || hand.reclaimedAt != 0) revert NotOpen();
        _;
    }

    constructor() EIP712("aHand", "core") {}

    /// @notice Locks `reward` in `token` from the caller until `expiry`. The Hand's link
    ///         starts at `rootKey`; whatever route it takes, the giver keeps at least
    ///         `minGiverClaimBps` of the reward. Each payment may use `payoutGasK` thousand gas.
    ///         `dataHash` is a commitment Core never reads: the application owns the data.
    ///         A minimum above the whole reward or a zero root key would leave a Hand nobody can
    ///         ever thank, its money locked until expiry: both are refused here.
    function raise(
        address token,
        uint256 reward,
        uint40 expiry,
        address rootKey,
        uint16 minGiverClaimBps,
        uint16 payoutGasK,
        bytes32 dataHash
    ) external nonReentrant returns (uint256 handId) {
        if (expiry <= block.timestamp) revert ExpiryNotInFuture();
        if (minGiverClaimBps > BPS) revert MinGiverClaimTooHigh();
        if (rootKey == address(0)) revert ZeroRootKey();

        handId = ++handsCount;
        hands[handId] = Hand({
            raiser: msg.sender,
            expiry: expiry,
            minGiverClaimBps: minGiverClaimBps,
            raisedAt: uint40(block.timestamp),
            token: token,
            payoutGasK: payoutGasK,
            thankedAt: 0, // written by thank
            reclaimedAt: 0, // written by reclaim
            reward: reward,
            rootKey: rootKey,
            dataHash: dataHash,
            giveHash: 0 // written by thank
        });

        emit Raised(handId, msg.sender, token, reward, expiry, rootKey, minGiverClaimBps, payoutGasK, dataHash);

        if (reward == 0) return handId; // a Hand without a reward never touches a token

        // Both sides are measured: a token that moves any other amount is refused here,
        // not discovered when the money has to leave.
        uint256 payerBefore = IERC20(token).balanceOf(msg.sender);
        uint256 coreBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), reward);
        if (IERC20(token).balanceOf(msg.sender) + reward != payerBefore) revert InexactTransfer();
        if (IERC20(token).balanceOf(address(this)) != coreBefore + reward) revert InexactTransfer();
    }

    /// @notice Pays the reward along a route: each shaker keeps its margin, the Give's payee gets
    ///         the rest. Each Shake is signed by the key before it, starting at the root key;
    ///         the Give by the last key and by its signer, who is never the raiser. Only the
    ///         raiser, only before expiry. Core never reads the data hashes.
    ///         A Give without a payee is refused: sent to the zero address, the giver's share
    ///         would be burned or stay pending where nobody can ever withdraw it.
    function thank(
        uint256 handId,
        SignedShake[] calldata shakes,
        Give calldata give,
        bytes calldata keySig,
        bytes calldata giverSig
    ) external nonReentrant whenOpen(handId) {
        Hand storage hand = hands[handId];

        if (msg.sender != hand.raiser) revert NotRaiser();
        if (msg.sender == give.signer) revert GiverIsRaiser();
        if (give.payee == address(0)) revert ZeroPayee();
        if (block.timestamp >= hand.expiry) revert Expired();

        bytes32 giveHash = _checkGive(handId, hand, shakes, give, keySig, giverSig);

        hand.thankedAt = uint40(block.timestamp);
        hand.giveHash = giveHash;

        emit Thanked(handId, give.signer, give.payee, give.routeHash, give.claimBps, give.dataHash);

        uint256 rest = _payShakers(handId, hand, shakes);

        _pay(hand.token, give.payee, rest, hand.payoutGasK);
    }

    /// @notice Refunds an expired Hand to its raiser. Anyone may call.
    function reclaim(uint256 handId) external nonReentrant whenOpen(handId) {
        Hand storage hand = hands[handId];
        if (block.timestamp < hand.expiry) revert NotExpired();

        hand.reclaimedAt = uint40(block.timestamp);
        emit Reclaimed(handId);

        _pay(hand.token, hand.raiser, hand.reward, hand.payoutGasK);
    }

    /// @notice Sends what is pending for `payee` in `token` to `to`. Anyone may send it to
    ///         the payee; only the payee may send it elsewhere, for example away from an
    ///         address the token has blocked. Never to the zero address, where a token that
    ///         accepts the transfer would burn the amount.
    function withdraw(address token, address payee, address to) external nonReentrant {
        if (to != payee && msg.sender != payee) revert NotPayee();
        if (to == address(0)) revert ZeroDestination();

        uint256 amount = pending[token][payee];
        if (amount == 0) revert NothingPending();

        pending[token][payee] = 0;
        emit Withdrawn(token, payee, to, amount);

        _transferExact(token, to, amount);
    }

    /// @notice Core calls this on itself, so that each transfer runs in a frame of its own
    ///         and a failing one undoes only itself. Nobody else may call it.
    function transferOut(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert NotCore();
        _transferExact(token, to, amount);
    }

    /// @dev Checks the route and the Give that ends it, and returns the Give's hash. Both
    ///      sign the same Give: the last key shows it came from the end of this route, the
    ///      signer that the giver accepted exactly it. Recovery alone returns some address for
    ///      any input, so each signature is compared with the address it must come from.
    function _checkGive(
        uint256 handId,
        Hand storage hand,
        SignedShake[] calldata shakes,
        Give calldata give,
        bytes calldata keySig,
        bytes calldata giverSig
    ) private view returns (bytes32 giveHash) {
        address lastKey = _checkRoute(handId, hand, shakes, give);

        giveHash = _hashGive(handId, give);
        bytes32 digest = _hashTypedDataV4(giveHash);

        if (ECDSA.recoverCalldata(digest, keySig) != lastKey) revert InvalidGive();
        if (ECDSA.recoverCalldata(digest, giverSig) != give.signer) revert InvalidGive();
    }

    /// @dev Follows the route from the root key and returns its last key. Each Shake must
    ///      continue the share it received, keep nothing without a payee, and be signed by
    ///      the key it comes from; the Give must name this route and the share left at its
    ///      end, which is no less than the raiser's minimum for the giver.
    function _checkRoute(uint256 handId, Hand storage hand, SignedShake[] calldata shakes, Give calldata give)
        private
        view
        returns (address key)
    {
        key = hand.rootKey;
        uint16 claim = BPS;
        bytes32 routeHash = bytes32(0); // a route without Shakes hashes to zero

        for (uint256 i; i < shakes.length; ++i) {
            Memory.Pointer freeMemory = Memory.getFreeMemoryPointer();
            Shake calldata shake = shakes[i].shake;

            if (shake.claimBps != claim || shake.nextClaimBps > claim) revert InvalidClaim(i);
            if (shake.payee == address(0) && shake.nextClaimBps != claim) revert AnonymousMargin(i);

            bytes32 shakeHash = _hashShake(handId, shake);

            if (ECDSA.recoverCalldata(_hashTypedDataV4(shakeHash), shakes[i].keySig) != key) revert InvalidShake(i);

            routeHash = keccak256(abi.encode(routeHash, shakeHash));

            key = shake.nextKey;
            claim = shake.nextClaimBps;

            // Nothing this pass put in memory outlives it; handing it back keeps every Shake's price the same.
            Memory.unsafeSetFreeMemoryPointer(freeMemory);
        }

        if (give.claimBps != claim) revert InvalidClaim(shakes.length);
        if (claim < hand.minGiverClaimBps) revert BelowMinGiverClaim();
        if (give.routeHash != routeHash) revert InvalidGive();
    }

    function _hashShake(uint256 handId, Shake calldata s) private pure returns (bytes32) {
        return keccak256(abi.encode(SHAKE_TYPEHASH, handId, s.nextKey, s.payee, s.claimBps, s.nextClaimBps, s.dataHash));
    }

    function _hashGive(uint256 handId, Give calldata g) private pure returns (bytes32) {
        return keccak256(abi.encode(GIVE_TYPEHASH, handId, g.routeHash, g.signer, g.payee, g.claimBps, g.dataHash));
    }

    /// @dev Pays every shaker its margin of the reward and returns what is left for the giver.
    ///      A margin that rounds down to zero leaves its dust to the giver.
    function _payShakers(uint256 handId, Hand storage hand, SignedShake[] calldata shakes)
        private
        returns (uint256 rest)
    {
        uint256 reward = hand.reward;
        rest = reward;

        for (uint256 i; i < shakes.length; ++i) {
            Shake calldata shake = shakes[i].shake;

            uint256 margin = Math.mulDiv(reward, shake.claimBps - shake.nextClaimBps, BPS);
            rest -= margin;

            emit Shaken(
                handId, i, shake.nextKey, shake.payee, shake.claimBps, shake.nextClaimBps, margin, shake.dataHash
            );

            _pay(hand.token, shake.payee, margin, hand.payoutGasK);
        }
    }

    /// @dev A payment that fails for any reason — a blocked or refusing payee, a paused or
    ///      broken token, the Hand's payout gas running out — stays pending for the same
    ///      payee instead. The Hand is closed either way. A zero amount touches no token.
    ///      Sent with too little gas on purpose, a payment that itself needs a lot of gas
    ///      can end up pending too; it is never lost, and anyone can withdraw it to the payee.
    function _pay(address token, address payee, uint256 amount, uint16 payoutGasK) private {
        if (amount == 0) return;
        try this.transferOut{gas: uint256(payoutGasK) * 1_000}(token, payee, amount) {
            emit Paid(token, payee, amount);
        } catch {
            pending[token][payee] += amount;
            emit Pending(token, payee, amount);
        }
    }

    /// @dev One token balance serves every Hand in that token, so a payment that takes more
    ///      than it pays out would be paid from other Hands' rewards.
    function _transferExact(address token, address to, uint256 amount) private {
        uint256 coreBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(to, amount);
        if (IERC20(token).balanceOf(address(this)) + amount != coreBefore) revert InexactTransfer();
    }
}
