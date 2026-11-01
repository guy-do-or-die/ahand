// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Conformance probe, §9.3 #7 (Seam 1): a team as the Giver. The contract
///         is `give.giver`; its manager key consents on its behalf through
///         ERC-1271 (GiverAcceptance), Core pays the whole residual G to the
///         contract, and the contract splits what it holds among its members by
///         its own fixed shares. Core never learns the members: no second Give, no
///         fee, no new payout shape. Test-only: never deployed as protocol.
contract SplitterGiver {
    using SafeERC20 for IERC20;

    bytes4 private constant MAGIC = 0x1626ba7e;
    bytes4 private constant INVALID = 0xffffffff;
    uint16 private constant BPS = 10_000;

    /// @notice The key whose ECDSA signature is this contract's consent.
    address public immutable manager;
    /// @notice The members paid by `split`, in share order.
    address[] public members;
    /// @notice Each member's share in bps; the shares sum to 10 000.
    uint16[] public sharesBps;

    /// @notice A balance was split among the members.
    event Split(address indexed token, uint256 total);

    /// @notice `members` and `shares` differ in length, or are empty.
    error LengthMismatch();
    /// @notice The shares do not sum to 10 000.
    error SharesNotWhole();

    /// @param manager_ The consenting key.
    /// @param members_ The members.
    /// @param shares_  Their shares in bps, summing to 10 000.
    constructor(address manager_, address[] memory members_, uint16[] memory shares_) {
        if (members_.length == 0 || members_.length != shares_.length) revert LengthMismatch();
        uint256 sum;
        for (uint256 i; i < shares_.length; ++i) {
            sum += shares_[i];
        }
        if (sum != BPS) revert SharesNotWhole();
        manager = manager_;
        members = members_;
        sharesBps = shares_;
    }

    /// @notice ERC-1271: valid iff `signature` is the manager's ECDSA signature over `hash`.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return (err == ECDSA.RecoverError.NoError && signer == manager) ? MAGIC : INVALID;
    }

    /// @notice Split the whole `token` balance among the members by their shares;
    ///         the last member absorbs the rounding dust. Anyone may trigger it.
    /// @param  token The token to split.
    function split(IERC20 token) external {
        uint256 total = token.balanceOf(address(this));
        uint256 last = members.length - 1;
        uint256 paid;
        for (uint256 i; i < last; ++i) {
            uint256 amount = total * sharesBps[i] / BPS;
            paid += amount;
            token.safeTransfer(members[i], amount);
        }
        token.safeTransfer(members[last], total - paid);
        emit Split(address(token), total);
    }

    /// @notice The number of members.
    function memberCount() external view returns (uint256) {
        return members.length;
    }
}
