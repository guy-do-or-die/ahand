// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTypes.sol";
import {IValueAnchor} from "./StaticAnchor.sol";

/// @title AHandSignals
/// @notice Soulbound receipt and referral reputation contract for the aHand protocol.
contract AHandSignals {
    /*//////////////////// Token IDs ////////////////////*/
    uint256 public constant SIGNAL_RAISE = 1;
    uint256 public constant SIGNAL_SHAKE = 2;
    uint256 public constant SIGNAL_GIVE  = 3;
    uint256 public constant SIGNAL_THANK = 4;
    uint256 public constant SIGNAL_UP    = 5;   // 9 decimals; spendable only earned
    uint256 public constant SIGNAL_DOWN  = 6;   // counter at target; non-spendable

    uint256 public constant ONE_UP = 1e9;

    /*//////////////////// ERC1155 State ////////////////////*/
    mapping(uint256 => mapping(address => uint256)) public balanceOf;
    mapping(uint256 => uint256) public totalSupply;

    /*//////////////////// Signals State ////////////////////*/
    address public immutable core;
    address public owner;
    address public pendingOwner;
    
    uint256 public emissionCapUsd = 10_000 * 1e18; // default $10,000
    IValueAnchor public anchor;                    // 0 = emission disabled

    mapping(address => uint256) public cumulativeUsd;
    mapping(address => uint256) public prevIsqrt;
    mapping(address => uint256) public earnedOf;     // spendable part of SIGNAL_UP

    function receivedOf(address a) external view returns (uint256) {
        return balanceOf[SIGNAL_UP][a] - earnedOf[a];
    }

    /*//////////////////// Events ////////////////////*/
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256[] ids,
        uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
    event UpGiven(address indexed from, address indexed target);
    event Downed(address indexed from, address indexed target);
    event ConfigUpdated(uint256 emissionCapUsd);
    event AnchorSet(address indexed anchor);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyCore() {
        if (msg.sender != core) revert OnlyCore();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address core_) {
        if (core_ == address(0)) revert ZeroAddress();
        core = core_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function setConfig(uint256 emissionCapUsd_) external onlyOwner {
        emissionCapUsd = emissionCapUsd_;
        emit ConfigUpdated(emissionCapUsd_);
    }

    function setAnchor(address anchor_) external onlyOwner {
        anchor = IValueAnchor(anchor_);
        emit AnchorSet(anchor_);
    }

    /*//////////////////// Mint / Burn ////////////////////*/
    function _mint(address to, uint256 id, uint256 value) internal {
        balanceOf[id][to] += value;
        totalSupply[id] += value;
        emit TransferSingle(msg.sender, address(0), to, id, value);
    }

    function _burn(address from, uint256 id, uint256 value) internal {
        if (balanceOf[id][from] < value) revert InsufficientBalance();
        balanceOf[id][from] -= value;
        totalSupply[id] -= value;
        emit TransferSingle(msg.sender, from, address(0), id, value);
    }

    /*//////////////////// Core Entry Points ////////////////////*/
    function mintRaise(address raiser, uint256 /*handId*/) external onlyCore {
        _mint(raiser, SIGNAL_RAISE, 1);
    }

    function mintSettlement(
        uint256 /*handId*/,
        address raiser,
        address solver,
        address[] calldata payees,
        uint16[] calldata margins,
        address token,
        uint96 charityFee
    ) external onlyCore {
        _mint(raiser, SIGNAL_THANK, 1);
        _mint(solver, SIGNAL_GIVE, 1);
        for (uint256 i = 0; i < payees.length; ++i) {
            if (margins[i] > 0) {
                _mint(payees[i], SIGNAL_SHAKE, 1);
            }
        }

        // UP emission: only via value anchor (quarantined: revert => 0 usd value, no freeze)
        if (charityFee > 0 && address(anchor) != address(0)) {
            uint256 usdVal;
            try anchor.usdValue{gas: 50_000}(token, charityFee) returns (uint256 v) {
                usdVal = v;                       // unrecognized token / rate = 0 => 0 emission
            } catch {}
            if (usdVal > emissionCapUsd) {
                usdVal = emissionCapUsd;
            }
            if (usdVal > 0) {
                uint256 halfVal = usdVal / 2;
                _emitEarnedUp(raiser, halfVal);
                _emitEarnedUp(solver, halfVal);
            }
        }
    }

    /// @notice Reserved hook: core is immutable, Signals is mutable.
    function onFinalize(uint256 handId, address raiser) external onlyCore {}

    /*//////////////////// Earned Up Emission ////////////////////*/
    function _emitEarnedUp(address addr, uint256 amount) internal {
        uint256 newCum = cumulativeUsd[addr] + amount;
        cumulativeUsd[addr] = newCum;

        uint256 newSqrt = _isqrt(newCum);
        uint256 prev = prevIsqrt[addr];
        if (newSqrt > prev) {
            uint256 diff = newSqrt - prev;
            prevIsqrt[addr] = newSqrt;
            earnedOf[addr] += diff;
            _mint(addr, SIGNAL_UP, diff);
        }
    }

    function _isqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /*//////////////////// Vouch / Down (Spendable Signals) ////////////////////*/
    function up(address target) external {
        if (earnedOf[msg.sender] < ONE_UP) revert InsufficientEarned();
        earnedOf[msg.sender] -= ONE_UP;          // spend only earned
        _burn(msg.sender, SIGNAL_UP, ONE_UP);    // recursion cut is here
        _mint(target, SIGNAL_UP, ONE_UP);        // targets get received portion
        emit UpGiven(msg.sender, target);
    }

    function down(address target) external {
        if (earnedOf[msg.sender] < 3 * ONE_UP) revert InsufficientEarned();
        earnedOf[msg.sender] -= 3 * ONE_UP;
        _burn(msg.sender, SIGNAL_UP, 3 * ONE_UP);
        _mint(target, SIGNAL_DOWN, 1);           // public non-spendable down indicator
        emit Downed(msg.sender, target);
    }


    /*//////////////////// On-chain Metadata (visual identity) ////////////////////*/
    function _meta(uint256 id) internal pure
        returns (string memory emoji, string memory title)
    {
        if (id == SIGNAL_RAISE) return (unicode"✋", "Raised");
        if (id == SIGNAL_SHAKE) return (unicode"🤝", "Shaken");
        if (id == SIGNAL_GIVE)  return (unicode"🙌", "Given");
        if (id == SIGNAL_THANK) return (unicode"🙏", "Thanked");
        if (id == SIGNAL_UP)    return (unicode"👍", "Up");
        if (id == SIGNAL_DOWN)  return (unicode"👎", "Down");
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

    function balanceOfBatch(address[] calldata owners, uint256[] calldata ids)
        external view returns (uint256[] memory out)
    {
        if (owners.length != ids.length) revert LengthMismatch();
        out = new uint256[](owners.length);
        for (uint256 i; i < owners.length; ++i) out[i] = balanceOf[ids[i]][owners[i]];
    }

    function setApprovalForAll(address, bool) external pure { revert Soulbound(); }
    function isApprovedForAll(address, address) external pure returns (bool) { return false; }

    /*//////////////////// Soulbound Rules ////////////////////*/
    function safeTransferFrom(address, address, uint256, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    function safeBatchTransferFrom(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure {
        revert Soulbound();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0xd9b67a26 // ERC1155
            || interfaceId == 0x0e89341c // ERC1155MetadataURI
            || interfaceId == 0x01ffc9a7; // ERC165
    }
}
