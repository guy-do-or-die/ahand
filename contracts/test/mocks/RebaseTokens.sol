// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice A token whose balances can be shrunk under everyone's feet: every
///         balance is `raw / divisor`, and raising the divisor is a negative rebase
///         (or a confiscation). Transfers stay exact at any divisor (raw moves in
///         multiples of it), so the only thing that breaks is Core's custody total:
///         pushes that no longer fit defer, withdraws revert, in call order.
contract NegativeRebaseToken {
    uint8 public constant decimals = 6;
    uint256 public divisor = 1;

    mapping(address => uint256) private _raw;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @dev A larger divisor shrinks every balance at once; 2 halves them.
    function setDivisor(uint256 newDivisor) external {
        require(newDivisor != 0, "ZERO_DIVISOR");
        divisor = newDivisor;
    }

    function mint(address to, uint256 amount) external {
        _raw[to] += amount * divisor;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _raw[account] / divisor;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        uint256 raw = amount * divisor;
        _raw[from] -= raw;
        _raw[to] += raw;
        emit Transfer(from, to, amount);
    }
}

/// @notice A share-based rebaser (stETH-style): balances are `shares · pooled /
///         totalShares`, and a transfer of `amount` moves floor(amount · totalShares
///         / pooled) shares, so the receiver can land 1 wei short. With `pooled ==
///         totalShares` every move is exact; after `rebase` lifts `pooled`, Core's
///         entry check may still pass by luck while every exit fails by 1 wei —
///         the class the app catalogue says to wrap, never to escrow directly.
contract SharesRebaserToken {
    uint8 public constant decimals = 18;
    uint256 public totalShares;
    uint256 public pooled;

    mapping(address => uint256) public sharesOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @dev Positive rebase: more pooled value behind the same shares.
    function rebase(uint256 newPooled) external {
        pooled = newPooled;
    }

    function mint(address to, uint256 amount) external {
        uint256 shares = totalShares == 0 ? amount : amount * totalShares / pooled;
        sharesOf[to] += shares;
        totalShares += shares;
        pooled += amount;
    }

    function balanceOf(address account) public view returns (uint256) {
        return totalShares == 0 ? 0 : sharesOf[account] * pooled / totalShares;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        uint256 shares = amount * totalShares / pooled;
        sharesOf[from] -= shares;
        sharesOf[to] += shares;
        emit Transfer(from, to, amount);
    }
}
