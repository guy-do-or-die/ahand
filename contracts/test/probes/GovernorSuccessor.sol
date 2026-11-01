// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AHandCore} from "../../src/AHandCore.sol";

/// @notice Conformance probe, §9.3 #9 (the policyAdmin seam, §10): a governance
///         contract that succeeds the owner's key as `policyAdmin`. It is nominated
///         through `transferPolicyAdmin`, accepts through `acceptPolicyAdmin`, and
///         from then on may call exactly `setCharityAllowed` (and hand the role on).
///         `attempt` lets a test prove the whole reach of the role: any other
///         selector either does not exist on Core or is a permissionless call
///         with a fixed destination. A single council address stands in for the
///         vote. Test-only: never deployed as protocol.
contract GovernorSuccessor {
    /// @notice The Core governed.
    AHandCore public immutable core;
    /// @notice The account whose word stands for a passed vote.
    address public immutable council;

    /// @notice Called by an account other than the council.
    error NotCouncil();

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    /// @param core_    The Core.
    /// @param council_ The vote stand-in.
    constructor(AHandCore core_, address council_) {
        core = core_;
        council = council_;
    }

    /// @notice Accept a pending nomination: the governor becomes `policyAdmin`.
    function accept() external onlyCouncil {
        core.acceptPolicyAdmin();
    }

    /// @notice The one power of the role: edit the prospective charity allowlist.
    function setCharity(address charity, bool allowed) external onlyCouncil {
        core.setCharityAllowed(charity, allowed);
    }

    /// @notice Hand the role on (or cancel a nomination with zero).
    function nominate(address next) external onlyCouncil {
        core.transferPolicyAdmin(next);
    }

    /// @notice Try any call on Core as the governor and report whether it went through.
    /// @param  data The calldata.
    /// @return ok   Whether the call succeeded.
    /// @return ret  The returndata (revert data when `ok` is false).
    function attempt(bytes calldata data) external onlyCouncil returns (bool ok, bytes memory ret) {
        (ok, ret) = address(core).call(data);
    }
}
