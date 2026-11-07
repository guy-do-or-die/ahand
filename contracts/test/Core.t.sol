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
import {HookToken} from "./mocks/HookToken.sol";
import {giveDigest} from "./Give.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TwoInARow {
    function go(AHandCore core, MockUSD token, uint256 amount, uint40 expiry) external {
        token.approve(address(core), 2 * amount);
        core.raise(address(token), amount, expiry, bytes32(0));
        core.raise(address(token), amount, expiry, bytes32(0));
    }
}

contract CoreTest is Test {
    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint256 amount,
        uint40 expiry,
        bytes32 metadataHash
    );
    event Reclaimed(uint256 indexed handId);
    event Thanked(uint256 indexed handId, address indexed giver, bytes32 solutionHash);

    uint256 constant POT = 100e6;
    bytes32 constant SOLUTION = keccak256("the salted solution");
    bytes32 constant METADATA = keccak256("what the raiser asks for");

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
        return core.raise(token, amount, expiry, METADATA);
    }

    function _sign(address to, uint256 key, uint256 handId, bytes32 solutionHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(key, giveDigest(to, handId, solutionHash));
        return abi.encodePacked(r, sv, v);
    }

    function _sig(uint256 handId, uint256 key) internal view returns (bytes memory) {
        return _sign(address(core), key, handId, SOLUTION);
    }

    /*//////////////////////////// raise ////////////////////////////*/

    function test_raise_escrowsThePotAndRecordsTheHand() public {
        uint256 before = usd.balanceOf(alice);

        vm.expectEmit(address(core));
        emit Raised(1, alice, address(usd), POT, expiry, METADATA);
        uint256 id = _raise(alice, address(usd), POT);

        assertEq(id, 1);
        assertEq(core.handsCount(), 1);
        assertEq(usd.balanceOf(address(core)), POT);
        assertEq(usd.balanceOf(alice), before - POT);

        (address raiser, uint40 exp, AHandCore.Status status, address token, uint256 amount, bytes32 metadataHash) =
            core.hands(id);
        assertEq(raiser, alice);
        assertEq(exp, expiry);
        assertEq(uint8(status), uint8(AHandCore.Status.Active));
        assertEq(token, address(usd));
        assertEq(amount, POT);
        assertEq(metadataHash, METADATA);
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
    function test_raise_zeroMetadataIsAllowed() public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), POT, expiry, bytes32(0));
        (,,,,, bytes32 metadataHash) = core.hands(id);
        assertEq(metadataHash, bytes32(0));
    }

    /// The hash outlives the Hand, so it can still be read once the Hand is closed.
    function test_raise_metadataStaysAfterTheHandCloses() public {
        uint256 thanked = _raise(alice, address(usd), POT);
        uint256 reclaimed = _raise(alice, address(usd), POT);
        vm.prank(alice);
        core.thank(thanked, carol, SOLUTION, _sig(thanked, carolKey));
        vm.warp(expiry);
        core.reclaim(reclaimed);

        (,,,,, bytes32 afterThank) = core.hands(thanked);
        (,,,,, bytes32 afterReclaim) = core.hands(reclaimed);
        assertEq(afterThank, METADATA);
        assertEq(afterReclaim, METADATA);
    }

    function test_raise_rejectsExpiryNotInTheFuture() public {
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), POT, uint40(block.timestamp), METADATA);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), POT, uint40(block.timestamp - 1), METADATA);
        vm.stopPrank();
        assertEq(core.handsCount(), 0);
    }

    function test_raise_acceptsExpiryOneSecondAhead() public {
        vm.prank(alice);
        core.raise(address(usd), POT, uint40(block.timestamp + 1), METADATA);
        assertEq(core.handsCount(), 1);
    }

    function test_raise_revertsWithoutAllowanceAndLeavesNoHand() public {
        vm.prank(alice);
        usd.approve(address(core), 0);
        vm.prank(alice);
        vm.expectRevert();
        core.raise(address(usd), POT, expiry, METADATA);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_revertsOnAddressWithoutCode() public {
        vm.prank(alice);
        vm.expectRevert();
        core.raise(makeAddr("not a token"), POT, expiry, METADATA);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_rejectsSenderSideFee() public {
        SenderFeeToken t = new SenderFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry, METADATA);
    }

    function test_raise_rejectsReceiverSideFee() public {
        ReceiverFeeToken t = new ReceiverFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry, METADATA);
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
        (,, AHandCore.Status status,,,) = core.hands(id);
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

    /*//////////////////////////// thank ////////////////////////////*/

    function test_thank_paysTheWholePotToTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);

        vm.expectEmit(address(core));
        emit Thanked(id, carol, SOLUTION);
        vm.prank(alice);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));

        assertEq(usd.balanceOf(carol), POT);
        assertEq(usd.balanceOf(address(core)), 0);
        (,, AHandCore.Status status,,,) = core.hands(id);
        assertEq(uint8(status), uint8(AHandCore.Status.Thanked));
    }

    function test_thank_onlyTheRaiser() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(carol);
        vm.expectRevert(AHandCore.NotRaiser.selector);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
    }

    function test_thank_windowClosesExactlyAtExpiry() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(expiry);
        vm.prank(alice);
        vm.expectRevert(AHandCore.Expired.selector);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
    }

    function test_thank_worksOneSecondBeforeExpiry() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(expiry - 1);
        vm.prank(alice);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
        assertEq(usd.balanceOf(carol), POT);
    }

    function test_thank_onlyOnce() public {
        uint256 id = _raise(alice, address(usd), POT);
        _raise(bob, address(usd), POT); // money a second thank would steal
        vm.startPrank(alice);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
        vm.expectRevert(AHandCore.NotActive.selector);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
        vm.stopPrank();
        assertEq(usd.balanceOf(address(core)), POT);
    }

    function test_thank_unknownHand() public {
        vm.expectRevert(AHandCore.NotActive.selector);
        core.thank(1, carol, SOLUTION, _sig(1, carolKey));
    }

    function test_thank_closesReclaim() public {
        uint256 id = _raise(alice, address(usd), POT);
        _raise(bob, address(usd), POT);
        vm.prank(alice);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
        vm.warp(expiry);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(id);
    }

    /// Nobody helps themselves: the pot leaves only to someone else, or back by reclaim.
    function test_thank_raiserCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.GiverIsRaiser.selector);
        core.thank(id, alice, SOLUTION, _sig(id, aliceKey));
        (,, AHandCore.Status status,,,) = core.hands(id);
        assertEq(uint8(status), uint8(AHandCore.Status.Active));
    }

    function test_thank_zeroPot() public {
        uint256 id = _raise(alice, address(usd), 0);
        vm.prank(alice);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
        (,, AHandCore.Status status,,,) = core.hands(id);
        assertEq(uint8(status), uint8(AHandCore.Status.Thanked));
    }

    /// Core has no key, so it can never sign a Give.
    function test_thank_coreCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, address(core), SOLUTION, _sig(id, carolKey));
    }

    /// A giver who cannot be paid changes nothing: the raiser can pick another or wait for expiry.
    function test_thank_blockedGiverLeavesTheHandOpen() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        t.setBlocked(carol, true);

        vm.startPrank(alice);
        vm.expectRevert();
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
        core.thank(id, bob, SOLUTION, _sig(id, bobKey));
        vm.stopPrank();
        assertEq(t.balanceOf(bob), POT);
    }

    function test_thank_lateFeeCannotEatAnotherHand() public {
        LateSenderFeeToken t = new LateSenderFeeToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 a = _raise(alice, address(t), POT);
        _raise(bob, address(t), POT);
        t.setFeeOn(true);

        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.thank(a, carol, SOLUTION, _sig(a, carolKey));
        assertEq(t.balanceOf(address(core)), 2 * POT);
    }

    /*//////////////////////////// give ////////////////////////////*/

    /// The raiser cannot name a giver who did not sign.
    function test_give_signatureOfSomeoneElse() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, carol, SOLUTION, _sig(id, bobKey));
    }

    function test_give_cannotBeMovedToAnotherHand() public {
        uint256 first = _raise(alice, address(usd), POT);
        uint256 second = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(second, carol, SOLUTION, _sig(first, carolKey));
    }

    function test_give_coversTheSolution() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, carol, keccak256("another solution"), _sig(id, carolKey));
    }

    function test_give_cannotBeMovedToAnotherCore() public {
        uint256 id = _raise(alice, address(usd), POT);
        bytes memory foreign = _sign(makeAddr("another core"), carolKey, id, SOLUTION);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, carol, SOLUTION, foreign);
    }

    /// After a fork the old chain id no longer signs anything here.
    function test_give_cannotBeMovedToAnotherChain() public {
        uint256 id = _raise(alice, address(usd), POT);
        bytes memory old = _sig(id, carolKey);
        vm.chainId(block.chainid + 1);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, carol, SOLUTION, old);
    }

    /// Nobody holds the zero address key: junk that recovers to zero must not pass for it.
    function test_give_zeroAddressCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.startPrank(alice);
        vm.expectRevert();
        core.thank(id, address(0), SOLUTION, new bytes(65));
        vm.expectRevert();
        core.thank(id, address(0), SOLUTION, "");
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, address(0), SOLUTION, _sig(id, carolKey));
        vm.stopPrank();
        assertEq(usd.balanceOf(address(core)), POT);
    }

    function test_give_malformedSignature() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.startPrank(alice);
        vm.expectRevert();
        core.thank(id, carol, SOLUTION, hex"1234");
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

    /// A `false` return must not count as paid: the Hand stays open and can be retried.
    function test_token_falseReturnOnRefundKeepsTheHandOpen() public {
        ReturnsFalseToken t = new ReturnsFalseToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        t.setRefuses(alice, true);
        vm.warp(expiry);

        vm.expectRevert();
        core.reclaim(id);
        (,, AHandCore.Status status,,,) = core.hands(id);
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
        core.raise(address(t), POT, expiry + 1, METADATA);

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
            address(core), abi.encodeCall(core.thank, (id, carol, SOLUTION, _sig(id, carolKey))), false, true, false
        );

        vm.prank(address(t));
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));

        assertFalse(t.lastReentryOk());
        assertEq(bytes4(t.lastReentryReturn()), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(t.balanceOf(carol), POT);
        assertEq(t.balanceOf(address(core)), POT);
    }

    /// A Hand cannot be paid out while its own deposit is still in flight.
    function test_reentry_thankInsideRaiseReverts() public {
        HookToken t = new HookToken();
        _fund(address(t), bob);
        _raise(bob, address(t), POT); // custody the payout would borrow from
        t.mint(address(t), POT);
        vm.prank(address(t));
        t.approve(address(core), POT);
        uint256 next = core.handsCount() + 1;
        t.setReentry(
            address(core), abi.encodeCall(core.thank, (next, carol, SOLUTION, _sig(next, carolKey))), true, false, true
        );

        vm.prank(address(t));
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        core.raise(address(t), POT, expiry, METADATA);

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
        uint256 id = core.raise(address(usd), amount, e, METADATA);
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
        uint256 id = core.raise(address(usd), amount, e, METADATA);

        vm.warp(block.timestamp + bound(at, 0, span - 1));
        vm.prank(alice);
        core.thank(id, carol, SOLUTION, _sig(id, carolKey));
        assertEq(usd.balanceOf(carol), amount);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    function testFuzz_raiseKeepsAnyMetadata(bytes32 metadataHash) public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), POT, expiry, metadataHash);
        (,,,,, bytes32 stored) = core.hands(id);
        assertEq(stored, metadataHash);
    }

    function testFuzz_giveFromAnyKeyForAnySolution(uint256 key, bytes32 solution) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        address giver = vm.addr(key);
        vm.assume(giver != alice && giver != address(core));
        uint256 id = _raise(alice, address(usd), POT);
        uint256 before = usd.balanceOf(giver);

        vm.prank(alice);
        core.thank(id, giver, solution, _sign(address(core), key, id, solution));
        assertEq(usd.balanceOf(giver), before + POT);
    }

    function testFuzz_giveRejectsAnyOtherSigner(uint256 key, address claimed) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(claimed != vm.addr(key) && claimed != alice);
        uint256 id = _raise(alice, address(usd), POT);

        bytes memory sig = _sign(address(core), key, id, SOLUTION);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        core.thank(id, claimed, SOLUTION, sig);
    }
}
