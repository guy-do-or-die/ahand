// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTypes.sol";
import {Math} from "../lib/openzeppelin-contracts/contracts/utils/math/Math.sol";

/// @title AHandSignals
/// @notice Soulbound receipt and referral reputation contract for the aHand protocol.
///         Ownerless, config-free and hook-free: the core never calls in; anyone may
///         materialize signals out of facts the immutable source core already settled.
///         The one and only external call in this contract is the read-only
///         IAHandCoreView.getHand — a Signals outage or quirk can never touch escrow.
contract AHandSignals {
    /*//////////////////// Token IDs ////////////////////*/
    uint256 public constant SIGNAL_RAISED  = 1;
    uint256 public constant SIGNAL_SHAKEN  = 2;
    uint256 public constant SIGNAL_GIVEN   = 3;
    uint256 public constant SIGNAL_THANKED = 4;
    uint256 public constant SIGNAL_UP      = 5;  // 9 decimals; spendable only earned
    uint256 public constant SIGNAL_DOWN    = 6;  // reserved; no entry point mints it

    uint256 public constant ONE_UP    = 1e9;
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

    mapping(uint256 => mapping(address => uint256)) internal _balances; // getters below uphold the ERC-1155 read ABI

    mapping(uint256 => uint256) public totalSupply;

    mapping(address => uint256) public cumulativeUsd; // lifetime credited role value, 1e18 scale
    mapping(address => uint256) public prevSqrt;      // floor-sqrt watermark of cumulativeUsd
    mapping(address => uint256) public earnedUp;      // spendable part of SIGNAL_UP

    mapping(address => uint256) public downCount;     // reserved; stays zero until down() lands

    /*//////////////////// Events ////////////////////*/
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);

    event EarnedUpMaterialized(
        bytes32 indexed sourceKey,
        address indexed actor,
        uint8   roleMask,
        uint256 credit,
        uint256 cumulativeBefore,
        uint256 cumulativeAfter,
        uint256 delta
    );

    event ThankSignalsMaterialized(
        bytes32 indexed sourceKey,
        uint256 indexed handId,
        address raiser,
        address giver,
        uint96  charityTokenAmount,
        uint256 charityUsd,
        uint256 uniqueShakers
    );

    event Upped(
        address indexed issuer,
        address indexed target,
        uint256 indexed handId,
        uint256 wholeUpCount,
        uint256 amount,
        bytes32 reasonTag,
        bytes32 evidenceHash
    );

    constructor(address sourceCore_) {
        if (sourceCore_ == address(0)) revert ZeroAddress();
        sourceCore = sourceCore_;
    }

    /*//////////////////// Mint / Burn ////////////////////*/
    function _mint(address to, uint256 id, uint256 value) internal {
        _balances[id][to] += value;
        totalSupply[id] += value;
        emit TransferSingle(msg.sender, address(0), to, id, value);
    }

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
    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return _balances[id][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external view returns (uint256[] memory out)
    {
        if (accounts.length != ids.length) revert LengthMismatch();
        out = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) out[i] = _balances[ids[i]][accounts[i]];
    }

    /// @notice Non-spendable part of SIGNAL_UP: endorsements received from others.
    function receivedOf(address a) external view returns (uint256) {
        return _balances[SIGNAL_UP][a] - earnedUp[a];
    }

    function raisedSourceKey(uint256 handId) external view returns (bytes32) {
        return AHandSource.raisedKey(sourceCore, handId);
    }

    function thankSourceKey(uint256 handId) external view returns (bytes32) {
        return AHandSource.thankKey(sourceCore, handId);
    }

    /// @notice ERC-165 only. Deliberately does NOT claim ERC-1155 (0xd9b67a26):
    ///         with no transfer or approval selectors on the ABI at all, claiming
    ///         the interface would lie to wallets and marketplaces.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7; // ERC165
    }

    /*//////////////////// On-chain Metadata (visual identity) ////////////////////*/
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
