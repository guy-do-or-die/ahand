// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {EIP7702Utils} from "@openzeppelin/contracts/account/utils/EIP7702Utils.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Memory} from "@openzeppelin/contracts/utils/Memory.sol";

/// @notice One shake: the shaker holding the current key passes the Hand on to `nextKey`
///         and keeps `claimBps - nextClaimBps` of the reward for `payee`. `claimBps` is the
///         claim that reached this shake, `nextClaimBps` the claim passed on.
struct Shake {
    address nextKey;
    address payee;
    uint16 claimBps;
    uint16 nextClaimBps;
    bytes32 dataHash;
}

/// @notice The giver's acceptance of a route: the claim that reached its end, `claimBps`,
///         is paid to `payee`. Signed by the last key of the route and by `signer`, the giver.
struct Give {
    address signer;
    address payee;
    uint16 claimBps;
    bytes32 routeHash;
    bytes32 dataHash;
}

/// @notice A Shake and the signature of the key it comes from.
struct SignedShake {
    Shake shake;
    bytes keySig;
}

/// @notice A Give and its two signatures: by the last key of the route and by its signer, the giver.
struct SignedGive {
    Give give;
    bytes keySig;
    bytes giverSig;
}

/// @title  AHandCore
/// @notice A Hand locks a reward in one ERC-20 until its expiry; its raiser can only add to the
///         reward and move the expiry later. Its link starts at a root key, and each shaker passes
///         it on with a signed Shake, keeping a margin. Before expiry the raiser can pay the
///         reward along a route to a giver who signed a Give at its end: every shaker gets its
///         margin, the giver the rest. From expiry on anyone can refund the reward to the
///         raiser. Nothing else can move it.
///         Every payout is tried on its own and may use up to the Hand's payout gas: one that
///         fails undoes only itself and stays pending for its payee, who can withdraw it later.
///         A token that calls its payees lets a payee spend all of that gas each time it is
///         paid, so a route that pays it often enough needs more gas than a transaction may use.
/// @dev    Core proves who called and who signed. Any other address in its events is only what
///         a call or a signature named: Core never checks a payee. `Paid` means that Core's
///         balance of the token dropped by exactly the amount; what the token is worth is the
///         raiser's choice.
contract AHandCore is EIP712 {
    using SafeERC20 for IERC20;

    /// @dev Field order is the storage packing. A Hand exists if `openedAt` is not zero and is
    ///      open while `closedAt` is zero. A closed Hand was thanked if `thanks` keeps its Give,
    ///      and refunded if not.
    struct Hand {
        // slot 0: set by raise; extend moves the expiry
        address raiser;
        uint40 expiry;
        uint40 openedAt;
        // slot 1: the time thank or refund closed the Hand; then, set by raise, the token, the
        // gas each payout may use, in thousands, and the least claim the giver must get
        uint40 closedAt;
        address token;
        uint16 payoutGasK;
        uint16 minClaimBps;
        // set by raise; fund adds to the reward
        uint256 reward;
        address rootKey;
        bytes32 dataHash;
    }

    /// @dev What a thank leaves.
    struct Thank {
        // the EIP-712 struct hash of the accepted Give; with the domain separator it gives the
        // digest that both of the Give's signatures signed
        bytes32 giveHash;
        // what the raiser stated with the thank, if anything
        bytes32 dataHash;
    }

    /// @dev What a Shake or a Give names its Hand by: everything `raise` fixes for good, not the
    ///      number alone. After a reorg the same number may belong to another Hand, and a signature
    ///      must not pass there. Reward and expiry are not signed: a giver accepts a claim on the
    ///      reward, not an amount, and the Hand's own expiry decides how long it can be thanked.
    bytes32 private constant HAND_TYPEHASH = keccak256(
        "Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
    );
    bytes32 private constant SHAKE_TYPEHASH = keccak256(
        "Shake(Hand hand,address nextKey,address payee,uint16 claimBps,uint16 nextClaimBps,bytes32 dataHash)Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
    );
    bytes32 private constant GIVE_TYPEHASH = keccak256(
        "Give(Hand hand,address signer,address payee,uint16 claimBps,bytes32 routeHash,bytes32 dataHash)Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
    );

    uint16 private constant BPS = 10_000; // the whole reward

    /// @notice How far ahead an expiry may be when it is set: no reward stays locked longer than
    ///         this after its raiser last raised or extended the Hand.
    uint256 public constant MAX_EXPIRY_PERIOD = 180 days;

    /// @notice How many Hands were raised. Hands are numbered from 1, so this is also the
    ///         number of the last one.
    uint256 public handsCount;
    /// @notice How many Hands were thanked.
    uint256 public thanksCount;
    /// @notice How many Hands were refunded.
    uint256 public refundsCount;

    /// @notice Each Hand by its number. A number never raised gives an empty Hand.
    mapping(uint256 handId => Hand) public hands;

    /// @notice What the thank of each thanked Hand left.
    mapping(uint256 handId => Thank) public thanks;

    /// @notice What waits for each payee per token, after a payout that could not be made.
    mapping(address token => mapping(address payee => uint256)) public pending;

    /// @dev Set while raise, extend, fund, thank, refund or withdraw runs; see `nonReentrant`.
    ///      Transient storage: it lasts only until the transaction ends and is never saved in state.
    bool private transient locked;

    /// @notice A Hand is raised: `reward` in `token` is locked until `expiry`. `Funded` may add to the
    ///         reward and `Extended` move the expiry later. All but `reward` and `expiry` is what
    ///         Shakes and Gives sign as their Hand.
    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint256 reward,
        uint40 expiry,
        address rootKey,
        uint16 payoutGasK,
        uint16 minClaimBps,
        bytes32 dataHash
    );
    /// @notice The raiser moved the Hand's expiry later, to `expiry`.
    event Extended(uint256 indexed handId, uint40 expiry);
    /// @notice The raiser added `amount` to the Hand's reward, which is now `reward`.
    event Funded(uint256 indexed handId, uint256 amount, uint256 reward);
    /// @notice The Shake at `position` of a thanked route, counted from the root key: it passed the
    ///         Hand on to `nextKey` and kept `margin` of the reward for `payee`.
    event Shaken(
        uint256 indexed handId,
        address indexed payee,
        uint256 position,
        uint256 margin,
        address nextKey,
        uint16 claimBps,
        uint16 nextClaimBps,
        bytes32 dataHash
    );
    /// @notice The Give that ends a thanked route: `signer` accepted it, and `payee` gets `amount`,
    ///         what the route left. `routeHash` names the route.
    event Given(
        uint256 indexed handId,
        address indexed signer,
        address indexed payee,
        uint256 amount,
        uint16 claimBps,
        bytes32 routeHash,
        bytes32 dataHash
    );
    /// @notice A Hand is thanked: its whole `reward` in `token` leaves along the route. In the same
    ///         transaction there follow, in this order: for each Shake, `Shaken` and its payout;
    ///         then `Given` and the giver's payout. A payout is `Paid` or `Pending`; one of zero
    ///         is not logged. `dataHash` is what the raiser states with the thank, zero if nothing.
    event Thanked(uint256 indexed handId, address indexed token, uint256 reward, bytes32 dataHash);
    /// @notice An expired Hand's whole `reward` in `token` goes back to its raiser; its payout
    ///         follows, unless the reward is zero.
    event Refunded(uint256 indexed handId, address indexed token, uint256 reward);
    /// @notice `amount` in `token` left Core for `payee`.
    event Paid(uint256 indexed handId, address indexed token, address indexed payee, uint256 amount);
    /// @notice `amount` in `token` could not leave Core for `payee` and waits for `withdraw`.
    event Pending(uint256 indexed handId, address indexed token, address indexed payee, uint256 amount);
    /// @notice What waited for `payee` in `token` left for `to`.
    event Withdrawn(address indexed token, address indexed payee, uint256 amount, address to);

    // raise and extend
    /// @notice The expiry is not later than now or, in `extend`, than the Hand's expiry.
    error ExpiryTooEarly();
    /// @notice The expiry is more than `MAX_EXPIRY_PERIOD` ahead of now.
    error ExpiryTooLate();
    // raise
    /// @notice The root key is the zero address, which nobody can sign for.
    error ZeroRootKey();
    /// @notice The minimum claim is above the whole reward.
    error MinClaimTooHigh();

    // extend, fund, thank and refund
    /// @notice The Hand was never raised, or is thanked or refunded already.
    error NotOpen();

    // checkRoute and checkGive
    /// @notice The Hand was never raised.
    error NotRaised();

    // extend, fund and thank
    /// @notice Only the Hand's raiser may extend, fund or thank it.
    error NotRaiser();
    /// @notice The Hand's expiry has come; it can only be refunded.
    error Expired();
    // thank, checkRoute and checkGive
    /// @notice The Give's signer is the raiser's own address.
    error GiverIsRaiser();
    /// @notice The Give names no payee.
    error ZeroPayee();
    /// @notice The Shake at `position` does not start from the claim that reached it, or passes on
    ///         more; at `position` equal to the number of Shakes, the Give's claim is not the one left.
    error InvalidClaim(uint256 position);
    /// @notice The Shake at `position` keeps a margin without a payee.
    error AnonymousMargin(uint256 position);
    /// @notice The link key's signature at `position` is unreadable or by another key; at `position`
    ///         equal to the number of Shakes, it is the Give's.
    error InvalidKeySig(uint256 position);
    /// @notice The Give names another route.
    error InvalidRouteHash();
    /// @notice The claim the route leaves the giver is below the raiser's minimum.
    error BelowMinClaim();
    /// @notice The Give's signer did not sign it: not its key, where that key still counts, nor its code (ERC-1271).
    error InvalidGiverSig();

    // refund
    /// @notice The Hand's expiry has not come yet.
    error NotExpired();

    // withdraw
    /// @notice Only the payee may send what waits for it anywhere but to itself.
    error NotPayee();
    /// @notice `to` is the zero address.
    error ZeroDestination();
    /// @notice Nothing waits for this payee in this token.
    error NothingPending();

    // token transfers
    /// @notice The token moved another amount than asked.
    error InexactTransfer();
    /// @notice Only Core may call `transferOut`.
    error NotCore();

    // raise, extend, fund, thank, refund and withdraw
    /// @notice Called again while one of them runs.
    error Reentered();

    /// @dev Raise, extend, fund, thank, refund and withdraw cannot be entered while one of them
    ///      runs: code that a token or a payee runs during a transfer cannot call back into them.
    ///      Calls one after another are not affected.
    modifier nonReentrant() {
        if (locked) revert Reentered();
        locked = true;
        _;
        locked = false;
    }

    /// @dev Raised and neither thanked nor refunded.
    modifier whenOpen(uint256 handId) {
        Hand storage hand = hands[handId];
        if (hand.openedAt == 0 || hand.closedAt != 0) revert NotOpen();
        _;
    }

    constructor() EIP712("aHand", "core") {}

    /// @notice Locks `reward` in `token` from the caller until `expiry`, at most
    ///         `MAX_EXPIRY_PERIOD` ahead; the raiser may add to the reward with `fund` and move
    ///         the expiry later with `extend`.
    ///         The Hand's link starts at `rootKey`; whatever route it takes, the giver keeps at
    ///         least `minClaimBps` of the reward, and above it each shaker keeps the margin its
    ///         Shake signed. Each payout may use `payoutGasK` thousand gas; with too little, zero
    ///         for example, every payout stays pending until withdrawn.
    ///         `dataHash` is a commitment every signature for the Hand covers and Core never
    ///         interprets: the application owns the data.
    ///         A minimum above the whole reward or a zero root key would leave a Hand nobody can
    ///         ever thank, its money locked until expiry: both are refused here.
    function raise(
        address token,
        uint256 reward,
        uint40 expiry,
        address rootKey,
        uint16 payoutGasK,
        uint16 minClaimBps,
        bytes32 dataHash
    ) external nonReentrant returns (uint256 handId) {
        if (expiry <= block.timestamp) revert ExpiryTooEarly();
        if (expiry > block.timestamp + MAX_EXPIRY_PERIOD) revert ExpiryTooLate();
        if (rootKey == address(0)) revert ZeroRootKey();
        if (minClaimBps > BPS) revert MinClaimTooHigh();

        // Field by field: a new number is a fresh, empty Hand, so `closedAt` needs no zero
        // written; thank or refund sets it.
        handId = ++handsCount;
        Hand storage hand = hands[handId];
        hand.raiser = msg.sender;
        hand.expiry = expiry;
        hand.openedAt = uint40(block.timestamp);
        hand.token = token;
        hand.payoutGasK = payoutGasK;
        hand.minClaimBps = minClaimBps;
        hand.reward = reward;
        hand.rootKey = rootKey;
        hand.dataHash = dataHash;

        emit Raised(handId, msg.sender, token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash);

        if (reward == 0) return handId; // a Hand without a reward never touches a token

        _transferIn(token, reward);
    }

    /// @notice Moves an open Hand's expiry later, to `newExpiry`, at most `MAX_EXPIRY_PERIOD`
    ///         from now. Only the raiser, only before expiry. Nothing else of the Hand changes,
    ///         and no signature names the expiry, so every route collected so far stays valid.
    function extend(uint256 handId, uint40 newExpiry) external nonReentrant whenOpen(handId) {
        Hand storage hand = hands[handId];

        if (msg.sender != hand.raiser) revert NotRaiser();
        if (block.timestamp >= hand.expiry) revert Expired();
        if (newExpiry <= hand.expiry) revert ExpiryTooEarly();
        if (newExpiry > block.timestamp + MAX_EXPIRY_PERIOD) revert ExpiryTooLate();

        hand.expiry = newExpiry;

        emit Extended(handId, newExpiry);
    }

    /// @notice Adds `amount` from the raiser to an open Hand's reward. Only before expiry.
    ///         Signatures name claims on the reward, not amounts, so every route collected so far
    ///         stays valid and pays its claims on the larger reward.
    function fund(uint256 handId, uint256 amount) external nonReentrant whenOpen(handId) {
        Hand storage hand = hands[handId];

        if (msg.sender != hand.raiser) revert NotRaiser();
        if (block.timestamp >= hand.expiry) revert Expired();

        uint256 reward = hand.reward + amount;
        hand.reward = reward;

        emit Funded(handId, amount, reward);

        if (amount == 0) return; // adding nothing never touches a token

        _transferIn(hand.token, amount);
    }

    /// @notice Pays the reward along a route: each shaker keeps its margin, the Give's payee gets
    ///         the rest. Each Shake is signed by the key before it, starting at the root key;
    ///         the Give by the last key and by its signer, whose address is not the raiser's.
    ///         Only the raiser, only before expiry. The signatures cover the data hashes; Core
    ///         never interprets them.
    ///         A Give without a payee is refused: sent to the zero address, the giver's payout
    ///         would be burned or stay pending where nobody can ever withdraw it.
    ///         `dataHash` is what the raiser states with the thank. No signature covers it, only
    ///         this call says it; Core keeps it in `thanks`, unless it is zero, and never
    ///         interprets it.
    function thank(
        uint256 handId,
        SignedShake[] calldata signedShakes,
        SignedGive calldata signedGive,
        bytes32 dataHash
    ) external nonReentrant whenOpen(handId) {
        Hand storage hand = hands[handId];
        Give calldata give = signedGive.give;

        if (msg.sender != hand.raiser) revert NotRaiser();
        if (block.timestamp >= hand.expiry) revert Expired();
        if (give.signer == hand.raiser) revert GiverIsRaiser();
        if (give.payee == address(0)) revert ZeroPayee();

        bytes32 giveHash = _checkGive(handId, hand, signedShakes, signedGive);

        hand.closedAt = uint40(block.timestamp);
        ++thanksCount;
        thanks[handId].giveHash = giveHash;
        if (dataHash != bytes32(0)) thanks[handId].dataHash = dataHash;

        emit Thanked(handId, hand.token, hand.reward, dataHash);

        uint256 rest = _payShakers(handId, hand, signedShakes);

        _payGiver(handId, hand, give, rest);
    }

    /// @notice Returns an expired Hand's whole reward to its raiser: what `raise` locked and all
    ///         that `fund` added. Anyone may call.
    function refund(uint256 handId) external nonReentrant whenOpen(handId) {
        Hand storage hand = hands[handId];
        if (block.timestamp < hand.expiry) revert NotExpired();

        hand.closedAt = uint40(block.timestamp);
        ++refundsCount;

        emit Refunded(handId, hand.token, hand.reward);

        _pay(handId, hand.token, hand.raiser, hand.reward, hand.payoutGasK);
    }

    /// @notice Sends what is pending for `payee` in `token` to `to`. Anyone may send it to
    ///         the payee; only the payee may send it elsewhere. Never to the zero address, where
    ///         a token that accepts the transfer would burn the amount.
    function withdraw(address token, address payee, address to) external nonReentrant {
        if (to != payee && msg.sender != payee) revert NotPayee();
        if (to == address(0)) revert ZeroDestination();

        uint256 amount = pending[token][payee];
        if (amount == 0) revert NothingPending();

        pending[token][payee] = 0;

        emit Withdrawn(token, payee, amount, to);

        _transferOut(token, to, amount);
    }

    /// @notice Core calls this on itself, so that each transfer runs in a frame of its own
    ///         and a failing one undoes only itself. Nobody else may call it.
    function transferOut(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert NotCore();

        _transferOut(token, to, amount);
    }

    /// @notice Checks a route as `thank` checks it and returns where it ends: its last key, the
    ///         claim left for a giver, and the hash of the route, which a Give names. Anyone may
    ///         ask, at any time after the Hand is raised; nothing changes. An empty route ends at
    ///         the Hand's root key. The claim left is not judged: if it is below the Hand's
    ///         minimum for the giver, no Give can end this route.
    function checkRoute(
        uint256 handId,
        SignedShake[] calldata signedShakes
    ) external view returns (address lastKey, uint16 claimBps, bytes32 routeHash) {
        Hand storage hand = hands[handId];

        if (hand.openedAt == 0) revert NotRaised();

        return _checkRoute(_hashHand(handId, hand), hand, signedShakes);
    }

    /// @notice Checks a route and the Give that ends it as `thank` checks them and returns the
    ///         Give's hash, which is the `giveHash` in `thanks` if the raiser thanked this Give.
    ///         Anyone may ask, at any time after the Hand is raised; nothing changes. It does not
    ///         say whether the Hand can still be thanked: the caller, the expiry and whether the
    ///         Hand is closed are not looked at.
    function checkGive(
        uint256 handId,
        SignedShake[] calldata signedShakes,
        SignedGive calldata signedGive
    ) external view returns (bytes32 giveHash) {
        Hand storage hand = hands[handId];
        Give calldata give = signedGive.give;

        if (hand.openedAt == 0) revert NotRaised();
        if (give.signer == hand.raiser) revert GiverIsRaiser();
        if (give.payee == address(0)) revert ZeroPayee();

        return _checkGive(handId, hand, signedShakes, signedGive);
    }

    /// @dev Checks the route and the Give that ends it, and returns the Give's hash. The Give
    ///      must name this route and the claim left at its end, which is no less than the
    ///      raiser's minimum for the giver. Both sign the same Give: the last key shows it came
    ///      from the end of this route, the signer that the giver accepted exactly it. Recovery
    ///      alone returns some address for any input, so each signature is compared with the
    ///      address it must come from.
    function _checkGive(
        uint256 handId,
        Hand storage hand,
        SignedShake[] calldata signedShakes,
        SignedGive calldata signedGive
    ) private view returns (bytes32 giveHash) {
        Give calldata give = signedGive.give;
        bytes32 handHash = _hashHand(handId, hand);
        (address lastKey, uint16 claim, bytes32 routeHash) = _checkRoute(handHash, hand, signedShakes);

        if (give.claimBps != claim) revert InvalidClaim(signedShakes.length);
        if (give.routeHash != routeHash) revert InvalidRouteHash();
        if (claim < hand.minClaimBps) revert BelowMinClaim();

        giveHash = _hashGive(handHash, give);
        bytes32 digest = _hashTypedDataV4(giveHash);

        if (!_signedBy(lastKey, digest, signedGive.keySig)) revert InvalidKeySig(signedShakes.length);

        // The signer's own key counts while the protocol still lets it act for the address: with
        // no code there, or with an EIP-7702 delegation (0xef0100 and an address, 23 bytes), which
        // that key can redirect at any time. Otherwise, or if that key did not sign, the address's
        // code decides (ERC-1271): a smart wallet, a passkey, a key that took over.
        address signer = give.signer;
        uint256 codeSize = signer.code.length;
        bool signed = false;

        if (codeSize == 0 || (codeSize == 23 && EIP7702Utils.fetchDelegate(signer) != address(0))) {
            signed = _signedBy(signer, digest, signedGive.giverSig);
        }

        if (!signed && !SignatureChecker.isValidERC1271SignatureNowCalldata(signer, digest, signedGive.giverSig)) {
            revert InvalidGiverSig();
        }
    }

    /// @dev Follows the route from the root key and returns its last key, the claim left at its
    ///      end and its hash. Each Shake must continue the claim it received, keep nothing
    ///      without a payee, and be signed by the key it comes from.
    function _checkRoute(
        bytes32 handHash,
        Hand storage hand,
        SignedShake[] calldata signedShakes
    ) private view returns (address key, uint16 claim, bytes32 routeHash) {
        key = hand.rootKey;
        claim = BPS;
        routeHash = bytes32(0); // a route without Shakes hashes to zero

        for (uint256 position; position < signedShakes.length; ++position) {
            Memory.Pointer freeMemory = Memory.getFreeMemoryPointer();

            SignedShake calldata signedShake = signedShakes[position];
            Shake calldata shake = signedShake.shake;

            if (shake.claimBps != claim || shake.nextClaimBps > claim) revert InvalidClaim(position);
            if (shake.payee == address(0) && shake.nextClaimBps != claim) revert AnonymousMargin(position);

            bytes32 shakeHash = _hashShake(handHash, shake);

            if (!_signedBy(key, _hashTypedDataV4(shakeHash), signedShake.keySig)) revert InvalidKeySig(position);

            routeHash = keccak256(abi.encode(routeHash, shakeHash));

            key = shake.nextKey;
            claim = shake.nextClaimBps;

            // Nothing this pass put in memory outlives it; handing it back keeps every Shake's price the same.
            Memory.unsafeSetFreeMemoryPointer(freeMemory);
        }
    }

    /// @dev Whether `key` signed `digest`. A signature that cannot be read never counts, so the
    ///      zero address that recovery returns for it is never taken for the zero key's signature.
    function _signedBy(address key, bytes32 digest, bytes calldata sig) private pure returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, sig);
        return err == ECDSA.RecoverError.NoError && recovered == key;
    }

    function _hashHand(uint256 handId, Hand storage hand) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                HAND_TYPEHASH,
                handId,
                hand.raiser,
                hand.token,
                hand.rootKey,
                hand.payoutGasK,
                hand.minClaimBps,
                hand.dataHash
            )
        );
    }

    function _hashShake(bytes32 handHash, Shake calldata shake) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SHAKE_TYPEHASH, handHash, shake.nextKey, shake.payee, shake.claimBps, shake.nextClaimBps, shake.dataHash
            )
        );
    }

    function _hashGive(bytes32 handHash, Give calldata give) private pure returns (bytes32) {
        return keccak256(
            abi.encode(GIVE_TYPEHASH, handHash, give.signer, give.payee, give.claimBps, give.routeHash, give.dataHash)
        );
    }

    /// @dev Pays every shaker its margin of the reward and returns what is left for the giver.
    ///      A margin that rounds down to zero leaves its dust to the giver.
    function _payShakers(
        uint256 handId,
        Hand storage hand,
        SignedShake[] calldata signedShakes
    ) private returns (uint256 rest) {
        uint256 reward = hand.reward;
        rest = reward;

        for (uint256 position; position < signedShakes.length; ++position) {
            Shake calldata shake = signedShakes[position].shake;

            uint256 margin = Math.mulDiv(reward, shake.claimBps - shake.nextClaimBps, BPS);
            rest -= margin;

            emit Shaken(
                handId, shake.payee, position, margin, shake.nextKey, shake.claimBps, shake.nextClaimBps, shake.dataHash
            );

            _pay(handId, hand.token, shake.payee, margin, hand.payoutGasK);
        }
    }

    /// @dev Logs the Give with the giver's amount, then pays it: the last act of a thank.
    function _payGiver(uint256 handId, Hand storage hand, Give calldata give, uint256 amount) private {
        emit Given(handId, give.signer, give.payee, amount, give.claimBps, give.routeHash, give.dataHash);

        _pay(handId, hand.token, give.payee, amount, hand.payoutGasK);
    }

    /// @dev A payout that fails for any reason — a blocked or refusing payee, a paused or
    ///      broken token, the Hand's payout gas running out — stays pending for the same
    ///      payee instead. The Hand is closed either way. A zero amount touches no token.
    ///      Sent with too little gas on purpose, a payout that itself needs a lot of gas
    ///      can end up pending too; it is never lost, and anyone can withdraw it to the payee.
    function _pay(uint256 handId, address token, address payee, uint256 amount, uint16 payoutGasK) private {
        if (amount == 0) return;

        try this.transferOut{gas: uint256(payoutGasK) * 1_000}(token, payee, amount) {
            emit Paid(handId, token, payee, amount);
        } catch {
            pending[token][payee] += amount;
            emit Pending(handId, token, payee, amount);
        }
    }

    /// @dev Takes exactly `amount` of `token` from the caller. Both sides are measured: a token that
    ///      moves any other amount is refused here, not discovered when the money has to leave.
    function _transferIn(address token, uint256 amount) private {
        uint256 callerBefore = IERC20(token).balanceOf(msg.sender);
        uint256 coreBefore = IERC20(token).balanceOf(address(this));

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        if (IERC20(token).balanceOf(msg.sender) + amount != callerBefore) revert InexactTransfer();
        if (IERC20(token).balanceOf(address(this)) != coreBefore + amount) revert InexactTransfer();
    }

    /// @dev One token balance serves every Hand in that token, so a transfer that takes more
    ///      than its amount would be paid from other Hands' rewards.
    function _transferOut(address token, address to, uint256 amount) private {
        uint256 coreBefore = IERC20(token).balanceOf(address(this));

        IERC20(token).safeTransfer(to, amount);

        if (IERC20(token).balanceOf(address(this)) + amount != coreBefore) revert InexactTransfer();
    }
}
