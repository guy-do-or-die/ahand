// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test, Vm} from "forge-std/Test.sol";
import {AHandCore, Give, SignedGive, SignedShake} from "../src/AHandCore.sol";
import {OverlayToken} from "./mocks/OverlayToken.sol";
import {digestOf, giveStructHash} from "./Helpers.sol";

/// What a contract in front of Core may rely on, pinned. An overlay here is a token the raiser
/// holds instead of the plain asset: a wrapper that lends the reward out while it lies in Core and
/// hands the payee the plain asset when Core pays. Core knows nothing of it; these tests say which
/// of Core's habits such a token leans on, so that a later change to Core cannot take them away
/// unnoticed.
///   1. On a payout Core checks only that its own balance fell by the amount, not what the payee
///      received. So a token may pay the payee in something else, and `Paid` still means what it
///      says about Core.
///   2. Core is the caller of both legs: `transferFrom` on the way in, `transfer` on the way out.
///      A token may tell Core's moves from everyone else's by `msg.sender`.
///   3. On the way in the Hand is already written and `Raised` already emitted when the token is
///      called: the newest Hand's number is its number, and its raiser and reward are readable.
contract OverlayTest is Test {
    event Raised(
        uint256 indexed handId,
        address indexed raiser,
        address indexed token,
        uint256 reward,
        uint40 expiry,
        address rootKey,
        uint16 payoutGasK,
        uint16 minClaimBps,
        bytes32 dataHash
    );
    event Paid(uint256 indexed handId, address indexed token, address indexed payee, uint256 amount);
    event Pending(uint256 indexed handId, address indexed token, address indexed payee, uint256 amount);

    uint256 constant REWARD = 100e6;
    uint256 constant TOP_UP = 5e6;
    bytes32 constant ANSWER = keccak256("the salted answer");
    bytes32 constant ASK = keccak256("what the raiser asks for");
    uint16 constant GAS_K = 200;
    uint256 constant ROOT_PK = 0xA0A0;

    AHandCore core;
    OverlayToken overlay;
    address alice;
    address carol;
    uint256 carolKey;
    address root;
    uint40 expiry;

    function setUp() public {
        alice = makeAddr("alice");
        (carol, carolKey) = makeAddrAndKey("carol");
        root = vm.addr(ROOT_PK);
        core = new AHandCore();
        overlay = new OverlayToken(core);
        expiry = uint40(block.timestamp + 30 days);
        overlay.mint(alice, 1_000_000e6);
        vm.prank(alice);
        overlay.approve(address(core), type(uint256).max);
    }

    function _raise(uint16 payoutGasK) internal returns (uint256) {
        vm.prank(alice);
        return core.raise(address(overlay), REWARD, expiry, root, payoutGasK, 0, ASK);
    }

    function _signed(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(key, digest);
        return abi.encodePacked(r, sv, v);
    }

    /// Alice thanks Carol over the direct route.
    function _thank(uint256 handId) internal {
        Give memory give = Give(carol, carol, 10_000, bytes32(0), ANSWER);
        bytes32 digest = digestOf(address(core), giveStructHash(core, handId, give));
        SignedShake[] memory none;
        vm.prank(alice);
        core.thank(handId, none, SignedGive(give, _signed(ROOT_PK, digest), _signed(carolKey, digest)), bytes32(0));
    }

    /*//////////////////////// 1. only Core's own debit is checked ////////////////////////*/

    /// The thank pays Carol nothing in the token itself and the whole reward in the other ledger;
    /// Core calls it paid, because its own balance fell by exactly the reward.
    function test_overlay_thankChecksOnlyCoreDebit() public {
        uint256 handId = _raise(GAS_K);

        vm.expectEmit(address(core));
        emit Paid(handId, address(overlay), carol, REWARD);
        _thank(handId);

        assertEq(overlay.balanceOf(carol), 0, "no shares reach the payee");
        assertEq(overlay.redeemed(carol), REWARD, "the payee holds the underlying");
        assertEq(overlay.balanceOf(address(core)), 0);
        assertEq(overlay.totalSupply(), 1_000_000e6 - REWARD, "Core's shares were burned");
        assertEq(core.pending(address(overlay), carol), 0);
    }

    /// The refund goes the same way: the raiser gets the underlying, by anyone's call.
    function test_overlay_refundChecksOnlyCoreDebit() public {
        uint256 handId = _raise(GAS_K);
        vm.warp(expiry);

        vm.expectEmit(address(core));
        emit Paid(handId, address(overlay), alice, REWARD);
        core.refund(handId);

        assertEq(overlay.redeemed(alice), REWARD);
        assertEq(overlay.balanceOf(address(core)), 0);
        assertEq(core.pending(address(overlay), alice), 0);
    }

    /// A payout left pending is withdrawn the same way too: `withdraw` is a transfer from Core.
    function test_overlay_withdrawChecksOnlyCoreDebit() public {
        uint256 handId = _raise(0); // no gas for payouts: every one of them waits

        vm.expectEmit(address(core));
        emit Pending(handId, address(overlay), carol, REWARD);
        _thank(handId);
        assertEq(core.pending(address(overlay), carol), REWARD);
        assertEq(overlay.redeemed(carol), 0);

        core.withdraw(address(overlay), carol, carol);

        assertEq(overlay.redeemed(carol), REWARD);
        assertEq(overlay.balanceOf(carol), 0);
        assertEq(core.pending(address(overlay), carol), 0);
    }

    /// When the overlay cannot pay the underlying it moves shares instead, and Core's payout
    /// still lands: the two ways out are the token's choice, not Core's.
    function test_overlay_sharesGoOutWhenTheUnderlyingCannot() public {
        uint256 handId = _raise(GAS_K);
        overlay.setPoolDown(true);

        vm.expectEmit(address(core));
        emit Paid(handId, address(overlay), carol, REWARD);
        _thank(handId);

        assertEq(overlay.balanceOf(carol), REWARD);
        assertEq(overlay.redeemed(carol), 0);
        assertEq(core.pending(address(overlay), carol), 0);
    }

    /*//////////////////////// 2. Core is the caller on both legs ////////////////////////*/

    function test_overlay_coreIsTheSenderOnBothLegs() public {
        uint256 handId = _raise(GAS_K);
        assertEq(overlay.inboundCalls(), 1);
        assertTrue(overlay.inboundSenderIsCore());

        _thank(handId);
        assertEq(overlay.outboundCalls(), 1, "a direct route is one payout");
        assertTrue(overlay.outboundSenderIsCore());
    }

    /*//////////////////////// 3. the Hand is written before the pull ////////////////////////*/

    /// While Core pulls the reward, the newest Hand is the one being raised, with its raiser and
    /// reward already in storage, and `Raised` is already out: the token's own `Transfer` comes
    /// after it in the log.
    function test_overlay_handIsWrittenAndRaisedEmittedBeforeThePull() public {
        vm.recordLogs();
        uint256 handId = _raise(GAS_K);

        assertEq(overlay.inboundHandsCount(), handId, "the newest Hand is this one");
        assertEq(overlay.inboundRaiser(), alice);
        assertEq(overlay.inboundReward(), REWARD);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 raisedAt = type(uint256).max;
        uint256 transferAt = type(uint256).max;
        for (uint256 index = 0; index < logs.length; index++) {
            if (logs[index].emitter == address(core) && logs[index].topics[0] == Raised.selector) raisedAt = index;
            if (
                logs[index].emitter == address(overlay)
                    && logs[index].topics[0] == keccak256("Transfer(address,address,uint256)")
            ) {
                if (transferAt == type(uint256).max) transferAt = index;
            }
        }
        assertLt(raisedAt, transferAt, "Raised before the token's Transfer");
    }

    /// The same for a top-up: the Hand already carries the larger reward when the token is called.
    function test_overlay_rewardIsWrittenBeforeTheTopUpPull() public {
        uint256 handId = _raise(GAS_K);

        vm.prank(alice);
        core.fund(handId, TOP_UP);

        assertEq(overlay.inboundCalls(), 2);
        assertEq(overlay.inboundHandsCount(), handId);
        assertEq(overlay.inboundReward(), REWARD + TOP_UP);
        assertEq(overlay.balanceOf(address(core)), REWARD + TOP_UP);
    }
}
