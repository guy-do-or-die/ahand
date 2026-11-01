// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IAHandFacts, Status} from "../../src/AHandTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Conformance probe, §9.3 #7 (Beside): tips from NEW money, bound to a
///         route key of a Hand and paid on the Hand's terminal facts. A tipper
///         escrows a tip for a beneficiary under `(handId, shakeHash)` — a path that
///         may well lose; once the Hand is Settled or Reclaimed (`closedAt != 0`),
///         anyone releases the tip to the beneficiary. The pot is never touched, no
///         second Give exists, no fee is added, no Up is earned. Test-only: never
///         deployed as protocol.
contract TipDistributor {
    using SafeERC20 for IERC20;

    /// @notice One escrowed tip.
    struct Tip {
        uint256 handId; // the Hand whose terminal fact releases the tip
        bytes32 shakeHash; // the path key the tip honours (verified off-chain)
        address beneficiary; // the fixed destination
        address token; // the tip's token (any ERC-20, independent of the Hand's)
        uint256 amount; // raw units escrowed
        bool released;
    }

    /// @notice The Core whose facts release tips.
    IAHandFacts public immutable facts;
    /// @notice Every tip by id.
    Tip[] public tips;

    /// @notice A tip was escrowed.
    event Tipped(
        uint256 indexed tipId,
        uint256 indexed handId,
        bytes32 indexed shakeHash,
        address tipper,
        address beneficiary,
        address token,
        uint256 amount
    );
    /// @notice A tip was paid out.
    event TipReleased(uint256 indexed tipId, address indexed beneficiary, uint256 amount);

    /// @notice The Hand was never raised.
    error UnknownHand();
    /// @notice The beneficiary is the zero address.
    error ZeroBeneficiary();
    /// @notice The tip amount is zero.
    error ZeroTip();
    /// @notice The Hand is still Active: its outcome is not a fact yet.
    error HandNotTerminal();
    /// @notice The tip was released before.
    error AlreadyReleased();

    /// @param facts_ The Core (through its stable facts interface only).
    constructor(IAHandFacts facts_) {
        facts = facts_;
    }

    /// @notice Escrow a tip for `beneficiary`, bound to a path of `handId`.
    /// @param  handId      A raised Hand (any status).
    /// @param  shakeHash   The path key (hashStruct of the tipped Shake).
    /// @param  beneficiary The fixed destination.
    /// @param  token       The tip's token.
    /// @param  amount      Raw units; pulled from the caller.
    /// @return tipId       The tip id.
    function tip(uint256 handId, bytes32 shakeHash, address beneficiary, address token, uint256 amount)
        external
        returns (uint256 tipId)
    {
        if (facts.facts(handId).status == Status.None) revert UnknownHand();
        if (beneficiary == address(0)) revert ZeroBeneficiary();
        if (amount == 0) revert ZeroTip();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        tipId = tips.length;
        tips.push(
            Tip({
                handId: handId,
                shakeHash: shakeHash,
                beneficiary: beneficiary,
                token: token,
                amount: amount,
                released: false
            })
        );
        emit Tipped(tipId, handId, shakeHash, msg.sender, beneficiary, token, amount);
    }

    /// @notice Pay a tip out once its Hand reached a terminal state. Anyone may call.
    /// @param  tipId The tip.
    function release(uint256 tipId) external {
        Tip storage t = tips[tipId];
        if (t.released) revert AlreadyReleased();
        if (facts.facts(t.handId).closedAt == 0) revert HandNotTerminal();
        t.released = true;
        IERC20(t.token).safeTransfer(t.beneficiary, t.amount);
        emit TipReleased(tipId, t.beneficiary, t.amount);
    }

    /// @notice The number of tips ever escrowed.
    function tipCount() external view returns (uint256) {
        return tips.length;
    }
}
