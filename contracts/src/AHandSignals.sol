// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTypes.sol";
import {Math} from "../lib/openzeppelin-contracts/contracts/utils/math/Math.sol";

/// @title  AHandSignals
/// @author aHand
/// @notice Soulbound receipt and referral reputation contract for the aHand protocol.
///         Ownerless, config-free and hook-free: the core never calls in; anyone may
///         materialize signals out of facts the immutable source core already settled.
///         The one and only external call in this contract is the read-only
///         IAHandCoreView.getHand — a Signals outage or quirk can never touch escrow.
/// @dev    Signals are soulbound: there are NO transfer or approval entry points, and
///         supportsInterface deliberately does NOT claim ERC-1155. UP is the sole
///         semi-fungible token, and only its EARNED portion is spendable, so
///         endorsement chains cannot recurse. Reads of the source core are staticcall
///         views, and every materializer sets its processed flag BEFORE minting — so
///         the "state change after external call" audit finding is a false positive
///         (see each materializer for the specific invariant).
contract AHandSignals {
    /*//////////////////// Token IDs ////////////////////*/
    /// @notice ERC-1155 id of the RAISED receipt (minted to the raiser).
    uint256 public constant SIGNAL_RAISED  = 1;
    /// @notice ERC-1155 id of the SHAKEN receipt (minted per distinct attributed shaker).
    uint256 public constant SIGNAL_SHAKEN  = 2;
    /// @notice ERC-1155 id of the GIVEN receipt (minted to the giver).
    uint256 public constant SIGNAL_GIVEN   = 3;
    /// @notice ERC-1155 id of the THANKED receipt (minted to the raiser on settlement).
    uint256 public constant SIGNAL_THANKED = 4;
    /// @notice ERC-1155 id of UP, the spendable reputation signal (9 decimals).
    uint256 public constant SIGNAL_UP      = 5;  // 9 decimals; spendable only earned
    /// @notice ERC-1155 id reserved for DOWN; no entry point mints it in v1.
    uint256 public constant SIGNAL_DOWN    = 6;  // reserved; no entry point mints it

    /// @notice One whole UP in base units (UP carries 9 decimals).
    uint256 public constant ONE_UP    = 1e9;
    /// @notice Reserved cost of a future down() action, in UP base units.
    uint256 public constant DOWN_COST = 3e9;     // reserved for the down() bolt-on

    /// @dev Role bits carried by EarnedUpMaterialized.roleMask.
    uint8 public constant ROLE_RAISER = 1 << 0;
    uint8 public constant ROLE_GIVER  = 1 << 1;

    /// @dev Source domains, re-exposed from AHandSource for indexers and tests.
    bytes32 public constant RAISED_SOURCE = AHandSource.RAISED_SOURCE;
    bytes32 public constant THANK_SOURCE  = AHandSource.THANK_SOURCE;

    /*//////////////////// Signals State ////////////////////*/
    /// @notice The single core this contract reads settled facts from. Immutable:
    ///         no owner exists to repoint it, so a source key means one thing forever.
    address public immutable sourceCore;

    /// @notice Idempotence flags, keyed by AHandSource.raisedKey / thankKey.
    mapping(bytes32 => bool) public processedSource;

    /// @dev ERC-1155-style balances; the getters below uphold the standard read ABI.
    mapping(uint256 => mapping(address => uint256)) internal _balances; // getters below uphold the ERC-1155 read ABI

    /// @notice Total minted supply per signal id.
    mapping(uint256 => uint256) public totalSupply;

    /// @notice Lifetime credited role value per account, in 1e18-scaled USD.
    mapping(address => uint256) public cumulativeUsd; // lifetime credited role value, 1e18 scale
    /// @notice Floor-sqrt watermark of cumulativeUsd per account (the UP emission curve).
    mapping(address => uint256) public prevSqrt;      // floor-sqrt watermark of cumulativeUsd
    /// @notice Spendable (earned) portion of an account's SIGNAL_UP balance.
    mapping(address => uint256) public earnedUp;      // spendable part of SIGNAL_UP

    /// @notice Reserved counter for the future down() action; stays zero in v1.
    mapping(address => uint256) public downCount;     // reserved; stays zero until down() lands

    /*//////////////////// Events ////////////////////*/
    /// @notice ERC-1155 single-transfer event, emitted on every mint and burn.
    /// @param operator The account that triggered the movement.
    /// @param from     Source (zero on mint).
    /// @param to       Destination (zero on burn).
    /// @param id       The signal id moved.
    /// @param value    The amount moved.
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);

    /// @notice Emitted once per role credit when a Thank materializes UP for an actor.
    /// @param sourceKey        The Thank source key this credit derives from.
    /// @param actor            The credited account (raiser, giver, or both).
    /// @param roleMask         ROLE_RAISER / ROLE_GIVER bits describing the credit.
    /// @param credit           The USD credit added to cumulativeUsd (1e18 scale).
    /// @param cumulativeBefore The actor's cumulativeUsd before this credit.
    /// @param cumulativeAfter  The actor's cumulativeUsd after this credit.
    /// @param delta            The UP minted = floor(sqrt(after)) − floor(sqrt(before)).
    event EarnedUpMaterialized(
        bytes32 indexed sourceKey,
        address indexed actor,
        uint8   roleMask,
        uint256 credit,
        uint256 cumulativeBefore,
        uint256 cumulativeAfter,
        uint256 delta
    );

    /// @notice Emitted once when a Thank's full signal set is materialized.
    /// @param sourceKey          The Thank source key.
    /// @param handId             The settled Hand id.
    /// @param raiser             The Hand's raiser.
    /// @param giver              The settled giver.
    /// @param charityTokenAmount The recomputed charity allocation in token units.
    /// @param charityUsd         charityTokenAmount * usdScaleAtRaise (1e18-scaled USD).
    /// @param uniqueShakers      The count of distinct attributed shakers that got SHAKEN.
    event ThankSignalsMaterialized(
        bytes32 indexed sourceKey,
        uint256 indexed handId,
        address raiser,
        address giver,
        uint96  charityTokenAmount,
        uint256 charityUsd,
        uint256 uniqueShakers
    );

    /// @notice Emitted when an account spends earned UP to endorse another.
    /// @param issuer       The endorsing account.
    /// @param target       The endorsed account.
    /// @param handId       The context Hand id (zero = none).
    /// @param wholeUpCount The whole-UP count spent.
    /// @param amount       The base-unit amount spent (wholeUpCount * ONE_UP).
    /// @param reasonTag    Optional context tag.
    /// @param evidenceHash Optional context evidence hash.
    event Upped(
        address indexed issuer,
        address indexed target,
        uint256 indexed handId,
        uint256 wholeUpCount,
        uint256 amount,
        bytes32 reasonTag,
        bytes32 evidenceHash
    );

    /// @notice Pins the immutable source core this contract reads settled facts from.
    /// @dev    There is no owner to repoint it later, so a source key means one thing forever.
    /// @param  sourceCore_ The AHandCore whose getHand this contract materializes from.
    constructor(address sourceCore_) {
        if (sourceCore_ == address(0)) revert ZeroAddress();
        sourceCore = sourceCore_;
    }

    /*//////////////////// Mint / Burn ////////////////////*/
    /// @dev Credits `value` of signal `id` to `to` and grows totalSupply.
    /// @param to    The recipient.
    /// @param id    The signal id.
    /// @param value The amount to mint.
    function _mint(address to, uint256 id, uint256 value) internal {
        _balances[id][to] += value;
        totalSupply[id] += value;
        emit TransferSingle(msg.sender, address(0), to, id, value);
    }

    /// @dev Debits `value` of signal `id` from `from`; reverts on insufficient balance.
    /// @param from  The holder to debit.
    /// @param id    The signal id.
    /// @param value The amount to burn.
    function _burn(address from, uint256 id, uint256 value) internal {
        if (_balances[id][from] < value) revert InsufficientBalance();
        _balances[id][from] -= value;
        totalSupply[id] -= value;
        emit TransferSingle(msg.sender, from, address(0), id, value);
    }

    /*//////////////////// Materialization (permissionless, idempotent) ////////////////////*/
    /// @notice Mint the RAISED receipt for a Hand that exists in the source core.
    ///         Valid for any existing status, terminal ones included — the raise
    ///         happened regardless of how the Hand later resolved.
    /// @dev    Permissionless and idempotent: replays revert AlreadyMaterialized.
    ///
    ///         Reentrancy note (the "state change after external call" finding is a
    ///         FALSE POSITIVE): the only external call is IAHandCoreView.getHand, a
    ///         read-only staticcall that cannot mutate this contract, and the
    ///         processed flag is set BEFORE _mint. Even if getHand could re-enter
    ///         (it cannot), the flag already guards the key, so no double mint is
    ///         possible.
    /// @param  handId The Hand to materialize the RAISED receipt for.
    function materializeRaised(uint256 handId) external {
        bytes32 key = AHandSource.raisedKey(sourceCore, handId);
        if (processedSource[key]) revert AlreadyMaterialized();

        Hand memory hand = IAHandCoreView(sourceCore).getHand(handId);
        if (hand.status == Status.None) revert WrongHand();

        processedSource[key] = true; // flag before mint
        _mint(hand.raiser, SIGNAL_RAISED, 1);
    }

    /// @notice Materialize the full signal set of a settled Thank. The caller supplies
    ///         the settlement facts; nothing is trusted — the charity amount is
    ///         recomputed from the Hand snapshot and the whole payload must rebuild
    ///         the exact source commitment the core stored at settlement.
    /// @dev    Permissionless and idempotent: replays revert AlreadyMaterialized, and
    ///         a mismatched payload reverts SourceCommitmentMismatch. UP credits use
    ///         checked arithmetic, so an overflowing credit reverts the whole call
    ///         atomically (retryable) rather than half-applying.
    ///
    ///         Reentrancy note (the "state change after external call" finding is a
    ///         FALSE POSITIVE): the only external call is the read-only getHand
    ///         staticcall, and the processed flag is set BEFORE any mint. A settled
    ///         Hand's facts are immutable, so re-reading them can never diverge, and
    ///         the flag prevents any double materialization of the same key.
    /// @param handId         The settled Hand to materialize.
    /// @param giver          The giver whose GIVEN receipt and role credit to mint.
    /// @param occShakers     attributed shaker per hop, route order, zero = anonymous
    /// @param occClaimDeltas margin bps per hop, route order (parentClaim − childClaim)
    function materializeThank(
        uint256 handId,
        address giver,
        address[] calldata occShakers,
        uint16[] calldata occClaimDeltas
    ) external {
        bytes32 key = AHandSource.thankKey(sourceCore, handId);
        if (processedSource[key]) revert AlreadyMaterialized();

        Hand memory hand = IAHandCoreView(sourceCore).getHand(handId);
        if (hand.status != Status.Settled) revert NotSettled();

        // Recompute rather than trust: the same floor math the core ran at settlement.
        // creditedReward is never zeroed, so this stays readable after settlement.
        // The 10_000 divisor is the bps denominator (= AHandCore.BPS_DENOMINATOR);
        // it is inlined here because that constant lives on the core, not on Signals,
        // and referencing it would add a cross-contract dependency for no bytecode gain.
        uint96 charityAmount = uint96(uint256(hand.creditedReward) * hand.charityBps / 10_000);

        bytes32 commitment = AHandSource.thankCommitment(
            sourceCore,
            handId,
            hand.raiser,
            giver,
            charityAmount,
            hand.usdScaleAtRaise,
            occShakers,
            occClaimDeltas
        );
        if (commitment != hand.thankSignalSourceHash) revert SourceCommitmentMismatch();

        processedSource[key] = true; // flag before any mint

        _mint(hand.raiser, SIGNAL_THANKED, 1);
        _mint(giver, SIGNAL_GIVEN, 1);

        // One SHAKEN per distinct attributed shaker; anonymous zeros mint nothing.
        // O(n^2) dedupe is deliberate: routes carry at most MAX_SHAKES occurrences.
        uint256 uniqueShakers;
        for (uint256 i; i < occShakers.length; ++i) {
            address shaker = occShakers[i];
            if (shaker == address(0)) continue;
            bool seen;
            for (uint256 j; j < i; ++j) {
                if (occShakers[j] == shaker) { seen = true; break; }
            }
            if (!seen) {
                ++uniqueShakers;
                _mint(shaker, SIGNAL_SHAKEN, 1);
            }
        }

        // USD value from the raise-time snapshot scale — no live oracle, ever.
        uint256 charityUsd = uint256(charityAmount) * hand.usdScaleAtRaise; // checked
        uint256 roleCredit = charityUsd / 2;

        if (hand.raiser == giver) {
            // Both roles on one account: one atomic update, both halves at once.
            _materializeEarnedUp(key, giver, ROLE_RAISER | ROLE_GIVER, 2 * roleCredit);
        } else {
            _materializeEarnedUp(key, hand.raiser, ROLE_RAISER, roleCredit);
            _materializeEarnedUp(key, giver, ROLE_GIVER, roleCredit);
        }

        emit ThankSignalsMaterialized(key, handId, hand.raiser, giver, charityAmount, charityUsd, uniqueShakers);
    }

    /*//////////////////// Earned Up Emission ////////////////////*/
    /// @dev Sqrt emission curve: an actor's total minted UP equals floor(sqrt(cumulativeUsd)).
    ///      Floor-sqrt is monotonic and sub-additive — splitting value across many Hands
    ///      never mints more than one big Hand would. Checked addition means an overflowing
    ///      credit reverts the whole materialization atomically; nothing is half-applied.
    /// @param sourceKey The source key of the materialization emitting this credit.
    /// @param actor     The account whose cumulative value and earned UP grow.
    /// @param roleMask  ROLE_RAISER / ROLE_GIVER bits for the event.
    /// @param credit    The USD credit to add to the actor's cumulativeUsd.
    function _materializeEarnedUp(bytes32 sourceKey, address actor, uint8 roleMask, uint256 credit) internal {
        uint256 cumulativeBefore = cumulativeUsd[actor];
        uint256 cumulativeAfter = cumulativeBefore + credit;
        cumulativeUsd[actor] = cumulativeAfter;

        uint256 newSqrt = Math.sqrt(cumulativeAfter); // floor
        uint256 delta = newSqrt - prevSqrt[actor];
        prevSqrt[actor] = newSqrt;
        if (delta != 0) {
            earnedUp[actor] += delta;
            _mint(actor, SIGNAL_UP, delta);
        }
        emit EarnedUpMaterialized(sourceKey, actor, roleMask, credit, cumulativeBefore, cumulativeAfter, delta);
    }

    /*//////////////////// Up (Spendable Signal) ////////////////////*/
    /// @notice Spend earned UP to endorse another account. Whole units only; the
    ///         context must say something. Received UP is not spendable, so
    ///         endorsement chains terminate by construction.
    /// @dev    The recursion cut lives in the earnedUp accounting: only earned UP is
    ///         debited, and the target receives it as (non-spendable) received UP, so
    ///         it can never be re-endorsed onward.
    /// @param  target       The account to endorse (not zero, not the caller).
    /// @param  wholeUpCount The number of whole UP to spend (must be > 0).
    /// @param  ctx          Context for the event; at least one field must be non-zero.
    function up(address target, uint256 wholeUpCount, UpContext calldata ctx) external {
        if (wholeUpCount == 0) revert ZeroAmount();
        uint256 amount = wholeUpCount * ONE_UP;
        if (amount > earnedUp[msg.sender]) revert InsufficientEarned();
        if (target == address(0)) revert ZeroAddress();
        if (target == msg.sender) revert SelfTarget();
        if (ctx.handId == 0 && ctx.reasonTag == bytes32(0) && ctx.evidenceHash == bytes32(0)) revert ZeroContext();

        earnedUp[msg.sender] -= amount;   // spend only earned — the recursion cut is here
        _burn(msg.sender, SIGNAL_UP, amount);
        _mint(target, SIGNAL_UP, amount); // lands as received; total supply conserved
        emit Upped(msg.sender, target, ctx.handId, wholeUpCount, amount, ctx.reasonTag, ctx.evidenceHash);
    }

    /*//////////////////// Views ////////////////////*/
    /// @notice ERC-1155 standard single-balance getter (account, id) order.
    /// @param  account The holder to query.
    /// @param  id      The signal id.
    /// @return The balance of `id` held by `account`.
    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return _balances[id][account];
    }

    /// @notice ERC-1155 batch balance getter.
    /// @param  accounts The holders, positional with `ids`.
    /// @param  ids      The signal ids, positional with `accounts`.
    /// @return out      Balances, one per (account, id) pair.
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external view returns (uint256[] memory out)
    {
        if (accounts.length != ids.length) revert LengthMismatch();
        out = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) out[i] = _balances[ids[i]][accounts[i]];
    }

    /// @notice Non-spendable part of SIGNAL_UP: endorsements received from others.
    /// @dev    Total UP held minus the earned (spendable) part.
    /// @param  a The account to query.
    /// @return The received (non-spendable) UP balance of `a`.
    function receivedOf(address a) external view returns (uint256) {
        return _balances[SIGNAL_UP][a] - earnedUp[a];
    }

    /// @notice The RAISED source key for a Hand (the materializeRaised idempotence key).
    /// @param  handId The Hand id.
    /// @return The raised source key.
    function raisedSourceKey(uint256 handId) external view returns (bytes32) {
        return AHandSource.raisedKey(sourceCore, handId);
    }

    /// @notice The THANK source key for a Hand (the materializeThank idempotence key).
    /// @param  handId The Hand id.
    /// @return The thank source key.
    function thankSourceKey(uint256 handId) external view returns (bytes32) {
        return AHandSource.thankKey(sourceCore, handId);
    }

    /// @notice ERC-165 only. Deliberately does NOT claim ERC-1155 (0xd9b67a26):
    ///         with no transfer or approval selectors on the ABI at all, claiming
    ///         the interface would lie to wallets and marketplaces.
    /// @param  interfaceId The interface id to probe.
    /// @return True only for the ERC-165 interface id (0x01ffc9a7).
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7; // ERC165
    }

    /*//////////////////// On-chain Metadata (visual identity) ////////////////////*/
    /// @dev Maps a signal id to its display emoji and title; empty for unknown ids.
    /// @param  id    The signal id.
    /// @return emoji The display emoji.
    /// @return title The display title.
    function _meta(uint256 id) internal pure
        returns (string memory emoji, string memory title)
    {
        if (id == SIGNAL_RAISED)  return (unicode"✋", "Raised");
        if (id == SIGNAL_SHAKEN)  return (unicode"🤝", "Shaken");
        if (id == SIGNAL_GIVEN)   return (unicode"🙌", "Given");
        if (id == SIGNAL_THANKED) return (unicode"🙏", "Thanked");
        if (id == SIGNAL_UP)      return (unicode"👍", "Up");
        if (id == SIGNAL_DOWN)    return (unicode"👎", "Down");
        return ("", "");
    }

    /// @notice ERC-1155 metadata URI: a fully on-chain, base64 data URI with an
    ///         SVG image, so a signal's identity needs no external hosting.
    /// @param  id The signal id.
    /// @return A `data:application/json;base64,...` URI for the signal.
    function uri(uint256 id) external pure returns (string memory) {
        (string memory emoji, string memory title) = _meta(id);
        string memory name_ = string.concat(emoji, " ", title);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="350" height="350">',
            '<rect width="100%" height="100%" fill="#101014"/>',
            '<text x="50%" y="54%" font-size="160" text-anchor="middle">', emoji, '</text>',
            '<text x="50%" y="88%" font-size="22" fill="#eeeeee" text-anchor="middle" ',
            'font-family="monospace">', title, '</text></svg>'
        );
        string memory json = string.concat(
            '{"name":"', name_, '","description":"aHand soulbound signal","image":',
            '"data:image/svg+xml;base64,', _b64(bytes(svg)), '"}'
        );
        return string.concat("data:application/json;base64,", _b64(bytes(json)));
    }

    /// @dev Standard base64 encoder (RFC 4648, '+/' alphabet, '=' padding), used to
    ///      inline the SVG and JSON of `uri` as data URIs.
    /// @param  data The bytes to encode.
    /// @return The base64 string.
    function _b64(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        bytes memory T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        string memory result = new string(4 * ((data.length + 2) / 3));
        assembly ("memory-safe") {
            let tablePtr := add(T, 1)
            let resultPtr := add(result, 32)
            let dataPtr := data
            let endPtr := add(data, mload(data))
            for {} lt(dataPtr, endPtr) {} {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F))))
                resultPtr := add(resultPtr, 1)
            }
            switch mod(mload(data), 3)
            case 1 {
                mstore8(sub(resultPtr, 1), 0x3d)
                mstore8(sub(resultPtr, 2), 0x3d)
            }
            case 2 { mstore8(sub(resultPtr, 1), 0x3d) }
        }
        return result;
    }
}
