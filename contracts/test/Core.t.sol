// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test, Vm} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AHandCore, Shake, Give, SignedShake, SignedGive} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {SenderFeeToken, LateSenderFeeToken, ReceiverFeeToken} from "./mocks/FeeTokens.sol";
import {NoReturnToken} from "./mocks/NoReturnToken.sol";
import {ReturnsFalseToken} from "./mocks/ReturnsFalseToken.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {HookToken, IHookRecipient} from "./mocks/HookToken.sol";
import {ReturndataBombToken} from "./mocks/ReturndataBombToken.sol";
import {shakeStructHash, giveStructHash, digestOf, HandView, handOf, ThankView, thankOf} from "./Helpers.sol";
import {FactsReader} from "./probes/FactsReader.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TwoInARow {
    function go(AHandCore core, MockUSD token, uint256 reward, uint40 expiry) external {
        token.approve(address(core), 2 * reward);
        core.raise(address(token), reward, expiry, address(this), 0, 200, bytes32(0));
        core.raise(address(token), reward, expiry, address(this), 0, 200, bytes32(0));
    }
}

/// Code put on a payee's address: refuses to be paid once switched on.
contract Refuser is IHookRecipient {
    function onTokenReceived(address, uint256) external pure {
        revert("PAY ME");
    }
}

/// Code put on a payee's address: burns all the gas it is handed and never returns.
contract Burner is IHookRecipient {
    function onTokenReceived(address, uint256) external pure {
        while (true) {}
    }
}

/// Code put on a payee's address: does 150 000 gas of work, then accepts the money.
contract Heavy is IHookRecipient {
    function onTokenReceived(address, uint256) external view {
        uint256 start = gasleft();
        while (start - gasleft() < 150_000) {}
    }
}

/// A smart wallet (ERC-1271) that accepts a plain signature by `owner`. The same code serves an
/// EIP-7702 account, or an address that moved to regular code for good, whose key is now `owner`.
contract Wallet {
    address immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        return ECDSA.recoverCalldata(digest, signature) == owner ? this.isValidSignature.selector : bytes4(0);
    }
}

/// A smart wallet whose check burns all the gas it is handed and never answers.
contract BurningWallet {
    fallback() external {
        while (true) {}
    }
}

/// A smart wallet that accepts a plain signature by `owner` and answers with a megabyte: the
/// answer, then junk.
contract HugeAnswerWallet {
    address immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4 answer) {
        answer = ECDSA.recoverCalldata(digest, signature) == owner ? this.isValidSignature.selector : bytes4(0);
        assembly {
            mstore(0, answer)
            return(0, 0x100000)
        }
    }
}

contract CoreTest is Test {
    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint256 reward,
        uint40 expiry,
        address rootKey,
        uint16 minClaimBps,
        uint16 payoutGasK,
        bytes32 dataHash
    );
    event Extended(uint256 indexed handId, uint40 expiry);
    event Funded(uint256 indexed handId, uint256 amount, uint256 reward);
    event Reclaimed(uint256 indexed handId, address indexed token, uint256 reward);
    event Thanked(uint256 indexed handId, address indexed token, uint256 reward, bytes32 dataHash);
    event Shaken(
        uint256 indexed handId,
        address indexed payee,
        uint256 position,
        uint256 margin,
        address nextKey,
        uint16 claimBps,
        uint16 nextClaimBps,
        bytes32 dataHash
    );
    event Given(
        uint256 indexed handId,
        address indexed signer,
        address indexed payee,
        uint256 amount,
        uint16 claimBps,
        bytes32 routeHash,
        bytes32 dataHash
    );
    event Paid(uint256 indexed handId, address indexed token, address indexed payee, uint256 amount);
    event Pending(uint256 indexed handId, address indexed token, address indexed payee, uint256 amount);
    event Withdrawn(address indexed token, address indexed payee, uint256 amount, address to);

    uint256 constant REWARD = 100e6;
    bytes32 constant ANSWER = keccak256("the salted answer");
    bytes32 constant ASK = keccak256("what the raiser asks for");
    bytes32 constant THANKS = keccak256("what the raiser states with the thanks");
    bytes32 constant SHAKE_DATA = keccak256("why I passed it on");
    uint16 constant GAS_K = 200; // payout gas, thousands
    uint256 constant ROOT_PK = 0xA0A0; // the link's root key: whoever holds the link
    uint256 constant NEXT_PK = 0xB0B0; // the key a Shake passes the Hand to
    uint256 constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141; // order of the curve
    uint256 constant TX_GAS_CAP = 16_777_216; // gas one transaction may use: EIP-7825, Ethereum and Base
    uint256 constant TX_SIZE_LIMIT = 128 * 1024; // the largest transaction geth and reth admit to the mempool
    uint256 constant TX_ENVELOPE = 256; // bytes of a signed transaction around its calldata, with room to spare
    uint256 constant LONGEST_ACCEPTED = 369; // empty Shakes that still fit TX_SIZE_LIMIT
    uint256 constant TOO_LONG = 1_500; // empty Shakes whose execution alone needs more than TX_GAS_CAP

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

    function _raise(address who, address token, uint256 reward) internal returns (uint256) {
        vm.prank(who);
        return core.raise(token, reward, expiry, root, 0, GAS_K, ASK);
    }

    function _signed(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(key, digest);
        return abi.encodePacked(r, sv, v);
    }

    function _signGive(address to, uint256 key, uint256 handId, Give memory g) internal view returns (bytes memory) {
        return _signed(key, digestOf(to, giveStructHash(core, handId, g)));
    }

    function _signShake(uint256 key, uint256 handId, Shake memory sh) internal view returns (bytes memory) {
        return _signed(key, digestOf(address(core), shakeStructHash(core, handId, sh)));
    }

    /// A Give over the direct route (no Shakes): the whole reward, paid to its signer.
    function _give(address signer) internal pure returns (Give memory) {
        return Give(signer, signer, 10_000, bytes32(0), ANSWER);
    }

    /// The direct route for the signer with `signerKey`, signed by the root key and by the signer.
    function _direct(
        uint256 id,
        uint256 signerKey
    ) internal view returns (Give memory g, bytes memory keySig, bytes memory giverSig) {
        address signer = vm.addr(signerKey);
        return _directGive(id, signer, signer, signerKey);
    }

    /// The direct route for `signer`, paying `payee`: signed by the root key and with `signKey`,
    /// the signer's own key or a key its code accepts.
    function _directGive(
        uint256 id,
        address signer,
        address payee,
        uint256 signKey
    ) internal view returns (Give memory g, bytes memory keySig, bytes memory giverSig) {
        g = Give(signer, payee, 10_000, bytes32(0), ANSWER);
        keySig = _signGive(address(core), ROOT_PK, id, g);
        giverSig = _signGive(address(core), signKey, id, g);
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
        core.thank(id, shakes, SignedGive(g, keySig, giverSig), bytes32(0));
    }

    /// `raiser` thanks the signer with `signerKey` over the direct route.
    function _thank(address raiser, uint256 id, uint256 signerKey) internal {
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, signerKey);
        _submit(raiser, id, _none(), g, keySig, giverSig);
    }

    /// `raiser` tries to thank the signer with `signerKey` over the direct route and is refused
    /// with `reason`. Everything is signed before the refusal is expected.
    function _thankReverts(address raiser, uint256 id, uint256 signerKey, bytes4 reason) internal {
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, signerKey);
        vm.expectRevert(reason);
        _submit(raiser, id, _none(), g, keySig, giverSig);
    }

    /// `raiser` thanks the signer with `signerKey` over the direct route, paying `payee`.
    function _thankTo(address raiser, uint256 id, uint256 signerKey, address payee) internal {
        (Give memory g, bytes memory keySig, bytes memory giverSig) =
            _directGive(id, vm.addr(signerKey), payee, signerKey);
        _submit(raiser, id, _none(), g, keySig, giverSig);
    }

    function _hand(uint256 id) internal view returns (HandView memory) {
        return handOf(core, id);
    }

    function _thankOf(uint256 id) internal view returns (ThankView memory) {
        return thankOf(core, id);
    }

    /// Not closed, and no thank is kept.
    function _assertOpen(uint256 id) internal view {
        assertEq(_hand(id).closedAt, 0);
        assertEq(_thankOf(id).giveHash, bytes32(0));
        assertEq(_thankOf(id).dataHash, bytes32(0));
    }

    /// Closed now, and the thank's Give is kept.
    function _assertThankedNow(uint256 id) internal view {
        assertEq(_hand(id).closedAt, block.timestamp);
        assertTrue(_thankOf(id).giveHash != bytes32(0));
    }

    /// Closed now, and no thank is kept.
    function _assertReclaimedNow(uint256 id) internal view {
        assertEq(_hand(id).closedAt, block.timestamp);
        assertEq(_thankOf(id).giveHash, bytes32(0));
        assertEq(_thankOf(id).dataHash, bytes32(0));
    }

    /*//////////////////////////// raise ////////////////////////////*/

    function test_raise_locksTheRewardAndRecordsTheHand() public {
        uint256 before = usd.balanceOf(alice);

        vm.expectEmit(address(core));
        emit Raised(1, alice, address(usd), REWARD, expiry, root, 0, GAS_K, ASK);
        uint256 id = _raise(alice, address(usd), REWARD);

        assertEq(id, 1);
        assertEq(core.handsCount(), 1);
        assertEq(usd.balanceOf(address(core)), REWARD);
        assertEq(usd.balanceOf(alice), before - REWARD);

        HandView memory h = _hand(id);
        assertEq(h.raiser, alice);
        assertEq(h.expiry, expiry);
        assertEq(h.openedAt, block.timestamp);
        _assertOpen(id);
        assertEq(h.token, address(usd));
        assertEq(h.payoutGasK, GAS_K);
        assertEq(h.minClaimBps, 0);
        assertEq(h.reward, REWARD);
        assertEq(h.rootKey, root);
        assertEq(h.dataHash, ASK);
    }

    function test_raise_idsGrowFromOne() public {
        assertEq(_raise(alice, address(usd), REWARD), 1);
        assertEq(_raise(bob, address(usd), REWARD), 2);
        assertEq(_raise(alice, address(usd), REWARD), 3);
    }

    function test_raise_zeroRewardIsAllowed() public {
        uint256 id = _raise(alice, address(usd), 0);
        assertEq(usd.balanceOf(address(core)), 0);
        vm.warp(expiry);
        core.reclaim(id);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /// Core does not judge the hash: an empty one is the raiser's and the application's business.
    function test_raise_zeroDataHashIsAllowed() public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), REWARD, expiry, root, 0, GAS_K, bytes32(0));
        assertEq(_hand(id).dataHash, bytes32(0));
    }

    /// The hash outlives the Hand, so it can still be read once the Hand is closed.
    function test_raise_dataHashStaysAfterTheHandCloses() public {
        uint256 thanked = _raise(alice, address(usd), REWARD);
        uint256 reclaimed = _raise(alice, address(usd), REWARD);
        _thank(alice, thanked, carolKey);
        vm.warp(expiry);
        core.reclaim(reclaimed);

        assertEq(_hand(thanked).dataHash, ASK);
        assertEq(_hand(reclaimed).dataHash, ASK);
    }

    function test_raise_rejectsExpiryNotInTheFuture() public {
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), REWARD, uint40(block.timestamp), root, 0, GAS_K, ASK);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), REWARD, uint40(block.timestamp - 1), root, 0, GAS_K, ASK);
        vm.stopPrank();
        assertEq(core.handsCount(), 0);
    }

    /// A minimum above the whole reward would make the Hand impossible to thank: refused at raise.
    function test_raise_rejectsMinClaimAboveTheReward() public {
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.MinClaimTooHigh.selector);
        core.raise(address(usd), REWARD, expiry, root, 10_001, GAS_K, ASK);
        vm.expectRevert(AHandCore.MinClaimTooHigh.selector);
        core.raise(address(usd), REWARD, expiry, root, type(uint16).max, GAS_K, ASK);
        core.raise(address(usd), REWARD, expiry, root, 10_000, GAS_K, ASK); // the whole reward is fine
        vm.stopPrank();
        assertEq(core.handsCount(), 1);
    }

    /// Nobody can sign as the zero address, so a zero root key is refused at raise.
    function test_raise_rejectsZeroRootKey() public {
        vm.prank(alice);
        vm.expectRevert(AHandCore.ZeroRootKey.selector);
        core.raise(address(usd), REWARD, expiry, address(0), 0, GAS_K, ASK);
        assertEq(core.handsCount(), 0);
    }

    /// With several things wrong, the error names the first in the order of the checks: the time,
    /// then the arguments in their order. A zero root key comes before a minimum above the reward.
    function test_raise_firstWrongThingIsNamed() public {
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ZeroRootKey.selector);
        core.raise(address(usd), REWARD, expiry, address(0), 10_001, GAS_K, ASK);
        vm.expectRevert(AHandCore.ExpiryNotInFuture.selector);
        core.raise(address(usd), REWARD, uint40(block.timestamp), address(0), 10_001, GAS_K, ASK);
        vm.stopPrank();
    }

    function test_raise_acceptsExpiryOneSecondAhead() public {
        vm.prank(alice);
        core.raise(address(usd), REWARD, uint40(block.timestamp + 1), root, 0, GAS_K, ASK);
        assertEq(core.handsCount(), 1);
    }

    function test_raise_revertsWithoutAllowanceAndLeavesNoHand() public {
        vm.prank(alice);
        usd.approve(address(core), 0);
        vm.prank(alice);
        vm.expectRevert();
        core.raise(address(usd), REWARD, expiry, root, 0, GAS_K, ASK);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_revertsOnAddressWithoutCode() public {
        vm.prank(alice);
        vm.expectRevert();
        core.raise(makeAddr("not a token"), REWARD, expiry, root, 0, GAS_K, ASK);
        assertEq(core.handsCount(), 0);
    }

    function test_raise_rejectsSenderSideFee() public {
        SenderFeeToken t = new SenderFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), REWARD, expiry, root, 0, GAS_K, ASK);
    }

    function test_raise_rejectsReceiverSideFee() public {
        ReceiverFeeToken t = new ReceiverFeeToken();
        _fund(address(t), alice);
        vm.prank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.raise(address(t), REWARD, expiry, root, 0, GAS_K, ASK);
    }

    /// No expiry further ahead than the cap: a typo cannot lock the money for decades.
    function test_raise_refusesExpiryBeyondTheCap() public {
        uint256 cap = block.timestamp + core.MAX_TERM();
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ExpiryTooFar.selector);
        core.raise(address(usd), REWARD, uint40(cap + 1), root, 0, GAS_K, ASK);
        core.raise(address(usd), REWARD, uint40(cap), root, 0, GAS_K, ASK); // the cap itself is fine
        vm.stopPrank();
        assertEq(core.handsCount(), 1);
    }

    /*//////////////////////////// extend ////////////////////////////*/

    /// The raiser moves the expiry later. Nothing else of the Hand changes, so the signatures
    /// collected before still pass, after the old expiry too.
    function test_extend_movesTheExpiryLaterAndKeepsTheSignatures() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        HandView memory before = _hand(id);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        uint40 later = expiry + 10 days;

        vm.expectEmit(address(core));
        emit Extended(id, later);
        vm.prank(alice);
        core.extend(id, later);

        before.expiry = later;
        assertEq(abi.encode(_hand(id)), abi.encode(before));
        vm.warp(expiry); // the old expiry has come and gone
        _submit(alice, id, _none(), g, keySig, giverSig);
        assertEq(usd.balanceOf(carol), REWARD);
    }

    /// Only the raiser extends: nobody else, whichever side of the raiser's address it is on.
    function test_extend_onlyTheRaiser() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address[3] memory others = [bob, address(1), address(type(uint160).max)];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(AHandCore.NotRaiser.selector);
            core.extend(id, expiry + 1);
        }
    }

    /// Only before expiry: from that moment the Hand belongs to reclaim, and anyone may close it.
    function test_extend_onlyBeforeExpiry() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.startPrank(alice);
        vm.warp(expiry - 1);
        core.extend(id, expiry + 1); // a second before expiry is still in time
        vm.warp(expiry + 1); // exactly at the new expiry
        vm.expectRevert(AHandCore.Expired.selector);
        core.extend(id, expiry + 2);
        vm.warp(expiry + 2); // and any time after it
        vm.expectRevert(AHandCore.Expired.selector);
        core.extend(id, expiry + 3);
        vm.stopPrank();
    }

    /// Only later: the expiry never moves back, so nobody who counted on it loses time.
    function test_extend_onlyLater() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ExpiryNotLater.selector);
        core.extend(id, expiry);
        vm.expectRevert(AHandCore.ExpiryNotLater.selector);
        core.extend(id, expiry - 1);
        vm.stopPrank();
    }

    /// No further ahead than the cap, counted from now: extending again and again keeps a Hand
    /// alive, but never locks it for longer than the cap from the last move.
    function test_extend_notBeyondTheCap() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        uint256 cap = block.timestamp + core.MAX_TERM();
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.ExpiryTooFar.selector);
        core.extend(id, uint40(cap + 1));
        core.extend(id, uint40(cap));
        vm.stopPrank();
    }

    /// A closed Hand stays closed: neither a thanked nor a reclaimed nor an unknown Hand extends.
    function test_extend_onlyAnOpenHand() public {
        uint256 thanked = _raise(alice, address(usd), REWARD);
        _thank(alice, thanked, carolKey);
        uint256 reclaimed = _raise(alice, address(usd), REWARD);
        vm.warp(expiry);
        core.reclaim(reclaimed);
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.extend(thanked, expiry + 1);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.extend(reclaimed, expiry + 1);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.extend(99, expiry + 1);
        vm.stopPrank();
    }

    /// With several things wrong, the error names the first in the order of the checks: the Hand,
    /// who calls, the time, then the new expiry.
    function test_extend_firstWrongThingIsNamed() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.prank(bob);
        vm.expectRevert(AHandCore.NotRaiser.selector);
        core.extend(id, expiry); // not later either
        vm.warp(expiry);
        vm.prank(alice);
        vm.expectRevert(AHandCore.Expired.selector);
        core.extend(id, expiry); // not later either
    }

    /*//////////////////////////// fund ////////////////////////////*/

    /// The raiser adds to the reward. Signatures name shares, not amounts, so a route collected
    /// before pays its shares of the larger reward.
    function test_fund_addsToTheRewardAndTheRoutePaysItsShares() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address shaker = makeAddr("shaker");
        SignedShake[] memory shakes = _oneShake(id, shaker, 9_000); // the shaker keeps 10 %
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);

        vm.expectEmit(address(core));
        emit Funded(id, REWARD, 2 * REWARD);
        vm.prank(alice);
        core.fund(id, REWARD);
        assertEq(_hand(id).reward, 2 * REWARD);
        assertEq(usd.balanceOf(address(core)), 2 * REWARD);

        _submit(alice, id, shakes, g, keySig, giverSig);
        assertEq(usd.balanceOf(shaker), 2 * REWARD / 10);
        assertEq(usd.balanceOf(carol), 2 * REWARD * 9 / 10);
    }

    /// Unthanked, all of it goes back to the raiser.
    function test_fund_reclaimReturnsAllOfIt() public {
        uint256 before = usd.balanceOf(alice);
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.prank(alice);
        core.fund(id, 3 * REWARD);
        vm.warp(expiry);
        vm.expectEmit(address(core));
        emit Reclaimed(id, address(usd), 4 * REWARD);
        core.reclaim(id);
        assertEq(usd.balanceOf(alice), before);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /// Only the raiser funds: nobody else, whichever side of the raiser's address it is on.
    function test_fund_onlyTheRaiser() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address[3] memory others = [bob, address(1), address(type(uint160).max)];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(AHandCore.NotRaiser.selector);
            core.fund(id, REWARD);
        }
    }

    /// Only before expiry: from that moment the Hand belongs to reclaim.
    function test_fund_onlyBeforeExpiry() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.startPrank(alice);
        vm.warp(expiry - 1);
        core.fund(id, 1);
        vm.warp(expiry);
        vm.expectRevert(AHandCore.Expired.selector);
        core.fund(id, 1);
        vm.warp(expiry + 1);
        vm.expectRevert(AHandCore.Expired.selector);
        core.fund(id, 1);
        vm.stopPrank();
    }

    /// A closed Hand takes nothing more: neither a thanked nor a reclaimed nor an unknown Hand.
    function test_fund_onlyAnOpenHand() public {
        uint256 thanked = _raise(alice, address(usd), REWARD);
        _thank(alice, thanked, carolKey);
        uint256 reclaimed = _raise(alice, address(usd), REWARD);
        vm.warp(expiry);
        core.reclaim(reclaimed);
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.fund(thanked, 1);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.fund(reclaimed, 1);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.fund(99, 1);
        vm.stopPrank();
    }

    /// Like raise, fund measures both sides: a token that moves any other amount is refused.
    function test_fund_refusesAnInexactToken() public {
        SenderFeeToken s = new SenderFeeToken();
        ReceiverFeeToken r = new ReceiverFeeToken();
        _fund(address(s), alice);
        _fund(address(r), alice);
        uint256 a = _raise(alice, address(s), 0);
        uint256 b = _raise(alice, address(r), 0);
        vm.startPrank(alice);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.fund(a, REWARD);
        vm.expectRevert(AHandCore.InexactTransfer.selector);
        core.fund(b, REWARD);
        vm.stopPrank();
    }

    /// Adding nothing touches no token, so a Hand without a reward may name any address as token.
    function test_fund_nothingTouchesNoToken() public {
        vm.prank(alice);
        uint256 id = core.raise(makeAddr("not a token"), 0, expiry, root, 0, GAS_K, ASK);
        vm.prank(alice);
        core.fund(id, 0);
        assertEq(_hand(id).reward, 0);
    }

    /// With several things wrong, the error names the first in the order of the checks.
    function test_fund_firstWrongThingIsNamed() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.warp(expiry);
        vm.prank(bob);
        vm.expectRevert(AHandCore.NotRaiser.selector);
        core.fund(id, 1); // late too
    }

    /*//////////////////////////// reclaim ////////////////////////////*/

    function test_reclaim_returnsTheWholeRewardToTheRaiser() public {
        uint256 before = usd.balanceOf(alice);
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.warp(expiry);

        vm.expectEmit(address(core));
        emit Reclaimed(id, address(usd), REWARD);
        core.reclaim(id);

        assertEq(usd.balanceOf(alice), before);
        assertEq(usd.balanceOf(address(core)), 0);
        _assertReclaimedNow(id);
    }

    function test_reclaim_windowOpensExactlyAtExpiry() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.warp(expiry - 1);
        vm.expectRevert(AHandCore.NotExpired.selector);
        core.reclaim(id);
        vm.warp(expiry);
        core.reclaim(id);
    }

    function test_reclaim_anyoneMayCallButOnlyTheRaiserIsPaid() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        uint256 aliceBefore = usd.balanceOf(alice);
        uint256 bobBefore = usd.balanceOf(bob);
        vm.warp(expiry);

        vm.prank(bob);
        core.reclaim(id);

        assertEq(usd.balanceOf(alice), aliceBefore + REWARD);
        assertEq(usd.balanceOf(bob), bobBefore);
    }

    function test_reclaim_onlyOnce() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        _raise(bob, address(usd), REWARD); // money a second reclaim would steal
        vm.warp(expiry);
        core.reclaim(id);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.reclaim(id);
        assertEq(usd.balanceOf(address(core)), REWARD);
    }

    function test_reclaim_unknownHand() public {
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.reclaim(1);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.reclaim(0);
    }

    /// The moment of reclaim is recorded, not the expiry it waited for.
    function test_reclaim_recordsItsOwnMoment() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.warp(uint256(expiry) + 3 days);
        core.reclaim(id);
        _assertReclaimedNow(id);
    }

    /// An id never raised has no times at all and cannot be reclaimed.
    function test_unknownHand_hasNoOpenedAt() public {
        assertEq(_hand(42).raiser, address(0));
        assertEq(_hand(42).openedAt, 0);
        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.reclaim(42);
    }

    /*//////////////////////////// thank ////////////////////////////*/

    function test_thank_paysTheWholeRewardToTheGiver() public {
        uint256 id = _raise(alice, address(usd), REWARD);

        vm.expectEmit(address(core));
        emit Thanked(id, address(usd), REWARD, bytes32(0));
        vm.expectEmit(address(core));
        emit Given(id, carol, carol, REWARD, 10_000, bytes32(0), ANSWER);
        _thank(alice, id, carolKey);

        assertEq(usd.balanceOf(carol), REWARD);
        assertEq(usd.balanceOf(address(core)), 0);
        _assertThankedNow(id);
    }

    /// A Hand closes with its token and its whole reward named, whatever then reaches the payees:
    /// here the giver's payout only waits. Summed per token, the closing events give what was
    /// thanked and what was reclaimed; Paid and Pending tell what was delivered.
    function test_thank_namesTheWholeRewardEvenIfItsPayoutWaits() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), REWARD);
        t.setBlocked(carol, true);

        vm.expectEmit(address(core));
        emit Thanked(id, address(t), REWARD, bytes32(0));
        _thank(alice, id, carolKey);

        assertEq(core.pending(address(t), carol), REWARD);
    }

    /// With the thanks the raiser may state something of its own. Core keeps it in the Hand and
    /// logs it, and nothing else changes: the question, the accepted Give and the payout.
    function test_thank_keepsAndLogsWhatTheRaiserStates() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);

        vm.expectEmit(address(core));
        emit Thanked(id, address(usd), REWARD, THANKS);
        vm.prank(alice);
        core.thank(id, _none(), SignedGive(g, keySig, giverSig), THANKS);

        assertEq(_thankOf(id).dataHash, THANKS);
        assertEq(_thankOf(id).giveHash, giveStructHash(core, id, g));
        assertEq(_hand(id).dataHash, ASK);
        assertEq(usd.balanceOf(carol), REWARD);
    }

    /// A thank that states nothing keeps nothing and says so in its event.
    function test_thank_statingNothingKeepsNothing() public {
        uint256 id = _raise(alice, address(usd), REWARD);

        vm.expectEmit(address(core));
        emit Thanked(id, address(usd), REWARD, bytes32(0));
        _thank(alice, id, carolKey);

        assertEq(_thankOf(id).dataHash, bytes32(0));
    }

    /// Whatever the raiser states is kept as it is, and no signature of the route covers it: the
    /// same Give is thanked with any statement.
    function testFuzz_thank_keepsWhateverTheRaiserStates(bytes32 stated) public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);

        vm.prank(alice);
        core.thank(id, _none(), SignedGive(g, keySig, giverSig), stated);

        assertEq(_thankOf(id).dataHash, stated);
        assertEq(usd.balanceOf(carol), REWARD);
    }

    /// Core counts the Hands thanked and the Hands reclaimed; a raise counts as neither.
    function test_counts_thanksAndReclaims() public {
        uint256 first = _raise(alice, address(usd), REWARD);
        uint256 second = _raise(alice, address(usd), REWARD);
        uint256 third = _raise(alice, address(usd), REWARD);
        assertEq(core.thanksCount(), 0);
        assertEq(core.reclaimsCount(), 0);

        _thank(alice, first, carolKey);
        assertEq(core.thanksCount(), 1);
        assertEq(core.reclaimsCount(), 0);

        vm.warp(expiry);
        core.reclaim(second);
        core.reclaim(third);
        assertEq(core.thanksCount(), 1);
        assertEq(core.reclaimsCount(), 2);
        assertEq(core.handsCount(), 3);
    }

    /// The time a thank closed the Hand is written once and stays.
    function test_thank_timeIsWrittenOnce() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        uint256 at = block.timestamp + 1 hours;
        vm.warp(at);
        _thank(alice, id, carolKey);
        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.reclaim(id);
        assertEq(_hand(id).closedAt, at);
    }

    /// Any caller but the raiser is refused, whatever its address.
    function testFuzz_thank_onlyTheRaiser(address caller) public {
        vm.assume(caller != alice);
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.expectRevert(AHandCore.NotRaiser.selector);
        _submit(caller, id, _none(), g, keySig, giverSig);
    }

    function test_thank_windowClosesExactlyAtExpiry() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.warp(expiry);
        _thankReverts(alice, id, carolKey, AHandCore.Expired.selector);
    }

    /// And it stays closed: any time after expiry, thank is refused.
    function testFuzz_thank_refusedAnyTimeAfterExpiry(uint32 late) public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.warp(uint256(expiry) + late);
        _thankReverts(alice, id, carolKey, AHandCore.Expired.selector);
    }

    function test_thank_worksOneSecondBeforeExpiry() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.warp(expiry - 1);
        _thank(alice, id, carolKey);
        assertEq(usd.balanceOf(carol), REWARD);
    }

    function test_thank_onlyOnce() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        _raise(bob, address(usd), REWARD); // money a second thank would steal
        _thank(alice, id, carolKey);
        _thankReverts(alice, id, carolKey, AHandCore.NotOpen.selector);
        assertEq(usd.balanceOf(address(core)), REWARD);
    }

    function test_thank_unknownHand() public {
        _thankReverts(alice, 1, carolKey, AHandCore.NotOpen.selector);
    }

    function test_thank_closesReclaim() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        _raise(bob, address(usd), REWARD);
        _thank(alice, id, carolKey);
        vm.warp(expiry);
        vm.expectRevert(AHandCore.NotOpen.selector);
        core.reclaim(id);
    }

    /// Nobody helps themselves: the reward leaves only to someone else, or back by reclaim.
    function test_thank_raiserCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        _thankReverts(alice, id, aliceKey, AHandCore.GiverIsRaiser.selector);
        _assertOpen(id);
    }

    /// The check is on who signs, not where the money goes: the raiser cannot sign as giver
    /// even while sending the money to someone else.
    function test_thank_raiserCannotSignAsTheGiver() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = Give(alice, carol, 10_000, bytes32(0), ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), aliceKey, id, g);
        vm.expectRevert(AHandCore.GiverIsRaiser.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// With several things wrong, the error names the first in the order of the checks: who calls,
    /// then the time, then the Give's fields in their order. A Give signed by the raiser with no
    /// payee is refused for its signer; after expiry the same call is late; by anyone else, a stranger's.
    function test_thank_firstWrongThingIsNamed() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = Give(alice, address(0), 10_000, bytes32(0), ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), aliceKey, id, g);
        vm.expectRevert(AHandCore.GiverIsRaiser.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);

        vm.warp(expiry);
        vm.expectRevert(AHandCore.Expired.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
        vm.expectRevert(AHandCore.NotRaiser.selector);
        _submit(bob, id, _none(), g, keySig, giverSig);
    }

    function test_thank_zeroReward() public {
        uint256 id = _raise(alice, address(usd), 0);
        _thank(alice, id, carolKey);
        _assertThankedNow(id);
    }

    /// Core has no key, so it can never sign a Give.
    function test_thank_coreCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = _give(address(core));
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// A giver who cannot be paid now loses nothing: the Hand closes and the payout stays pending for the giver.
    function test_thank_blockedGiverPayoutStaysPending() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), REWARD);
        t.setBlocked(carol, true);

        vm.expectEmit(address(core));
        emit Pending(id, address(t), carol, REWARD);
        _thank(alice, id, carolKey);

        _assertThankedNow(id);
        assertEq(core.pending(address(t), carol), REWARD);
        assertEq(t.balanceOf(address(core)), REWARD);
    }

    function test_thank_lateFeeCannotEatAnotherHand() public {
        LateSenderFeeToken t = new LateSenderFeeToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 a = _raise(alice, address(t), REWARD);
        _raise(bob, address(t), REWARD);
        t.setFeeOn(true);
        _thank(alice, a, carolKey);
        assertEq(core.pending(address(t), carol), REWARD);
        assertEq(t.balanceOf(address(core)), 2 * REWARD);
    }

    /*//////////////////////////// give ////////////////////////////*/

    /// The raiser cannot name a giver who did not sign.
    function test_give_signatureOfSomeoneElse() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = _give(carol);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), bobKey, id, g);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// A Give must come from the end of its route, here the root key: the link itself.
    function test_give_needsTheLinkKey() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = _give(carol);
        bytes memory keySig = _signGive(address(core), bobKey, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    function test_give_cannotBeMovedToAnotherHand() public {
        uint256 first = _raise(alice, address(usd), REWARD);
        uint256 second = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(first, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, second, _none(), g, keySig, giverSig);
    }

    function test_give_coversTheData() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        g.dataHash = keccak256("another answer");
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// Where the money goes is signed: nobody can swap the payee after the giver signed.
    function test_give_coversThePayee() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        g.payee = alice;
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// The giver may take the money at another address, an exchange for example.
    function test_give_paysThePayeeTheSignerChose() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address exchange = makeAddr("exchange");
        Give memory g = Give(carol, exchange, 10_000, bytes32(0), ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        _submit(alice, id, _none(), g, keySig, giverSig);
        assertEq(usd.balanceOf(exchange), REWARD);
        assertEq(usd.balanceOf(carol), 0);
    }

    /// The claim in the Give is the one that reached its signer: the whole reward on a direct route.
    function test_give_namesTheClaimThatReachedIt() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = Give(carol, carol, 9_000, bytes32(0), ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// The route in the Give is the one the raiser submits: no Shakes here.
    function test_give_namesTheRoute() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = Give(carol, carol, 10_000, keccak256("another route"), ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidRouteHash.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    function test_give_cannotBeMovedToAnotherCore() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = _give(carol);
        address other = makeAddr("another core");
        bytes memory keySig = _signGive(other, ROOT_PK, id, g);
        bytes memory giverSig = _signGive(other, carolKey, id, g);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// After a fork the old chain id no longer signs anything here.
    function test_give_cannotBeMovedToAnotherChain() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// Nobody holds the zero address key: junk that recovers to zero must not pass for it.
    function test_give_zeroAddressCannotBeTheGiver() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = Give(address(0), carol, 10_000, bytes32(0), ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        vm.expectRevert();
        _submit(alice, id, _none(), g, keySig, new bytes(65));
        vm.expectRevert();
        _submit(alice, id, _none(), g, keySig, "");
        bytes memory carolSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        _submit(alice, id, _none(), g, keySig, carolSig);
        assertEq(usd.balanceOf(address(core)), REWARD);
    }

    /// The giver's payout must reach someone. Sent to the zero address it is burned, or, if the
    /// token refuses, stays pending where nobody can ever withdraw it. Refused for any reward.
    function test_give_zeroAddressCannotBeThePayee() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        Give memory g = Give(carol, address(0), 10_000, bytes32(0), ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.ZeroPayee.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);

        uint256 empty = _raise(alice, address(usd), 0);
        keySig = _signGive(address(core), ROOT_PK, empty, g);
        giverSig = _signGive(address(core), carolKey, empty, g);
        vm.expectRevert(AHandCore.ZeroPayee.selector);
        _submit(alice, empty, _none(), g, keySig, giverSig);
    }

    function test_give_malformedSignature() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.expectRevert();
        _submit(alice, id, _none(), g, keySig, hex"1234");
        vm.expectRevert();
        _submit(alice, id, _none(), g, hex"1234", giverSig);
    }

    /*//////////////////////////// signer ////////////////////////////*/

    /// A smart wallet signs through its code (ERC-1271): this one accepts its owner's signature.
    function test_signer_smartWalletSigns() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address wallet = address(new Wallet(carol));
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _directGive(id, wallet, wallet, carolKey);
        _submit(alice, id, _none(), g, keySig, giverSig);
        _assertThankedNow(id);
        assertEq(usd.balanceOf(wallet), REWARD);
    }

    /// A wallet that does not accept the signature fails only this Give: the Hand stays open for
    /// another one.
    function test_signer_walletRefusalFailsOnlyItsGive() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address wallet = address(new Wallet(carol));
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _directGive(id, wallet, wallet, bobKey);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
        _assertOpen(id);
        _thank(alice, id, carolKey);
        _assertThankedNow(id);
    }

    /// A wallet whose check burns all the gas it is handed costs the raiser one failed
    /// transaction, nothing more: the Hand stays open for another Give.
    function test_signer_walletBurningGasFailsOnlyTheThank() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address wallet = address(new BurningWallet());
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _directGive(id, wallet, wallet, carolKey);
        SignedShake[] memory none;
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        vm.prank(alice);
        core.thank{gas: 1_000_000}(id, none, SignedGive(g, keySig, giverSig), bytes32(0));
        _assertOpen(id);
        _thank(alice, id, carolKey);
        _assertThankedNow(id);
    }

    /// A wallet answering with a megabyte pays for its own answer: Core reads its first 32 bytes
    /// and copies nothing more, so the thank fits in 3 million gas. Copying the answer would take
    /// about 2.2 million more.
    function test_signer_walletHugeAnswerIsNotCopied() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address wallet = address(new HugeAnswerWallet(carol));
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _directGive(id, wallet, wallet, carolKey);
        SignedShake[] memory none;
        vm.prank(alice);
        core.thank{gas: 3_000_000}(id, none, SignedGive(g, keySig, giverSig), bytes32(0));
        _assertThankedNow(id);
    }

    /// One owner, two wallets: a Give names its signer, so what the owner signed for one wallet
    /// does not pass for the other.
    function test_signer_oneSignatureFitsOneWallet() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address first = address(new Wallet(carol));
        address second = address(new Wallet(carol));
        (,, bytes memory firstSig) = _directGive(id, first, first, carolKey);
        (Give memory g, bytes memory keySig,) = _directGive(id, second, second, carolKey);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        _submit(alice, id, _none(), g, keySig, firstSig);
    }

    /// A wallet not deployed yet has no code to ask, and its owner's key is not the address's own:
    /// the Give fails. Signatures that deploy the wallet first (ERC-6492) are not read.
    function test_signer_undeployedWalletCannotSign() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address wallet = makeAddr("wallet not deployed yet");
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _directGive(id, wallet, wallet, carolKey);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// An EIP-7702 account signs with its own key, which the protocol still lets act for it.
    /// Usually its code accepts that key as well.
    function test_signer_eip7702AccountSigns() public {
        vm.etch(carol, abi.encodePacked(hex"ef0100", address(new Wallet(carol)))); // carol delegates
        uint256 id = _raise(alice, address(usd), REWARD);
        _thank(alice, id, carolKey);
        _assertThankedNow(id);
    }

    /// An EIP-7702 account's own key passes whatever its code says, even when the code accepts
    /// another key instead or knows nothing of ERC-1271: that key can redirect the code at any
    /// time. The other key passes too, through the code.
    function test_signer_eip7702KeyStillSigns() public {
        (address newKey, uint256 newKeyPk) = makeAddrAndKey("new key");
        vm.etch(carol, abi.encodePacked(hex"ef0100", address(new Wallet(newKey)))); // carol delegates
        uint256 first = _raise(alice, address(usd), REWARD);
        _thank(alice, first, carolKey);
        _assertThankedNow(first);

        uint256 second = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _directGive(second, carol, carol, newKeyPk);
        _submit(alice, second, _none(), g, keySig, giverSig);
        _assertThankedNow(second);
    }

    /// An address that moved to regular code for good (EIP-8298 proposes this) has retired its
    /// key: only the code decides now.
    function test_signer_retiredKeyCannotSign() public {
        (address newKey, uint256 newKeyPk) = makeAddrAndKey("new key");
        vm.etch(carol, address(new Wallet(newKey)).code);
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory carolSig) = _direct(id, carolKey);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        _submit(alice, id, _none(), g, keySig, carolSig);

        (,, bytes memory newKeySig) = _directGive(id, carol, carol, newKeyPk);
        _submit(alice, id, _none(), g, keySig, newKeySig);
        _assertThankedNow(id);
    }

    /// Only the exact EIP-7702 mark keeps the key: other code of the same 23 bytes decides alone.
    function test_signer_onlyTheEip7702MarkKeepsTheKey() public {
        vm.etch(carol, new bytes(23)); // code that stops at once and answers nothing
        uint256 id = _raise(alice, address(usd), REWARD);
        _thankReverts(alice, id, carolKey, AHandCore.InvalidGiverSig.selector);
    }

    /// Only an address's own key or its own code signs for it: a random key or random bytes never
    /// pass for a plain account, a smart wallet, an EIP-7702 account or a precompile.
    function testFuzz_signer_nobodyElseSigns(uint256 key, bytes memory junk, uint8 precompile) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        (address newKey, uint256 newKeyPk) = makeAddrAndKey("new key");
        (address dave, uint256 daveKey) = makeAddrAndKey("dave");
        vm.assume(key != carolKey && key != newKeyPk && key != daveKey);
        vm.etch(dave, abi.encodePacked(hex"ef0100", address(new Wallet(newKey)))); // dave delegates
        uint256 id = _raise(alice, address(usd), REWARD);

        _assertNobodyElseSigns(id, carol, key, junk);
        _assertNobodyElseSigns(id, address(new Wallet(carol)), key, junk);
        _assertNobodyElseSigns(id, dave, key, junk);
        _assertNobodyElseSigns(id, address(uint160(bound(precompile, 1, 0x11))), key, junk);
        _assertOpen(id);
    }

    /// A Give from `signer` fails both when signed with `key` and when it carries `junk`.
    function _assertNobodyElseSigns(uint256 id, address signer, uint256 key, bytes memory junk) internal {
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _directGive(id, signer, signer, key);
        SignedShake[] memory none;
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        vm.prank(alice);
        core.thank{gas: 2_000_000}(id, none, SignedGive(g, keySig, giverSig), bytes32(0));
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        vm.prank(alice);
        core.thank{gas: 2_000_000}(id, none, SignedGive(g, keySig, junk), bytes32(0));
    }

    /*//////////////////////////// reorg ////////////////////////////*/

    /// Signatures collected for alice's Hand along one Shake; then the chain goes back to before her
    /// raise, as in a reorg, and the same number is free again.
    function _collectThenReorg()
        internal
        returns (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig)
    {
        uint256 beforeRaise = vm.snapshotState();
        id = _raise(alice, address(usd), REWARD);
        shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (g, keySig, giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.revertToState(beforeRaise);
    }

    /// After a reorg a stranger takes the same number with a copy of everything she can copy: the
    /// root key, the question and the rules. Only the raiser differs, and none of the signatures
    /// collected for alice's Hand pass on hers.
    function test_reorg_strangerCopyingTheWholeHandGetsNoSignature() public {
        address mallory = makeAddr("mallory");
        _fund(address(usd), mallory);
        (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig) =
            _collectThenReorg();
        vm.prank(mallory);
        assertEq(core.raise(address(usd), 1, expiry, root, 0, GAS_K, ASK), id);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(mallory, id, shakes, g, keySig, giverSig);
    }

    /// A stranger may sign the first Shake again with her own root key, but the Give still names
    /// alice's Hand.
    function test_reorg_strangerResigningTheFirstShakeGetsNoGive() public {
        (address mallory, uint256 malloryKey) = makeAddrAndKey("mallory");
        _fund(address(usd), mallory);
        (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig) =
            _collectThenReorg();
        vm.prank(mallory);
        assertEq(core.raise(address(usd), 1, expiry, mallory, 0, GAS_K, keccak256("another question")), id);
        shakes[0].keySig = _signShake(malloryKey, id, shakes[0].shake);
        vm.expectRevert(AHandCore.InvalidRouteHash.selector);
        _submit(mallory, id, shakes, g, keySig, giverSig);
    }

    /// Every term a signature names counts. After a reorg alice's own Hand takes the number, the same
    /// in all but one of them — token, root key, minimum for the giver, payout gas or question — and
    /// no signature passes; with another root key, not even after the first Shake is signed again.
    function test_reorg_everySignedTermCounts() public {
        MockUSD otherToken = new MockUSD();
        _fund(address(otherToken), alice);
        for (uint256 k; k < 5; ++k) {
            (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig) =
                _collectThenReorg();
            vm.prank(alice);
            core.raise(
                k == 0 ? address(otherToken) : address(usd),
                REWARD,
                expiry,
                k == 1 ? vm.addr(0xA1A1) : root,
                k == 2 ? 100 : 0,
                k == 3 ? GAS_K + 1 : GAS_K,
                k == 4 ? keccak256("another question") : ASK
            );
            if (k == 1) {
                shakes[0].keySig = _signShake(0xA1A1, id, shakes[0].shake);
                vm.expectRevert(AHandCore.InvalidRouteHash.selector);
            } else {
                vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
            }
            _submit(alice, id, shakes, g, keySig, giverSig);
        }
    }

    /// A signature names the question and its rules, not the amount or the deadline: the same
    /// question raised again after a reorg, with another reward and expiry, keeps its signatures.
    function test_reorg_sameQuestionKeepsItsSignatures() public {
        (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig) =
            _collectThenReorg();
        vm.prank(alice);
        assertEq(core.raise(address(usd), REWARD / 2, expiry + 1 days, root, 0, GAS_K, ASK), id);
        _submit(alice, id, shakes, g, keySig, giverSig);
        _assertThankedNow(id);
    }

    /*//////////////////////////// route ////////////////////////////*/

    /// One Shake: the root key passes the Hand to NEXT_PK, keeping `10 000 - nextClaimBps` for `payee`.
    function _oneShake(
        uint256 id,
        address payee,
        uint16 nextClaimBps
    ) internal view returns (SignedShake[] memory shakes) {
        shakes = new SignedShake[](1);
        shakes[0].shake = Shake(vm.addr(NEXT_PK), payee, 10_000, nextClaimBps, SHAKE_DATA);
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
    }

    function _routeHash(uint256 id, SignedShake[] memory shakes) internal view returns (bytes32 routeHash) {
        for (uint256 i; i < shakes.length; ++i) {
            routeHash = keccak256(abi.encode(routeHash, shakeStructHash(core, id, shakes[i].shake)));
        }
    }

    /// The Give at the end of `shakes` for the signer with `signerKey`, signed by `lastKey` and by the signer.
    function _giveAt(
        uint256 id,
        SignedShake[] memory shakes,
        uint256 lastKey,
        uint256 signerKey
    ) internal view returns (Give memory g, bytes memory keySig, bytes memory giverSig) {
        uint16 claim = shakes.length == 0 ? 10_000 : shakes[shakes.length - 1].shake.nextClaimBps;
        address signer = vm.addr(signerKey);
        g = Give(signer, signer, claim, _routeHash(id, shakes), ANSWER);
        keySig = _signGive(address(core), lastKey, id, g);
        giverSig = _signGive(address(core), signerKey, id, g);
    }

    /// Alice thanks the signer with `signerKey` along a route of one Shake.
    function _thankAlong(uint256 id, SignedShake[] memory shakes, uint256 signerKey) internal {
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, signerKey);
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// The shaker keeps its margin, the giver gets the rest.
    function test_route_shakerKeepsItsMargin() public {
        address shaker = makeAddr("shaker");
        uint256 id = _raise(alice, address(usd), REWARD);
        _thankAlong(id, _oneShake(id, shaker, 9_000), carolKey);
        assertEq(usd.balanceOf(shaker), 10e6);
        assertEq(usd.balanceOf(carol), 90e6);
        assertEq(usd.balanceOf(address(core)), 0);
        _assertThankedNow(id);
    }

    /// Each act has its event, in the order of the route: the thank, every Shake with its margin
    /// and payout, then the Give with the giver's amount and payout. Shakes and the Give carry
    /// everything they signed, so anyone can rebuild them to prove the route to a contract.
    function test_route_isLogged() public {
        address shaker = makeAddr("shaker");
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, shaker, 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectEmit(address(core));
        emit Thanked(id, address(usd), REWARD, bytes32(0));
        vm.expectEmit(address(core));
        emit Shaken(id, shaker, 0, 10e6, vm.addr(NEXT_PK), 10_000, 9_000, SHAKE_DATA);
        vm.expectEmit(address(core));
        emit Paid(id, address(usd), shaker, 10e6);
        vm.expectEmit(address(core));
        emit Given(id, carol, carol, 90e6, 9_000, g.routeHash, ANSWER);
        vm.expectEmit(address(core));
        emit Paid(id, address(usd), carol, 90e6);
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// A giver who helps for nothing, paid at the Shake's own address, is still named with the
    /// amount: zero. Without it, the Shake's payout would be the last one and pass for the giver's.
    function test_route_givenNamesAZeroAmount() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, carol, 0);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectEmit(address(core));
        emit Paid(id, address(usd), carol, REWARD);
        vm.expectEmit(address(core));
        emit Given(id, carol, carol, 0, 0, g.routeHash, ANSWER);
        vm.recordLogs();
        _submit(alice, id, shakes, g, keySig, giverSig);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 fromCore;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(core)) ++fromCore;
        }
        assertEq(fromCore, 4); // Thanked, Shaken, Paid, Given; no Paid of zero
    }

    /// A Shake comes only from the key that holds the Hand: here the root key.
    function test_route_shakeMustBeSignedByTheRootKey() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        shakes[0].keySig = _signShake(bobKey, id, shakes[0].shake);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// Link keys sign only plainly: with a wallet's address as the root key, neither a Give nor a
    /// Shake from it passes, though the wallet would accept the root key's signature.
    function test_route_linkKeyCannotBeAWallet() public {
        address wallet = address(new Wallet(root));
        vm.prank(alice);
        uint256 id = core.raise(address(usd), REWARD, expiry, wallet, 0, GAS_K, ASK);

        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);

        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (g, keySig, giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// A Shake is signed for one Hand: the same link key cannot reuse it on another Hand.
    function test_route_shakeIsBoundToItsHand() public {
        uint256 first = _raise(alice, address(usd), REWARD);
        uint256 second = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(first, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(second, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, second, shakes, g, keySig, giverSig);
    }

    /// A Shake starts from exactly the claim it received and cannot pass on more than that.
    function test_route_shakeContinuesItsClaim() public {
        uint256 id = _raise(alice, address(usd), REWARD);
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
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = new SignedShake[](2);
        shakes[0].shake = Shake(vm.addr(NEXT_PK), first, 10_000, 9_000, SHAKE_DATA);
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        shakes[1].shake = Shake(vm.addr(lastPk), second, 9_000, 8_500, SHAKE_DATA);
        shakes[1].keySig = _signShake(ROOT_PK, id, shakes[1].shake); // the root no longer holds the Hand
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, lastPk, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 1));
        _submit(alice, id, shakes, g, keySig, giverSig);

        shakes[1].keySig = _signShake(NEXT_PK, id, shakes[1].shake);
        (g, keySig, giverSig) = _giveAt(id, shakes, lastPk, carolKey);
        _submit(alice, id, shakes, g, keySig, giverSig);
        assertEq(usd.balanceOf(first), 10e6);
        assertEq(usd.balanceOf(second), 5e6);
        assertEq(usd.balanceOf(carol), 85e6);
    }

    /// Each pass over the route hands its memory back, so a Shake's signature is checked in the
    /// very memory where the previous Shake's signer was just recovered. Junk in its place still
    /// fails, even when the previous Shake was signed by the same key and passed the Hand to it.
    function testFuzz_route_junkNeverPassesOnALaterShake(bytes32 r, bytes32 s, uint8 v) public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = new SignedShake[](2);
        shakes[0].shake = Shake(root, makeAddr("first shaker"), 10_000, 9_000, SHAKE_DATA); // to the same key
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        shakes[1].shake = Shake(vm.addr(NEXT_PK), makeAddr("second shaker"), 9_000, 8_000, SHAKE_DATA);
        shakes[1].keySig = abi.encodePacked(r, s, v);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert();
        _submit(alice, id, shakes, g, keySig, giverSig);
        _assertOpen(id);
    }

    /// The same for the Give: junk in place of the last key's signature fails right after a Shake
    /// that passed the Hand back to the very key that signed it.
    function testFuzz_route_junkNeverPassesForTheLastKey(bytes32 r, bytes32 s, uint8 v) public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = new SignedShake[](1);
        shakes[0].shake = Shake(root, makeAddr("shaker"), 10_000, 9_000, SHAKE_DATA); // back to the same key
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        (Give memory g,, bytes memory giverSig) = _giveAt(id, shakes, ROOT_PK, carolKey);
        vm.expectRevert();
        _submit(alice, id, shakes, g, abi.encodePacked(r, s, v), giverSig);
        _assertOpen(id);
    }

    /// A Shake without a payee may pass the Hand on but never keep a margin.
    function test_route_anonymousShakeKeepsNothing() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, address(0), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.AnonymousMargin.selector, 0));
        _submit(alice, id, shakes, g, keySig, giverSig);

        _thankAlong(id, _oneShake(id, address(0), 10_000), carolKey);
        assertEq(usd.balanceOf(carol), REWARD);
    }

    /// The Give must come from the key the Shake passed the Hand to, not from the root.
    function test_route_giveComesFromTheNextKey() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, ROOT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 1));
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// The giver holds only the next key, so she cannot drop the Shake to take its margin:
    /// a Give over the shorter route would need the root key.
    function test_route_giverCannotDropTheShake() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, _none(), NEXT_PK, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
    }

    /// The Give names the route it ends: a Give for no Shakes cannot close a route with one.
    function test_route_giveNamesItsRoute() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        Give memory g = Give(carol, carol, 9_000, bytes32(0), ANSWER);
        bytes memory keySig = _signGive(address(core), NEXT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(AHandCore.InvalidRouteHash.selector);
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// The claim in the Give is the one the Shake passed on.
    function test_route_giveNamesTheClaimThatReachedIt() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        Give memory g = Give(carol, carol, 10_000, _routeHash(id, shakes), ANSWER);
        bytes memory keySig = _signGive(address(core), NEXT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), carolKey, id, g);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 1));
        _submit(alice, id, shakes, g, keySig, giverSig);
    }

    /// The raiser's minimum for the giver holds against any route.
    function test_route_minimumForTheGiver() public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), REWARD, expiry, root, 9_500, GAS_K, ASK);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        vm.expectRevert(AHandCore.BelowMinClaim.selector);
        _submit(alice, id, shakes, g, keySig, giverSig);

        _thankAlong(id, _oneShake(id, makeAddr("shaker"), 9_500), carolKey);
        assertEq(usd.balanceOf(carol), 95e6);
    }

    /// With several things wrong in the Give, the error names the first in the order of the checks:
    /// its claim and its route against the route followed, then the raiser's minimum, then the
    /// signatures. Here the route leaves less than the minimum and the Give is not signed at all.
    function test_route_firstWrongThingInTheGiveIsNamed() public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), REWARD, expiry, root, 9_500, GAS_K, ASK);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        bytes32 routeHash = _routeHash(id, shakes);

        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 1));
        _submit(alice, id, shakes, Give(carol, carol, 10_000, bytes32(0), ANSWER), "", "");
        vm.expectRevert(AHandCore.InvalidRouteHash.selector);
        _submit(alice, id, shakes, Give(carol, carol, 9_000, bytes32(0), ANSWER), "", "");
        vm.expectRevert(AHandCore.BelowMinClaim.selector);
        _submit(alice, id, shakes, Give(carol, carol, 9_000, routeHash, ANSWER), "", "");
    }

    /// A Hand whose root key nobody holds can never be thanked, only reclaimed. An address
    /// hashed from an open string is such a key, and anyone can check that.
    function test_route_rootKeyNobodyHoldsLeavesOnlyReclaim() public {
        address nobodys = address(uint160(uint256(keccak256("a root key nobody holds"))));
        vm.prank(alice);
        uint256 id = core.raise(address(usd), REWARD, expiry, nobodys, 0, GAS_K, ASK);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        _submit(alice, id, _none(), g, keySig, giverSig);
        vm.warp(expiry);
        core.reclaim(id);
        _assertReclaimedNow(id);
    }

    /// A Shake may pass the link to the zero key. Nobody holds that key, so the branch is dead:
    /// nothing after it can be signed. Signature recovery answers "zero" for anything it cannot
    /// read, so these tests pin that no such answer ever counts as the zero key's signature.
    /// Any refusal will do: the error may change, the refusal may not.
    function _deadBranch(uint256 id) internal view returns (SignedShake[] memory shakes) {
        shakes = new SignedShake[](1);
        shakes[0].shake = Shake(address(0), address(0), 10_000, 10_000, SHAKE_DATA);
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
    }

    /// Signatures that are not the zero key's: unreadable ones, an all-zero one, and a real one by
    /// another key.
    function _notTheZeroKeys(bytes memory realOfAnotherKey) internal pure returns (bytes[] memory sigs) {
        sigs = new bytes[](7);
        sigs[0] = "";
        sigs[1] = hex"00";
        sigs[2] = new bytes(64);
        sigs[3] = new bytes(65);
        sigs[4] = new bytes(66);
        sigs[5] = abi.encodePacked(bytes32(0), bytes32(0), uint8(27));
        sigs[6] = realOfAnotherKey;
    }

    /// After a dead branch, a Give "from the zero key" pays nobody, whatever stands for the last
    /// key's signature. The same Give after a live branch passes: only that signature is wrong.
    function test_route_giveFromADeadBranchIsRefused() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (address thief, uint256 thiefKey) = makeAddrAndKey("thief");
        SignedShake[] memory shakes = _deadBranch(id);
        Give memory g = Give(thief, thief, 10_000, _routeHash(id, shakes), ANSWER);
        bytes memory giverSig = _signGive(address(core), thiefKey, id, g);
        bytes[] memory sigs = _notTheZeroKeys(giverSig);
        for (uint256 i; i < sigs.length; ++i) {
            vm.expectRevert();
            _submit(alice, id, shakes, g, sigs[i], giverSig);
        }
        assertEq(usd.balanceOf(thief), 0);

        shakes[0].shake.nextKey = vm.addr(NEXT_PK);
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        g.routeHash = _routeHash(id, shakes);
        _submit(
            alice, id, shakes, g, _signGive(address(core), NEXT_PK, id, g), _signGive(address(core), thiefKey, id, g)
        );
        assertEq(usd.balanceOf(thief), REWARD);
    }

    /// After a dead branch, a Shake "from the zero key" that keeps the whole reward pays nobody,
    /// whatever stands for its signature. The same Shake after a live branch passes.
    function test_route_shakeFromADeadBranchIsRefused() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (address thief, uint256 thiefKey) = makeAddrAndKey("thief");
        SignedShake[] memory shakes = new SignedShake[](2);
        shakes[0] = _deadBranch(id)[0];
        shakes[1].shake = Shake(thief, thief, 10_000, 0, SHAKE_DATA); // keeps it all, passes on to itself
        bytes[] memory sigs = _notTheZeroKeys(_signShake(thiefKey, id, shakes[1].shake));
        for (uint256 i; i < sigs.length; ++i) {
            shakes[1].keySig = sigs[i];
            Give memory g = Give(thief, thief, 0, _routeHash(id, shakes), ANSWER);
            bytes memory sig = _signGive(address(core), thiefKey, id, g);
            vm.expectRevert();
            _submit(alice, id, shakes, g, sig, sig);
        }
        assertEq(usd.balanceOf(thief), 0);

        shakes[0].shake.nextKey = vm.addr(NEXT_PK);
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        shakes[1].keySig = _signShake(NEXT_PK, id, shakes[1].shake);
        Give memory live = Give(thief, thief, 0, _routeHash(id, shakes), ANSWER);
        bytes memory liveSig = _signGive(address(core), thiefKey, id, live);
        _submit(alice, id, shakes, live, liveSig, liveSig);
        assertEq(usd.balanceOf(thief), REWARD);
    }

    /// A key signature Core cannot read is refused like one by another key, with the place where it
    /// stands: the Shake's, or the number of Shakes for the Give. Unreadable means the wrong length,
    /// zeros, a `v` other than 27 or 28, or a real signature turned into its second form, with the
    /// high `s`, which recovery would accept for the same key.
    function test_route_unreadableKeySigNamesItsPlace() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        bytes memory shakeSig = shakes[0].keySig;
        bytes[] memory badShakeSigs = _unreadable(shakeSig);
        bytes[] memory badGiveSigs = _unreadable(keySig);
        for (uint256 i; i < badShakeSigs.length; ++i) {
            shakes[0].keySig = badShakeSigs[i];
            vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
            _submit(alice, id, shakes, g, keySig, giverSig);

            shakes[0].keySig = shakeSig;
            vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 1));
            _submit(alice, id, shakes, g, badGiveSigs[i], giverSig);
        }
        _submit(alice, id, shakes, g, keySig, giverSig);
        _assertThankedNow(id);
    }

    /// Unreadable forms of a key signature: lengths around 65, zeros, a bad `v`, and the
    /// signature's second form with the high `s`.
    function _unreadable(bytes memory real) internal pure returns (bytes[] memory sigs) {
        bytes32 r;
        bytes32 s;
        assembly ("memory-safe") {
            r := mload(add(real, 0x20))
            s := mload(add(real, 0x40))
        }
        uint8 v = uint8(real[64]);
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        sigs = new bytes[](8);
        sigs[0] = "";
        sigs[1] = hex"00";
        sigs[2] = abi.encodePacked(r, s);
        sigs[3] = abi.encodePacked(real, uint8(0));
        sigs[4] = new bytes(65);
        sigs[5] = abi.encodePacked(bytes32(0), bytes32(0), uint8(27));
        sigs[6] = abi.encodePacked(r, s, uint8(29));
        sigs[7] = abi.encodePacked(r, highS, v == 27 ? uint8(28) : uint8(27));
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
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        _submit(alice, id, shakes, g, keySig, giverSig);
        assertEq(_thankOf(id).giveHash, giveStructHash(core, id, g));
    }

    /// A Shake whose payee refuses the money leaves only its own margin pending.
    function test_route_refusedMarginStaysPendingTheGiverIsPaid() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        address shaker = makeAddr("shaker");
        vm.etch(shaker, type(Refuser).runtimeCode);
        t.setHooked(shaker, true);
        uint256 id = _raise(alice, address(t), REWARD);
        _thankAlong(id, _oneShake(id, shaker, 9_000), carolKey);
        assertEq(core.pending(address(t), shaker), 10e6);
        assertEq(t.balanceOf(carol), 90e6);
    }

    /// No exception by identity: the raiser may be a Shake's payee and gets its margin.
    function test_route_raiserMayBeAShakePayee() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        uint256 before = usd.balanceOf(alice);
        _thankAlong(id, _oneShake(id, alice, 9_000), carolKey);
        assertEq(usd.balanceOf(alice), before + 10e6);
        assertEq(usd.balanceOf(carol), 90e6);
    }

    /// The giver may also be the Shake's payee: each occurrence is paid.
    function test_route_giverMayAlsoBeTheShakePayee() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        _thankAlong(id, _oneShake(id, carol, 9_000), carolKey);
        assertEq(usd.balanceOf(carol), REWARD);
    }

    /// A Hand without a reward still logs its Shake, and touches no token.
    function test_route_zeroRewardLogsTheShakeAndTouchesNoToken() public {
        vm.prank(alice);
        uint256 id = core.raise(address(0), 0, expiry, root, 0, GAS_K, ASK);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        vm.recordLogs();
        _thankAlong(id, shakes, carolKey);
        assertEq(vm.getRecordedLogs().length, 3); // Thanked, Shaken and Given; no Paid, no Pending
    }

    /// A huge reward cannot overflow the margin.
    function test_route_hugeRewardDoesNotOverflow() public {
        uint256 big = type(uint256).max / 2;
        usd.mint(alice, big);
        uint256 id = _raise(alice, address(usd), big);
        address shaker = makeAddr("shaker");
        _thankAlong(id, _oneShake(id, shaker, 9_000), carolKey);
        assertEq(usd.balanceOf(shaker), big / 10);
        assertEq(usd.balanceOf(shaker) + usd.balanceOf(carol), big);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    function testFuzz_route_conservesTheReward(uint256 reward, uint16 next) public {
        reward = bound(reward, 0, type(uint128).max);
        next = uint16(bound(next, 0, 10_000));
        usd.mint(alice, reward);
        uint256 id = _raise(alice, address(usd), reward);
        address shaker = makeAddr("shaker");
        _thankAlong(id, _oneShake(id, shaker, next), carolKey);
        assertEq(usd.balanceOf(shaker), reward * (10_000 - next) / 10_000);
        assertEq(usd.balanceOf(shaker) + usd.balanceOf(carol), reward);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /// Gas Core spends in `thank` on a route of `n` Shakes that keep nothing, on a Hand without
    /// a reward, so that only the route itself is paid for. Called through `this`, so that every
    /// route is measured from a fresh call: read inside one long test, the number also grew with
    /// the test's own memory.
    function routeGas(uint256 n) external returns (uint256) {
        (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig) =
            _emptyRoute(n, 0);
        _submit(alice, id, shakes, g, keySig, giverSig);
        return vm.lastCallGas().gasTotalUsed;
    }

    /// A Hand with `reward` (none: no token at all) and a signed route of `n` Shakes that keep
    /// nothing, ending in carol's Give.
    function _emptyRoute(
        uint256 n,
        uint256 reward
    )
        internal
        returns (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig)
    {
        if (reward == 0) {
            vm.prank(alice);
            id = core.raise(address(0), 0, expiry, root, 0, GAS_K, ASK);
        } else {
            id = _raise(alice, address(usd), reward);
        }
        shakes = new SignedShake[](n);
        uint256 key = ROOT_PK;
        for (uint256 i; i < n; ++i) {
            uint256 nextKey = NEXT_PK + i;
            shakes[i].shake = Shake(vm.addr(nextKey), address(0), 10_000, 10_000, SHAKE_DATA);
            shakes[i].keySig = _signShake(key, id, shakes[i].shake);
            key = nextKey;
        }
        (g, keySig, giverSig) = _giveAt(id, shakes, key, carolKey);
    }

    /// Gas the calldata of a transaction costs: 4 for a zero byte, 16 for any other.
    function _calldataGas(bytes memory data) internal pure returns (uint256 gas) {
        for (uint256 i; i < data.length; ++i) {
            gas += data[i] == 0 ? 4 : 16;
        }
    }

    /// Calls `thank` as alice with the gas that one transaction carrying `data` has left to run.
    function _thankInOneTransaction(bytes memory data) internal returns (bool ok) {
        vm.prank(alice);
        (ok,) = address(core).call{gas: TX_GAS_CAP - 21_000 - _calldataGas(data)}(data);
    }

    /// Every Shake costs the same, however long the route: the hundredth adds exactly what the
    /// second does.
    function test_route_everyShakeCostsTheSame() public {
        this.routeGas(0); // the very first thank also starts Core's count of thanks
        uint256 second = this.routeGas(2) - this.routeGas(1);
        uint256 hundredth = this.routeGas(100) - this.routeGas(99);
        assertEq(hundredth, second);
    }

    /// The series from the owner's reminder of 07.11: a route of each of these lengths is thanked,
    /// and every Shake adds exactly the same gas, on both sides of 256.
    function test_route_seriesCostsLinearly() public {
        this.routeGas(0);
        uint256 one = this.routeGas(1);
        uint256 perShake = this.routeGas(2) - one;
        uint256[5] memory lengths = [uint256(6), 32, 255, 256, 257];
        for (uint256 i; i < lengths.length; ++i) {
            assertEq(this.routeGas(lengths[i]), one + (lengths[i] - 1) * perShake);
        }
    }

    /// Padding up to the largest transaction ordinary nodes accept still fits the gas one
    /// transaction may use: the size limit binds first, and the giver is paid (Р-45).
    function test_route_longestAcceptedRouteFitsTheGasCap() public {
        (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig) =
            _emptyRoute(LONGEST_ACCEPTED, REWARD);
        bytes memory data = abi.encodeCall(core.thank, (id, shakes, SignedGive(g, keySig, giverSig), bytes32(0)));
        assertLe(data.length + TX_ENVELOPE, TX_SIZE_LIMIT);
        assertTrue(_thankInOneTransaction(data));
        assertEq(usd.balanceOf(carol), REWARD);
    }

    /// A route that needs more gas than one transaction may use just fails, and nothing changes:
    /// the Hand stays open with its whole reward, and another route is still thanked.
    function test_route_tooLongForOneTransactionChangesNothing() public {
        (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig) =
            _emptyRoute(TOO_LONG, REWARD);
        assertFalse(
            _thankInOneTransaction(
                abi.encodeCall(core.thank, (id, shakes, SignedGive(g, keySig, giverSig), bytes32(0)))
            )
        );
        _assertOpen(id);
        assertEq(usd.balanceOf(address(core)), REWARD);
        _thank(alice, id, bobKey);
        _assertThankedNow(id);
    }

    /// After a route too long to thank, reclaim at expiry returns the whole reward: it reads no
    /// route, so a long one cannot touch it.
    function test_reclaim_afterATooLongRoutePaysInFull() public {
        (uint256 id, SignedShake[] memory shakes, Give memory g, bytes memory keySig, bytes memory giverSig) =
            _emptyRoute(TOO_LONG, REWARD);
        assertFalse(
            _thankInOneTransaction(
                abi.encodeCall(core.thank, (id, shakes, SignedGive(g, keySig, giverSig), bytes32(0)))
            )
        );
        vm.warp(expiry);
        uint256 before = usd.balanceOf(alice);
        core.reclaim(id);
        assertEq(usd.balanceOf(alice), before + REWARD);
        _assertReclaimedNow(id);
    }

    /*//////////////////////////// check ////////////////////////////*/

    /// The Give `g` after a route, signed by `lastKey` and by the signer with `signerKey`.
    function _signedGiveBy(
        uint256 id,
        Give memory g,
        uint256 lastKey,
        uint256 signerKey
    ) internal view returns (SignedGive memory) {
        return SignedGive(g, _signGive(address(core), lastKey, id, g), _signGive(address(core), signerKey, id, g));
    }

    /// `checkGive` refuses with `reason`. Everything is signed before the refusal is expected.
    function _checkGiveReverts(
        uint256 id,
        SignedShake[] memory shakes,
        SignedGive memory sg,
        bytes memory reason
    ) internal {
        vm.expectRevert(reason);
        core.checkGive(id, shakes, sg);
    }

    /// Anyone can ask Core where a route ends: its last key, the claim left for a giver, and the
    /// hash a Give must name. An empty route ends at the root key with the whole claim.
    function test_checkRoute_returnsWhereTheRouteEnds() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _twoShakes(id, makeAddr("first"), makeAddr("second"));

        vm.prank(bob);
        (address lastKey, uint16 claimBps, bytes32 routeHash) = core.checkRoute(id, shakes);
        assertEq(lastKey, vm.addr(0xC0C0));
        assertEq(claimBps, 8_500);
        assertEq(routeHash, _routeHash(id, shakes));

        (lastKey, claimBps, routeHash) = core.checkRoute(id, _none());
        assertEq(lastKey, root);
        assertEq(claimBps, 10_000);
        assertEq(routeHash, bytes32(0));
    }

    /// A route `thank` would refuse is refused the same way, Shake by Shake.
    function test_checkRoute_refusesWhatThankRefuses() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        address shaker = makeAddr("shaker");

        SignedShake[] memory notByRoot = _oneShake(id, shaker, 9_000);
        notByRoot[0].keySig = _signShake(NEXT_PK, id, notByRoot[0].shake);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0));
        core.checkRoute(id, notByRoot);

        SignedShake[] memory broken = _twoShakes(id, shaker, shaker);
        broken[1].shake.claimBps = 9_500; // does not continue the claim it received
        broken[1].keySig = _signShake(NEXT_PK, id, broken[1].shake);
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 1));
        core.checkRoute(id, broken);

        SignedShake[] memory forNobody = _oneShake(id, address(0), 9_000); // keeps a margin for nobody
        vm.expectRevert(abi.encodeWithSelector(AHandCore.AnonymousMargin.selector, 0));
        core.checkRoute(id, forNobody);
    }

    /// The claim a route leaves is returned, not judged: whether it is enough for a giver is a
    /// question about a Give, and `checkGive` answers it.
    function test_checkRoute_returnsAClaimBelowTheGiversMinimum() public {
        vm.prank(alice);
        uint256 id = core.raise(address(usd), REWARD, expiry, root, 8_000, GAS_K, ASK);
        SignedShake[] memory greedy = _oneShake(id, makeAddr("shaker"), 7_999);

        (, uint16 claimBps,) = core.checkRoute(id, greedy);
        assertEq(claimBps, 7_999);

        Give memory g = Give(carol, carol, 7_999, _routeHash(id, greedy), ANSWER);
        _checkGiveReverts(
            id,
            greedy,
            _signedGiveBy(id, g, NEXT_PK, carolKey),
            abi.encodeWithSelector(AHandCore.BelowMinClaim.selector)
        );
    }

    /// A Hand that was never raised has no route and no Give: both checks refuse it by name, before
    /// anything else. Its root key is zero, and an answer of zero would pass for a key with any
    /// reader that recovers signatures carelessly.
    function test_check_refusesAHandNeverRaised() public {
        vm.expectRevert(AHandCore.NotRaised.selector);
        core.checkRoute(99, _none());

        SignedShake[] memory shakes = _oneShake(99, makeAddr("shaker"), 9_000);
        vm.expectRevert(AHandCore.NotRaised.selector);
        core.checkRoute(99, shakes);

        bytes memory junk = hex"00";
        vm.expectRevert(AHandCore.NotRaised.selector);
        core.checkGive(99, _none(), SignedGive(Give(address(0), address(0), 1, bytes32(0), ANSWER), junk, junk));
        SignedGive memory sg = _signedGiveBy(99, Give(carol, carol, 10_000, bytes32(0), ANSWER), ROOT_PK, carolKey);
        vm.expectRevert(AHandCore.NotRaised.selector);
        core.checkGive(99, _none(), sg);
    }

    /// Anyone can ask Core whether a Give ends a route of a Hand. The answer is the Give's hash:
    /// the one Core keeps when the raiser thanks that Give. Asking changes nothing.
    function test_checkGive_returnsTheHashThankKeeps() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        bytes memory before = abi.encode(_hand(id));

        vm.prank(bob);
        bytes32 giveHash = core.checkGive(id, shakes, SignedGive(g, keySig, giverSig));
        assertEq(giveHash, giveStructHash(core, id, g));
        assertEq(abi.encode(_hand(id)), before);

        _submit(alice, id, shakes, g, keySig, giverSig);
        assertEq(_thankOf(id).giveHash, giveHash);
        assertEq(core.checkGive(id, shakes, SignedGive(g, keySig, giverSig)), giveHash); // a thanked Hand answers too
    }

    /// Only a Give its raiser signed is refused for its signer: a giver whose address is on either
    /// side of the raiser's passes.
    function test_checkGive_giverOnEitherSideOfTheRaiser() public {
        vm.prank(alice);
        uint256 byAlice = core.raise(address(usd), 0, expiry, root, 0, GAS_K, ASK);
        vm.prank(carol);
        uint256 byCarol = core.raise(address(usd), 0, expiry, root, 0, GAS_K, ASK);
        (Give memory toCarol, bytes memory keySigC, bytes memory giverSigC) = _direct(byAlice, carolKey);
        (Give memory toAlice, bytes memory keySigA, bytes memory giverSigA) = _direct(byCarol, aliceKey);

        assertEq(
            core.checkGive(byAlice, _none(), SignedGive(toCarol, keySigC, giverSigC)),
            giveStructHash(core, byAlice, toCarol)
        );
        assertEq(
            core.checkGive(byCarol, _none(), SignedGive(toAlice, keySigA, giverSigA)),
            giveStructHash(core, byCarol, toAlice)
        );
    }

    /// It answers at any time: the caller, the expiry and the Hand's outcome are not looked at.
    function test_checkGive_answersAfterExpiryAndReclaim() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        SignedGive memory sg = SignedGive(g, keySig, giverSig);
        bytes32 giveHash = giveStructHash(core, id, g);

        vm.warp(expiry);
        assertEq(core.checkGive(id, _none(), sg), giveHash);
        core.reclaim(id);
        assertEq(core.checkGive(id, _none(), sg), giveHash);
    }

    /// A Give `thank` would refuse is refused the same way.
    function test_checkGive_refusesWhatThankRefuses() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), 9_000);
        bytes32 route = _routeHash(id, shakes);
        Give memory good = Give(carol, carol, 9_000, route, ANSWER);

        // signed by the raiser itself
        _checkGiveReverts(
            id,
            shakes,
            _signedGiveBy(id, Give(alice, carol, 9_000, route, ANSWER), NEXT_PK, aliceKey),
            abi.encodeWithSelector(AHandCore.GiverIsRaiser.selector)
        );
        // no payee
        _checkGiveReverts(
            id,
            shakes,
            _signedGiveBy(id, Give(carol, address(0), 9_000, route, ANSWER), NEXT_PK, carolKey),
            abi.encodeWithSelector(AHandCore.ZeroPayee.selector)
        );
        // not the claim the route left
        _checkGiveReverts(
            id,
            shakes,
            _signedGiveBy(id, Give(carol, carol, 9_001, route, ANSWER), NEXT_PK, carolKey),
            abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 1)
        );
        // names another route
        _checkGiveReverts(
            id,
            shakes,
            _signedGiveBy(id, Give(carol, carol, 9_000, bytes32(0), ANSWER), NEXT_PK, carolKey),
            abi.encodeWithSelector(AHandCore.InvalidRouteHash.selector)
        );
        // not signed by the route's last key
        _checkGiveReverts(
            id,
            shakes,
            _signedGiveBy(id, good, ROOT_PK, carolKey),
            abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 1)
        );
        // not signed by its signer
        _checkGiveReverts(
            id,
            shakes,
            _signedGiveBy(id, good, NEXT_PK, bobKey),
            abi.encodeWithSelector(AHandCore.InvalidGiverSig.selector)
        );
    }

    /// With several things wrong, the error names the first in the order of `thank`'s checks: the
    /// Give's signer, its payee, and only then the route and the signatures.
    function test_checkGive_firstWrongThingIsNamed() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        bytes memory junk = hex"00";

        vm.expectRevert(AHandCore.GiverIsRaiser.selector);
        core.checkGive(id, _none(), SignedGive(Give(alice, address(0), 1, bytes32(uint256(1)), ANSWER), junk, junk));
        vm.expectRevert(AHandCore.ZeroPayee.selector);
        core.checkGive(id, _none(), SignedGive(Give(carol, address(0), 1, bytes32(uint256(1)), ANSWER), junk, junk));
        vm.expectRevert(abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 0));
        core.checkGive(id, _none(), SignedGive(Give(carol, carol, 1, bytes32(uint256(1)), ANSWER), junk, junk));
    }

    /// Whatever the Give, `checkGive` says what `thank` would do with it for a raiser in time: it
    /// passes exactly when the thank passes, and returns the hash the thank keeps.
    function testFuzz_checkGive_saysWhatThankWouldDo(
        uint16 next,
        bool lastKeySigns,
        bool giverSigns,
        bool hasPayee
    ) public {
        next = uint16(bound(next, 0, 10_000));
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _oneShake(id, makeAddr("shaker"), next);
        Give memory g = Give(carol, hasPayee ? carol : address(0), next, _routeHash(id, shakes), ANSWER);
        SignedGive memory sg = _signedGiveBy(id, g, lastKeySigns ? NEXT_PK : ROOT_PK, giverSigns ? carolKey : bobKey);

        bool passes;
        bytes32 giveHash;
        try core.checkGive(id, shakes, sg) returns (bytes32 hash) {
            (passes, giveHash) = (true, hash);
        } catch {}

        vm.prank(alice);
        try core.thank(id, shakes, sg, bytes32(0)) {
            assertTrue(passes);
            assertEq(_thankOf(id).giveHash, giveHash);
        } catch {
            assertFalse(passes);
        }
        assertEq(passes, lastKeySigns && giverSigns && hasPayee);
    }

    /*//////////////////////////// facts ////////////////////////////*/

    /// Two Shakes, each keeping a margin for its own payee, then the Give at NEXT_PK's successor.
    function _twoShakes(uint256 id, address first, address second) internal view returns (SignedShake[] memory shakes) {
        shakes = new SignedShake[](2);
        shakes[0].shake = Shake(vm.addr(NEXT_PK), first, 10_000, 9_000, SHAKE_DATA);
        shakes[0].keySig = _signShake(ROOT_PK, id, shakes[0].shake);
        shakes[1].shake = Shake(vm.addr(0xC0C0), second, 9_000, 8_500, keccak256("why I passed it on, too"));
        shakes[1].keySig = _signShake(NEXT_PK, id, shakes[1].shake);
    }

    function _unsigned(SignedShake[] memory signed) internal pure returns (Shake[] memory shakes) {
        shakes = new Shake[](signed.length);
        for (uint256 i; i < signed.length; ++i) {
            shakes[i] = signed[i].shake;
        }
    }

    /// A reader outside Core proves from Core's storage alone who helped in a thanked Hand and what
    /// each one was due: the raiser, the giver, every payee with its amount and reason, the answer.
    function test_facts_readerProvesWhoHelpedAndWhatEachWasDue() public {
        FactsReader reader = new FactsReader(core);
        address first = makeAddr("first shaker");
        address second = makeAddr("second shaker");
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _twoShakes(id, first, second);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, 0xC0C0, carolKey);
        _submit(alice, id, shakes, g, keySig, giverSig);

        (address raiser, address giver, FactsReader.Share[] memory shares) = reader.proveThank(id, _unsigned(shakes), g);
        assertEq(raiser, alice);
        assertEq(giver, carol);
        assertEq(shares.length, 3);
        assertEq(shares[0].payee, first);
        assertEq(shares[0].amount, usd.balanceOf(first));
        assertEq(shares[0].dataHash, SHAKE_DATA);
        assertEq(shares[1].payee, second);
        assertEq(shares[1].amount, usd.balanceOf(second));
        assertEq(shares[2].payee, carol);
        assertEq(shares[2].amount, usd.balanceOf(carol));
        assertEq(shares[2].dataHash, ANSWER);
    }

    /// A branch that was not thanked, or a Give changed in any field, proves nothing.
    function test_facts_otherRouteOrChangedGiveProvesNothing() public {
        FactsReader reader = new FactsReader(core);
        uint256 id = _raise(alice, address(usd), REWARD);
        SignedShake[] memory shakes = _twoShakes(id, makeAddr("first shaker"), makeAddr("second shaker"));
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, 0xC0C0, carolKey);
        _submit(alice, id, shakes, g, keySig, giverSig);

        Shake[] memory firstOnly = new Shake[](1);
        firstOnly[0] = shakes[0].shake;
        vm.expectRevert(FactsReader.NotTheThankedRoute.selector);
        reader.proveThank(id, firstOnly, g);

        Give memory changed = g;
        changed.payee = bob;
        vm.expectRevert(FactsReader.NotTheThankedGive.selector);
        reader.proveThank(id, _unsigned(shakes), changed);
        changed = g;
        changed.dataHash = keccak256("another answer");
        vm.expectRevert(FactsReader.NotTheThankedGive.selector);
        reader.proveThank(id, _unsigned(shakes), changed);
    }

    /// An open Hand and a reclaimed one have nothing to prove.
    function test_facts_openOrReclaimedHandHasNoFacts() public {
        FactsReader reader = new FactsReader(core);
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory g,,) = _direct(id, carolKey);
        Shake[] memory none;
        vm.expectRevert(FactsReader.NotThanked.selector);
        reader.proveThank(id, none, g);
        vm.warp(expiry);
        core.reclaim(id);
        vm.expectRevert(FactsReader.NotThanked.selector);
        reader.proveThank(id, none, g);
    }

    /// Whatever the reward and the margin, what the reader works out is exactly what Core paid.
    function testFuzz_facts_readerAmountsAreThePayouts(uint256 reward, uint16 next) public {
        reward = bound(reward, 0, 1e30);
        next = uint16(bound(next, 0, 10_000));
        FactsReader reader = new FactsReader(core);
        IMintable(address(usd)).mint(alice, reward);
        address shaker = makeAddr("shaker");
        uint256 id = _raise(alice, address(usd), reward);
        SignedShake[] memory shakes = _oneShake(id, shaker, next);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(id, shakes, NEXT_PK, carolKey);
        _submit(alice, id, shakes, g, keySig, giverSig);

        (,, FactsReader.Share[] memory shares) = reader.proveThank(id, _unsigned(shakes), g);
        assertEq(shares[0].amount, usd.balanceOf(shaker));
        assertEq(shares[1].amount, usd.balanceOf(carol));
        assertEq(shares[0].amount + shares[1].amount, reward);
    }

    /*//////////////////////////// awkward tokens ////////////////////////////*/

    function test_token_noReturnValueWorks() public {
        NoReturnToken t = new NoReturnToken();
        _fund(address(t), alice);
        uint256 before = t.balanceOf(alice);
        uint256 id = _raise(alice, address(t), REWARD);
        vm.warp(expiry);
        core.reclaim(id);
        assertEq(t.balanceOf(alice), before);
    }

    /// A `false` return must not count as paid: the payout stays pending, not lost.
    function test_token_falseReturnLeavesThePayoutPending() public {
        ReturnsFalseToken t = new ReturnsFalseToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), REWARD);
        t.setRefuses(alice, true);
        vm.warp(expiry);

        core.reclaim(id);
        _assertReclaimedNow(id);
        assertEq(core.pending(address(t), alice), REWARD);

        t.setRefuses(alice, false);
        core.withdraw(address(t), alice, alice);
        assertEq(t.balanceOf(address(core)), 0);
    }

    /// A blocked raiser hurts only their own Hand, and only while blocked.
    function test_token_blockedRaiserDoesNotTouchOtherHands() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 a = _raise(alice, address(t), REWARD);
        uint256 b = _raise(bob, address(t), REWARD);
        t.setBlocked(alice, true);
        vm.warp(expiry);

        core.reclaim(a);
        core.reclaim(b);
        assertEq(core.pending(address(t), alice), REWARD);
        assertEq(t.balanceOf(address(core)), REWARD);

        t.setBlocked(alice, false);
        core.withdraw(address(t), alice, alice);
        assertEq(t.balanceOf(address(core)), 0);
    }

    /// A fee switched on later must not let one payout eat another Hand's reward.
    function test_token_lateFeeCannotEatAnotherHand() public {
        LateSenderFeeToken t = new LateSenderFeeToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 a = _raise(alice, address(t), REWARD);
        _raise(bob, address(t), REWARD);
        t.setFeeOn(true);
        vm.warp(expiry);

        core.reclaim(a);
        assertEq(core.pending(address(t), alice), REWARD);
        assertEq(t.balanceOf(address(core)), 2 * REWARD);

        vm.expectRevert(AHandCore.InexactTransfer.selector); // what is pending waits too
        core.withdraw(address(t), alice, alice);

        t.setFeeOn(false);
        core.withdraw(address(t), alice, alice);
        assertEq(t.balanceOf(address(core)), REWARD);
    }

    /// A broken token stays in its own lane: another token's Hands are unaffected.
    function test_token_brokenTokenDoesNotReachOtherTokens() public {
        LateSenderFeeToken bad = new LateSenderFeeToken();
        _fund(address(bad), alice);
        uint256 a = _raise(alice, address(bad), REWARD);
        uint256 b = _raise(bob, address(usd), REWARD);
        bad.setFeeOn(true);
        vm.warp(expiry);

        core.reclaim(a); // the token itself fails: the payout stays pending
        core.reclaim(b);
        assertEq(core.pending(address(bad), alice), REWARD);
        assertEq(usd.balanceOf(address(core)), 0);
    }

    /*//////////////////////////// payouts ////////////////////////////*/

    function test_payout_emitsPaid() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        vm.expectEmit(address(core));
        emit Paid(id, address(usd), carol, REWARD);
        _thank(alice, id, carolKey);
        assertEq(core.pending(address(usd), carol), 0);
    }

    /// Every payout names its Hand, so an indexer tracks payouts without guessing from the order of
    /// the log: in one Hand a shaker is paid and the giver left pending, in another the raiser is paid back.
    function test_payout_eventsNameTheHand() public {
        BlacklistToken t = new BlacklistToken();
        _fund(address(t), alice);
        address shaker = makeAddr("shaker");
        uint256 thanked = _raise(alice, address(t), REWARD);
        uint256 reclaimed = _raise(alice, address(t), REWARD);
        t.setBlocked(carol, true);
        SignedShake[] memory shakes = _oneShake(thanked, shaker, 9_000);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _giveAt(thanked, shakes, NEXT_PK, carolKey);

        vm.expectEmit(address(core));
        emit Paid(thanked, address(t), shaker, 10e6);
        vm.expectEmit(address(core));
        emit Pending(thanked, address(t), carol, 90e6);
        _submit(alice, thanked, shakes, g, keySig, giverSig);

        vm.warp(expiry);
        vm.expectEmit(address(core));
        emit Paid(reclaimed, address(t), alice, REWARD);
        core.reclaim(reclaimed);
    }

    /// A payee whose code refuses the money has it pending; the Hand still closes.
    function test_payout_refusedPayoutStaysPending() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), REWARD);
        address payee = makeAddr("payee");
        vm.etch(payee, type(Refuser).runtimeCode); // carol signs and is paid at an address that misbehaves
        t.setHooked(payee, true);
        _thankTo(alice, id, carolKey, payee);
        assertEq(core.pending(address(t), payee), REWARD);
    }

    /// A payee that burns all the gas it is handed costs the thank no more than the Hand's
    /// payout gas: the thank still fits in 400 000 gas, and the payout stays pending. (Checked by
    /// outcome: Foundry miscounts gas measured around a call that asks for more than is left.)
    function test_payout_gasBurnerIsCapped() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), REWARD);
        address payee = makeAddr("payee");
        vm.etch(payee, type(Burner).runtimeCode);
        t.setHooked(payee, true);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _directGive(id, carol, payee, carolKey);
        SignedShake[] memory none;
        vm.prank(alice);
        core.thank{gas: 400_000}(id, none, SignedGive(g, keySig, giverSig), bytes32(0));
        assertEq(core.pending(address(t), payee), REWARD);
    }

    /// A token answering with a megabyte cannot make the thank fail.
    function test_payout_returndataBombLeavesThePayoutPending() public {
        ReturndataBombToken t = new ReturndataBombToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        SignedShake[] memory none;
        vm.prank(alice);
        core.thank{gas: 2_000_000}(id, none, SignedGive(g, keySig, giverSig), bytes32(0));
        assertEq(core.pending(address(t), carol), REWARD);
    }

    /// The payout gas is the raiser's choice per Hand, for thank and reclaim
    /// alike: too little leaves the payout pending.
    function test_payout_gasIsSetPerHand() public {
        vm.startPrank(alice);
        uint256 a = core.raise(address(usd), REWARD, expiry, root, 0, 1, ASK); // 1 000 gas cannot move a token
        uint256 b = core.raise(address(usd), REWARD, expiry, root, 0, 1, ASK);
        vm.stopPrank();
        _thank(alice, a, carolKey);
        assertEq(core.pending(address(usd), carol), REWARD);
        vm.warp(expiry);
        core.reclaim(b);
        assertEq(core.pending(address(usd), alice), REWARD);

        core.withdraw(address(usd), carol, carol);
        assertEq(usd.balanceOf(carol), REWARD);
    }

    /// The limit is counted in thousands of gas: a payee needing 150 000 is left pending
    /// under a 100 000 limit and paid under a 300 000 one.
    function test_payout_gasLimitIsInThousands() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        address payee = makeAddr("payee");
        vm.etch(payee, type(Heavy).runtimeCode);
        t.setHooked(payee, true);
        vm.startPrank(alice);
        uint256 low = core.raise(address(t), REWARD, expiry, root, 0, 100, ASK);
        uint256 high = core.raise(address(t), REWARD, expiry, root, 0, 300, ASK);
        vm.stopPrank();
        _thankTo(alice, low, carolKey, payee);
        _thankTo(alice, high, carolKey, payee);
        assertEq(core.pending(address(t), payee), REWARD);
        assertEq(t.balanceOf(payee), REWARD);
    }

    /// Picking the transaction gas cannot leave an honest payout of an ordinary token pending:
    /// it reverts or pays. The reclaim payout matters most, because anyone may call `reclaim`.
    function test_payout_underGassingPaysOrReverts() public {
        uint256 id = _raise(alice, address(usd), REWARD);
        (Give memory give, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        SignedShake[] memory none;
        uint256 paid;
        uint256 reverted;
        uint256 snap = vm.snapshotState();
        for (uint256 g = 20_000; g < 300_000; g += 100) {
            vm.prank(alice);
            try core.thank{gas: g}(id, none, SignedGive(give, keySig, giverSig), bytes32(0)) {
                assertEq(core.pending(address(usd), carol), 0);
                assertEq(usd.balanceOf(carol), REWARD);
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
                assertEq(usd.balanceOf(alice), before + REWARD);
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
        uint256 a = _raise(alice, address(t), REWARD);
        uint256 b = _raise(alice, address(t), 2 * REWARD);
        t.setBlocked(carol, true);
        _thank(alice, a, carolKey);
        _thank(alice, b, carolKey);
        assertEq(core.pending(address(t), carol), 3 * REWARD);

        t.setBlocked(carol, false);
        core.withdraw(address(t), carol, carol);
        assertEq(t.balanceOf(carol), 3 * REWARD);
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
        uint256 id = _raise(alice, address(t), REWARD);
        t.setBlocked(payee, true);
        uint256 key = payee == carol ? carolKey : bobKey;
        _thank(alice, id, key);
    }

    /// Anyone may send what is pending to its own payee.
    function test_withdraw_anyoneSendsToThePayee() public {
        BlacklistToken t = _leavePending(carol);
        t.setBlocked(carol, false);
        vm.expectEmit(address(core));
        emit Withdrawn(address(t), carol, REWARD, carol);
        vm.prank(bob);
        core.withdraw(address(t), carol, carol);
        assertEq(t.balanceOf(carol), REWARD);
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
        emit Withdrawn(address(t), carol, REWARD, fresh);
        vm.prank(carol);
        core.withdraw(address(t), carol, fresh);
        assertEq(t.balanceOf(fresh), REWARD);
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
        assertEq(core.pending(address(t), carol), REWARD);
    }

    /// What is cleared is the payee's pending amount, never the destination's (the bug Across shipped).
    function test_withdraw_clearsThePayeeNotTheDestination() public {
        BlacklistToken t = _leavePending(carol);
        uint256 other = _raise(alice, address(t), REWARD);
        t.setBlocked(bob, true);
        _thank(alice, other, bobKey);
        assertEq(core.pending(address(t), bob), REWARD);

        t.setBlocked(bob, false);
        vm.prank(carol);
        core.withdraw(address(t), carol, bob); // carol sends hers to bob, who has some pending too
        assertEq(t.balanceOf(bob), REWARD);
        assertEq(core.pending(address(t), carol), 0);
        assertEq(core.pending(address(t), bob), REWARD);
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
        assertEq(core.pending(address(t), carol), REWARD);
    }

    /// Nothing re-enters Core while a pending amount is paid out — not even a withdraw that would
    /// succeed on its own.
    function test_withdraw_reentryBlocked() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 a = _raise(alice, address(t), REWARD);
        uint256 b = _raise(alice, address(t), REWARD);
        address payeeA = makeAddr("payee a"); // both refuse once, so both have some pending
        address payeeB = makeAddr("payee b");
        vm.etch(payeeA, type(Refuser).runtimeCode);
        vm.etch(payeeB, type(Refuser).runtimeCode);
        t.setHooked(payeeA, true);
        t.setHooked(payeeB, true);
        _thankTo(alice, a, carolKey, payeeA);
        _thankTo(alice, b, bobKey, payeeB);
        t.setHooked(payeeA, false);
        t.setHooked(payeeB, false);
        t.setReentry(address(core), abi.encodeCall(core.withdraw, (address(t), payeeB, payeeB)), false, true, false);

        core.withdraw(address(t), payeeA, payeeA);

        assertFalse(t.lastReentryOk());
        assertEq(bytes4(t.lastReentryReturn()), AHandCore.Reentered.selector);
        assertEq(t.balanceOf(payeeA), REWARD);
        assertEq(core.pending(address(t), payeeB), REWARD);
        assertEq(t.balanceOf(address(core)), REWARD);
    }

    /*//////////////////////////// zero ////////////////////////////*/

    /// A Hand without a reward never touches a token, so any token address will do;
    /// closing it pays nothing and leaves nothing pending: no Paid, no Pending.
    function test_zeroReward_touchesNoToken() public {
        vm.prank(alice);
        uint256 a = core.raise(address(0), 0, expiry, root, 0, GAS_K, ASK);
        vm.expectEmit(address(core));
        emit Thanked(a, address(0), 0, bytes32(0));
        vm.recordLogs();
        _thank(alice, a, carolKey);
        assertEq(vm.getRecordedLogs().length, 2); // Thanked and Given only

        vm.prank(alice);
        uint256 b = core.raise(address(0xdead), 0, expiry, root, 0, GAS_K, ASK);
        vm.warp(expiry);
        vm.expectEmit(address(core));
        emit Reclaimed(b, address(0xdead), 0);
        vm.recordLogs();
        core.reclaim(b);
        assertEq(vm.getRecordedLogs().length, 1); // Reclaimed only
        _assertReclaimedNow(b);
    }

    /*//////////////////////////// reentrancy ////////////////////////////*/

    function test_reentry_reclaimInsideItsOwnPayoutPaysOnce() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        _fund(address(t), bob);
        uint256 id = _raise(alice, address(t), REWARD);
        _raise(bob, address(t), REWARD);
        t.setReentry(address(core), abi.encodeCall(core.reclaim, (id)), false, true, false);
        vm.warp(expiry);

        core.reclaim(id);

        assertFalse(t.lastReentryOk());
        assertEq(bytes4(t.lastReentryReturn()), AHandCore.Reentered.selector);
        assertEq(t.balanceOf(address(core)), REWARD);
    }

    function test_reentry_reclaimInsideRaiseCannotFakeAReward() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 old = _raise(alice, address(t), REWARD);
        vm.warp(expiry);
        t.setReentry(address(core), abi.encodeCall(core.reclaim, (old)), true, false, true);

        vm.prank(alice);
        vm.expectRevert(AHandCore.Reentered.selector);
        core.raise(address(t), REWARD, expiry + 1, root, 0, GAS_K, ASK);

        assertEq(core.handsCount(), 1);
        assertEq(t.balanceOf(address(core)), REWARD);
    }

    /// The token is its own raiser here, so it can re-enter `thank` with full authority.
    function test_reentry_thankInsideItsOwnPayoutPaysOnce() public {
        HookToken t = new HookToken();
        _fund(address(t), bob);
        t.mint(address(t), REWARD);
        vm.prank(address(t));
        t.approve(address(core), REWARD);
        uint256 id = _raise(address(t), address(t), REWARD);
        _raise(bob, address(t), REWARD);
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(id, carolKey);
        bytes memory data = abi.encodeCall(core.thank, (id, _none(), SignedGive(g, keySig, giverSig), bytes32(0)));
        t.setReentry(address(core), data, false, true, false);

        _submit(address(t), id, _none(), g, keySig, giverSig);

        assertFalse(t.lastReentryOk());
        assertEq(bytes4(t.lastReentryReturn()), AHandCore.Reentered.selector);
        assertEq(t.balanceOf(carol), REWARD);
        assertEq(t.balanceOf(address(core)), REWARD);
    }

    /// A Hand cannot be paid out while its own reward is still being transferred in.
    function test_reentry_thankInsideRaiseReverts() public {
        HookToken t = new HookToken();
        _fund(address(t), bob);
        _raise(bob, address(t), REWARD); // another Hand's reward the payout would borrow from
        t.mint(address(t), REWARD);
        vm.prank(address(t));
        t.approve(address(core), REWARD);
        uint256 next = core.handsCount() + 1;
        (Give memory g, bytes memory keySig, bytes memory giverSig) = _direct(next, carolKey);
        bytes memory data = abi.encodeCall(core.thank, (next, _none(), SignedGive(g, keySig, giverSig), bytes32(0)));
        t.setReentry(address(core), data, true, false, true);

        vm.prank(address(t));
        vm.expectRevert(AHandCore.Reentered.selector);
        core.raise(address(t), REWARD, expiry, root, 0, GAS_K, ASK);

        assertEq(t.balanceOf(carol), 0);
        assertEq(t.balanceOf(address(core)), REWARD);
        assertEq(core.handsCount(), 1);
    }

    /// Nothing changes a Hand from inside a payout, not even its expiry: the token is the raiser of
    /// another Hand here and tries to extend it while Core pays the giver.
    function test_reentry_extendInsideAPayoutIsRefused() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        t.mint(address(t), REWARD);
        vm.prank(address(t));
        t.approve(address(core), REWARD);
        uint256 own = _raise(address(t), address(t), REWARD);
        uint256 id = _raise(alice, address(t), REWARD);
        t.setReentry(address(core), abi.encodeCall(core.extend, (own, expiry + 1)), false, true, false);

        _thank(alice, id, carolKey);

        assertFalse(t.lastReentryOk());
        assertEq(bytes4(t.lastReentryReturn()), AHandCore.Reentered.selector);
        assertEq(_hand(own).expiry, expiry);
        assertEq(t.balanceOf(carol), REWARD);
    }

    /// The token cannot add to the Hand again while fund is moving its money.
    function test_reentry_fundInsideItsOwnTransferReverts() public {
        HookToken t = new HookToken();
        _fund(address(t), alice);
        uint256 id = _raise(alice, address(t), REWARD);
        t.setReentry(address(core), abi.encodeCall(core.fund, (id, 1)), true, false, true);

        vm.prank(alice);
        vm.expectRevert(AHandCore.Reentered.selector);
        core.fund(id, REWARD);

        assertEq(_hand(id).reward, REWARD);
        assertEq(t.balanceOf(address(core)), REWARD);
    }

    /// The lock stops nesting, not sequence: a contract raiser may call Core many times in a row.
    function test_reentry_lockAllowsCallsInARow() public {
        TwoInARow raiser = new TwoInARow();
        usd.mint(address(raiser), 2 * REWARD);
        raiser.go(core, usd, REWARD, expiry);
        assertEq(core.handsCount(), 2);
        assertEq(usd.balanceOf(address(core)), 2 * REWARD);
    }

    /*//////////////////////////// fuzz ////////////////////////////*/

    function testFuzz_raiseThenReclaimReturnsExactlyTheReward(uint256 amount, uint40 ahead, uint40 late) public {
        amount = bound(amount, 0, type(uint256).max - usd.totalSupply());
        uint40 e = uint40(block.timestamp + bound(ahead, 1, core.MAX_TERM()));
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

    function testFuzz_thankPaysExactlyTheReward(uint256 amount, uint40 ahead, uint40 at) public {
        amount = bound(amount, 0, type(uint256).max - usd.totalSupply());
        uint256 span = bound(ahead, 1, core.MAX_TERM());
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
        uint256 id = core.raise(address(usd), REWARD, expiry, root, 0, GAS_K, dataHash);
        assertEq(_hand(id).dataHash, dataHash);
    }

    function testFuzz_giveFromAnyKeyForAnyData(uint256 key, bytes32 data) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        address giver = vm.addr(key);
        vm.assume(giver != alice && giver != address(core));
        uint256 id = _raise(alice, address(usd), REWARD);
        uint256 before = usd.balanceOf(giver);

        Give memory g = Give(giver, giver, 10_000, bytes32(0), data);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), key, id, g);
        _submit(alice, id, _none(), g, keySig, giverSig);
        assertEq(usd.balanceOf(giver), before + REWARD);
    }

    function testFuzz_giveRejectsAnyOtherSigner(uint256 key, address claimed) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(claimed != vm.addr(key) && claimed != alice);
        uint256 id = _raise(alice, address(usd), REWARD);

        Give memory g = Give(claimed, carol, 10_000, bytes32(0), ANSWER);
        bytes memory keySig = _signGive(address(core), ROOT_PK, id, g);
        bytes memory giverSig = _signGive(address(core), key, id, g);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        _submit(alice, id, _none(), g, keySig, giverSig);
    }
}
