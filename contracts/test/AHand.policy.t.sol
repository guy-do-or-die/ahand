// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: policy — bounded admin, prospective-only
        switches, revision provenance, absent surfaces
//////////////////////////////////////////////////////////////*/

contract AHandPolicyTest is AHandTestBase {
    address newAdmin = makeAddr("newAdmin");

    /*──────────────── prospective-only: token switch ────────────────*/

    function test_DisableToken_BlocksNewRaise() public {
        vm.prank(policyAdmin);
        core.setTokenEnabled(false);
        expectRaiseRevert(TokenNotEnabled.selector, defaultParams());
    }

    /// A live Hand raised before the switch settles exactly as promised:
    /// tokenEnabled never gates thank.
    function test_DisableToken_ExistingHandStillThanks() public {
        uint256 h = makeRaise();
        vm.prank(policyAdmin);
        core.setTokenEnabled(false);

        settleSimple(h);
        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled));
        assertEq(core.claims(address(usd), giver), 90e6, "residual credited under disabled policy");
    }

    function test_DisableToken_ExistingHandStillReclaims() public {
        uint256 h = makeRaise();
        vm.prank(policyAdmin);
        core.setTokenEnabled(false);

        vm.warp(core.getHand(h).expiry);
        core.reclaim(h);
        assertEq(core.claims(address(usd), raiser), DEPOSIT, "refund credited under disabled policy");
    }

    /// Withdraw has no tokenEnabled check at all — the full escrow exit
    /// survives any policy posture. (Deeper coverage in the withdraw suite.)
    function test_DisableToken_WithdrawUnaffected() public {
        uint256 h = makeRaise();
        settleSimple(h);
        vm.prank(policyAdmin);
        core.setTokenEnabled(false);

        core.withdraw(address(usd), charity);
        assertEq(usd.balanceOf(charity), 10e6);
    }

    function test_ReenableToken_RaiseWorksAgain() public {
        vm.startPrank(policyAdmin);
        core.setTokenEnabled(false);
        core.setTokenEnabled(true);
        vm.stopPrank();
        assertEq(makeRaise(), 1, "raises resume");
    }

    /*──────────────── prospective-only: charity allowlist ────────────────*/

    function test_DeallowCharity_BlocksNewRaise() public {
        vm.prank(policyAdmin);
        core.setCharityAllowed(charity, false);
        expectRaiseRevert(CharityNotWhitelisted.selector, defaultParams());
    }

    /// The charity snapshot lives in the Hand: a de-allowed charity still
    /// receives the cut of every Hand raised while it was allowed.
    function test_DeallowCharity_ExistingHandStillSettlesToIt() public {
        uint256 h = makeRaise();
        vm.prank(policyAdmin);
        core.setCharityAllowed(charity, false);

        settleSimple(h);
        assertEq(core.claims(address(usd), charity), 10e6, "snapshot beats allowlist");
    }

    function test_AllowNewCharity_RaiseAccepts() public {
        address charityB = makeAddr("charityB");
        RaiseParams memory p = defaultParams();
        p.charityRecipient = charityB;
        expectRaiseRevert(CharityNotWhitelisted.selector, p);

        vm.prank(policyAdmin);
        core.setCharityAllowed(charityB, true);
        uint256 h = makeRaise(p);
        assertEq(core.getHand(h).charityRecipient, charityB);
    }

    /*──────────────── guards ────────────────*/

    function test_OnlyPolicyAdmin_GuardsAllSetters() public {
        vm.startPrank(stranger);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setTokenEnabled(false);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setCharityAllowed(stranger, true);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.transferPolicyAdmin(stranger);
        vm.stopPrank();
    }

    function test_SetCharityAllowed_ZeroAddress() public {
        vm.prank(policyAdmin);
        vm.expectRevert(ZeroAddress.selector);
        core.setCharityAllowed(address(0), true);
    }

    /*──────────────── two-step admin handover ────────────────*/

    function test_TwoStepTransfer_FullFlow() public {
        vm.expectEmit();
        emit AHandCore.PolicyAdminTransferStarted(policyAdmin, newAdmin);
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(newAdmin);

        // pending set, role unchanged until acceptance
        assertEq(core.pendingPolicyAdmin(), newAdmin);
        assertEq(core.policyAdmin(), policyAdmin, "no power moves on step one");

        vm.expectEmit();
        emit AHandCore.PolicyAdminTransferred(policyAdmin, newAdmin);
        vm.prank(newAdmin);
        core.acceptPolicyAdmin();

        assertEq(core.policyAdmin(), newAdmin);
        assertEq(core.pendingPolicyAdmin(), address(0), "pending cleared");

        // the old admin is fully demoted; the new one governs
        vm.prank(policyAdmin);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setTokenEnabled(false);
        vm.prank(newAdmin);
        core.setTokenEnabled(false);
        assertFalse(core.tokenEnabled());
    }

    function test_AcceptByNonPending_NotPendingOwner() public {
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(newAdmin);

        vm.prank(stranger);
        vm.expectRevert(NotPendingOwner.selector);
        core.acceptPolicyAdmin();

        // with nothing pending, nobody can accept — including the admin
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(address(0));
        vm.prank(policyAdmin);
        vm.expectRevert(NotPendingOwner.selector);
        core.acceptPolicyAdmin();
    }

    /// transferPolicyAdmin(0) cancels a pending handover: the former nominee
    /// loses the claim it never exercised.
    function test_CancelWithZero() public {
        vm.startPrank(policyAdmin);
        core.transferPolicyAdmin(newAdmin);
        vm.expectEmit();
        emit AHandCore.PolicyAdminTransferStarted(policyAdmin, address(0));
        core.transferPolicyAdmin(address(0));
        vm.stopPrank();

        assertEq(core.pendingPolicyAdmin(), address(0));
        vm.prank(newAdmin);
        vm.expectRevert(NotPendingOwner.selector);
        core.acceptPolicyAdmin();
    }

    /*──────────────── policyRevision provenance ────────────────*/

    /// Every policy MUTATION bumps the revision; admin handover does not —
    /// it changes who governs, not what the policy says.
    function test_PolicyRevision_BumpRules() public {
        assertEq(core.policyRevision(), 1, "genesis");

        vm.prank(policyAdmin);
        vm.expectEmit();
        emit AHandCore.TokenPolicyUpdated(address(usd), false, 2);
        core.setTokenEnabled(false);
        assertEq(core.policyRevision(), 2);

        vm.prank(policyAdmin);
        vm.expectEmit();
        emit AHandCore.CharityPolicyUpdated(stranger, true, 3);
        core.setCharityAllowed(stranger, true);
        assertEq(core.policyRevision(), 3);

        vm.prank(policyAdmin);
        core.transferPolicyAdmin(newAdmin);
        assertEq(core.policyRevision(), 3, "transfer start: no bump");
        vm.prank(newAdmin);
        core.acceptPolicyAdmin();
        assertEq(core.policyRevision(), 3, "transfer accept: no bump");
    }

    /// Raised snapshots the revision current at raise time — provenance for
    /// which policy regime admitted the Hand.
    function test_PolicyRevision_SnapshotInRaised() public {
        vm.startPrank(policyAdmin);
        core.setTokenEnabled(false); // 2
        core.setTokenEnabled(true);  // 3
        vm.stopPrank();

        RaiseParams memory p = defaultParams();
        vm.expectEmit();
        emit AHandCore.Raised(
            1, raiser, address(usd), DEPOSIT, USD_SCALE, 3, p.expiry, vm.addr(E0), Visibility.Public,
            p.metadataCommitment, p.discoveryCommitment, DEFAULT_REF, 5_000, charity, 1_000
        );
        makeRaise(p);
    }

    /*──────────────── absent surfaces ────────────────*/

    /// The old protocol's owner/push machinery must not merely be inert — the
    /// selectors must fail at dispatch. No receive, no fallback: any unknown
    /// calldata and any plain value transfer revert.
    function test_AbsentSelectors_FailAtDispatch() public {
        _assertNoDispatch(abi.encodeWithSignature("finalize(uint256)", 1));
        _assertNoDispatch(abi.encodeWithSignature("owner()"));
        _assertNoDispatch(abi.encodeWithSignature("transferOwnership(address)", stranger));
        _assertNoDispatch(abi.encodeWithSignature("setSignals(address)", address(signals)));
        _assertNoDispatch(abi.encodeWithSignature("maintainer()"));
        _assertNoDispatch(abi.encodeWithSignature("withdrawTo(address,address)", address(usd), stranger));
        _assertNoDispatch(abi.encodeWithSignature("pending(address)", stranger));
        _assertNoDispatch(abi.encodeWithSignature("pending(address,address)", address(usd), stranger));
    }

    function test_NoReceiveNoFallback() public {
        vm.deal(address(this), 1 ether);

        (bool ok,) = address(core).call{value: 1}("");
        assertFalse(ok, "no receive()");

        (ok,) = address(core).call(hex"deadbeef");
        assertFalse(ok, "no fallback()");

        (ok,) = address(core).call("");
        assertFalse(ok, "zero-value empty calldata still reverts");
    }

    function _assertNoDispatch(bytes memory callData) internal {
        (bool ok,) = address(core).call(callData);
        assertFalse(ok, "selector must not exist");
    }
}
