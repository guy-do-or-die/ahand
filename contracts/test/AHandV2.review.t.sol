// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
    Security review pins — DESIGN §5.3, §6.4, §9.5, §9.4.

    Each test here records a property the review verified by reading
    the code and then confirmed by execution. None of them is a Core
    vulnerability: the first two pin boundaries of the money surface
    and the verifier, the last two pin two Signals v2 (periphery)
    properties that the design accepts and the copy must state.
//////////////////////////////////////////////////////////////*/

import {AHandTestBase} from "./AHandTestBase.sol";
import {AHandSettlement} from "../src/AHandFacts.sol";
import {
    CapabilityProof,
    CharityNotAllowed,
    GiverAcceptanceInvalid,
    RaiseParams,
    ShakerAcceptanceInvalid,
    Status,
    Terminal
} from "../src/AHandTypes.sol";
import {AHandSignalsV2, UpContext} from "../src/AHandSignalsV2.sol";

/// @dev Answers the magic selector in the top four bytes and junk in the other
///      28 bytes of the word. ABI-conformant validators zero-pad; this one does not.
contract JunkPaddedMagic1271 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        assembly ("memory-safe") {
            mstore(0x00, or(shl(224, 0x1626ba7e), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff))
            return(0x00, 0x20)
        }
    }
}

contract AHandV2ReviewTest is AHandTestBase {
    AHandSignalsV2 signals;

    uint256 constant ATTACKER_PK = 0xA77ACC;
    address attacker;

    function setUp() public override {
        super.setUp();
        attacker = vm.addr(ATTACKER_PK);
        vm.label(attacker, "attacker");
        signals = new AHandSignalsV2(address(core), address(usd));
    }

    function ctx(uint256 handId) internal pure returns (UpContext memory) {
        return UpContext({handId: handId, reasonTag: bytes32(0), evidenceHash: bytes32(0)});
    }

    /*//////////////////// §9.5 — Core can never be a payee ////////////////////*/

    /// The grant proof needs Core itself outside every recipient variable. Core cannot
    /// hold a key, has no `isValidSignature` and is barred from the allowlist, so each
    /// role that would make it a payee fails closed with that role's own error.
    function test_Review_CoreIsNeverAPayee_InAnyRole() public {
        // charity: the allowlist door rejects Core (constructor and setter share it)
        vm.prank(policyAdmin);
        vm.expectRevert(CharityNotAllowed.selector);
        core.setCharityAllowed(address(core), true);

        // explicit shaker with a margin: Core must validate a ShakerAcceptance and cannot
        uint256 h1 = makeRaise();
        RouteBuild memory r1 = newRoute(h1);
        addHop(r1, E1, address(core), 0, 9_000, defaultDeadline());
        expectThankRevert(abi.encodeWithSelector(ShakerAcceptanceInvalid.selector, 0), r1, buildTerminal(r1));

        // giver: the GiverAcceptance is always required and Core cannot give it
        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newRoute(h2);
        Terminal memory t2 = buildTerminal(r2, address(core), 0, DEFAULT_SOLUTION, defaultDeadline());
        expectThankRevert(abi.encodeWithSelector(GiverAcceptanceInvalid.selector), r2, t2);

        // root capability: a Hand rooted at Core can never be settled (reclaim only)
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(core);
        uint256 h3 = makeRaise(p);
        RouteBuild memory r3 = newRoute(h3);
        expectThankRevert(abi.encodeWithSelector(CapabilityProof.selector, 0), r3, buildTerminal(r3));

        assertEq(claimOf(address(usd), address(core)), 0, "Core never accrues a claim on itself");
        assertEq(uint8(statusOf(h1)), uint8(Status.Active));
        assertEq(uint8(statusOf(h2)), uint8(Status.Active));
        assertEq(uint8(statusOf(h3)), uint8(Status.Active));
    }

    /*//////////////////// §6.4 — the magic-word comparison ////////////////////*/

    /// `_isValidSig` compares only the top four bytes of the returned word
    /// (`shr(224, mload(0))`), so a validator that returns the selector with junk in
    /// the low 28 bytes validates. OpenZeppelin's SignatureChecker compares the whole
    /// word. The looser rule is the design's own (§6.4) and harms nobody: only the
    /// validator's owner controls what it returns. Pinned so a tightening is deliberate.
    function test_Review_ERC1271_SelectorWithJunkPadding_Validates() public {
        JunkPaddedMagic1271 junk = new JunkPaddedMagic1271();
        uint256 h = makeRaise(noCharityParams());
        RouteBuild memory r = newRoute(h);
        Terminal memory t = buildTerminal(r, address(junk), 0, DEFAULT_SOLUTION, defaultDeadline());
        doThank(r, t);
        assertEq(uint8(statusOf(h)), uint8(Status.Settled));
        assertEq(usd.balanceOf(address(junk)), DEPOSIT);
    }

    /*//////////////////// §9.4 — Signals v2 periphery properties ////////////////////*/

    /// `down` is gated on holding a Thank receipt, but a receipt costs only gas: a
    /// zero-pot Hand raised, routed (zero hops) and given by one key, thanked by the
    /// same key and materialized by anyone makes that key a THANKED and GIVEN holder.
    /// Zero-burn Downs against any target are therefore permissionless in practice;
    /// D14 says apps weigh a zero-burn Down as they see fit, and this pins why they must.
    function test_Review_Signals_DownGate_SatisfiedByZeroPotSelfHand() public {
        RaiseParams memory p = zeroPotParams();
        p.rootCapability = attacker;
        uint256 h = makeRaiseAs(attacker, core, p, DEFAULT_REF, noTags());
        RouteBuild memory r = newRouteOn(core, h, ATTACKER_PK);
        Terminal memory t = buildTerminal(r, attacker, ATTACKER_PK, DEFAULT_SOLUTION, defaultDeadline());

        vm.recordLogs();
        doThankAs(attacker, r, t);
        AHandSettlement.SettlementPreimage memory pre = preimageFromLogsOn(core, vm.getRecordedLogs(), h);
        vm.prank(stranger);
        signals.materializeThank(pre);

        assertTrue(signals.isThankParticipant(attacker), "one zero-pot Hand is enough");
        assertEq(signals.balanceOf(attacker, signals.SIGNAL_UP()), 0, "no Up: raiser == giver, no donation");
        vm.prank(attacker);
        signals.down(giver, 0, ctx(h));
        assertEq(signals.balanceOf(giver, signals.SIGNAL_DOWN()), 1, "a zero-burn Down landed on an unrelated account");
    }

    /// The floor-sqrt curve is per account, so sqrt(a) + sqrt(b) ≥ sqrt(a + b): the same
    /// donation split across many giver accounts mints more Up in total, and `up()`
    /// lets the sybils concentrate it as received Up, which `levelOf` counts. 250 USDC
    /// donated over 25 Hands with 25 givers reaches level 3 on a target; the same 250
    /// USDC in one Hand gives its giver level 2 and the target it endorses level 2.
    /// D11/D39 accept the curve; the copy must not present a level as sybil-resistant.
    function test_Review_Signals_SplitDonation_AmplifiesLevelViaReceivedUp() public {
        address target = makeAddr("target");
        uint256 sybilUp;
        for (uint256 i; i < 25; ++i) {
            uint256 pk = 0x9000 + i;
            address g = vm.addr(pk);
            uint256 h = makeRaise(); // 100 USDC pool, 10 % donation: C = 10 USDC > 1 %
            RouteBuild memory r = newRoute(h);
            Terminal memory t = buildTerminal(r, g, pk, DEFAULT_SOLUTION, defaultDeadline());
            vm.recordLogs();
            doThank(r, t);
            vm.prank(stranger);
            signals.materializeThank(preimageFromLogsOn(core, vm.getRecordedLogs(), h));
            uint256 whole = signals.earnedUp(g) / signals.ONE_UP();
            assertEq(whole, 2, "each sybil giver: floor(sqrt(5e18)) = 2.23 Up");
            vm.prank(g);
            signals.up(target, whole, ctx(h));
            sybilUp += whole;
        }
        assertEq(sybilUp, 50);
        assertEq(signals.levelOf(target), 3, "25 x 10 USDC donations: target at level 3 (>= 25 Up)");

        // the honest shape: one Hand, one giver, the same 250 USDC donated
        address target2 = makeAddr("target2");
        RaiseParams memory p = defaultParams();
        p.amount = 2_500e6;
        uint256 hOne = makeRaise(p);
        RouteBuild memory rOne = newRoute(hOne);
        Terminal memory tOne = buildTerminal(rOne);
        vm.recordLogs();
        doThank(rOne, tOne);
        vm.prank(stranger);
        signals.materializeThank(preimageFromLogsOn(core, vm.getRecordedLogs(), hOne));
        uint256 honestWhole = signals.earnedUp(giver) / signals.ONE_UP();
        assertEq(honestWhole, 11, "one 250 USDC donation: floor(sqrt(1.25e20)) = 11.18 Up");
        assertEq(signals.levelOf(giver), 2);
        vm.prank(giver);
        signals.up(target2, honestWhole, ctx(hOne));
        assertEq(signals.levelOf(target2), 2, "same donation, honest shape: level 2");
    }
}
