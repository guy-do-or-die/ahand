// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice The storage shape shared by the proxy's delegate target and anyone who
///         reads it: an owner, a pause flag, a blacklist and the ERC-20 ledger.
abstract contract FiatTokenLikeStorage {
    address public owner;
    bool public paused;
    mapping(address => bool) public blacklisted;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
}

/// @notice A FiatToken-shaped implementation (Circle USDC): six decimals, an owner
///         who can pause and blacklist, string-reverting checks on both parties of
///         every move, `true` returns. Always reached through `FiatTokenLikeProxy`,
///         so every call pays the proxy's delegatecall — the heaviest honest push.
contract FiatTokenLikeV1 is FiatTokenLikeStorage {
    string public constant name = "USD Coin (like)";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Pausable: paused");
        _;
    }

    modifier notBlacklisted(address account) {
        require(!blacklisted[account], "Blacklistable: account is blacklisted");
        _;
    }

    function initialize(address owner_) external {
        require(owner == address(0), "already initialized");
        owner = owner_;
    }

    function mint(address to, uint256 amount) external onlyOwner whenNotPaused notBlacklisted(to) {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function blacklist(address account) external onlyOwner {
        blacklisted[account] = true;
    }

    function unBlacklist(address account) external onlyOwner {
        blacklisted[account] = false;
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function approve(address spender, uint256 amount)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(spender)
        returns (bool)
    {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(to)
        returns (bool)
    {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(from)
        notBlacklisted(to)
        returns (bool)
    {
        require(amount <= allowance[from][msg.sender], "ERC20: transfer amount exceeds allowance");
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(to != address(0), "ERC20: transfer to the zero address");
        require(amount <= balanceOf[from], "ERC20: transfer amount exceeds balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice A minimal delegating proxy in front of `FiatTokenLikeV1`, with the
///         implementation in the ERC-1967 slot so it never collides with the
///         implementation's own storage. Tests talk to the proxy address through
///         the `FiatTokenLikeV1` ABI.
contract FiatTokenLikeProxy {
    /// @dev bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation) {
        assembly ("memory-safe") {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
    }

    fallback() external payable {
        assembly {
            let implementation := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
