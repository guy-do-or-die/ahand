// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {AHandCore, Shake, Give, SignedShake} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {SenderFeeToken, LateSenderFeeToken, ReceiverFeeToken} from "./mocks/FeeTokens.sol";
import {NoReturnToken} from "./mocks/NoReturnToken.sol";
import {ReturnsFalseToken} from "./mocks/ReturnsFalseToken.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {HookToken, IHookRecipient} from "./mocks/HookToken.sol";
import {ReturndataBombToken} from "./mocks/ReturndataBombToken.sol";
import {shakeStructHash, giveStructHash, digestOf, HandView, handOf} from "./Helpers.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TwoInARow {
    function go(AHandCore core, MockUSD token, uint256 amount, uint40 expiry) external {
        token.approve(address(core), 2 * amount);
        core.raise(address(token), amount, expiry, address(this), 0, 200, bytes32(0));
        core.raise(address(token), amount, expiry, address(this), 0, 200, bytes32(0));
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
        address rootKey,
        uint16 minGiverClaimBps,
        uint16 payoutGasK,
        bytes32 dataHash
    );
    event Reclaimed(uint256 indexed handId);
    event Thanked(
        uint256 indexed handId,
        address indexed signer,
        address indexed payee,
        bytes32 routeHash,
        uint16 claimBps,
        bytes32 dataHash
    );
    event Shaken(
        uint256 indexed handId,
        uint256 position,
        address nextKey,
        address indexed payee,
        uint16 claimBps,
        uint16 nextClaimBps,
        uint256 margin,
        bytes32 dataHash
    );
    event Paid(address indexed token, address indexed payee, uint256 amount);
    event Pending(address indexed token, address indexed payee, uint256 amount);
    event Withdrawn(address indexed token, address indexed payee, address to, uint256 amount);

    uint256 constant POT = 100e6;
    bytes32 constant ANSWER = keccak256("the salted answer");
    bytes32 constant ASK = keccak256("what the raiser asks for");
    bytes32 constant SHAKE_DATA = keccak256("why I passed it on");
    uint16 constant GAS_K = 200; // payout gas, thousands
    uint256 constant ROOT_PK = 0xA0A0; // the link's root key: whoever holds the link
    uint256 constant NEXT_PK = 0xB0B0; // the key a Shake passes the Hand to

    AHandCore core;
    MockUSD usd;
    address alice;
    address bob;
    address carol;
    uint256 aliceKey;
    uint256 bobKey;
    uint256 carolKey;
    uint40 expiry;
    address root;

    function setUp() public {
        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        (carol, carolKey) = makeAddrAndKey("carol");
        root = vm.addr(ROOT_PK);
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
        return core.raise(token, amount, expiry, root, 0, GAS_K, ASK);
    }

    function _signed(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(key, digest);
        return abi.encodePacked(r, sv, v);
    }

    function _signGive(address to, uint256 key, uint256 handId, Give memory g) internal view returns (bytes memory) {
        return _signed(key, digestOf(to, giveStructHash(handId, g)));
    }

    function _signShake(uint256 key, uint256 handId, Shake memory sh) internal view returns (bytes memory) {
        return _signed(key, digestOf(address(core), shakeStructHash(handId, sh)));
    }

    /// A Give over the direct route (no Shakes): the whole share, paid to its signer.
    function _give(address signer) internal pure returns (Give memory) {
        return Give(bytes32(0), signer, signer, 10_000, ANSWER);
    }

    /// The direct route for `signerKey`'s holder, signed by the root key and by the signer.
    function _direct(uint256 id, uint256 signerKey)
        internal
        view
        returns (Give memory g, bytes memory keySig, bytes memory giverSig)
    {
        g = _give(vm.addr(signerKey));
        keySig = _signGive(address(core), ROOT_PK, id, g);
        giverSig = _signGive(address(core), signerKey, id, g);
    }

    function _none() internal pure returns (SignedShake[] memory shakes) {}

    function _submit(
        address raiser,
        uint256 id,
        SignedShake[] memory shakes,
        Give memory g,
        bytes memory keySig,
        bytes memory giverSig
    ) internal {
        vm.prank(raiser);
        core.thank(id, shakes, g, keySig, giverSig);
    }

    /// `raiser` thanks `signerKey`'s holder over the direct route.
    function _thank(address raiser, uint256 id, uint256 signerKey) internal {
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, signerKey);
        _submit(raiser, id, _none(), g, keySig, giverSig);
    }

    function _hand(uint256 id) internal view returns (HandView memory) {
        return handOf(core, id);
    }

    function _assertOpen(uint256 id) internal view {
        assertEq(_hand(id).thankedAt, 0);
        assertEq(_hand(id).reclaimedAt, 0);
    }

    function _assertThankedNow(uint256 id) internal view {
        assertEq(_hand(id).thankedAt, block.timestamp);
        assertEq(_hand(id).reclaimedAt, 0);
    }

    function _assertReclaimedNow(uint256 id) internal view {
        assertEq(_hand(id).thankedAt, 0);
        assertEq(_hand(id).reclaimedAt, block.timestamp);
    }

    /*//////////////////////////// raise ////////////////////////////*/

    function test_raise_escrowsThePotAndRecordsTheHand() public {
        uint256 before = usd.balanceOf(alice);

        vm.expectEmit(address(core));
        emit Raised(1, alice, address(usd), POT, expiry, root, 0, GAS_K, ASK);
        uint256 id = _raise(alice, address(usd), POT);

        assertEq(id, 1);
        assertEq(core.handsCount(), 1);
        assertEq(usd.balanceOf(address(core)), POT);
        assertEq(usd.balanceOf(alice), before - POT);

        HandView memory h = _hand(id);
        assertEq(h.raiser, alice);
        assertEq(h.expiry, expiry);
        assertEq(h.minGiverClaimBps, 0);
        assertEq(h.raisedAt, block.timestamp);
        assertEq(h.token, address(usd));
        assertEq(h.payoutGasK, GAS_K);
        _assertOpen(id);
        assertEq(h.amount, POT);
        assertEq(h.rootKey, root);
        assertEq(h.dataHash, ASK);
        assertEq(h.giveHash, bytes32(0));
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
        uint256 id = core.raise(address(usd), POT, expiry, root, 0, GAS_K, bytes32(0));
        assertEq(_hand(id).dataHash, bytes32(0));
    }

    /// The hash outlives the Hand, so it can still be read once the Hand is closed.
    function test_raise_dataHashStaysAfterTheHandCloses() public {
        uint256 thanked = _raise(alice, address(usd), POT);
        uint256 reclaimed = _raise(alice, address(usd), POT);
        _thank(alice, thanked, carolKey);
        vm.warp(expiry);
        core.reclaim(reclaimed);

        assertEq(_hand(thanked).dataHash, ASK);
        assertEq(_hand(reclaimed).dataHash, ASK);
    }

    function test_raise_rejectsExpiryNotInTheFuture() public {
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), POT, uint40(block.timestamp), root, 0, GAS_K, ASK);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), POT, uint40(block.timestamp - 1), root, 0, GAS_K, ASK);
        vm.stopPrank();
        assertEq(core.handsCount(), 0);
    }

    /// A minimum above the whole pot would make the Hand impossible to thank: refused at raise.
    function test_raise_rejectsMinGiverClaimAboveThePot() public {
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.InvalidMinGiverClaim.selector);
        core.raise(address(usd), POT, expiry, root, 10_001, GAS_K, ASK);
        vm.expectRevert(AHandCore.InvalidMinGiverClaim.selector);
        core.raise(address(usd), POT, expiry, root, type(uint16).max, GAS_K, ASK);
        core.raise(address(usd), POT, expiry, root, 10_000, GAS_K, ASK); // the whole pot is fine
        vm.stopPrank();
        assertEq(core.handsCount(), 1);
    }

    /// Nobody can sign as the zero address, so a zero root key is refused at raise.
    function test_raise_rejectsZeroRootKey() public {
        vm.prank(alice);
        vm.expectRevert(AHandCore.InvalidRootKey.selector);
        core.raise(address(usd), POT, expiry, address(0), 0, GAS_K, ASK);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_acceptsExpiryOneSecondAhead() public {
        vm.prank(alice);
        core.raise(address(usd), POT, uint40(block.timestamp + 1), root, 0, GAS_K, ASK);
        assertEq(core.handsCount(), 1);
    }

    function test_raise_revertsWithoutAllowanceAndLeavesNoHand() public {
        vm.prank(alice);
        usd.approve(address(core), 0);
        vm.prank(alice);
        vm.expectRevert();
        core.raise(address(usd), POT, expiry, root, 0, GAS_K, ASK);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_revertsOnAddressWithoutCode() public {
        vm.prank(alice);
        vm.expectRevert();
        core.raise(makeAddr("not a token"), POT, expiry, root, 0, GAS_K, ASK);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_rejectsSenderSideFee() public {
        SenderFeeToken t = new SenderFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry, root, 0, GAS_K, ASK);
    }

    function test_raise_rejectsReceiverSideFee() public {
        ReceiverFeeToken t = new ReceiverFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), POT, expiry, root, 0, GAS_K, ASK);
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
        assertEq(_hand(42).raiser, address(0));
        assertEq(_hand(42).raisedAt, 0);
        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(42);
    }

    /*//////////////////////////// thank ////////////////////////////*/

    function test_thank_paysTheWholePotToTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);

        vm.expectEmit(address(core));
        emit Thanked(id, carol, carol, bytes32(0), 10_000, ANSWER);
        _thank(alice, id, carolKey);

        assertEq(usd.balanceOf(carol), POT);
        assertEq(usd.balanceOf(address(core)), 0);
        _assertThankedNow(id);
    }

    /// The time of thank is written once and stays.
    function test_thank_timeIsWrittenOnce() public {
        uint256 id = _raise(alice, address(usd), POT);
        uint256 at = block.timestamp + 1 hours;
        vm.warp(at);
        _thank(alice, id, carolKey);
        vm.warp(uint256(expiry) + 1);
        assertEq(_hand(id).thankedAt, at);
        assertEq(_hand(id).reclaimedAt, 0);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(id);
    }

    /// Any caller but the raiser is refused, whatever its address.
    function testFuzz_thank_onlyTheRaiser(address caller) public {
        vm.assume(caller != alice);
        uint256 id = _raise(alice, address(usd), POT);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.expectRevert(AHandCore.NotRaiser.selector);
        _submit(caller, id, _none(), g, keySig, giverSig);
    }

    function test_thank_windowClosesExactlyAtExpiry() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(expiry);
        vm.expectRevert(AHandCore.Expired.selector);
        _thank(alice, id, carolKey);
    }

    /// And it stays closed: any time after expiry, thank is refused.
    function testFuzz_thank_refusedAnyTimeAfterExpiry(uint32 late) public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(uint256(expiry) + late);
        vm.expectRevert(AHandCore.Expired.selector);
        _thank(alice, id, carolKey);
    }

    function test_thank_worksOneSecondBeforeExpiry() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.warp(expiry - 1);
        _thank(alice, id, carolKey);
        assertEq(usd.balanceOf(carol), POT);
    }

    function test_thank_onlyOnce() public {
        uint256 id = _raise(alice, address(usd), POT);
        _raise(bob, address(usd), POT); // money a second thank would steal
        _thank(alice, id, carolKey);
        vm.expectRevert(AHandCore.NotActive.selector);
        _thank(alice, id, carolKey);
        assertEq(usd.balanceOf(address(core)), POT);
    }

    function test_thank_unknownHand() public {
        vm.expectRevert(AHandCore.NotActive.selector);
        _thank(alice, 1, carolKey);
    }

    function test_thank_closesReclaim() public {
        uint256 id = _raise(alice, address(usd), POT);
        _raise(bob, address(usd), POT);
        _thank(alice, id, carolKey);
        vm.warp(expiry);
        vm.expectRevert(AHandCore.NotActive.selector);
        core.reclaim(id);
    }

    /// Nobody helps themselves: the pot leaves only to someone else, or back by reclaim.
    function test_thank_raiserCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        vm.expectRevert(AHandCore.GiverIsRaiser.selector);
        _thank(alice, id, aliceKey);
        _assertOpen(id);
    }

    /// The check is on who signs, not where the money goes: the raiser cannot sign as giver
    /// even while sending the money to someone else.
    function test_thank_raiserCannotSignAsTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = Give(bytes32(0), alice, carol, 10_000, ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), aliceKey, id, g);
        vm.expectRevert(AHandCore.GiverIsRaiser.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    function test_thank_zeroPot() public {
        uint256 id = _raise(alice, address(usd), 0);
        _thank(alice, id, carolKey);
        _assertThankedNow(id);
    }

    /// Core has no key, so it can never sign a Give.
    function test_thank_coreCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = _give(address(core));
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// A giver who cannot be paid now loses nothing: the Hand closes and the share stays pending for her.
    function test_thank_blockedGiverShareStaysPending() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        t.setBlocked(carol, true);

        vm.expectEmit(address(core));
        emit Pending(address(t), carol, POT);
        _thank(alice, id, carolKey);

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
        _thank(alice, a, carolKey);
        assertEq(core.pending(address(t), carol), POT);
        assertEq(t.balanceOf(address(core)), 2 * POT);
    }

    /*//////////////////////////// give ////////////////////////////*/

    /// The raiser cannot name a giver who did not sign.
    function test_give_signatureOfSomeoneElse() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = _give(carol);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), bobKey, id, g);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// A Give must come from the end of its route, here the root key: the link itself.
    function test_give_needsTheLinkKey() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = _give(carol);
        bytes memory keySig = _signGive(address(core), bobKey, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    function test_give_cannotBeMovedToAnotherHand() public {
        uint256 first = _raise(alice, address(usd), POT);
        uint256 second = _raise(alice, address(usd), POT);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(first, carolKey);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, second, _none(), g, keySig, giverSig);
    }

    function test_give_coversTheData() public {
        uint256 id = _raise(alice, address(usd), POT);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        g.dataHash = keccak256("another answer");
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// Where the money goes is signed: nobody can swap the payee after the giver signed.
    function test_give_coversThePayee() public {
        uint256 id = _raise(alice, address(usd), POT);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        g.payee = alice;
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// The giver may take the money at another address, an exchange for example.
    function test_give_paysThePayeeTheSignerChose() public {
        uint256 id = _raise(alice, address(usd), POT);
        address exchange = makeAddr("exchange");
        Give memory g = Give(bytes32(0), carol, exchange, 10_000, ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        _submit(alice, id, _none(), g, keySig, giverSig);
        assertEq(usd.balanceOf(exchange), POT);
        assertEq(usd.balanceOf(carol), 0);
    }

    /// The share in the Give is the one that reached its signer: the whole pot on a direct route.
    function test_give_namesTheShareThatReachedIt() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = Give(bytes32(0), carol, carol, 9_000, ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// The route in the Give is the one the raiser submits: no Shakes here.
    function test_give_namesTheRoute() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = Give(keccak256("another route"), carol, carol, 10_000, ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    function test_give_cannotBeMovedToAnotherCore() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = _give(carol);
        address other = makeAddr("another core");
        bytes memory keySig = _signGive(other, ROOT_PK, id, g);
        bytes memory giverSig = _signGive(other, carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// After a fork the old chain id no longer signs anything here.
    function test_give_cannotBeMovedToAnotherChain() public {
        uint256 id = _raise(alice, address(usd), POT);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// Nobody holds the zero address key: junk that recovers to zero must not pass for it.
    function test_give_zeroAddressCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = Give(bytes32(0), address(0), carol, 10_000, ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        vm.expectRevert();
        _submit(alice, id, _none(), g, keySig, new bytes(65));
        vm.expectRevert();
        _submit(alice, id, _none(), g, keySig, "");
        bytes memory carolSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, carolSig);
        assertEq(usd.balanceOf(address(core)), POT);
    }

    /// The giver's share must reach someone. Sent to the zero address it is burned, or, if the
    /// token refuses, stays pending where nobody can ever withdraw it. Refused for any pot.
    function test_give_zeroAddressCannotBeThePayee() public {
        uint256 id = _raise(alice, address(usd), POT);
        Give memory g = Give(bytes32(0), carol, address(0), 10_000, ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidPayee.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);

        uint256 empty = _raise(alice, address(usd), 0);
        keySig = _signGive(address(core), ROOT_PK, empty, g);
        giverSig = _signGive(address(core), carolKey, empty, g);
        vm.expectRevert(AHandCore.InvalidPayee.selector);
        _submit(alice, empty, _none(), g, keySig, giverSig);
    }

    function test_give_malformedSignature() public {
        uint256 id = _raise(alice, address(usd), POT);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.expectRevert();
        _submit(alice, id, _none(), g, keySig, hex"1234");
        vm.expectRevert();
        _submit(alice, id, _none(), g, hex"1234", giverSig);
    }

    /*//////////////////////////// route ////////////////////////////*/

    /// One Shake: the root key passes the Hand to NEXT_PK, keeping `10 000 - nextClaimBps` for `payee`.
    function _oneShake(uint256 id, address payee, uint16 nextClaimBps)
        internal
        view
        returns (SignedShake[] memory shakes)
    {
        shakes = new SignedShake[](1);
        shakes[0].shake = Shake(vm.addr(NEXT_PK), payee, 10_000, nextClaimBps, SHAKE_DATA);
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
    }

    function _routeHash(uint256 id, SignedShake[] memory shakes) internal pure returns (bytes32 routeHash) {
        for (uint256 i; i < shakes.length; ++i) {
            routeHash = keccak256(abi.encode(routeHash, shakeStructHash(id, shakes[i].shake)));
        }
    }

    /// The Give at the end of `shakes` for `signerKey`'s holder, signed by `lastKey` and by the signer.
    function _giveAt(uint256 id, SignedShake[] memory shakes, uint256 lastKey, uint256 signerKey)
        internal
        view
        returns (Give memory g, bytes memory keySig, bytes memory giverSig)
    {
        uint16 claim = shakes.length == 0 ? 10_000 : shakes[shakes.length - 1].shake.nextClaimBps;
        address signer = vm.addr(signerKey);
        g = Give(_routeHash(id, shakes), signer, signer, claim, ANSWER);
        keySig = _signGive(address(core), lastKey, id, g);
        giverSig = _signGive(address(core), signerKey, id, g);
    }

    /// Alice thanks `signerKey`'s holder along a route of one Shake.
    function _thankAlong(uint256 id, SignedShake[] memory shakes, uint256 signerKey) internal {
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, signerKey);
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// The shaker keeps its margin, the giver gets the rest.
    function test_route_shakerKeepsItsMargin() public {
        address shaker = makeAddr("shaker");
        uint256 id = _raise(alice, address(usd), POT);
        _thankAlong(id, _oneShake(id, shaker, 9_000), carolKey);
        assertEq(usd.balanceOf(shaker), 10e6);
        assertEq(usd.balanceOf(carol), 90e6);
        assertEq(usd.balanceOf(address(core)), 0);
        _assertThankedNow(id);
    }

    /// The Give and every Shake are logged with everything they signed; the Shake with its margin.
    function test_route_isLogged() public {
        address shaker = makeAddr("shaker");
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(id, shaker, 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectEmit(address(core));
        emit Thanked(id, carol, carol, g.routeHash, 9_000, ANSWER);
        vm.expectEmit(address(core));
        emit Shaken(id, 0, vm.addr(NEXT_PK), shaker, 10_000, 9_000, 10e6, SHAKE_DATA);
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// A Shake comes only from the key that holds the Hand: here the root key.
    function test_route_shakeMustBeSignedByTheRootKey() public {
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        shakes[0].keySig = _signShake(bobKey, id, shakes[0].shake);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidShake.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// A Shake is signed for one Hand: the same link key cannot reuse it on another Hand.
    function test_route_shakeIsBoundToItsHand() public {
        uint256 first = _raise(alice, address(usd), POT);
        uint256 second = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(first, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(second, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidShake.selector, 0));
        _submit(alice, second, shakes, g, keySig, giverSig);
    }

    /// A Shake starts from exactly the share it received and cannot pass on more than that.
    function test_route_shakeContinuesItsShare() public {
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        shakes[0].shake.claimBps = 9_999;
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);

        shakes = _oneShake(id, makeAddr("shaker"), 10_001);
        (g, keySig, giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);

        // Claiming more than reached it, even while passing on less, would take from the giver.
        shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        shakes[0].shake.claimBps = 19_000;
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        (g, keySig, giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);

        // Both rules broken at once.
        shakes = _oneShake(id, makeAddr("shaker"), 10_500);
        shakes[0].shake.claimBps = 19_000;
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        (g, keySig, giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// Keys chain: the second Shake comes from the key the first one passed the Hand to, and the
    /// Give from the key the second one passed it to. Longer routes are the next step.
    function test_route_keysChainFromShakeToShake() public {
        uint256 lastPk = 0xC0C0;
        address first = makeAddr("first shaker");
        address second = makeAddr("second shaker");
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = new SignedShake[](2);
        shakes[0].shake = Shake(vm.addr(NEXT_PK), first, 10_000, 9_000, SHAKE_DATA);
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        shakes[1].shake = Shake(vm.addr(lastPk), second, 9_000, 8_500, SHAKE_DATA);
        shakes[1].keySig = _signShake(ROOT_PK, id, shakes[1].shake); // the root no longer holds the Hand
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, lastPk, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidShake.selector, 1));
        _submit(alice, id, shakes, g, keySig, giverSig);

        shakes[1].keySig = _signShake(NEXT_PK, id, shakes[1].shake);
        (g, keySig, giverSig) = _giveAt(id, shakes, lastPk, carolKey);
        _submit(alice, id, shakes, g, keySig, giverSig);
        assertEq(usd.balanceOf(first), 10e6);
        assertEq(usd.balanceOf(second), 5e6);
        assertEq(usd.balanceOf(carol), 85e6);
    }

    /// A Shake without a payee may pass the Hand on but never keep a margin.
    function test_route_anonymousShakeKeepsNothing() public {
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(id, address(0), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.AnonymousMargin.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);

        _thankAlong(id, _oneShake(id, address(0), 10_000), carolKey);
        assertEq(usd.balanceOf(carol), POT);
    }

    /// The Give must come from the key the Shake passed the Hand to, not from the root.
    function test_route_giveComesFromTheNextKey() public {
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, ROOT_PK, carolKey);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// The giver holds only the next key, so she cannot drop the Shake to take its margin:
    /// a Give over the shorter route would need the root key.
    function test_route_giverCannotDropTheShake() public {
        uint256 id = _raise(alice, address(usd), POT);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, _none(), NEXT_PK, carolKey);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// The Give names the route it ends: a Give for no Shakes cannot close a route with one.
    function test_route_giveNamesItsRoute() public {
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        Give memory g = Give(bytes32(0), carol, carol, 9_000, ANSWER);
        bytes memory keySig = _signGive(address(core), NEXT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// The share in the Give is the one the Shake passed on.
    function test_route_giveNamesTheShareThatReachedIt() public {
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        Give memory g = Give(_routeHash(id, shakes), carol, carol, 10_000, ANSWER);
        bytes memory keySig = _signGive(address(core), NEXT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 1));
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// The raiser's minimum for the giver holds against any route.
    function test_route_minimumForTheGiver() public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), POT, expiry, root, 9_500, GAS_K, ASK);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(AHandCore.BelowMinGiverClaim.selector);
        _submit(alice, id, shakes, g, keySig, giverSig);

        _thankAlong(id, _oneShake(id, makeAddr("shaker"), 9_500), carolKey);
        assertEq(usd.balanceOf(carol), 95e6);
    }

    /// A Hand whose root key nobody holds can never be thanked, only reclaimed. An address
    /// hashed from an open string is such a key, and anyone can check that.
    function test_route_rootKeyNobodyHoldsLeavesOnlyReclaim() public {
        address nobodys = address(uint160(uint256(keccak256("a root key nobody holds"))));
        vm.prank(alice);
        uint256 id = core.raise(address(usd), POT, expiry, nobodys, 0, GAS_K, ASK);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
        vm.warp(expiry);
        core.reclaim(id);
        _assertReclaimedNow(id);
    }

    /// A margin that rounds to nothing does not stop the route: the dust goes to the giver.
    function test_route_marginRoundingToZeroGoesToTheGiver() public {
        address shaker = makeAddr("shaker");
        uint256 id = _raise(alice, address(usd), 9);
        _thankAlong(id, _oneShake(id, shaker, 9_999), carolKey);
        assertEq(usd.balanceOf(shaker), 0);
        assertEq(usd.balanceOf(carol), 9);
    }

    /// Core keeps the hash of the Give it paid, so a contract can later prove the route.
    function test_route_giveHashIsKept() public {
        uint256 id = _raise(alice, address(usd), POT);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        _submit(alice, id, shakes, g, keySig, giverSig);
        assertEq(_hand(id).giveHash, giveStructHash(id, g));
    }

    /// A Shake whose payee refuses the money leaves only its own margin pending.
    function test_route_refusedMarginStaysPendingTheGiverIsPaid() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        address shaker = makeAddr("shaker");
        vm.etch(shaker, type(Refuser).runtimeCode);
        t.setHooked(shaker, true);
        uint256 id = _raise(alice, address(t), POT);
        _thankAlong(id, _oneShake(id, shaker, 9_000), carolKey);
        assertEq(core.pending(address(t), shaker), 10e6);
        assertEq(t.balanceOf(carol), 90e6);
    }

    /// No exception by identity: the raiser may be a Shake's payee and gets its margin.
    function test_route_raiserMayBeAShakePayee() public {
        uint256 id = _raise(alice, address(usd), POT);
        uint256 before = usd.balanceOf(alice);
        _thankAlong(id, _oneShake(id, alice, 9_000), carolKey);
        assertEq(usd.balanceOf(alice), before + 10e6);
        assertEq(usd.balanceOf(carol), 90e6);
    }

    /// The giver may also be the Shake's payee: each occurrence is paid.
    function test_route_giverMayAlsoBeTheShakePayee() public {
        uint256 id = _raise(alice, address(usd), POT);
        _thankAlong(id, _oneShake(id, carol, 9_000), carolKey);
        assertEq(usd.balanceOf(carol), POT);
    }

    /// A Hand without a reward still logs its Shake, and touches no token.
    function test_route_zeroPotLogsTheShakeAndTouchesNoToken() public {
        vm.prank(alice);
        uint256 id = core.raise(address(0), 0, expiry, root, 0, GAS_K, ASK);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        vm.recordLogs();
        _thankAlong(id, shakes, carolKey);
        assertEq(vm.getRecordedLogs().length, 2); // Thanked and Shaken; no Paid, no Pending
    }

    /// A huge pot cannot overflow the margin.
    function test_route_hugePotDoesNotOverflow() public {
        uint256 big = type(uint256).max / 2;
        usd.mint(alice, big);
        uint256 id = _raise(alice, address(usd), big);
        address shaker = makeAddr("shaker");
        _thankAlong(id, _oneShake(id, shaker, 9_000), carolKey);
        assertEq(usd.balanceOf(shaker), big / 10);
        assertEq(usd.balanceOf(shaker) + usd.balanceOf(carol), big);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    function testFuzz_route_conservesThePot(uint256 pot, uint16 next) public {
        pot = bound(pot, 0, type(uint128).max);
        next = uint16(bound(next, 0, 10_000));
        usd.mint(alice, pot);
        uint256 id = _raise(alice, address(usd), pot);
        address shaker = makeAddr("shaker");
        _thankAlong(id, _oneShake(id, shaker, next), carolKey);
        assertEq(usd.balanceOf(shaker), pot * (10_000 - next) / 10_000);
        assertEq(usd.balanceOf(shaker) + usd.balanceOf(carol), pot);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /// Gas Core spends in `thank` on a route of `n` Shakes that keep nothing, on a Hand without
    /// a reward, so that only the route itself is paid for. Called through `this`, so that every
    /// route is measured from a fresh call: read inside one long test, the number also grew with
    /// the test's own memory.
    function routeGas(uint256 n) external returns (uint256) {
        vm.prank(alice);
        uint256 id = core.raise(address(0), 0, expiry, root, 0, GAS_K, ASK);
        SignedShake[] memory shakes = new SignedShake[](n);
        uint256 key = ROOT_PK;
        for (uint256 i; i < n; ++i) {
            uint256 nextKey = NEXT_PK + i;
            shakes[i].shake = Shake(vm.addr(nextKey), address(0), 10_000, 10_000, SHAKE_DATA);
            shakes[i].keySig = _signShake(key, id, shakes[i].shake);
            key = nextKey;
        }
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, key, carolKey);
        _submit(alice, id, shakes, g, keySig, giverSig);
        return vm.lastCallGas().gasTotalUsed;
    }

    /// Every Shake costs the same, however long the route: the hundredth adds exactly what the
    /// second does.
    function test_route_everyShakeCostsTheSame() public {
        uint256 second = this.routeGas(2) - this.routeGas(1);
        uint256 hundredth = this.routeGas(100) - this.routeGas(99);
        assertEq(hundredth, second);
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
        _thank(alice, id, carolKey);
        assertEq(core.pending(address(usd), carol), 0);
    }

    /// A payee whose code refuses the money has it pending; the Hand still closes.
    function test_payout_refusedPaymentStaysPending() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        vm.etch(carol, type(Refuser).runtimeCode); // a smart account that misbehaves; carol's key still signs
        t.setHooked(carol, true);
        _thank(alice, id, carolKey);
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
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        SignedShake[] memory none;
        vm.prank(alice);
        core.thank{gas: 400_000}(id, none, g, keySig, giverSig);
        assertEq(core.pending(address(t), carol), POT);
    }

    /// A token answering with a megabyte cannot make the thank fail.
    function test_payout_returndataBombLeavesPaymentPending() public {
        ReturndataBombToken t = new ReturndataBombToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        SignedShake[] memory none;
        vm.prank(alice);
        core.thank{gas: 2_000_000}(id, none, g, keySig, giverSig);
        assertEq(core.pending(address(t), carol), POT);
    }

    /// The payout gas is the raiser's choice per Hand, for the payment and the refund
    /// alike: too little leaves the share pending.
    function test_payout_gasIsSetPerHand() public {
        vm.startPrank(alice);
        uint256 a = core.raise(address(usd), POT, expiry, root, 0, 1, ASK); // 1 000 gas cannot move a token
        uint256 b = core.raise(address(usd), POT, expiry, root, 0, 1, ASK);
        vm.stopPrank();
        _thank(alice, a, carolKey);
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
        uint256 low = core.raise(address(t), POT, expiry, root, 0, 100, ASK);
        uint256 high = core.raise(address(t), POT, expiry, root, 0, 300, ASK);
        vm.stopPrank();
        _thank(alice, low, carolKey);
        _thank(alice, high, carolKey);
        assertEq(core.pending(address(t), carol), POT);
        assertEq(t.balanceOf(carol), POT);
    }

    /// Picking the transaction gas cannot leave an honest payout of an ordinary token pending:
    /// it reverts or pays. The refund matters most, because anyone may call `reclaim`.
    function test_payout_underGassingPaysOrReverts() public {
        uint256 id = _raise(alice, address(usd), POT);
        (Give memory give, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        SignedShake[] memory none;
        uint256 paid;
        uint256 reverted;
        uint256 snap = vm.snapshotState();
        for (uint256 g = 20_000; g < 300_000; g += 100) {
            vm.prank(alice);
            try core.thank{gas: g}(id, none, give, keySig, giverSig) {
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
        _thank(alice, a, carolKey);
        _thank(alice, b, carolKey);
        assertEq(core.pending(address(t), carol), 3 * POT);

        t.setBlocked(carol, false);
        core.withdraw(address(t), carol, carol);
        assertEq(t.balanceOf(carol), 3 * POT);
    }

    /// Nobody but Core itself may call it, whatever the caller's address.
    function testFuzz_transferOut_onlyFromCoreItself(address caller) public {
        vm.assume(caller != address(core));
        vm.expectRevert(AHandCore.NotCore.selector);
        vm.prank(caller);
        core.transferOut(address(usd), carol, 1);
    }

    /*//////////////////////////// withdraw ////////////////////////////*/

    function _leavePending(address payee) internal returns (BlacklistToken t) {
        t = new BlacklistToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), POT);
        t.setBlocked(payee, true);
        uint256 key = payee == carol ? carolKey : bobKey;
        _thank(alice, id, key);
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

    /// Nobody else redirects it, whatever the addresses of the caller and the destination.
    function testFuzz_withdraw_nobodyElseRedirects(address caller, address to) public {
        vm.assume(caller != carol && to != carol);
        BlacklistToken t = _leavePending(carol);
        vm.expectRevert(AHandCore.NotPayee.selector);
        vm.prank(caller);
        core.withdraw(address(t), carol, to);
    }

    /// Not even the payee may send it to the zero address: a token that accepts the transfer
    /// would burn it. It stays pending.
    function test_withdraw_neverToTheZeroAddress() public {
        BlacklistToken t = _leavePending(carol);
        vm.expectRevert(AHandCore.ZeroDestination.selector);
        vm.prank(carol);
        core.withdraw(address(t), carol, address(0));
        assertEq(core.pending(address(t), carol), POT);
    }

    /// What is cleared is the payee's pending amount, never the destination's (the bug Across shipped).
    function test_withdraw_clearsThePayeeNotTheDestination() public {
        BlacklistToken t = _leavePending(carol);
        uint256 other = _raise(alice, address(t), POT);
        t.setBlocked(bob, true);
        _thank(alice, other, bobKey);
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
        _thank(alice, a, carolKey);
        _thank(alice, b, bobKey);
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
        uint256 a = core.raise(address(0), 0, expiry, root, 0, GAS_K, ASK);
        vm.recordLogs();
        _thank(alice, a, carolKey);
        assertEq(vm.getRecordedLogs().length, 1); // Thanked only

        vm.prank(alice);
        uint256 b = core.raise(address(0xdead), 0, expiry, root, 0, GAS_K, ASK);
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
        core.raise(address(t), POT, expiry + 1, root, 0, GAS_K, ASK);

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
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        t.setReentry(address(core), abi.encodeCall(core.thank, (id, _none(), g, keySig, giverSig)), false, true, false);

        _submit(address(t), id, _none(), g, keySig, giverSig);

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
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(next, carolKey);
        t.setReentry(address(core), abi.encodeCall(core.thank, (next, _none(), g, keySig, giverSig)), true, false, true);

        vm.prank(address(t));
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        core.raise(address(t), POT, expiry, root, 0, GAS_K, ASK);

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
        uint256 id = core.raise(address(usd), amount, e, root, 0, GAS_K, ASK);
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
        uint256 id = core.raise(address(usd), amount, e, root, 0, GAS_K, ASK);

        vm.warp(block.timestamp + bound(at, 0, span - 1));
        _thank(alice, id, carolKey);
        assertEq(usd.balanceOf(carol), amount);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    function testFuzz_raiseKeepsAnyDataHash(bytes32 dataHash) public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), POT, expiry, root, 0, GAS_K, dataHash);
        assertEq(_hand(id).dataHash, dataHash);
    }

    function testFuzz_giveFromAnyKeyForAnyData(uint256 key, bytes32 data) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        address giver = vm.addr(key);
        vm.assume(giver != alice && giver != address(core));
        uint256 id = _raise(alice, address(usd), POT);
        uint256 before = usd.balanceOf(giver);

        Give memory g = Give(bytes32(0), giver, giver, 10_000, data);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), key, id, g);
        _submit(alice, id, _none(), g, keySig, giverSig);
        assertEq(usd.balanceOf(giver), before + POT);
    }

    function testFuzz_giveRejectsAnyOtherSigner(uint256 key, address claimed) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(claimed != vm.addr(key) && claimed != alice);
        uint256 id = _raise(alice, address(usd), POT);

        Give memory g = Give(bytes32(0), claimed, carol, 10_000, ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), key, id, g);
        vm.expectRevert(AHandCore.InvalidGive.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }
}
