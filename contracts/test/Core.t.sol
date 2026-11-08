// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {SenderFeeToken, LateSenderFeeToken, ReceiverFeeToken} from "./mocks/FeeTokens.sol";
import {NoReturnToken} from "./mocks/NoReturnToken.sol";
import {ReturnsFalseToken} from "./mocks/ReturnsFalseToken.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {HookToken, IHookRecipient} from "./mocks/HookToken.sol";
import {ReturndataBombToken} from "./mocks/ReturndataBombToken.sol";
import {giveDigest} from "./Give.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TwoInARow {
    function go(AHandCore core, MockUSD token, uint256 amount, uint40 expiry) external {
        token.approve(address(core), 2 * amount);
        core.raise(address(token), amount, expiry, 200, bytes32(0));
        core.raise(address(token), amount, expiry, 200, bytes32(0));
    }
}

/// Code put on a giver's address: refuses to be paid once switched on.
contract Refuser is IHookRecipient {
    function onTokenReceived(address, uint256) external pure {
        revert("PAY ME");
    }
}

/// Code put on a giver's address: burns all the gas it is handed and never returns.
contract Burner is IHookRecipient {
    function onTokenReceived(address, uint256) external pure {
        while (true) {}
    }
}

/// Code put on a giver's address: does 150 000 gas of work, then accepts the money.
contract Heavy is IHookRecipient {
    function onTokenReceived(address, uint256) external view {
        uint256 start = gasleft();
        while (start - gasleft() < 150_000) {}
    }
}

contract CoreTest is Test {
    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint256 amount,
        uint40 expiry,
        uint16 payoutGasK,
        bytes32 dataHash
    );
    event Reclaimed(uint256 indexed handId);
    event Thanked(uint256 indexed handId, address indexed giver, bytes32 dataHash);
    event Paid(address indexed token, address indexed payee, uint256 amount);
    event Pending(address indexed token, address indexed payee, uint256 amount);
    event Withdrawn(address indexed token, address indexed payee, address to, uint256 amount);

    uint256 constant POT = 100e6;
    bytes32 constant ANSWER = keccak256("the salted answer");
    bytes32 constant ASK = keccak256("what the raiser asks for");
    uint16 constant GAS_K = 200; // payout gas, thousands

    AHandCore core;
    MockUSD usd;
    address alice;
    address bob;
    address carol;
    uint256 aliceKey;
    uint256 bobKey;
    uint256 carolKey;
    uint40 expiry;

    function setUp() public {
        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        (carol, carolKey) = makeAddrAndKey("carol");
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
        return core.raise(token, amount, expiry, GAS_K, ASK);
    }

    function _sign(address to, uint256 key, uint256 handId, bytes32 dataHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(key, giveDigest(to, handId, dataHash));
        return abi.encodePacked(r, sv, v);
    }

    function _sig(uint256 handId, uint256 key) internal view returns (bytes memory) {
        return _sign(address(core), key, handId, ANSWER);
    }

    function _times(uint256 id) internal view returns (uint40 thankedAt, uint40 reclaimedAt) {
        (,,,,, thankedAt, reclaimedAt,,) = core.hands(id);
    }

    function _assertOpen(uint256 id) internal view {
        (uint40 thankedAt, uint40 reclaimedAt) = _times(id);
        assertEq(thankedAt, 0);
        assertEq(reclaimedAt, 0);
    }

    function _assertThankedNow(uint256 id) internal view {
        (uint40 thankedAt, uint40 reclaimedAt) = _times(id);
        assertEq(thankedAt, block.timestamp);
        assertEq(reclaimedAt, 0);
    }

    function _assertReclaimedNow(uint256 id) internal view {
        (uint40 thankedAt, uint40 reclaimedAt) = _times(id);
        assertEq(thankedAt, 0);
        assertEq(reclaimedAt, block.timestamp);
    }

    /*//////////////////////////// raise ////////////////////////////*/

    function test_raise_escrowsThePotAndRecordsTheHand() public {
        uint256 before = usd.balanceOf(alice);

        vm.expectEmit(address(core));
        emit Raised(1, alice, address(usd), POT, expiry, GAS_K, ASK);
        uint256 id = _raise(alice, address(usd), POT);

        assertEq(id, 1);
        assertEq(core.handsCount(), 1);
        assertEq(usd.balanceOf(address(core)), POT);
        assertEq(usd.balanceOf(alice), before - POT);

        (address raiser, uint40 exp, uint40 raisedAt, address token, uint16 gasK,,, uint256 amount, bytes32 dataHash) =
            core.hands(id);
        assertEq(raiser, alice);
        assertEq(exp, expiry);
        assertEq(raisedAt, block.timestamp);
        _assertOpen(id);
        assertEq(gasK, GAS_K);
        assertEq(token, address(usd));
        assertEq(amount, POT);
        assertEq(dataHash, ASK);
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

    /// Core does not judge the hash: an empty one is the raiser's and the application's business.
    function test_raise_zeroDataHashIsAllowed() public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), POT, expiry, GAS_K, bytes32(0));
        (,,,,,,,, bytes32 dataHash) = core.hands(id);
        assertEq(dataHash, bytes32(0));
    }

    /// The hash outlives the Hand, so it can still be read once the Hand is closed.
    function test_raise_dataHashStaysAfterTheHandCloses() public {
        uint256 thanked = _raise(alice, address(usd), POT);
        uint256 reclaimed = _raise(alice, address(usd), POT);
        vm.prank(alice);
        core.thank(thanked, carol, ANSWER, _sig(thanked, carolKey));
        vm.warp(expiry);
        core.reclaim(reclaimed);

        (,,,,,,,, bytes32 afterThank) = core.hands(thanked);
        (,,,,,,,, bytes32 afterReclaim) = core.hands(reclaimed);
        assertEq(afterThank, ASK);
        assertEq(afterReclaim, ASK);
    }

    function test_raise_rejectsExpiryNotInTheFuture() public {
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), POT, uint40(block.timestamp), GAS_K, ASK);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), POT, uint40(block.timestamp - 1), GAS_K, ASK);
        vm.stopPrank();
        assertEq(core.handsCount(), 0);
    }

    function test_raise_acceptsExpiryOneSecondAhead() public {
        vm.prank(alice);
        core.raise(address(usd), POT, uint40(block.timestamp + 1), GAS_K, ASK);
        assertEq(core.handsCount(), 1);
    }

    function test_raise_revertsWithoutAllowanceAndLeavesNoHand() public {
        vm.prank(alice);
        usd.approve(address(core), 0);
        vm.prank(alice);
        vm.expectRevert();
        core.raise(address(usd), POT, expiry, GAS_K, ASK);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_revertsOnAddressWithoutCode() public {
        vm.prank(alice);
        vm.expectRevert();
        core.raise(makeAddr("not a token"), POT, expiry, GAS_K, ASK);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_rejectsSenderSideFee() public {
        SenderFeeToken t = new SenderFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry, GAS_K, ASK);
    }

    function test_raise_rejectsReceiverSideFee() public {
        ReceiverFeeToken t = new ReceiverFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry, GAS_K, ASK);
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
        _assertReclaimedNow(id);
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

    /// The moment of reclaim is recorded, not the expiry it waited for.
    function test_reclaim_recordsItsOwnMoment() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(uint256(expiry) + 3 days);
        core.reclaim(id);
        _assertReclaimedNow(id);
    }

    /// An id never raised has no times at all and cannot be reclaimed.
    function test_unknownHand_hasNoRaisedAt() public {
        (address raiser,, uint40 raisedAt,,,,,,) = core.hands(42);
        assertEq(raiser, address(0));
        assertEq(raisedAt, 0);
        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(42);
    }

    /*//////////////////////////// thank ////////////////////////////*/

    function test_thank_paysTheWholePotToTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);

        vm.expectEmit(address(core));
        emit Thanked(id, carol, ANSWER);
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));

        assertEq(usd.balanceOf(carol), POT);
        assertEq(usd.balanceOf(address(core)), 0);
        _assertThankedNow(id);
    }

    /// The time of thank is written once and stays.
    function test_thank_timeIsWrittenOnce() public {
        uint256 id = _raise(alice, address(usd), POT);
        uint256 at = block.timestamp + 1 hours;
        vm.warp(at);
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        vm.warp(uint256(expiry) + 1);
        (uint40 thankedAt, uint40 reclaimedAt) = _times(id);
        assertEq(thankedAt, at);
        assertEq(reclaimedAt, 0);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(id);
    }

    function test_thank_onlyTheRaiser() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(carol);
        vm.expectRevert(AHandCore.NotRaiser.selector);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
    }

    function test_thank_windowClosesExactlyAtExpiry() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(expiry);
        vm.prank(alice);
        vm.expectRevert(AHandCore.Expired.selector);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
    }

    function test_thank_worksOneSecondBeforeExpiry() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(expiry - 1);
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        assertEq(usd.balanceOf(carol), POT);
    }

    function test_thank_onlyOnce() public {
        uint256 id = _raise(alice, address(usd), POT);
        _raise(bob, address(usd), POT); // money a second thank would steal
        vm.startPrank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        vm.expectRevert(AHandCore.NotActive.selector);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        vm.stopPrank();
        assertEq(usd.balanceOf(address(core)), POT);
    }

    function test_thank_unknownHand() public {
        vm.expectRevert(AHandCore.NotActive.selector);
        core.thank(1, carol, ANSWER, _sig(1, carolKey));
    }

    function test_thank_closesReclaim() public {
        uint256 id = _raise(alice, address(usd), POT);
        _raise(bob, address(usd), POT);
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        vm.warp(expiry);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(id);
    }

    /// Nobody helps themselves: the pot leaves only to someone else, or back by reclaim.
    function test_thank_raiserCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.GiverIsRaiser.selector);
        core.thank(id, alice, ANSWER, _sig(id, aliceKey));
        _assertOpen(id);
    }

    function test_thank_zeroPot() public {
        uint256 id = _raise(alice, address(usd), 0);
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        _assertThankedNow(id);
    }

    /// Core has no key, so it can never sign a Give.
    function test_thank_coreCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, address(core), ANSWER, _sig(id, carolKey));
    }

    /// A giver who cannot be paid now loses nothing: the Hand closes and the share stays pending for her.
    function test_thank_blockedGiverShareStaysPending() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        t.setBlocked(carol, true);

        vm.expectEmit(address(core));
        emit Pending(address(t), carol, POT);
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));

        _assertThankedNow(id);
        assertEq(core.pending(address(t), carol), POT);
        assertEq(t.balanceOf(address(core)), POT);
    }

    function test_thank_lateFeeCannotEatAnotherHand() public {
        LateSenderFeeToken t = new LateSenderFeeToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 a = _raise(alice, address(t), POT);
        _raise(bob, address(t), POT);
        t.setFeeOn(true);

        vm.prank(alice);
        core.thank(a, carol, ANSWER, _sig(a, carolKey));
        assertEq(core.pending(address(t), carol), POT);
        assertEq(t.balanceOf(address(core)), 2 * POT);
    }

    /*//////////////////////////// give ////////////////////////////*/

    /// The raiser cannot name a giver who did not sign.
    function test_give_signatureOfSomeoneElse() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, carol, ANSWER, _sig(id, bobKey));
    }

    function test_give_cannotBeMovedToAnotherHand() public {
        uint256 first = _raise(alice, address(usd), POT);
        uint256 second = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(second, carol, ANSWER, _sig(first, carolKey));
    }

    function test_give_coversTheData() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, carol, keccak256("another answer"), _sig(id, carolKey));
    }

    function test_give_cannotBeMovedToAnotherCore() public {
        uint256 id = _raise(alice, address(usd), POT);
        bytes memory foreign = _sign(makeAddr("another core"), carolKey, id, ANSWER);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, carol, ANSWER, foreign);
    }

    /// After a fork the old chain id no longer signs anything here.
    function test_give_cannotBeMovedToAnotherChain() public {
        uint256 id = _raise(alice, address(usd), POT);
        bytes memory old = _sig(id, carolKey);
        vm.chainId(block.chainid + 1);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, carol, ANSWER, old);
    }

    /// Nobody holds the zero address key: junk that recovers to zero must not pass for it.
    function test_give_zeroAddressCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.startPrank(alice);
        vm.expectRevert();
        core.thank(id, address(0), ANSWER, new bytes(65));
        vm.expectRevert();
        core.thank(id, address(0), ANSWER, "");
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, address(0), ANSWER, _sig(id, carolKey));
        vm.stopPrank();
        assertEq(usd.balanceOf(address(core)), POT);
    }

    function test_give_malformedSignature() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.startPrank(alice);
        vm.expectRevert();
        core.thank(id, carol, ANSWER, hex"1234");
        vm.stopPrank();
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

    /// A `false` return must not count as paid: the refund stays pending, not lost.
    function test_token_falseReturnLeavesRefundPending() public {
        ReturnsFalseToken t = new ReturnsFalseToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        t.setRefuses(alice, true);
        vm.warp(expiry);

        core.reclaim(id);
        _assertReclaimedNow(id);
        assertEq(core.pending(address(t), alice), POT);

        t.setRefuses(alice, false);
        core.withdraw(address(t), alice, alice);
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

        core.reclaim(a);
        core.reclaim(b);
        assertEq(core.pending(address(t), alice), POT);
        assertEq(t.balanceOf(address(core)), POT);

        t.setBlocked(alice, false);
        core.withdraw(address(t), alice, alice);
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

        core.reclaim(a);
        assertEq(core.pending(address(t), alice), POT);
        assertEq(t.balanceOf(address(core)), 2 * POT);

        vm.expectRevert(AHandCore.InexactTransfer.selector); // what is pending waits too
        core.withdraw(address(t), alice, alice);

        t.setFeeOn(false);
        core.withdraw(address(t), alice, alice);
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

        core.reclaim(a); // the token itself fails: the refund stays pending
        core.reclaim(b);
        assertEq(core.pending(address(bad), alice), POT);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /*//////////////////////////// payouts ////////////////////////////*/

    function test_payout_emitsPaid() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.expectEmit(address(core));
        emit Paid(address(usd), carol, POT);
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        assertEq(core.pending(address(usd), carol), 0);
    }

    /// A payee whose code refuses the money has it pending; the Hand still closes.
    function test_payout_refusedPaymentStaysPending() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        vm.etch(carol, type(Refuser).runtimeCode); // a smart account that misbehaves; carol's key still signs
        t.setHooked(carol, true);
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        assertEq(core.pending(address(t), carol), POT);
    }

    /// A payee that burns all the gas it is handed costs the thank no more than the Hand's
    /// payout gas: the thank still fits in 400 000 gas, and the share stays pending. (Checked by
    /// outcome: Foundry miscounts gas measured around a call that asks for more than is left.)
    function test_payout_gasBurnerIsCapped() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        vm.etch(carol, type(Burner).runtimeCode);
        t.setHooked(carol, true);
        bytes memory sig = _sig(id, carolKey);
        vm.prank(alice);
        core.thank{gas: 400_000}(id, carol, ANSWER, sig);
        assertEq(core.pending(address(t), carol), POT);
    }

    /// A token answering with a megabyte cannot make the thank fail.
    function test_payout_returndataBombLeavesPaymentPending() public {
        ReturndataBombToken t = new ReturndataBombToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        bytes memory sig = _sig(id, carolKey);
        vm.prank(alice);
        core.thank{gas: 2_000_000}(id, carol, ANSWER, sig);
        assertEq(core.pending(address(t), carol), POT);
    }

    /// The payout gas is the raiser's choice per Hand, for the payment and the refund
    /// alike: too little leaves the share pending.
    function test_payout_gasIsSetPerHand() public {
        vm.startPrank(alice);
        uint256 a = core.raise(address(usd), POT, expiry, 1, ASK); // 1 000 gas cannot move a token
        uint256 b = core.raise(address(usd), POT, expiry, 1, ASK);
        core.thank(a, carol, ANSWER, _sig(a, carolKey));
        vm.stopPrank();
        assertEq(core.pending(address(usd), carol), POT);
        vm.warp(expiry);
        core.reclaim(b);
        assertEq(core.pending(address(usd), alice), POT);

        core.withdraw(address(usd), carol, carol);
        assertEq(usd.balanceOf(carol), POT);
    }

    /// The limit is counted in thousands of gas: a payee needing 150 000 is left pending
    /// under a 100 000 limit and paid under a 300 000 one.
    function test_payout_gasLimitIsInThousands() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        vm.etch(carol, type(Heavy).runtimeCode);
        t.setHooked(carol, true);
        vm.startPrank(alice);
        uint256 low = core.raise(address(t), POT, expiry, 100, ASK);
        uint256 high = core.raise(address(t), POT, expiry, 300, ASK);
        core.thank(low, carol, ANSWER, _sig(low, carolKey));
        core.thank(high, carol, ANSWER, _sig(high, carolKey));
        vm.stopPrank();
        assertEq(core.pending(address(t), carol), POT);
        assertEq(t.balanceOf(carol), POT);
    }

    /// Picking the transaction gas cannot leave an honest payout of an ordinary token pending:
    /// it reverts or pays. The refund matters most, because anyone may call `reclaim`.
    function test_payout_underGassingPaysOrReverts() public {
        uint256 id = _raise(alice, address(usd), POT);
        bytes memory sig = _sig(id, carolKey);
        uint256 paid;
        uint256 reverted;
        uint256 snap = vm.snapshotState();
        for (uint256 g = 20_000; g < 300_000; g += 100) {
            vm.prank(alice);
            try core.thank{gas: g}(id, carol, ANSWER, sig) {
                assertEq(core.pending(address(usd), carol), 0);
                assertEq(usd.balanceOf(carol), POT);
                paid++;
            } catch {
                reverted++;
            }
            vm.revertToState(snap);
        }

        vm.warp(expiry);
        snap = vm.snapshotState();
        uint256 before = usd.balanceOf(alice);
        for (uint256 g = 20_000; g < 300_000; g += 100) {
            vm.prank(bob);
            try core.reclaim{gas: g}(id) {
                assertEq(core.pending(address(usd), alice), 0);
                assertEq(usd.balanceOf(alice), before + POT);
                paid++;
            } catch {
                reverted++;
            }
            vm.revertToState(snap);
        }
        assertGt(paid, 0); // both outcomes were reached, so the sweep crossed the edge
        assertGt(reverted, 0);
    }

    /// What is pending for one payee in one token adds up and leaves in one withdrawal.
    function test_payout_pendingAddsUp() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        uint256 a = _raise(alice, address(t), POT);
        uint256 b = _raise(alice, address(t), 2 * POT);
        t.setBlocked(carol, true);
        vm.startPrank(alice);
        core.thank(a, carol, ANSWER, _sig(a, carolKey));
        core.thank(b, carol, ANSWER, _sig(b, carolKey));
        vm.stopPrank();
        assertEq(core.pending(address(t), carol), 3 * POT);

        t.setBlocked(carol, false);
        core.withdraw(address(t), carol, carol);
        assertEq(t.balanceOf(carol), 3 * POT);
    }

    function test_pay_onlyFromCoreItself() public {
        vm.expectRevert(AHandCore.NotCore.selector);
        core.pay(address(usd), carol, 1);
    }

    /*//////////////////////////// withdraw ////////////////////////////*/

    function _leavePending(address payee) internal returns (BlacklistToken t) {
        t = new BlacklistToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        t.setBlocked(payee, true);
        uint256 key = payee == carol ? carolKey : bobKey;
        vm.prank(alice);
        core.thank(id, payee, ANSWER, _sig(id, key));
    }

    /// Anyone may send what is pending to its own payee.
    function test_withdraw_anyoneSendsToThePayee() public {
        BlacklistToken t = _leavePending(carol);
        t.setBlocked(carol, false);
        vm.expectEmit(address(core));
        emit Withdrawn(address(t), carol, carol, POT);
        vm.prank(bob);
        core.withdraw(address(t), carol, carol);
        assertEq(t.balanceOf(carol), POT);
        assertEq(core.pending(address(t), carol), 0);
    }

    /// Only the payee may send what is pending somewhere else — even while its own address is blocked.
    function test_withdraw_onlyThePayeeRedirects() public {
        BlacklistToken t = _leavePending(carol);
        address fresh = makeAddr("carol second address");
        vm.prank(bob);
        vm.expectRevert(AHandCore.NotPayee.selector);
        core.withdraw(address(t), carol, bob);

        vm.expectEmit(address(core));
        emit Withdrawn(address(t), carol, fresh, POT);
        vm.prank(carol);
        core.withdraw(address(t), carol, fresh);
        assertEq(t.balanceOf(fresh), POT);
        assertEq(core.pending(address(t), carol), 0);
    }

    /// What is cleared is the payee's pending amount, never the destination's (the bug Across shipped).
    function test_withdraw_clearsThePayeeNotTheDestination() public {
        BlacklistToken t = _leavePending(carol);
        uint256 other = _raise(alice, address(t), POT);
        t.setBlocked(bob, true);
        vm.prank(alice);
        core.thank(other, bob, ANSWER, _sig(other, bobKey));
        assertEq(core.pending(address(t), bob), POT);

        t.setBlocked(bob, false);
        vm.prank(carol);
        core.withdraw(address(t), carol, bob); // carol sends hers to bob, who has some pending too
        assertEq(t.balanceOf(bob), POT);
        assertEq(core.pending(address(t), carol), 0);
        assertEq(core.pending(address(t), bob), POT);
    }

    function test_withdraw_nothingPending() public {
        vm.expectRevert(AHandCore.NothingPending.selector);
        core.withdraw(address(usd), carol, carol);
    }

    function test_withdraw_onlyOnce() public {
        BlacklistToken t = _leavePending(carol);
        t.setBlocked(carol, false);
        core.withdraw(address(t), carol, carol);
        vm.expectRevert(AHandCore.NothingPending.selector);
        core.withdraw(address(t), carol, carol);
    }

    /// A failed withdraw keeps it pending.
    function test_withdraw_failureKeepsItPending() public {
        BlacklistToken t = _leavePending(carol);
        vm.expectRevert();
        core.withdraw(address(t), carol, carol); // still blocked
        assertEq(core.pending(address(t), carol), POT);
    }

    /// Nothing re-enters Core while a pending amount is paid out — not even a withdraw that would
    /// succeed on its own.
    function test_withdraw_reentryBlocked() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 a = _raise(alice, address(t), POT);
        uint256 b = _raise(alice, address(t), POT);
        vm.etch(carol, type(Refuser).runtimeCode); // both refuse once, so both have some pending
        vm.etch(bob, type(Refuser).runtimeCode);
        t.setHooked(carol, true);
        t.setHooked(bob, true);
        vm.startPrank(alice);
        core.thank(a, carol, ANSWER, _sig(a, carolKey));
        core.thank(b, bob, ANSWER, _sig(b, bobKey));
        vm.stopPrank();
        t.setHooked(carol, false);
        t.setHooked(bob, false);
        t.setReentry(address(core), abi.encodeCall(core.withdraw, (address(t), bob, bob)), false, true, false);

        core.withdraw(address(t), carol, carol);

        assertFalse(t.lastReentryOk());
        assertEq(bytes4(t.lastReentryReturn()), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(t.balanceOf(carol), POT);
        assertEq(core.pending(address(t), bob), POT);
        assertEq(t.balanceOf(address(core)), POT);
    }

    /*//////////////////////////// zero ////////////////////////////*/

    /// A Hand without a reward never touches a token, so any token address will do;
    /// closing it pays nothing and leaves nothing pending: no Paid, no Pending.
    function test_zeroPot_touchesNoToken() public {
        vm.prank(alice);
        uint256 a = core.raise(address(0), 0, expiry, GAS_K, ASK);
        vm.recordLogs();
        vm.prank(alice);
        core.thank(a, carol, ANSWER, _sig(a, carolKey));
        assertEq(vm.getRecordedLogs().length, 1); // Thanked only

        vm.prank(alice);
        uint256 b = core.raise(address(0xdead), 0, expiry, GAS_K, ASK);
        vm.warp(expiry);
        vm.recordLogs();
        core.reclaim(b);
        assertEq(vm.getRecordedLogs().length, 1); // Reclaimed only
        _assertReclaimedNow(b);
    }

    /*//////////////////////////// reentrancy ////////////////////////////*/

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
        assertEq(bytes4(t.lastReentryReturn()), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(t.balanceOf(address(core)), POT);
    }

    function test_reentry_reclaimInsideRaiseCannotFakeADeposit() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 old = _raise(alice, address(t), POT);
        vm.warp(expiry);
        t.setReentry(address(core), abi.encodeCall(core.reclaim, (old)), true, false, true);

        vm.prank(alice);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        core.raise(address(t), POT, expiry + 1, GAS_K, ASK);

        assertEq(core.handsCount(), 1);
        assertEq(t.balanceOf(address(core)), POT);
    }

    /// The token is its own raiser here, so it can re-enter `thank` with full authority.
    function test_reentry_thankInsideItsOwnPaymentPaysOnce() public {
        HookToken t = new HookToken();
        _fund(address(t), bob);
        t.mint(address(t), POT);
        vm.prank(address(t));
        t.approve(address(core), POT);
        uint256 id = _raise(address(t), address(t), POT);
        _raise(bob, address(t), POT);
        t.setReentry(
            address(core), abi.encodeCall(core.thank, (id, carol, ANSWER, _sig(id, carolKey))), false, true, false
        );

        vm.prank(address(t));
        core.thank(id, carol, ANSWER, _sig(id, carolKey));

        assertFalse(t.lastReentryOk());
        assertEq(bytes4(t.lastReentryReturn()), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(t.balanceOf(carol), POT);
        assertEq(t.balanceOf(address(core)), POT);
    }

    /// A Hand cannot be paid out while its own deposit is still in flight.
    function test_reentry_thankInsideRaiseReverts() public {
        HookToken t = new HookToken();
        _fund(address(t), bob);
        _raise(bob, address(t), POT); // another Hand's pot the payout would borrow from
        t.mint(address(t), POT);
        vm.prank(address(t));
        t.approve(address(core), POT);
        uint256 next = core.handsCount() + 1;
        t.setReentry(
            address(core), abi.encodeCall(core.thank, (next, carol, ANSWER, _sig(next, carolKey))), true, false, true
        );

        vm.prank(address(t));
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        core.raise(address(t), POT, expiry, GAS_K, ASK);

        assertEq(t.balanceOf(carol), 0);
        assertEq(t.balanceOf(address(core)), POT);
        assertEq(core.handsCount(), 1);
    }

    /// The lock stops nesting, not sequence: a contract raiser may call Core many times in a row.
    function test_reentry_lockAllowsCallsInARow() public {
        TwoInARow raiser = new TwoInARow();
        usd.mint(address(raiser), 2 * POT);
        raiser.go(core, usd, POT, expiry);
        assertEq(core.handsCount(), 2);
        assertEq(usd.balanceOf(address(core)), 2 * POT);
    }

    /*//////////////////////////// fuzz ////////////////////////////*/

    function testFuzz_raiseThenReclaimReturnsExactlyThePot(uint256 amount, uint40 ahead, uint40 late) public {
        amount = bound(amount, 0, type(uint256).max - usd.totalSupply());
        uint40 e = uint40(block.timestamp + bound(ahead, 1, 3650 days));
        usd.mint(alice, amount);
        uint256 before = usd.balanceOf(alice);

        vm.prank(alice);
        uint256 id = core.raise(address(usd), amount, e, GAS_K, ASK);
        assertEq(usd.balanceOf(address(core)), amount);

        vm.warp(uint256(e) + bound(late, 0, 3650 days));
        core.reclaim(id);
        assertEq(usd.balanceOf(alice), before);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    function testFuzz_thankPaysExactlyThePot(uint256 amount, uint40 ahead, uint40 at) public {
        amount = bound(amount, 0, type(uint256).max - usd.totalSupply());
        uint256 span = bound(ahead, 1, 3650 days);
        uint40 e = uint40(block.timestamp + span);
        usd.mint(alice, amount);

        vm.prank(alice);
        uint256 id = core.raise(address(usd), amount, e, GAS_K, ASK);

        vm.warp(block.timestamp + bound(at, 0, span - 1));
        vm.prank(alice);
        core.thank(id, carol, ANSWER, _sig(id, carolKey));
        assertEq(usd.balanceOf(carol), amount);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    function testFuzz_raiseKeepsAnyDataHash(bytes32 dataHash) public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), POT, expiry, GAS_K, dataHash);
        (,,,,,,,, bytes32 stored) = core.hands(id);
        assertEq(stored, dataHash);
    }

    function testFuzz_giveFromAnyKeyForAnyData(uint256 key, bytes32 data) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        address giver = vm.addr(key);
        vm.assume(giver != alice && giver != address(core));
        uint256 id = _raise(alice, address(usd), POT);
        uint256 before = usd.balanceOf(giver);

        vm.prank(alice);
        core.thank(id, giver, data, _sign(address(core), key, id, data));
        assertEq(usd.balanceOf(giver), before + POT);
    }

    function testFuzz_giveRejectsAnyOtherSigner(uint256 key, address claimed) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(claimed != vm.addr(key) && claimed != alice);
        uint256 id = _raise(alice, address(usd), POT);

        bytes memory sig = _sign(address(core), key, id, ANSWER);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, claimed, ANSWER, sig);
    }
}
