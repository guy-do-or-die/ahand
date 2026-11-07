// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {SenderFeeToken, LateSenderFeeToken, ReceiverFeeToken} from "./mocks/FeeTokens.sol";
import {NoReturnToken} from "./mocks/NoReturnToken.sol";
import {ReturnsFalseToken} from "./mocks/ReturnsFalseToken.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {HookToken} from "./mocks/HookToken.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract CoreTest is Test {
    event Raised(uint256 indexed handId, address indexed raiser, address indexed token, uint256 amount, uint40 expiry);
    event Reclaimed(uint256 indexed handId);

    uint256 constant POT = 100e6;

    AHandCore core;
    MockUSD usd;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint40 expiry;

    function setUp() public {
        core = new AHandCore();
        usd = new MockUSD();
        expiry = uint40(block.timestamp + 30 days);
        _fund(address(usd), alice);
        _fund(address(usd), bob);
    }

    function _fund(address token, address who) internal {
        IMintable(token).mint(who, 1_000_000e6);
        vm.prank(who);
        IMintable(token).approve(address(core), type(uint256).max);
    }

    function _raise(address who, address token, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return core.raise(token, amount, expiry);
    }

    /*//////////////////////////// raise ////////////////////////////*/

    function test_raise_escrowsThePotAndRecordsTheHand() public {
        uint256 before = usd.balanceOf(alice);

        vm.expectEmit(address(core));
        emit Raised(1, alice, address(usd), POT, expiry);
        uint256 id = _raise(alice, address(usd), POT);

        assertEq(id, 1);
        assertEq(core.handsCount(), 1);
        assertEq(usd.balanceOf(address(core)), POT);
        assertEq(usd.balanceOf(alice), before - POT);

        (address raiser, uint40 exp, AHandCore.Status status, address token, uint256 amount) = core.hands(id);
        assertEq(raiser, alice);
        assertEq(exp, expiry);
        assertEq(uint8(status), uint8(AHandCore.Status.Active));
        assertEq(token, address(usd));
        assertEq(amount, POT);
    }

    function test_raise_idsGrowFromOne() public {
        assertEq(_raise(alice, address(usd), POT), 1);
        assertEq(_raise(bob, address(usd), POT), 2);
        assertEq(_raise(alice, address(usd), POT), 3);
    }

    function test_raise_zeroPotIsAllowed() public {
        uint256 id = _raise(alice, address(usd), 0);
        assertEq(usd.balanceOf(address(core)), 0);
        vm.warp(expiry);
        core.reclaim(id);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    function test_raise_rejectsExpiryNotInTheFuture() public {
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), POT, uint40(block.timestamp));
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), POT, uint40(block.timestamp - 1));
        vm.stopPrank();
        assertEq(core.handsCount(), 0);
    }

    function test_raise_acceptsExpiryOneSecondAhead() public {
        vm.prank(alice);
        core.raise(address(usd), POT, uint40(block.timestamp + 1));
        assertEq(core.handsCount(), 1);
    }

    function test_raise_revertsWithoutAllowanceAndLeavesNoHand() public {
        vm.prank(alice);
        usd.approve(address(core), 0);
        vm.prank(alice);
        vm.expectRevert();
        core.raise(address(usd), POT, expiry);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_revertsOnAddressWithoutCode() public {
        vm.prank(alice);
        vm.expectRevert();
        core.raise(makeAddr("not a token"), POT, expiry);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_rejectsSenderSideFee() public {
        SenderFeeToken t = new SenderFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry);
    }

    function test_raise_rejectsReceiverSideFee() public {
        ReceiverFeeToken t = new ReceiverFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry);
    }

    /*//////////////////////////// reclaim ////////////////////////////*/

    function test_reclaim_refundsTheRaiserInFull() public {
        uint256 before = usd.balanceOf(alice);
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(expiry);

        vm.expectEmit(address(core));
        emit Reclaimed(id);
        core.reclaim(id);

        assertEq(usd.balanceOf(alice), before);
        assertEq(usd.balanceOf(address(core)), 0);
        (,, AHandCore.Status status,,) = core.hands(id);
        assertEq(uint8(status), uint8(AHandCore.Status.Reclaimed));
    }

    function test_reclaim_windowOpensExactlyAtExpiry() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(expiry - 1);
        vm.expectRevert(AHandCore.NotExpired.selector);
        core.reclaim(id);
        vm.warp(expiry);
        core.reclaim(id);
    }

    function test_reclaim_anyoneMayCallButOnlyTheRaiserIsPaid() public {
        uint256 id = _raise(alice, address(usd), POT);
        uint256 aliceBefore = usd.balanceOf(alice);
        uint256 bobBefore = usd.balanceOf(bob);
        vm.warp(expiry);

        vm.prank(bob);
        core.reclaim(id);

        assertEq(usd.balanceOf(alice), aliceBefore + POT);
        assertEq(usd.balanceOf(bob), bobBefore);
    }

    function test_reclaim_onlyOnce() public {
        uint256 id = _raise(alice, address(usd), POT);
        _raise(bob, address(usd), POT); // money a second reclaim would steal
        vm.warp(expiry);
        core.reclaim(id);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(id);
        assertEq(usd.balanceOf(address(core)), POT);
    }

    function test_reclaim_unknownHand() public {
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(1);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(0);
    }

    /*//////////////////////////// awkward tokens ////////////////////////////*/

    function test_token_noReturnValueWorks() public {
        NoReturnToken t = new NoReturnToken();
        _fund(address(t), alice);
        uint256 before = t.balanceOf(alice);
        uint256 id = _raise(alice, address(t), POT);
        vm.warp(expiry);
        core.reclaim(id);
        assertEq(t.balanceOf(alice), before);
    }

    /// A `false` return must not count as paid: the Hand stays open and can be retried.
    function test_token_falseReturnOnRefundKeepsTheHandOpen() public {
        ReturnsFalseToken t = new ReturnsFalseToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        t.setRefuses(alice, true);
        vm.warp(expiry);

        vm.expectRevert();
        core.reclaim(id);
        (,, AHandCore.Status status,,) = core.hands(id);
        assertEq(uint8(status), uint8(AHandCore.Status.Active));

        t.setRefuses(alice, false);
        core.reclaim(id);
        assertEq(t.balanceOf(address(core)), 0);
    }

    /// A blocked raiser hurts only their own Hand, and only while blocked.
    function test_token_blockedRaiserDoesNotTouchOtherHands() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 a = _raise(alice, address(t), POT);
        uint256 b = _raise(bob, address(t), POT);
        t.setBlocked(alice, true);
        vm.warp(expiry);

        vm.expectRevert();
        core.reclaim(a);
        core.reclaim(b);
        assertEq(t.balanceOf(address(core)), POT);

        t.setBlocked(alice, false);
        core.reclaim(a);
        assertEq(t.balanceOf(address(core)), 0);
    }

    /// A fee switched on later must not let one refund eat another Hand's escrow.
    function test_token_lateFeeCannotEatAnotherHand() public {
        LateSenderFeeToken t = new LateSenderFeeToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 a = _raise(alice, address(t), POT);
        _raise(bob, address(t), POT);
        t.setFeeOn(true);
        vm.warp(expiry);

        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.reclaim(a);
        assertEq(t.balanceOf(address(core)), 2 * POT);

        t.setFeeOn(false);
        core.reclaim(a);
        assertEq(t.balanceOf(address(core)), POT);
    }

    /// A broken token stays in its own lane: another token's Hands are unaffected.
    function test_token_brokenTokenDoesNotReachOtherTokens() public {
        LateSenderFeeToken bad = new LateSenderFeeToken();
        _fund(address(bad), alice);
        uint256 a = _raise(alice, address(bad), POT);
        uint256 b = _raise(bob, address(usd), POT);
        bad.setFeeOn(true);
        vm.warp(expiry);

        vm.expectRevert(); // the token itself fails: custody cannot cover pot + fee
        core.reclaim(a);
        core.reclaim(b);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /*//////////////////////////// reentrancy ////////////////////////////*/

    /// There is no lock: these two tests are why none is needed yet.
    function test_reentry_reclaimInsideItsOwnRefundPaysOnce() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 id = _raise(alice, address(t), POT);
        _raise(bob, address(t), POT);
        t.setReentry(address(core), abi.encodeCall(core.reclaim, (id)), false, true, false);
        vm.warp(expiry);

        core.reclaim(id);

        assertFalse(t.lastReentryOk());
        assertEq(bytes4(t.lastReentryReturn()), AHandCore.NotActive.selector);
        assertEq(t.balanceOf(address(core)), POT);
    }

    function test_reentry_reclaimInsideRaiseCannotFakeADeposit() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 old = _raise(alice, address(t), POT);
        vm.warp(expiry);
        t.setReentry(address(core), abi.encodeCall(core.reclaim, (old)), true, false, true);

        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry + 1);

        assertEq(core.handsCount(), 1);
        assertEq(t.balanceOf(address(core)), POT);
    }

    /*//////////////////////////// fuzz ////////////////////////////*/

    function testFuzz_raiseThenReclaimReturnsExactlyThePot(uint256 amount, uint40 ahead, uint40 late) public {
        amount = bound(amount, 0, type(uint256).max - usd.totalSupply());
        uint40 e = uint40(block.timestamp + bound(ahead, 1, 3650 days));
        usd.mint(alice, amount);
        uint256 before = usd.balanceOf(alice);

        vm.prank(alice);
        uint256 id = core.raise(address(usd), amount, e);
        assertEq(usd.balanceOf(address(core)), amount);

        vm.warp(uint256(e) + bound(late, 0, 3650 days));
        core.reclaim(id);
        assertEq(usd.balanceOf(alice), before);
        assertEq(usd.balanceOf(address(core)), 0);
    }
}
