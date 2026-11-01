// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AHandCore} from "../../src/AHandCore.sol";
import {Hop, IAHandFacts, RaiseParams, Status, Terminal} from "../../src/AHandTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Conformance probe, §9.3 #1: an opt-in controller / arbiter as the Raiser
///         (Seam 1) under a fixed policy committed in the metadata envelope (Seam 2).
///         A principal funds the controller; the controller raises (it IS
///         `h.raiser`), the decision maker thanks the unmodified signed route inside
///         the decision window, and after expiry anyone reclaims on Core — the refund
///         lands here and is distributed under the policy. Test-only: never a
///         protocol contract, never deployed.
/// @dev    What it can never do, by Core alone: adopt an EOA Hand (`NotRaiser`),
///         thank after expiry (`HandExpired`), skip the GiverAcceptance
///         (`GiverAcceptanceInvalid`), extend expiry, or pay anyone off the route.
contract PolicyRaiser {
    using SafeERC20 for IERC20;

    /// @notice The Seam-2 schema tag of the policy envelope.
    bytes32 public constant SCHEMA_TAG = keccak256("ahand.meta.controller.v1");

    /// @notice The fixed policy: who decides, who funded, and the ordered deadlines
    ///         `deliveryDeadline < challengeDeadline < decisionDeadline < expiry`.
    struct Policy {
        address decisionMaker; // the only account that may thank
        address principal; // the human funder; receives a reclaimed refund
        uint40 deliveryDeadline; // the giver's delivery must be in by then (off-chain fact)
        uint40 challengeDeadline; // the challenge window closes; decisions open after it
        uint40 decisionDeadline; // the last second a decision is taken; strictly before expiry
    }

    /// @notice The Core this controller raises on.
    AHandCore public immutable core;
    /// @notice The policy; fixed at construction.
    Policy public policy;
    /// @notice The one Hand this controller raised (zero before `fund`).
    uint256 public handId;
    /// @notice The evidence the decision was taken on (zero before `decide`).
    bytes32 public evidenceHash;

    /// @notice The deadlines are not strictly ordered.
    error PolicyOrder();
    /// @notice Called by an account other than the principal.
    error NotPrincipal();
    /// @notice Called by an account other than the decision maker.
    error NotDecisionMaker();
    /// @notice The controller already raised its Hand.
    error AlreadyFunded();
    /// @notice The controller has no Hand yet.
    error NotFunded();
    /// @notice The Hand's expiry is not after the decision deadline.
    error ExpiryBeforeDecision();
    /// @notice The metadata commitment is not this controller's policy envelope.
    error WrongEnvelope();
    /// @notice The decision was attempted outside (challengeDeadline, decisionDeadline].
    error OutsideDecisionWindow();
    /// @notice The Hand was not reclaimed, so there is no refund to distribute.
    error NotReclaimed();

    /// @param core_   The Core.
    /// @param policy_ The policy; deadlines strictly ascending.
    constructor(AHandCore core_, Policy memory policy_) {
        if (
            policy_.deliveryDeadline >= policy_.challengeDeadline
                || policy_.challengeDeadline >= policy_.decisionDeadline
        ) revert PolicyOrder();
        core = core_;
        policy = policy_;
    }

    /// @notice keccak256 of the policy — the `policyHash` field of the envelope payload.
    function policyHash() public view returns (bytes32) {
        return keccak256(abi.encode(policy));
    }

    /// @notice The §9.2 envelope this controller commits as `metadataCommitment`:
    ///         `keccak256(abi.encode(SCHEMA_TAG, keccak256(abi.encode(policyHash, principal))))`.
    function metadataCommitment() public view returns (bytes32) {
        return keccak256(abi.encode(SCHEMA_TAG, keccak256(abi.encode(policyHash(), policy.principal))));
    }

    /// @notice The principal funds the pot and the controller raises the Hand under the policy.
    /// @dev    `p.expiry` must leave room for the decision; `p.metadataCommitment` must be
    ///         this controller's envelope. The pot is pulled from the principal and
    ///         escrowed by Core through an exact approval.
    /// @param  p            The raise parameters (any token, any amount).
    /// @param  discoveryRef The discovery ref bytes.
    /// @param  tags         The discovery tags.
    /// @return id           The Hand id.
    function fund(RaiseParams calldata p, bytes calldata discoveryRef, bytes32[] calldata tags)
        external
        returns (uint256 id)
    {
        if (msg.sender != policy.principal) revert NotPrincipal();
        if (handId != 0) revert AlreadyFunded();
        if (p.expiry <= policy.decisionDeadline) revert ExpiryBeforeDecision();
        if (p.metadataCommitment != metadataCommitment()) revert WrongEnvelope();
        if (p.amount != 0) {
            IERC20(p.token).safeTransferFrom(msg.sender, address(this), p.amount);
            IERC20(p.token).forceApprove(address(core), p.amount);
        }
        id = core.raise(p, discoveryRef, tags);
        handId = id;
    }

    /// @notice The decision: thank the unmodified signed route and Give, inside the
    ///         decision window, on the recorded evidence. Core still demands every
    ///         consent the route carries.
    /// @param  hops     The route hops with their proofs.
    /// @param  t        The terminal Give with its proofs.
    /// @param  evidence The evidence commitment the decision rests on.
    function decide(Hop[] calldata hops, Terminal calldata t, bytes32 evidence) external {
        if (msg.sender != policy.decisionMaker) revert NotDecisionMaker();
        if (handId == 0) revert NotFunded();
        if (block.timestamp <= policy.challengeDeadline || block.timestamp > policy.decisionDeadline) {
            revert OutsideDecisionWindow();
        }
        evidenceHash = evidence;
        core.thank(handId, hops, t);
    }

    /// @notice After anyone reclaimed the expired Hand on Core, pass the refund that
    ///         landed here to the principal — the policy's distribution rule.
    /// @dev    A deferred refund is first pulled with `core.withdraw(token, this)` by
    ///         anyone; this call then forwards whatever the controller holds.
    function distributeRefund() external {
        IAHandFacts.HandFacts memory f = core.facts(handId);
        if (f.status != Status.Reclaimed) revert NotReclaimed();
        if (f.pool != 0) IERC20(f.token).safeTransfer(policy.principal, IERC20(f.token).balanceOf(address(this)));
    }
}
