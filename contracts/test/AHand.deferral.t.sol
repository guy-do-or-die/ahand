// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {ReturnsFalseToken} from "./mocks/ReturnsFalseToken.sol";
import {NoReturnToken} from "./mocks/NoReturnToken.sol";
import {GasHogToken} from "./mocks/GasHogToken.sol";

interface IMintableToken {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

/*//////////////////////////////////////////////////////////////
        SUITE: deferral — the push-with-pull-fallback path.
        The fixture runs on a BlacklistToken core, so any
        allocation can be forced to defer: shaker margins, giver
        residuals, duplicate shakers, every recipient at once
        (the USDC-pause analog), and withdraw beside live escrow
        and junk. The _tryPush success shape is pinned against
        tokens that return false, return nothing, or out-burn
        the push stipend.
//////////////////////////////////////////////////////////////*/

contract AHandDeferralTest is AHandTestBase {
    BlacklistToken bl;

    function setUp() public override {
        super.setUp();
        bl = new BlacklistToken();
        useRewardToken(bl);
    }

    function claimOf(address a) internal view returns (uint256) {
        return core.claims(address(bl), a);
    }

    /// @dev Default Hand ($100, 10% charity -> distributable 90) routed through
    ///      shakerA (margin 1000 bps -> 9.0) then `second` (margin 500 -> 4.5);
    ///      the giver residual is 76.5. Artifacts are signed up front so event
    ///      expectations can sit right before the thank call.
    function twoMarginRoute(address second, uint256 secondPk)
        internal
        returns (uint256 h, RouteBuild memory r, Give memory g, bytes memory giveSig, bytes memory giverAcc)
    {
        h = makeRaise();
        r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_000);
        addExplicitHop(r, h, E2, second, secondPk, 8_500);
        (g, giveSig) = buildGive(h, r, giver, defaultDeadline());
        giverAcc = signGiverAcceptance(GIVER_PK, g);
    }

    /*──────────────── per-kind deferral ────────────────*/

    /// A blocked shaker margin and a blocked giver residual each defer exactly
    /// their own share; the charity and the other shaker are pushed in the
    /// same transaction, and the deferred shares drain once unblocked.
    function test_Deferral_ShakerMarginAndGiverResidual() public {
        (uint256 h, RouteBuild memory r, Give memory g, bytes memory giveSig, bytes memory giverAcc) =
            twoMarginRoute(shakerB, SHAKER_B_PK);
        bl.setBlocked(shakerA, true);
        bl.setBlocked(giver, true);

        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h, address(bl), charity, 10e6);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(bl), shakerA, 9e6);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h, address(bl), shakerB, 4_500_000);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(bl), giver, 76_500_000);
        doThank(h, r, g, giveSig, giverAcc);

        assertEq(bl.balanceOf(charity), 10e6, "charity pushed");
        assertEq(bl.balanceOf(shakerB), 4_500_000, "unblocked shaker pushed");
        assertEq(bl.balanceOf(shakerA) + bl.balanceOf(giver), 0, "blocked recipients got nothing");
        assertEq(claimOf(shakerA), 9e6, "margin deferred");
        assertEq(claimOf(giver), 76_500_000, "residual deferred");
        assertEq(claimOf(charity) + claimOf(shakerB), 0, "pushed shares never become claims");
        assertEq(bl.balanceOf(address(core)), 85_500_000, "core holds exactly the deferred shares");

        bl.setBlocked(shakerA, false);
        bl.setBlocked(giver, false);
        core.withdraw(address(bl), shakerA);
        core.withdraw(address(bl), giver);
        assertEq(bl.balanceOf(shakerA), 9e6, "margin withdrawn");
        assertEq(bl.balanceOf(giver), 76_500_000, "residual withdrawn");
        assertEq(bl.balanceOf(address(core)), 0, "claims drained");
    }

    /// One blocked shaker on two hops: one PayoutDeferred per occurrence, one
    /// claim holding their sum, one withdraw paying it.
    function test_Deferral_DuplicateShaker_OneClaimPerAddress() public {
        (uint256 h, RouteBuild memory r, Give memory g, bytes memory giveSig, bytes memory giverAcc) =
            twoMarginRoute(shakerA, SHAKER_A_PK);
        bl.setBlocked(shakerA, true);

        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(bl), shakerA, 9e6);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h, address(bl), shakerA, 4_500_000);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutPushed(h, address(bl), giver, 76_500_000);
        doThank(h, r, g, giveSig, giverAcc);

        assertEq(claimOf(shakerA), 13_500_000, "both margins in one claim");
        assertEq(bl.balanceOf(charity) + bl.balanceOf(giver), 86_500_000, "the rest pushed");

        bl.setBlocked(shakerA, false);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutWithdrawn(address(bl), shakerA, 13_500_000);
        core.withdraw(address(bl), shakerA);
        assertEq(bl.balanceOf(shakerA), 13_500_000, "one transfer, full sum");
    }

    /// Every recipient blocked — what a token-wide pause does to a settlement:
    /// nothing is pushed, the Hand still settles, the core balance is exactly
    /// the claims, and Signals still materialize from the committed facts.
    function test_Deferral_EveryRecipientBlocked_StillSettles() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_000);
        bl.setBlocked(charity, true);
        bl.setBlocked(shakerA, true);
        bl.setBlocked(giver, true);

        vm.recordLogs();
        settle(h, r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 pushed;
        uint256 deferred;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(bl)) fail(); // no token moved at all
            if (logs[i].topics[0] == AHandCore.PayoutPushed.selector) ++pushed;
            if (logs[i].topics[0] == AHandCore.PayoutDeferred.selector) ++deferred;
        }
        assertEq(pushed, 0, "nothing pushed");
        assertEq(deferred, 3, "charity, margin and residual deferred");

        assertTrue(core.getHand(h).status == Status.Settled, "settles regardless of delivery");
        assertEq(claimOf(charity), 10e6);
        assertEq(claimOf(shakerA), 9e6);
        assertEq(claimOf(giver), 81e6);
        assertEq(bl.balanceOf(address(core)), uint256(DEPOSIT), "balance == sum of claims");

        address[] memory occShakers = new address[](1);
        occShakers[0] = shakerA;
        uint16[] memory occDeltas = new uint16[](1);
        occDeltas[0] = 1_000;
        signals.materializeThank(h, giver, occShakers, occDeltas);
        assertEq(signals.balanceOf(giver, signals.SIGNAL_GIVEN()), 1, "GIVEN minted");
        assertEq(signals.balanceOf(shakerA, signals.SIGNAL_SHAKEN()), 1, "SHAKEN minted");
    }

    /*──────────────── withdraw beside live escrow ────────────────*/

    /// withdraw pays exactly the claim — never another Hand's Active escrow or
    /// junk sitting in the same balance — and that escrow still backs its own
    /// Hand's refund, deferred and withdrawn in turn.
    function test_Withdraw_PaysExactClaim_BesideActiveEscrowAndJunk() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise(); // stays Active
        bl.setBlocked(charity, true);
        settleSimple(h1); // charity 10 deferred, giver 90 pushed
        bl.mint(address(core), 7e6); // junk
        assertEq(bl.balanceOf(address(core)), uint256(DEPOSIT) + 10e6 + 7e6);

        bl.setBlocked(charity, false);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutWithdrawn(address(bl), charity, 10e6);
        core.withdraw(address(bl), charity);
        assertEq(bl.balanceOf(charity), 10e6, "exactly the claim");
        assertEq(bl.balanceOf(address(core)), uint256(DEPOSIT) + 7e6, "active escrow and junk untouched");

        bl.setBlocked(raiser, true);
        vm.warp(core.getHand(h2).expiry);
        vm.expectEmit(address(core));
        emit AHandCore.PayoutDeferred(h2, address(bl), raiser, DEPOSIT);
        core.reclaim(h2);
        assertEq(claimOf(raiser), DEPOSIT, "refund deferred");

        bl.setBlocked(raiser, false);
        uint256 raiserBefore = bl.balanceOf(raiser);
        core.withdraw(address(bl), raiser);
        assertEq(bl.balanceOf(raiser) - raiserBefore, DEPOSIT, "refund withdrawn");
        assertEq(bl.balanceOf(address(core)), 7e6, "only junk remains");
    }

    /*──────────────── _tryPush success shape ────────────────*/

    /// @dev Core over `token` with one default Hand raised; settleSimpleOn then
    ///      allocates 10 to the charity and 90 to the giver.
    function shapeCore(address token) internal returns (AHandCore c, uint256 h) {
        c = deployCore(token);
        IMintableToken(token).mint(raiser, DEPOSIT);
        vm.prank(raiser);
        IMintableToken(token).approve(address(c), type(uint256).max);
        RaiseParams memory p = defaultParams();
        p.token = token;
        vm.prank(raiser);
        h = c.raise(p, DEFAULT_REF, noTags());
    }

    /// A transfer that returns false without reverting is not a delivery: the
    /// share defers, and withdraw (SafeERC20) refuses the same false return.
    function test_TryPush_FalseReturn_Defers() public {
        ReturnsFalseToken t = new ReturnsFalseToken();
        (AHandCore c, uint256 h) = shapeCore(address(t));
        t.setRefuses(giver, true);

        vm.expectEmit(address(c));
        emit AHandCore.PayoutPushed(h, address(t), charity, 10e6);
        vm.expectEmit(address(c));
        emit AHandCore.PayoutDeferred(h, address(t), giver, 90e6);
        settleSimpleOn(c, h);
        assertEq(c.claims(address(t), giver), 90e6, "false return deferred");
        assertEq(t.balanceOf(giver), 0);

        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(t)));
        c.withdraw(address(t), giver);
        t.setRefuses(giver, false);
        c.withdraw(address(t), giver);
        assertEq(t.balanceOf(giver), 90e6, "claim paid once the token accepts");
    }

    /// A transfer that returns no data (USDT shape) counts as delivered.
    function test_TryPush_NoReturnData_Pushes() public {
        NoReturnToken t = new NoReturnToken();
        (AHandCore c, uint256 h) = shapeCore(address(t));

        vm.expectEmit(address(c));
        emit AHandCore.PayoutPushed(h, address(t), charity, 10e6);
        vm.expectEmit(address(c));
        emit AHandCore.PayoutPushed(h, address(t), giver, 90e6);
        settleSimpleOn(c, h);
        assertEq(t.balanceOf(charity), 10e6);
        assertEq(t.balanceOf(giver), 90e6);
        assertEq(c.claims(address(t), giver), 0, "nothing deferred");
        assertEq(t.balanceOf(address(c)), 0);
    }

    /// A recipient whose transfer costs more than PUSH_GAS_STIPEND defers
    /// without failing the thank; withdraw is not stipend-bound, so the claim
    /// drains even while the recipient stays expensive.
    function test_TryPush_OverStipend_Defers() public {
        GasHogToken t = new GasHogToken();
        (AHandCore c, uint256 h) = shapeCore(address(t));
        assertGt(t.HOG_GAS(), c.PUSH_GAS_STIPEND());
        t.setHog(giver, true);

        vm.expectEmit(address(c));
        emit AHandCore.PayoutPushed(h, address(t), charity, 10e6);
        vm.expectEmit(address(c));
        emit AHandCore.PayoutDeferred(h, address(t), giver, 90e6);
        settleSimpleOn(c, h);
        assertTrue(c.getHand(h).status == Status.Settled);
        assertEq(c.claims(address(t), giver), 90e6, "stipend exhaustion deferred");

        c.withdraw(address(t), giver);
        assertEq(t.balanceOf(giver), 90e6, "withdraw forwards enough gas");
    }
}
