// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IAHandFacts, Status, ZeroAddress} from "./AHandTypes.sol";
import {AHandSettlement} from "./AHandFacts.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/*//////////////////////////////////////////////////////////////
                      aHand Signals v2 — shapes
//////////////////////////////////////////////////////////////*/

/// @notice The context an endorsement (`up`) or a Down (`down`) is given in. At
///         least one field must be non-zero: a signal must say something.
/// @dev    `handId` is read as HandRef(chainId, sourceCore, handId) by convention;
///         Signals never verifies it (the fact is the signal, not the Hand).
struct UpContext {
    uint256 handId; // zero = none
    bytes32 reasonTag; // app-level tag, zero = none
    bytes32 evidenceHash; // app-level evidence commitment, zero = none
}

/// @notice `materializeRaised` found no Hand under that id (status None).
error NotRaised();
/// @notice `materializeThank` found the Hand not Settled (Active, Reclaimed or never raised).
error NotSettled();
/// @notice The source key was materialized before: every receipt is minted once.
error AlreadyMaterialized();
/// @notice The supplied preimage does not rebuild the settlement hash the Core stored.
error SourceCommitmentMismatch();
/// @notice `up` was called with zero whole Up.
error ZeroAmount();
/// @notice The spend exceeds the caller's earned (spendable) Up.
error InsufficientEarned();
/// @notice The signal targets the caller itself.
error SelfTarget();
/// @notice Every `UpContext` field was zero.
error ZeroContext();
/// @notice `down` was called by an account that holds no Thank receipt.
error NotParticipant();
/// @notice `balanceOfBatch` received arrays of different length.
error LengthMismatch();
/// @notice A transfer or approval was attempted on a soulbound signal.
error Soulbound();
/// @notice The profile token reports more than 18 decimals; nominal valuation needs ≤ 18.
error UnsupportedDecimals();

/// @title  AHandSignalsV2
/// @author aHand
/// @notice The reference reader of Seam 3: soulbound receipts (RAISED, SHAKEN, GIVEN,
///         THANKED), earned Up for the Raiser and Giver of qualifying Thanks, Up
///         endorsements and voluntary Downs — all materialized permissionlessly from
///         facts one immutable Core already settled. Admin-free: no owner, no curator,
///         no repointing. The only external calls are the Core's read-only `facts`
///         (at materialization) and the profile token's `decimals` (at construction).
/// @dev    One ledger per policy epoch: the qualification profile (which token earns
///         Up, at what unit) is fixed in the constructor; a different profile is a new
///         deployment, never a setter. Receipts are ERC-1155-compatible and soulbound:
///         the read ABI and `supportsInterface` are standard, every transfer and
///         approval entry point reverts, and mints call no receiver hook. Every
///         materializer sets its processed flag BEFORE the first mint, and Core is
///         never called back, so nothing here can touch escrow or run twice.
contract AHandSignalsV2 {
    /*//////////////////// Signal ids (frozen as built) ////////////////////*/

    /// @notice RAISED receipt: one per Hand, to the raiser, for any raised Hand.
    uint256 public constant SIGNAL_RAISED = 1;
    /// @notice SHAKEN receipt: one per attributed route occurrence of a settled Thank.
    uint256 public constant SIGNAL_SHAKEN = 2;
    /// @notice GIVEN receipt: one per settled Thank, to the giver.
    uint256 public constant SIGNAL_GIVEN = 3;
    /// @notice THANKED receipt: one per settled Thank, to the raiser.
    uint256 public constant SIGNAL_THANKED = 4;
    /// @notice UP: the reputation signal (9 decimals); only its earned part is spendable.
    uint256 public constant SIGNAL_UP = 5;
    /// @notice DOWN: one unit per Down received; minted only by `down`.
    uint256 public constant SIGNAL_DOWN = 6;

    /// @notice One whole Up in base units.
    uint256 public constant ONE_UP = 1e9;

    /// @notice Role bit of a Raiser credit in `EarnedUpMaterialized.roleMask`.
    uint8 public constant ROLE_RAISER = 1 << 0;
    /// @notice Role bit of a Giver credit in `EarnedUpMaterialized.roleMask`.
    uint8 public constant ROLE_GIVER = 1 << 1;

    /// @notice Domain tag of the RAISED source key.
    bytes32 public constant RAISED_SOURCE = keccak256("aHand.signals.source.raised.v2");
    /// @notice Domain tag of the THANK source key.
    bytes32 public constant THANK_SOURCE = keccak256("aHand.signals.source.thank.v2");

    /// @dev ERC-165, ERC-1155 and ERC-1155 metadata interface ids.
    bytes4 private constant IID_ERC165 = 0x01ffc9a7;
    bytes4 private constant IID_ERC1155 = 0xd9b67a26;
    bytes4 private constant IID_ERC1155_METADATA_URI = 0x0e89341c;

    /// @dev Decimals of the valuation: a credit is a 1e18-scaled nominal amount, so
    ///      one whole unit of the profile token credits 1e18 and mints exactly ONE_UP
    ///      on the floor-sqrt curve.
    uint8 private constant VALUE_DECIMALS = 18;

    /*//////////////////// Profile (immutable per deployment) ////////////////////*/

    /// @notice The one Core this ledger reads settled facts from.
    address public immutable sourceCore;
    /// @notice The one token whose donations earn Up in this deployment (USDC-only profile).
    address public immutable qualifiedToken;
    /// @notice Raw units of `qualifiedToken` × `unitScale` = the 1e18-scaled nominal value.
    uint256 public immutable unitScale;

    /*//////////////////// Ledger ////////////////////*/

    /// @notice Idempotence flags by source key (`raisedSourceKey` / `thankSourceKey`).
    mapping(bytes32 => bool) public processedSource;
    /// @dev ERC-1155 balances: id → account → amount.
    mapping(uint256 => mapping(address => uint256)) private _balances;
    /// @notice Minted supply per signal id (Up is conserved by `up`, so this is total Up).
    mapping(uint256 => uint256) public totalSupply;
    /// @notice Lifetime credited donation value per account, 1e18-scaled.
    mapping(address => uint256) public cumulativeValue;
    /// @notice Floor-sqrt watermark of `cumulativeValue`: the Up ever minted to the account.
    mapping(address => uint256) public prevSqrt;
    /// @notice The earned (spendable) part of an account's UP balance.
    mapping(address => uint256) public earnedUp;

    /*//////////////////// Events ////////////////////*/

    /// @notice ERC-1155 single transfer: every mint (`from` zero) and burn (`to` zero).
    /// @param operator The account that caused the movement.
    /// @param from     The debited account, or zero on mint.
    /// @param to       The credited account, or zero on burn.
    /// @param id       The signal id.
    /// @param value    The amount moved.
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);

    /// @notice One role credit of a materialized Thank, with the curve step it caused.
    /// @param sourceKey        The THANK source key.
    /// @param actor            The credited account.
    /// @param roleMask         ROLE_RAISER or ROLE_GIVER.
    /// @param credit           The 1e18-scaled value added to `cumulativeValue`.
    /// @param cumulativeBefore `cumulativeValue` before the credit.
    /// @param cumulativeAfter  `cumulativeValue` after the credit.
    /// @param delta            Up minted: floor(sqrt(after)) − floor(sqrt(before)).
    event EarnedUpMaterialized(
        bytes32 indexed sourceKey,
        address indexed actor,
        uint8 roleMask,
        uint256 credit,
        uint256 cumulativeBefore,
        uint256 cumulativeAfter,
        uint256 delta
    );

    /// @notice The full signal set of a settled Thank was materialized.
    /// @param sourceKey         The THANK source key.
    /// @param handId            The settled Hand.
    /// @param raiser            The raiser (THANKED).
    /// @param giver             The giver (GIVEN).
    /// @param charityAllocation C: the allocated donation in raw token units.
    /// @param occurrences       The route length (`occShakers.length`, anonymous hops included).
    /// @param earnedUpMinted    Up minted to the raiser and giver together (zero when unqualified).
    event ThankSignalsMaterialized(
        bytes32 indexed sourceKey,
        uint256 indexed handId,
        address raiser,
        address giver,
        uint256 charityAllocation,
        uint256 occurrences,
        uint256 earnedUpMinted
    );

    /// @notice Earned Up was spent to endorse another account.
    /// @param issuer       The endorser.
    /// @param target       The endorsed account.
    /// @param handId       Context Hand (zero = none).
    /// @param wholeUpCount Whole Up spent.
    /// @param amount       Base units moved (`wholeUpCount · ONE_UP`).
    /// @param reasonTag    Context tag.
    /// @param evidenceHash Context evidence commitment.
    event Upped(
        address indexed issuer,
        address indexed target,
        uint256 indexed handId,
        uint256 wholeUpCount,
        uint256 amount,
        bytes32 reasonTag,
        bytes32 evidenceHash
    );

    /// @notice A Down was given: one DOWN minted to the target, `burned` earned Up destroyed.
    /// @param issuer       The account giving the Down.
    /// @param target       The account receiving it.
    /// @param handId       Context Hand (zero = none).
    /// @param burned       Earned Up burned by the issuer, in base units (may be zero).
    /// @param reasonTag    Context tag.
    /// @param evidenceHash Context evidence commitment.
    event Downed(
        address indexed issuer,
        address indexed target,
        uint256 indexed handId,
        uint256 burned,
        bytes32 reasonTag,
        bytes32 evidenceHash
    );

    /*//////////////////// Construction ////////////////////*/

    /// @notice Binds the ledger to one Core and fixes its qualification profile:
    ///         `qualifiedToken_` at nominal units (one whole token = one unit of value).
    /// @dev    The unit scale is derived from the token's own `decimals()` once, here,
    ///         so a 6-decimal USDC credits 1e18 per whole dollar. Nothing can be
    ///         changed afterwards; a different profile is a new deployment.
    /// @param  sourceCore_     The Core whose `facts` this ledger materializes from.
    /// @param  qualifiedToken_ The one token whose donations earn Up.
    constructor(address sourceCore_, address qualifiedToken_) {
        if (sourceCore_ == address(0) || qualifiedToken_ == address(0)) revert ZeroAddress();
        uint8 decimals = IERC20Metadata(qualifiedToken_).decimals();
        if (decimals > VALUE_DECIMALS) revert UnsupportedDecimals();
        sourceCore = sourceCore_;
        qualifiedToken = qualifiedToken_;
        unitScale = 10 ** uint256(VALUE_DECIMALS - decimals);
    }

    /*//////////////////// Materialization (permissionless, idempotent) ////////////////////*/

    /// @notice Mint the RAISED receipt of a Hand to its raiser. Valid for any raised
    ///         Hand, terminal ones included: the raise happened however it resolved.
    /// @dev    Replays revert `AlreadyMaterialized`. The flag is set before the mint;
    ///         `facts` is a staticcall into an immutable fact, so nothing can diverge.
    /// @param  handId The Hand.
    function materializeRaised(uint256 handId) external {
        bytes32 key = raisedSourceKey(handId);
        if (processedSource[key]) revert AlreadyMaterialized();
        IAHandFacts.HandFacts memory f = IAHandFacts(sourceCore).facts(handId);
        if (f.status == Status.None) revert NotRaised();

        processedSource[key] = true; // before any mint
        _mint(f.raiser, SIGNAL_RAISED, 1);
    }

    /// @notice Materialize every signal of a settled Thank from its settlement
    ///         preimage. Nothing in `p` is trusted: it must rebuild, byte for byte,
    ///         the commitment the Core stored at settlement.
    /// @dev    `p.handId` is the only Hand id (no second parameter can disagree).
    ///         Order: replay check, Core facts (Settled), commitment check, flag, then
    ///         mints — THANKED to the raiser and GIVEN to the giver (both also when
    ///         they are one address), one SHAKEN per non-zero `occShakers[i]` without
    ///         dedup, then earned Up iff `earnsUp(p)`. Checked arithmetic: a credit
    ///         that cannot be represented reverts the whole call rather than
    ///         half-applying (unreachable under the USDC profile).
    /// @param  p The settlement preimage rebuilt from `Settled` + `RouteHopSettled`.
    function materializeThank(AHandSettlement.SettlementPreimage calldata p) external {
        bytes32 key = thankSourceKey(p.handId);
        if (processedSource[key]) revert AlreadyMaterialized();
        IAHandFacts.HandFacts memory f = IAHandFacts(sourceCore).facts(p.handId);
        if (f.status != Status.Settled) revert NotSettled();
        if (AHandSettlement.commitment(sourceCore, p) != f.settlementHash) revert SourceCommitmentMismatch();

        processedSource[key] = true; // before any mint

        _mint(p.raiser, SIGNAL_THANKED, 1);
        _mint(p.giver, SIGNAL_GIVEN, 1);
        address[] calldata shakers = p.occShakers;
        for (uint256 i; i < shakers.length; ++i) {
            if (shakers[i] != address(0)) _mint(shakers[i], SIGNAL_SHAKEN, 1); // per occurrence, no dedup
        }

        uint256 minted = 0;
        if (earnsUp(p)) {
            uint256 credit = valuation(p.token, p.charityAllocation) / 2; // half each, donation only
            minted = _creditEarnedUp(key, p.raiser, ROLE_RAISER, credit) + _creditEarnedUp(key, p.giver, ROLE_GIVER, credit);
        }
        // forge-lint: disable-next-line(reentrancy-events) — the only external call above is the Core's read-only facts()
        emit ThankSignalsMaterialized(key, p.handId, p.raiser, p.giver, p.charityAllocation, shakers.length, minted);
    }

    /*//////////////////// Qualification and valuation (the profile) ////////////////////*/

    /// @notice Whether a settled Thank earns Up under this deployment's profile:
    ///         the raiser and giver are distinct; the donation is strictly more than
    ///         1 % of the pool after rounding (`C > floor(P / 100)`); the token is
    ///         qualified; and the charity is none of the participants (a donation
    ///         that never left the circle earns nothing).
    /// @param  p The settlement preimage.
    /// @return True iff the Thank earns Up.
    function earnsUp(AHandSettlement.SettlementPreimage calldata p) public view returns (bool) {
        if (p.raiser == p.giver) return false;
        if (p.charityAllocation <= p.pool / 100) return false;
        if (!qualified(p.token, p.closedAt)) return false;
        address recipient = p.charityRecipient;
        if (recipient == p.raiser || recipient == p.giver) return false;
        address[] calldata shakers = p.occShakers;
        for (uint256 i; i < shakers.length; ++i) {
            if (shakers[i] == recipient) return false;
        }
        return true;
    }

    /// @notice Whether `token` is valued by this deployment for a Hand closed at the
    ///         given time. The USDC-only profile has no epoch bound: the second
    ///         argument is part of the Seam-3 shape (a profile may be bounded by
    ///         `closedAt`) and is ignored here.
    /// @param  token The settled Hand's token.
    /// @return True iff `token` is the profile token.
    function qualified(address token, uint40) public view returns (bool) {
        return token == qualifiedToken;
    }

    /// @notice The 1e18-scaled nominal value of `amount` raw units of `token`; zero
    ///         for any token outside the profile.
    /// @param  token  The token.
    /// @param  amount Raw token units.
    /// @return The valuation.
    function valuation(address token, uint256 amount) public view returns (uint256) {
        return token == qualifiedToken ? amount * unitScale : 0;
    }

    /*//////////////////// Up and Down ////////////////////*/

    /// @notice Spend whole units of earned Up to endorse `target`. Received Up is
    ///         never spendable, so endorsement chains end by construction.
    /// @dev    Burns from the issuer's earned part, mints the same amount to the
    ///         target as received Up; total supply is conserved.
    /// @param  target  The endorsed account: not zero, not the caller.
    /// @param  wholeUp Whole Up to spend; at least one.
    /// @param  ctx     Context; at least one field non-zero.
    function up(address target, uint256 wholeUp, UpContext calldata ctx) external {
        if (wholeUp == 0) revert ZeroAmount();
        uint256 amount = wholeUp * ONE_UP; // checked
        if (amount > earnedUp[msg.sender]) revert InsufficientEarned();
        _checkSignal(target, ctx);

        earnedUp[msg.sender] -= amount; // the recursion cut: only earned Up leaves
        _burn(msg.sender, SIGNAL_UP, amount);
        _mint(target, SIGNAL_UP, amount); // lands as received Up
        emit Upped(msg.sender, target, ctx.handId, wholeUp, amount, ctx.reasonTag, ctx.evidenceHash);
    }

    /// @notice Give `target` a Down, voluntarily burning `amount` base units of the
    ///         caller's own earned Up (zero allowed). Mints one DOWN to the target.
    /// @dev    Open to any Thank participant: the caller must hold at least one
    ///         THANKED, GIVEN or SHAKEN receipt. The burned amount is the issuer's
    ///         stake behind the Down; apps weigh a zero-burn Down as they see fit.
    /// @param  target The account receiving the Down: not zero, not the caller.
    /// @param  amount Earned Up to burn, in base units; may be zero.
    /// @param  ctx    Context; at least one field non-zero.
    function down(address target, uint256 amount, UpContext calldata ctx) external {
        _checkSignal(target, ctx);
        if (!isThankParticipant(msg.sender)) revert NotParticipant();
        if (amount > earnedUp[msg.sender]) revert InsufficientEarned();

        if (amount != 0) {
            earnedUp[msg.sender] -= amount;
            _burn(msg.sender, SIGNAL_UP, amount);
        }
        _mint(target, SIGNAL_DOWN, 1);
        emit Downed(msg.sender, target, ctx.handId, amount, ctx.reasonTag, ctx.evidenceHash);
    }

    /*//////////////////// ERC-1155 read surface (soulbound) ////////////////////*/

    /// @notice ERC-1155 balance of `id` held by `account`.
    /// @param  account The holder.
    /// @param  id      The signal id.
    /// @return The balance.
    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return _balances[id][account];
    }

    /// @notice ERC-1155 batch balances, positional.
    /// @param  accounts The holders.
    /// @param  ids      The signal ids, one per holder.
    /// @return balances One balance per (account, id) pair.
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory balances)
    {
        if (accounts.length != ids.length) revert LengthMismatch();
        balances = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            balances[i] = _balances[ids[i]][accounts[i]];
        }
    }

    /// @notice The received (non-spendable) part of an account's UP balance.
    /// @param  account The holder.
    /// @return UP held minus the earned part.
    function receivedOf(address account) external view returns (uint256) {
        return _balances[SIGNAL_UP][account] - earnedUp[account];
    }

    /// @notice Whether `account` holds at least one Thank receipt (THANKED, GIVEN or SHAKEN).
    /// @param  account The account.
    /// @return True iff the account took part in a materialized Thank.
    function isThankParticipant(address account) public view returns (bool) {
        return _balances[SIGNAL_THANKED][account] != 0 || _balances[SIGNAL_GIVEN][account] != 0
            || _balances[SIGNAL_SHAKEN][account] != 0;
    }

    /// @notice The level ring of an account by its whole Up held (earned and received):
    ///         0 below 1 Up, then rings at 1, 5, 25 and 100 Up. The display surface
    ///         of D39: roles and levels, never the raw number.
    /// @param  account The account.
    /// @return level 0..4.
    function levelOf(address account) external view returns (uint8 level) {
        uint256 wholeUp = _balances[SIGNAL_UP][account] / ONE_UP;
        if (wholeUp >= 100) return 4;
        if (wholeUp >= 25) return 3;
        if (wholeUp >= 5) return 2;
        if (wholeUp >= 1) return 1;
        return 0;
    }

    /// @notice The RAISED source key of a Hand (the `materializeRaised` idempotence key).
    /// @param  handId The Hand.
    /// @return keccak256(abi.encode(RAISED_SOURCE, chainId, sourceCore, handId)).
    function raisedSourceKey(uint256 handId) public view returns (bytes32) {
        return keccak256(abi.encode(RAISED_SOURCE, block.chainid, sourceCore, handId));
    }

    /// @notice The THANK source key of a Hand (the `materializeThank` idempotence key).
    /// @param  handId The Hand.
    /// @return keccak256(abi.encode(THANK_SOURCE, chainId, sourceCore, handId)).
    function thankSourceKey(uint256 handId) public view returns (bytes32) {
        return keccak256(abi.encode(THANK_SOURCE, block.chainid, sourceCore, handId));
    }

    /// @notice ERC-165: ERC-165, ERC-1155 and ERC-1155 metadata. The signals are
    ///         soulbound, so the transfer and approval entry points exist and revert.
    /// @param  interfaceId The interface id.
    /// @return True for 0x01ffc9a7, 0xd9b67a26 and 0x0e89341c.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == IID_ERC165 || interfaceId == IID_ERC1155 || interfaceId == IID_ERC1155_METADATA_URI;
    }

    /// @notice ERC-1155 approval query: nobody is ever approved for a soulbound signal.
    /// @return Always false.
    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    /// @notice ERC-1155 transfer stub: signals are soulbound, so it always reverts.
    function safeTransferFrom(address, address, uint256, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    /// @notice ERC-1155 batch transfer stub: signals are soulbound, so it always reverts.
    function safeBatchTransferFrom(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
    {
        revert Soulbound();
    }

    /// @notice ERC-1155 approval stub: signals are soulbound, so it always reverts.
    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    /*//////////////////// On-chain metadata ////////////////////*/

    /// @notice ERC-1155 metadata: a fully on-chain data URI with an SVG, naming the
    ///         ROLE a receipt stands for or, for UP and DOWN, the level rings. It
    ///         never renders an account's raw Up number (`balanceOf` does, by the
    ///         standard itself — the documented wallet-display caveat).
    /// @param  id The signal id.
    /// @return A `data:application/json;base64,…` URI; empty for an unknown id.
    function uri(uint256 id) external pure returns (string memory) {
        (string memory glyph, string memory title, string memory meaning) = _meta(id);
        if (bytes(title).length == 0) return "";
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="350" height="350">',
            '<rect width="100%" height="100%" fill="#101014"/>',
            '<text x="50%" y="54%" font-size="160" text-anchor="middle">',
            glyph,
            '</text><text x="50%" y="88%" font-size="22" fill="#eeeeee" text-anchor="middle" font-family="monospace">',
            title,
            "</text></svg>"
        );
        string memory json = string.concat(
            '{"name":"',
            glyph,
            " ",
            title,
            '","description":"',
            meaning,
            '","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /*//////////////////// Internals ////////////////////*/

    /// @dev Credits `value` of `id` to `to`. No receiver hook, ever.
    function _mint(address to, uint256 id, uint256 value) private {
        _balances[id][to] += value;
        totalSupply[id] += value;
        // forge-lint: disable-next-line(reentrancy-events) — the only external call before a mint is the Core's read-only facts()
        emit TransferSingle(msg.sender, address(0), to, id, value);
    }

    /// @dev Debits `value` of `id` from `from`. Only ever called with an amount
    ///      bounded by the holder's earned Up, which is bounded by its balance.
    function _burn(address from, uint256 id, uint256 value) private {
        // forge-lint: disable-next-line(missing-events-access-control) — TransferSingle below is the event
        _balances[id][from] -= value;
        totalSupply[id] -= value;
        emit TransferSingle(msg.sender, from, address(0), id, value);
    }

    /// @dev The floor-sqrt curve: an account's Up ever minted equals
    ///      floor(sqrt(cumulativeValue)). Monotone and sub-additive, so splitting
    ///      value across Hands never mints more than one Hand would.
    /// @param sourceKey The materialization this credit belongs to.
    /// @param actor     The credited account.
    /// @param roleMask  ROLE_RAISER or ROLE_GIVER.
    /// @param credit    The 1e18-scaled value to add.
    /// @return delta    The Up minted (zero when the watermark did not move).
    function _creditEarnedUp(bytes32 sourceKey, address actor, uint8 roleMask, uint256 credit)
        private
        returns (uint256 delta)
    {
        uint256 before = cumulativeValue[actor];
        uint256 after_ = before + credit;
        cumulativeValue[actor] = after_;

        uint256 newSqrt = Math.sqrt(after_); // floor
        delta = newSqrt - prevSqrt[actor];
        prevSqrt[actor] = newSqrt;
        if (delta != 0) {
            earnedUp[actor] += delta;
            _mint(actor, SIGNAL_UP, delta);
        }
        // forge-lint: disable-next-line(reentrancy-events) — the only external call before a credit is the Core's read-only facts()
        emit EarnedUpMaterialized(sourceKey, actor, roleMask, credit, before, after_, delta);
    }

    /// @dev The two rules every Up and Down share: a real, other target and a context that says something.
    function _checkSignal(address target, UpContext calldata ctx) private view {
        if (target == address(0)) revert ZeroAddress();
        if (target == msg.sender) revert SelfTarget();
        if (ctx.handId == 0 && ctx.reasonTag == bytes32(0) && ctx.evidenceHash == bytes32(0)) revert ZeroContext();
    }

    /// @dev Glyph, title and meaning per signal id; empty for an unknown id.
    function _meta(uint256 id) private pure returns (string memory glyph, string memory title, string memory meaning) {
        if (id == SIGNAL_RAISED) return (unicode"✋", "Raised", "aHand role receipt: raised a Hand");
        if (id == SIGNAL_SHAKEN) return (unicode"🤝", "Shaken", "aHand role receipt: passed a Hand along a settled route");
        if (id == SIGNAL_GIVEN) return (unicode"🙌", "Given", "aHand role receipt: gave the solution of a settled Hand");
        if (id == SIGNAL_THANKED) return (unicode"🙏", "Thanked", "aHand role receipt: thanked a settled Hand");
        if (id == SIGNAL_UP) {
            return (unicode"👍", "Up", "aHand signal earned by raisers and givers of qualifying Thanks; level rings at 1, 5, 25 and 100 Up");
        }
        if (id == SIGNAL_DOWN) return (unicode"👎", "Down", "aHand signal: a Down received, backed by the issuer's burned Up");
        return ("", "", "");
    }
}
