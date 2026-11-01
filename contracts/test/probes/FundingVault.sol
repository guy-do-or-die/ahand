// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AHandCore} from "../../src/AHandCore.sol";
import {Hop, RaiseParams, Status, Terminal} from "../../src/AHandTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Conformance probe, §9.3 #2: a pooled / crowdfunded Raiser (Seam 1).
///         Contributors deposit one token until the funding deadline; between the
///         funding and the execution deadline the vault raises ONE Hand with ONE pot
///         equal to the sum; the steward thanks; contributor refund rights live here:
///         if nobody raised by the execution deadline, or if the Hand was reclaimed
///         (the pool came back whole), every contributor takes their contribution
///         back. Each funding cycle is a new vault and a new Hand: Core knows no
///         top-up, no partial award and no second Give. Test-only: never deployed
///         as protocol.
contract FundingVault {
    using SafeERC20 for IERC20;

    /// @notice The Core the vault raises on.
    AHandCore public immutable core;
    /// @notice The one token of this cycle.
    IERC20 public immutable token;
    /// @notice The account that may thank on the vault's behalf.
    address public immutable steward;
    /// @notice Contributions close here; the raise window opens.
    uint40 public immutable fundingDeadline;
    /// @notice The raise window closes here; without a raise, refunds open.
    uint40 public immutable executionDeadline;

    /// @notice Each contributor's outstanding contribution.
    mapping(address => uint256) public contributed;
    /// @notice The sum of outstanding contributions — the pot the vault raises.
    uint256 public totalContributed;
    /// @notice The Hand this vault raised (zero until `raise`).
    uint256 public handId;

    /// @notice A contribution landed.
    event Contributed(address indexed contributor, uint256 amount);
    /// @notice A contribution was returned.
    event Refunded(address indexed contributor, uint256 amount);

    /// @notice The deadlines are not ordered (funding before execution).
    error DeadlineOrder();
    /// @notice The funding window is closed.
    error FundingClosed();
    /// @notice The raise window is not open (funding still open, or execution passed).
    error RaiseWindowClosed();
    /// @notice The vault already raised its Hand.
    error AlreadyRaised();
    /// @notice The raise terms do not name this token and the exact pooled amount.
    error PotMismatch();
    /// @notice Nothing was contributed, so there is nothing to raise.
    error NothingPooled();
    /// @notice Called by an account other than the steward.
    error NotSteward();
    /// @notice Refunds are not open: a raise may still happen, or the Hand is not reclaimed.
    error NotRefundable();
    /// @notice The caller has no outstanding contribution.
    error NothingToRefund();

    /// @param core_              The Core.
    /// @param token_             The token of this cycle.
    /// @param steward_           The thank authority inside the vault.
    /// @param fundingDeadline_   When contributions close and the raise window opens.
    /// @param executionDeadline_ When the raise window closes.
    constructor(AHandCore core_, IERC20 token_, address steward_, uint40 fundingDeadline_, uint40 executionDeadline_) {
        if (fundingDeadline_ >= executionDeadline_) revert DeadlineOrder();
        core = core_;
        token = token_;
        steward = steward_;
        fundingDeadline = fundingDeadline_;
        executionDeadline = executionDeadline_;
    }

    /// @notice Contribute `amount` before the funding deadline.
    /// @param  amount Raw token units.
    function contribute(uint256 amount) external {
        if (block.timestamp >= fundingDeadline) revert FundingClosed();
        token.safeTransferFrom(msg.sender, address(this), amount);
        contributed[msg.sender] += amount;
        totalContributed += amount;
        emit Contributed(msg.sender, amount);
    }

    /// @notice Inside the raise window, anyone raises the one Hand: this token, the whole pool.
    /// @param  p            The raise parameters; `token` and `amount` must match the pool.
    /// @param  discoveryRef The discovery ref bytes.
    /// @param  tags         The discovery tags.
    /// @return id           The Hand id.
    function raise(RaiseParams calldata p, bytes calldata discoveryRef, bytes32[] calldata tags)
        external
        returns (uint256 id)
    {
        if (block.timestamp < fundingDeadline || block.timestamp >= executionDeadline) revert RaiseWindowClosed();
        if (handId != 0) revert AlreadyRaised();
        if (totalContributed == 0) revert NothingPooled();
        if (p.token != address(token) || p.amount != totalContributed) revert PotMismatch();
        token.forceApprove(address(core), p.amount);
        id = core.raise(p, discoveryRef, tags);
        handId = id;
    }

    /// @notice The steward thanks the vault's Hand with a consented route and Give.
    /// @param  hops The route hops with their proofs.
    /// @param  t    The terminal Give with its proofs.
    function thank(Hop[] calldata hops, Terminal calldata t) external {
        if (msg.sender != steward) revert NotSteward();
        core.thank(handId, hops, t);
    }

    /// @notice Take a contribution back while `refundable()`.
    /// @dev    A deferred reclaim refund is first pulled with `core.withdraw(token, vault)`
    ///         by anyone; until it lands the transfer here reverts and the
    ///         contribution stays recorded.
    function refund() external {
        if (!refundable()) revert NotRefundable();
        uint256 amount = contributed[msg.sender];
        if (amount == 0) revert NothingToRefund();
        contributed[msg.sender] = 0;
        totalContributed -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    /// @notice Whether contributions can be taken back now: no raise by the execution
    ///         deadline, or the Hand reclaimed on Core.
    function refundable() public view returns (bool) {
        if (handId == 0) return block.timestamp >= executionDeadline;
        return core.facts(handId).status == Status.Reclaimed;
    }
}
