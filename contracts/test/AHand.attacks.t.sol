// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Test.sol";
import "../src/AHandTypes.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {StaticAnchor} from "../src/StaticAnchor.sol";
import {AHandWitness} from "../src/AHandWitness.sol";

/*//////////////////////////////////////////////////////////////
                            MOCKS
//////////////////////////////////////////////////////////////*/

contract MockERC20 {
    string public name; uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    constructor(string memory n) { name = n; }
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) public virtual returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; _push(f, to, a); return true;
    }
    function _push(address, address to, uint256 a) internal virtual { balanceOf[to] += a; }
}

/// USDC-like: transfer to blocked address reverts.
contract BlacklistToken is MockERC20 {
    mapping(address => bool) public blocked;
    constructor() MockERC20("BL") {}
    function setBlocked(address a, bool b) external { blocked[a] = b; }
    function transfer(address to, uint256 a) public override returns (bool) {
        require(!blocked[to], "BLACKLISTED");
        return super.transfer(to, a);
    }
}

/// ERC777-like: triggers recipient contract hook (reentrancy / revert-recipient).
interface IPushHook { function onTokenPush() external; }
contract HookToken is MockERC20 {
    constructor() MockERC20("HOOK") {}
    function transfer(address to, uint256 a) public override returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a;
        if (to.code.length > 0) IPushHook(to).onTokenPush();   // hook AFTER transfer
        return true;
    }
}

contract RevertingReceiver is IPushHook {
    function onTokenPush() external pure { revert("NO THANKS"); }
}

contract ReenteringReceiver is IPushHook {
    AHandCore public core; uint256 public handId; bool public armed; bool public reentrySucceeded;
    function arm(AHandCore c, uint256 h) external { core = c; handId = h; armed = true; }
    function onTokenPush() external {
        if (armed) {
            armed = false;
            try core.finalize(handId) { reentrySucceeded = true; } catch {}
        }
    }
}

/*//////////////////////////////////////////////////////////////
                    BASE: actors, signatures, chains
//////////////////////////////////////////////////////////////*/

contract AHandBase is Test {
    AHandCore core;
    AHandSignals signals;
    StaticAnchor anchorC;
    MockERC20 usd;
    address raiser  = makeAddr("raiser");
    address charity = makeAddr("charity");
    address maint   = makeAddr("maint");
    address connA   = makeAddr("connA");
    address connB   = makeAddr("connB");
    address stranger = makeAddr("stranger");

    uint256 constant E0 = 0xE0aa; uint256 constant E1 = 0xE1aa;
    uint256 constant E2 = 0xE2aa; uint256 constant E3 = 0xE3aa;
    uint256 constant SOLVER_PK = 0x50aa;
    address solver;

    uint96 constant DEPOSIT = 100e6;

    function setUp() public virtual {
        solver = vm.addr(SOLVER_PK);
        address[] memory ch = new address[](1); ch[0] = charity;
        core = new AHandCore(ch, maint);
        signals = new AHandSignals(address(core));
        core.setSignals(address(signals));
        anchorC = new StaticAnchor();
        usd = new MockERC20("USD");
        anchorC.setRate(address(usd), 1e12);      // USDC-like: 6dec -> usd18
        signals.setAnchor(address(anchorC));
        usd.mint(raiser, 1_000e6);
        vm.prank(raiser); usd.approve(address(core), type(uint256).max);
    }

    function _raise(MockERC20 token, uint16 minSolver) internal returns (uint256 handId) {
        vm.prank(raiser);
        handId = core.raise(
            address(token), DEPOSIT, uint40(block.timestamp + 30 days),
            100, 0, minSolver, charity, vm.addr(E0), keccak256("meta")
        );
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, AHandSig.digest(core.DOMAIN_SEPARATOR(), structHash));
        return abi.encodePacked(r, s, v);
    }

    function _shake(
        uint256 handId, uint256 parentPk, address childCap, address payout,
        uint16 parentClaim, uint16 childClaim
    ) internal view returns (Shake memory sh, bytes memory sig) {
        sh = Shake(handId, childCap, payout, parentClaim, childClaim,
                   uint40(block.timestamp + 7 days));
        sig = _sign(parentPk, AHandSig.hashShake(sh));
    }

    function _give(uint256 handId, uint256 capPk, address solver_)
        internal view returns (Give memory g, bytes memory sig)
    {
        g = Give(handId, solver_, keccak256("solution"));
        sig = _sign(capPk, AHandSig.hashGive(g));
    }

    /// Canonical honest chain: root(E0) -> A(margin 10%) -> B(margin 5%) -> solver claim 85%.
    function _honestChain(uint256 handId)
        internal view returns (Shake[] memory shakes, bytes[] memory sigs, uint256 lastPk)
    {
        shakes = new Shake[](2); sigs = new bytes[](2);
        (shakes[0], sigs[0]) = _shake(handId, E0, vm.addr(E1), connA, 10_000, 9_000);
        (shakes[1], sigs[1]) = _shake(handId, E1, vm.addr(E2), connB, 9_000, 8_500);
        lastPk = E2;
    }

    function _thank(uint256 handId, Shake[] memory shakes, bytes[] memory sigs,
                    Give memory g, bytes memory gs) internal {
        vm.prank(raiser);
        core.thank(handId, shakes, sigs, g, gs, 0);
    }
}

/*//////////////////////////////////////////////////////////////
        SUITE: each test is labeled with a spec invariant
//////////////////////////////////////////////////////////////*/

contract AHandAttacksTest is AHandBase {

    /*──────────────── raise: active setup ────────────────*/

    function test_Raise_PullsDepositAndStoresHand() public {
        uint256 h = _raise(usd, 5000);
        (, , uint96 remaining, , , , , Status st, , address rootCap,) = core.hands(h);
        assertEq(remaining, DEPOSIT, "I-12: remainingReward = credited");
        assertEq(uint8(st), uint8(Status.Active));
        assertEq(rootCap, vm.addr(E0));
        assertEq(usd.balanceOf(address(core)), DEPOSIT);
    }

    function test_Raise_RevertsOnUnlistedCharity() public {
        vm.prank(raiser);
        vm.expectRevert(CharityNotWhitelisted.selector);
        core.raise(address(usd), DEPOSIT, uint40(block.timestamp + 30 days),
                   100, 0, 5000, stranger, vm.addr(E0), 0);
    }

    function test_Raise_BoundsEnforced() public {
        vm.startPrank(raiser);
        vm.expectRevert(BoundsViolated.selector); // charityFee < min
        core.raise(address(usd), DEPOSIT, uint40(block.timestamp + 30 days),
                   50, 0, 5000, charity, vm.addr(E0), 0);
        vm.expectRevert(BoundsViolated.selector); // floor outside [2000,9000]
        core.raise(address(usd), DEPOSIT, uint40(block.timestamp + 30 days),
                   100, 0, 1000, charity, vm.addr(E0), 0);
        vm.stopPrank();
    }

    /*──────────────── I-4/§7: telescopic settlement ────────────────*/

    function test_Thank_HappyPath_TelescopicSettlement() public {
        uint256 h = _raise(usd, 5000);
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);

        _thank(h, sh, sg, g, gs);

        uint256 net = DEPOSIT - 1e6;                 // charity 1%
        assertEq(usd.balanceOf(charity), 1e6, "charity 1%");
        assertEq(usd.balanceOf(connA), net * 1000 / 10_000, "A margin 10%");
        assertEq(usd.balanceOf(connB), net *  500 / 10_000, "B margin 5%");
        assertEq(usd.balanceOf(solver), net * 8500 / 10_000, "solver: claim 85%");
        (, , uint96 remaining, , , , , Status st, , ,) = core.hands(h);
        assertEq(remaining, 0, "I-16");
        assertEq(uint8(st), uint8(Status.Settled), "I-3");
    }

    /// I-5: solver self-insertion - coalition receives EXACTLY same amount (telescope identity).
    function testFuzz_SelfInsertion_CoalitionInvariant(uint16 split) public {
        split = uint16(bound(split, 100, 3400)); // sybil margin within its own claim
        uint256 h1 = _raise(usd, 5000);
        uint256 h2 = _raise(usd, 5000);

        // honest: root -> A(10%) -> solver claim 90%
        Shake[] memory s1 = new Shake[](1); bytes[] memory g1 = new bytes[](1);
        (s1[0], g1[0]) = _shake(h1, E0, vm.addr(E1), connA, 10_000, 9_000);
        (Give memory gv1, bytes memory gs1) = _give(h1, E1, solver);
        _thank(h1, s1, g1, gv1, gs1);
        uint256 honest = usd.balanceOf(solver);

        // sybil: root -> A(10%) -> SYBIL(split) -> solver claim 90%-split
        address sybilPayout = makeAddr("sybilPayout");
        Shake[] memory s2 = new Shake[](2); bytes[] memory g2 = new bytes[](2);
        (s2[0], g2[0]) = _shake(h2, E0, vm.addr(E1), connA, 10_000, 9_000);
        (s2[1], g2[1]) = _shake(h2, E1, vm.addr(E3), sybilPayout, 9_000, 9_000 - split);
        (Give memory gv2, bytes memory gs2) = _give(h2, E3, solver);
        uint256 solverBefore = usd.balanceOf(solver);
        _thank(h2, s2, g2, gv2, gs2);

        uint256 coalition = (usd.balanceOf(solver) - solverBefore) + usd.balanceOf(sybilPayout);
        assertEq(coalition, honest, "I-5 coalition invariant");
    }

    /*──────────────── I-15: anti-truncation (three scenarios) ────────────────*/

    /// (a) compliant payload: solver does not have e1 - route truncation is impossible.
    function test_SoloTruncation_Reverts_CompliantPayload() public {
        uint256 h = _raise(usd, 2000);
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);

        // truncated route with one shake; Give signed by LAST capability (all that exists)
        Shake[] memory cut = new Shake[](1); bytes[] memory cutSig = new bytes[](1);
        cut[0] = sh[0]; cutSig[0] = sg[0];
        (Give memory g, bytes memory gs) = _give(h, last, solver); // e2 != e1
        vm.prank(raiser);
        vm.expectRevert(CapabilityProof.selector);
        core.thank(h, cut, cutSig, g, gs, 0);

        // and with random key - also no
        (Give memory g2, bytes memory gs2) = _give(h, 0xBAD, solver);
        vm.prank(raiser);
        vm.expectRevert(CapabilityProof.selector);
        core.thank(h, cut, cutSig, g2, gs2, 0);
    }

    /// (b) leaked parent key: truncation is POSSIBLE by design - boundary of I-15 is honestly enforceable.
    function test_Truncation_WithLeakedParentKey_Succeeds_ByDesign() public {
        uint256 h = _raise(usd, 2000);
        (Shake[] memory sh, bytes[] memory sg,) = _honestChain(h);
        Shake[] memory cut = new Shake[](1); bytes[] memory cutSig = new bytes[](1);
        cut[0] = sh[0]; cutSig[0] = sg[0];

        address thief = makeAddr("thief");
        (Give memory g, bytes memory gs) = _give(h, E1, thief); // e1 leaked - payload was not stripped
        vm.prank(raiser);
        core.thank(h, cut, cutSig, g, gs, 0);
        assertGt(usd.balanceOf(thief), 0, "I-15b: leak => truncation by design");
    }

    /// (c) personal anchor: only the recipient wallet can continue past it.
    function test_PersonalAnchor_BlocksTruncationBeyond() public {
        uint256 h = _raise(usd, 2000);
        Shake[] memory sh = new Shake[](2); bytes[] memory sg = new bytes[](2);
        (sh[0], sg[0]) = _shake(h, E0, vm.addr(E1), connA, 10_000, 9_000);
        (sh[1], sg[1]) = _shake(h, E1, solver /*personal!*/, connB, 9_000, 8_000);

        (Give memory bad, bytes memory badSig) = _give(h, 0xBAD, makeAddr("thief"));
        vm.prank(raiser);
        vm.expectRevert(CapabilityProof.selector);
        core.thank(h, sh, sg, bad, badSig, 0);

        (Give memory ok, bytes memory okSig) = _give(h, SOLVER_PK, solver);
        _thank(h, sh, sg, ok, okSig);
        assertGt(usd.balanceOf(solver), 0, "personal anchor passes");
    }

    /// I-7: start from middle impossible - first shake must be from rootCapability.
    function test_MidChainStart_Impossible() public {
        uint256 h = _raise(usd, 2000);
        Shake[] memory sh = new Shake[](1); bytes[] memory sg = new bytes[](1);
        (sh[0], sg[0]) = _shake(h, E1, vm.addr(E2), connB, 9_000, 8_500); // root skipped
        (Give memory g, bytes memory gs) = _give(h, E2, solver);
        vm.prank(raiser);
        vm.expectRevert(CapabilityProof.selector);
        core.thank(h, sh, sg, g, gs, 0);
    }

    /*──────────────── §6: route validity ────────────────*/

    function test_ClaimMustNotGrow_Reverts() public {
        uint256 h = _raise(usd, 2000);
        Shake[] memory sh = new Shake[](1); bytes[] memory sg = new bytes[](1);
        (sh[0], sg[0]) = _shake(h, E0, vm.addr(E1), connA, 10_000, 10_500); // claim growth
        (Give memory g, bytes memory gs) = _give(h, E1, solver);
        vm.prank(raiser);
        vm.expectRevert(ClaimMustNotGrow.selector);
        core.thank(h, sh, sg, g, gs, 0);
    }

    function test_ParentClaimMismatch_Reverts() public {
        uint256 h = _raise(usd, 2000);
        Shake[] memory sh = new Shake[](2); bytes[] memory sg = new bytes[](2);
        (sh[0], sg[0]) = _shake(h, E0, vm.addr(E1), connA, 10_000, 9_000);
        (sh[1], sg[1]) = _shake(h, E1, vm.addr(E2), connB, 8_888, 8_000); // != 9_000
        (Give memory g, bytes memory gs) = _give(h, E2, solver);
        vm.prank(raiser);
        vm.expectRevert(ClaimMismatch.selector);
        core.thank(h, sh, sg, g, gs, 0);
    }

    function test_ExpiredShakeDeadline_Reverts() public {
        uint256 h = _raise(usd, 2000);
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);
        vm.warp(block.timestamp + 8 days); // ticket deadline = +7d
        vm.prank(raiser);
        vm.expectRevert(TicketExpired.selector);
        core.thank(h, sh, sg, g, gs, 0);
    }

    function test_MinSolverClaim_Enforced() public {
        uint256 h = _raise(usd, 9000); // strict floor
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h); // claim 85% < 90%
        (Give memory g, bytes memory gs) = _give(h, last, solver);
        vm.prank(raiser);
        vm.expectRevert(SolverClaimTooSmall.selector);
        core.thank(h, sh, sg, g, gs, 0);
    }

    function test_RouteTooLong_Reverts() public {
        uint256 h = _raise(usd, 2000);
        uint256 n = core.MAX_ROUTE_LEN() + 1;
        Shake[] memory sh = new Shake[](n); bytes[] memory sg = new bytes[](n);
        uint256 pk = E0;
        for (uint256 i; i < n; ++i) {
            uint256 nextPk = uint256(keccak256(abi.encode("eph", i))) % type(uint128).max + 1;
            (sh[i], sg[i]) = _shake(h, pk, vm.addr(nextPk), connA, uint16(10_000 - i), uint16(10_000 - i - 1));
            pk = nextPk;
        }
        (Give memory g, bytes memory gs) = _give(h, pk, solver);
        vm.prank(raiser);
        vm.expectRevert(RouteTooLong.selector);
        core.thank(h, sh, sg, g, gs, 0);
    }

        /*──────────────── I-3/I-11/I-14: lifecycle ────────────────*/

    function test_SettleOnce_ThankThenAnythingReverts() public {
        uint256 h = _raise(usd, 5000);
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);
        _thank(h, sh, sg, g, gs);

        vm.prank(raiser);
        vm.expectRevert(NotActive.selector);
        core.thank(h, sh, sg, g, gs, 0);

        vm.warp(block.timestamp + 40 days);
        vm.expectRevert(NotActive.selector);
        core.finalize(h);
    }

    function test_Finalize_ReclaimMinusCharity_PermissionlessAfterExpiry() public {
        uint256 h = _raise(usd, 5000);
        vm.expectRevert(NotExpired.selector);
        core.finalize(h);

        vm.warp(block.timestamp + 31 days);
        uint256 before = usd.balanceOf(raiser);
        vm.prank(stranger);                      // I-14: anyone
        core.finalize(h);
        assertEq(usd.balanceOf(raiser) - before, DEPOSIT - 1e6, "refund - charity 1%");
        assertEq(usd.balanceOf(charity), 1e6);
        (, , uint96 remaining, , , , , Status st, , ,) = core.hands(h);
        assertEq(remaining, 0); assertEq(uint8(st), uint8(Status.Reclaimed));
    }

    function test_TopUp_JoinsPoolBeforeSettlement() public {
        uint256 h = _raise(usd, 5000);
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);
        vm.prank(raiser);
        core.thank(h, sh, sg, g, gs, 50e6);      // thank amount larger than promised
        uint256 pool = 150e6; uint256 net = pool - pool / 100;
        assertEq(usd.balanceOf(solver), net * 8500 / 10_000, "top-up same telescope");
    }

    /*──────────────── I-9a / withdrawTo / CEI ────────────────*/

    function test_PushFallback_RevertingRecipient_OthersPaid() public {
        HookToken hook = new HookToken();
        hook.mint(raiser, 1_000e6);
        vm.prank(raiser); hook.approve(address(core), type(uint256).max);
        uint256 h = _raise(hook, 5000);

        RevertingReceiver bad = new RevertingReceiver();
        Shake[] memory sh = new Shake[](2); bytes[] memory sg = new bytes[](2);
        (sh[0], sg[0]) = _shake(h, E0, vm.addr(E1), address(bad), 10_000, 9_000); // custom receiver reverter hop
        (sh[1], sg[1]) = _shake(h, E1, vm.addr(E2), connB, 9_000, 8_500);
        (Give memory g, bytes memory gs) = _give(h, E2, solver);

        _thank(h, sh, sg, g, gs); // should not revert the entire settlement (I-9a)
        uint256 net = DEPOSIT - 1e6;
        assertEq(hook.balanceOf(connB), net * 500 / 10_000, "innocent paid");
        assertEq(hook.balanceOf(solver), net * 8500 / 10_000);
        assertEq(core.pending(address(bad), address(hook)), uint96(net * 1000 / 10_000),
                 "reverter -> pending");
    }

    function test_WithdrawTo_RescuesBlacklistedPending() public {
        BlacklistToken bl = new BlacklistToken();
        bl.mint(raiser, 1_000e6);
        vm.prank(raiser); bl.approve(address(core), type(uint256).max);
        uint256 h = _raise(bl, 5000);
        bl.setBlocked(connA, true);              // USDC-freeze before settlement

        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);
        _thank(h, sh, sg, g, gs);

        uint96 owed = core.pending(connA, address(bl));
        assertGt(owed, 0, "freeze => deferred");

        vm.prank(stranger);
        vm.expectRevert(ZeroAmount.selector);    // stranger cannot withdraw someone else's pending
        core.withdrawTo(address(bl), stranger);

        address rescue = makeAddr("rescue");
        vm.prank(connA);
        core.withdrawTo(address(bl), rescue);    // rescue to a different address
        assertEq(bl.balanceOf(rescue), owed);
        assertEq(core.pending(connA, address(bl)), 0);
    }

    function test_Reentrancy_PushHookCannotDoubleSettle() public {
        HookToken hook = new HookToken();
        hook.mint(raiser, 1_000e6);
        vm.prank(raiser); hook.approve(address(core), type(uint256).max);
        uint256 h = _raise(hook, 5000);

        ReenteringReceiver evil = new ReenteringReceiver();
        Shake[] memory sh = new Shake[](1); bytes[] memory sg = new bytes[](1);
        (sh[0], sg[0]) = _shake(h, E0, vm.addr(E1), address(evil), 10_000, 9_000);
        (Give memory g, bytes memory gs) = _give(h, E1, solver);
        evil.arm(core, h);

        _thank(h, sh, sg, g, gs);
        assertFalse(evil.reentrySucceeded(), "CEI: status set before pushes");
        assertEq(hook.balanceOf(address(core)), 0, "no double pay, no stuck funds");
    }

    /*──────────────── I-1: conservation across lifecycle ────────────────*/

    function test_Conservation_AcrossLifecycle() public {
        uint256 h1 = _raise(usd, 5000);           // will be thanked (+topUp)
        uint256 h2 = _raise(usd, 5000);           // will expire

        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h1);
        (Give memory g, bytes memory gs) = _give(h1, last, solver);
        vm.prank(raiser);
        core.thank(h1, sh, sg, g, gs, 25e6);

        vm.warp(block.timestamp + 31 days);
        core.finalize(h2);

        uint256 deposited = 2 * uint256(DEPOSIT) + 25e6;
        uint256 delivered = usd.balanceOf(connA) + usd.balanceOf(connB)
                          + usd.balanceOf(solver) + usd.balanceOf(charity)
                          + usd.balanceOf(maint)
                          + (usd.balanceOf(raiser) - (1_000e6 - deposited)); // refund
        assertEq(delivered, deposited, "I-1 conservation");
        assertEq(usd.balanceOf(address(core)), 0, "I-16 core drained");
    }

    /*──────────────── Additional Invariant Tests ────────────────*/

    function _generateRoute(uint256 handId, uint256 numHops, uint16[] memory splits)
        internal returns (Shake[] memory shakes, bytes[] memory sigs, uint256 lastPk)
    {
        shakes = new Shake[](numHops);
        sigs = new bytes[](numHops);
        uint256 pk = E0;
        uint16 prevClaim = 10000;
        for (uint256 i = 0; i < numHops; ++i) {
            uint256 nextPk = uint256(keccak256(abi.encode("eph_fuzz", i, handId))) % type(uint128).max + 1;
            address childCap = vm.addr(nextPk);
            address payout = makeAddr(string(abi.encodePacked("payout", i)));
            uint16 childClaim = prevClaim - splits[i];

            (shakes[i], sigs[i]) = _shake(handId, pk, childCap, payout, prevClaim, childClaim);
            pk = nextPk;
            prevClaim = childClaim;
        }
        lastPk = pk;
    }

    /// I-1 / I-4 / I-6 fuzzed route logic check
    /// Spec §4: token unknown to anchor — full settlement, zero history.
    function test_Signals_UnknownToken_ZeroEmission() public {
        MockERC20 junk = new MockERC20("JUNK");   // rate not set
        junk.mint(raiser, 1_000e6);
        vm.prank(raiser); junk.approve(address(core), type(uint256).max);
        uint256 h = _raise(junk, 5000);
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);
        _thank(h, sh, sg, g, gs);
        assertGt(junk.balanceOf(solver), 0, "money settled");
        assertEq(signals.balanceOf(signals.SIGNAL_UP(), solver), 0, "zero UP for junk");
        assertEq(signals.balanceOf(signals.SIGNAL_UP(), raiser), 0);
    }

    /// OZ ECDSA: malleable s (N - s, flipped v) is rejected.
    /// NB: py-evm is stricter than mainnet and rejects high-s automatically; this test is DEMONSTRATIVE on anvil/geth.
    function test_Malleability_Rejected() public {
        uint256 h = _raise(usd, 5000);
        Shake[] memory sh = new Shake[](1); bytes[] memory sg = new bytes[](1);
        (sh[0], sg[0]) = _shake(h, E0, vm.addr(E1), connA, 10_000, 9_000);
        bytes memory orig = sg[0];
        uint256 N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 r; uint256 s; uint8 v;
        assembly {
            r := mload(add(orig, 32))
            s := mload(add(orig, 64))
            v := byte(0, mload(add(orig, 96)))
        }
        sg[0] = abi.encodePacked(r, bytes32(N - s), uint8(55 - v)); // 27<->28
        (Give memory g, bytes memory gs) = _give(h, E1, solver);
        vm.prank(raiser);
        vm.expectRevert(CapabilityProof.selector);
        core.thank(h, sh, sg, g, gs, 0);
    }

    function testFuzz_TelescopicConservation(uint8 numHops, uint96 topUp) public {
        numHops = uint8(bound(numHops, 0, 32)); // MAX_ROUTE_LEN = 32
        topUp = uint96(bound(topUp, 0, 1_000e6));
        usd.mint(raiser, topUp);

        uint16 minSolver = 2000; // MIN_SOLVER_FLOOR_BPS
        uint256 h = _raise(usd, minSolver);

        uint16[] memory splits = new uint16[](numHops);
        uint16 totalSplit = 0;
        if (numHops > 0) {
            uint16 maxSplit = (10000 - minSolver) / numHops;
            for (uint256 i = 0; i < numHops; ++i) {
                splits[i] = maxSplit;
                totalSplit += maxSplit;
            }
        }

        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _generateRoute(h, numHops, splits);
        (Give memory g, bytes memory gs) = _give(h, last, solver);

        uint256 initialCoreBal = usd.balanceOf(address(core));
        uint256 initialSolverBal = usd.balanceOf(solver);
        uint256 initialCharityBal = usd.balanceOf(charity);
        uint256 initialMaintBal = usd.balanceOf(maint);

        address[] memory payees = new address[](numHops);
        uint256[] memory initialPayeeBals = new uint256[](numHops);
        for (uint256 i = 0; i < numHops; ++i) {
            payees[i] = sh[i].payout;
            initialPayeeBals[i] = usd.balanceOf(payees[i]);
        }

        vm.prank(raiser);
        core.thank(h, sh, sg, g, gs, topUp);

        // I-1 Conservation check
        uint256 totalPool = DEPOSIT + topUp;
        uint256 charityFee = (totalPool * 100) / 10000;
        uint256 maintFee = 0; // maintFeeBps is 0 in setup
        uint256 net = totalPool - charityFee - maintFee;

        uint256 actualCharityPaid = usd.balanceOf(charity) - initialCharityBal;
        assertEq(actualCharityPaid, charityFee, "I-10: charity fee correct");

        uint256 actualMaintPaid = usd.balanceOf(maint) - initialMaintBal;
        assertEq(actualMaintPaid, maintFee, "I-10: maint fee correct");

        uint256 totalPayouts = actualCharityPaid + actualMaintPaid;

        for (uint256 i = 0; i < numHops; ++i) {
            uint256 margin = (net * splits[i]) / 10000;
            uint256 actualPaid = usd.balanceOf(payees[i]) - initialPayeeBals[i];
            assertEq(actualPaid, margin, "I-4/I-1 hop payout correct");
            totalPayouts += actualPaid;
        }

        uint256 expectedSolver = totalPool - totalPayouts;
        uint256 actualSolverPaid = usd.balanceOf(solver) - initialSolverBal;
        assertEq(actualSolverPaid, expectedSolver, "I-4/I-1 solver payout correct");
        assertApproxEqAbs(actualSolverPaid, (net * (10000 - totalSplit)) / 10000, 34, "Solver share within rounding limit");
        totalPayouts += actualSolverPaid;

        assertEq(totalPayouts, totalPool, "I-1 conservation equation holds");
        assertEq(usd.balanceOf(address(core)), initialCoreBal - DEPOSIT, "Escrow balance cleanly depleted");
    }

    /// I-2 obligations vs actual balance sanity check
    function test_I2_ObligationsBookkeeping_ForceSend() public {
        uint256 h = _raise(usd, 5000);
        (, , uint96 remaining, , , , , Status st, , ,) = core.hands(h);
        assertEq(remaining, DEPOSIT);
        assertEq(uint8(st), uint8(Status.Active));

        // Force-send tokens directly to the contract
        usd.mint(address(core), 500e6);

        // Verify that the contract balance increases, but remaining reward and hand state are untouched
        (, , uint96 remainingAfter, , , , , Status stAfter, , ,) = core.hands(h);
        assertEq(remainingAfter, DEPOSIT, "I-2: remainingReward is unaffected");
        assertEq(uint8(stAfter), uint8(Status.Active), "I-2: hand status remains Active");

        // Verify contract balance is greater than obligations
        uint256 expectedObligations = DEPOSIT;
        assertGt(usd.balanceOf(address(core)), expectedObligations, "I-2: balance >= obligations");
    }

    /// I-16 Escrow balance isolation check
    function test_I16_EscrowIsolation_ZeroInfluence() public {
        uint256 h1 = _raise(usd, 5000);
        uint256 h2 = _raise(usd, 5000);

        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h1);
        (Give memory g, bytes memory gs) = _give(h1, last, solver);

        // Settle hand 1
        _thank(h1, sh, sg, g, gs);

        // Verify hand 2 is completely unaffected
        (, , uint96 remaining2, , , , , Status st2, , ,) = core.hands(h2);
        assertEq(remaining2, DEPOSIT, "I-16: hand 2 remaining reward is unaffected by hand 1 settlement");
        assertEq(uint8(st2), uint8(Status.Active), "I-16: hand 2 status remains Active");
    }

    /*──────────────── Signals & Reputation Tests (USDC 6 decimals) ────────────────*/

    function test_Signals_SoulboundTransfers() public {
        _raise(usd, 5000);
        
        uint256 upId = signals.SIGNAL_UP();
        
        // Transfers of both UP and DOWN signals must revert (I-8)
        vm.expectRevert(Soulbound.selector);
        signals.safeTransferFrom(raiser, stranger, upId, 1, "");

        vm.expectRevert(Soulbound.selector);
        uint256[] memory ids = new uint256[](1); ids[0] = upId;
        uint256[] memory vals = new uint256[](1); vals[0] = 1;
        signals.safeBatchTransferFrom(raiser, stranger, ids, vals, "");
    }

    function test_Signals_MintsOnRaiseAndThank() public {
        // 1. Raise mints SIGNAL_RAISE to raiser
        uint256 h = _raise(usd, 5000);
        assertEq(signals.balanceOf(signals.SIGNAL_RAISE(), raiser), 1);

        // 2. Thank mints SIGNAL_THANK to raiser, SIGNAL_GIVE to solver, SIGNAL_SHAKE to connectors
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);

        _thank(h, sh, sg, g, gs);

        assertEq(signals.balanceOf(signals.SIGNAL_THANK(), raiser), 1);
        assertEq(signals.balanceOf(signals.SIGNAL_GIVE(), solver), 1);
        assertEq(signals.balanceOf(signals.SIGNAL_SHAKE(), connA), 1);
        assertEq(signals.balanceOf(signals.SIGNAL_SHAKE(), connB), 1);
    }

    function test_Signals_EarnedUpEmissionMath() public {
        uint256 h = _raise(usd, 5000); // 100 USDC deposit -> charity fee 1% = 1 USDC = 1e6 units
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);

        _thank(h, sh, sg, g, gs);

        // charityFee = 1e6 USDC units.
        // usdVal = 1e6 * 1e12 = 1e18 USD units.
        // halfVal = 0.5e18 USD units.
        // cumulativeUsd[raiser] = 0.5e18.
        // sqrt(0.5e18) = 707106781 (scaled 1e9, 9 decimals)
        uint256 expectedEarnedUp = 707106781;
        assertEq(signals.balanceOf(signals.SIGNAL_UP(), raiser), expectedEarnedUp);
        assertEq(signals.earnedOf(raiser), expectedEarnedUp);
        assertEq(signals.balanceOf(signals.SIGNAL_UP(), solver), expectedEarnedUp);
        assertEq(signals.earnedOf(solver), expectedEarnedUp);
    }

    function test_Signals_UpAndDown() public {
        // Raise with a large deposit of 2000 USDC to yield > 3 tokens of UP
        usd.mint(raiser, 2000e6);
        vm.prank(raiser);
        uint256 h = core.raise(
            address(usd), 2000e6, uint40(block.timestamp + 30 days),
            100, 0, 5000, charity, vm.addr(E0), keccak256("meta")
        );

        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);
        _thank(h, sh, sg, g, gs);

        // charityFee = 20e6 USDC = 20 USDC.
        // halfVal = 10e18 USD units.
        // sqrt(10e18) = 3162277660 (~3.16 tokens of UP).
        uint256 initialBal = signals.balanceOf(signals.SIGNAL_UP(), raiser);
        assertEq(initialBal, 3162277660);
        assertEq(signals.earnedOf(raiser), 3162277660);

        // Raiser gives UP (upvote) to connA (costs 1e9 = 1 token)
        vm.prank(raiser);
        signals.up(connA);

        assertEq(signals.earnedOf(raiser), initialBal - 1e9);
        assertEq(signals.balanceOf(signals.SIGNAL_UP(), raiser), initialBal - 1e9);
        
        // Target (connA) receives 1 token of received UP
        assertEq(signals.balanceOf(signals.SIGNAL_UP(), connA), 1e9);
        assertEq(signals.receivedOf(connA), 1e9);
        assertEq(signals.earnedOf(connA), 0); // target got received, not earned

        // Down connB (costs 3e9 from solver)
        vm.prank(solver);
        signals.down(connB);

        assertEq(signals.earnedOf(solver), 3162277660 - 3e9);
        assertEq(signals.balanceOf(signals.SIGNAL_UP(), solver), 3162277660 - 3e9);
        assertEq(signals.balanceOf(signals.SIGNAL_DOWN(), connB), 1);
    }

    function test_Signals_Up_EarnedOnly_RecursionCut() public {
        // Target receives 1 token of UP, but earned is 0, so target trying to upvote someone else must revert!
        usd.mint(raiser, 1000e6);
        vm.prank(raiser);
        uint256 h = core.raise(
            address(usd), 1000e6, uint40(block.timestamp + 30 days),
            100, 0, 5000, charity, vm.addr(E0), keccak256("meta")
        );
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);
        _thank(h, sh, sg, g, gs);

        // Raiser gets ~2.23 tokens of UP. Raiser upvotes stranger.
        vm.prank(raiser);
        signals.up(stranger);

        assertEq(signals.receivedOf(stranger), 1e9);
        assertEq(signals.earnedOf(stranger), 0);

        // Stranger tries to upvote connA using their received UP -> must revert (recursion cut)!
        vm.prank(stranger);
        vm.expectRevert(InsufficientEarned.selector);
        signals.up(connA);
    }

    function test_Signals_EvilSignals_CannotBlockMoney() public {
        uint256 h = _raise(usd, 5000);
        
        // 1. Owner sets signals to a malicious/reverting Signals contract (governance exploit vector)
        EvilSignals evil = new EvilSignals();
        core.setSignals(address(evil));

        // 2. Settlement must NOT freeze (I-17 Try/Catch Quarantine protects user funds)
        (Shake[] memory sh, bytes[] memory sg, uint256 last) = _honestChain(h);
        (Give memory g, bytes memory gs) = _give(h, last, solver);

        _thank(h, sh, sg, g, gs);

        // Verify that the raiser funds exit successfully and core becomes cleanly depleted
        assertEq(usd.balanceOf(address(core)), 0, "I-17: escrow cleanly drained despite malicious signals");
    }

    function test_Signals_UriMetadataAndEmojiJSON() public {
        _raise(usd, 5000);

        string memory raisedUri = signals.uri(signals.SIGNAL_RAISE());
        string memory expectedStart = "data:application/json;base64,";
        
        // Verify JSON returns dynamic on-chain base64
        assertEq(slice(raisedUri, 0, bytes(expectedStart).length), expectedStart);
    }

    // Helper to slice strings in Solidity tests
    function slice(string memory str, uint256 start, uint256 length) internal pure returns (string memory) {
        bytes memory strBytes = bytes(str);
        bytes memory result = new bytes(length);
        for (uint256 i = 0; i < length; ++i) {
            result[i] = strBytes[start + i];
        }
        return string(result);
    }
    /*──────────────── Refined Custom Error / Two-Step Ownership / Reentrancy Tests ────────────────*/

    function test_Constructor_ZeroAddressReverts() public {
        address[] memory ch = new address[](2);
        ch[0] = charity;
        ch[1] = address(0);
        vm.expectRevert(ZeroAddress.selector);
        new AHandCore(ch, maint);
    }

    function test_Ownership_TwoStepCore() public {
        address initialOwner = core.owner();
        vm.prank(initialOwner);
        core.transferOwnership(stranger);
        assertEq(core.pendingOwner(), stranger);
        assertEq(core.owner(), initialOwner);

        vm.prank(stranger);
        core.acceptOwnership();
        assertEq(core.pendingOwner(), address(0));
        assertEq(core.owner(), stranger);
    }

    function test_Ownership_TwoStepSignals() public {
        address initialOwner = signals.owner();
        vm.prank(initialOwner);
        signals.transferOwnership(stranger);
        assertEq(signals.pendingOwner(), stranger);
        assertEq(signals.owner(), initialOwner);

        vm.prank(stranger);
        signals.acceptOwnership();
        assertEq(signals.pendingOwner(), address(0));
        assertEq(signals.owner(), stranger);
    }

    function test_Ownership_TwoStepAnchor() public {
        address initialOwner = anchorC.owner();
        vm.prank(initialOwner);
        anchorC.transferOwnership(stranger);
        assertEq(anchorC.pendingOwner(), stranger);
        assertEq(anchorC.owner(), initialOwner);

        vm.prank(stranger);
        anchorC.acceptOwnership();
        assertEq(anchorC.pendingOwner(), address(0));
        assertEq(anchorC.owner(), stranger);
    }

    function test_Anchors_Smoke() public {
        AHandWitness anchors = new AHandWitness(address(core));
        
        // 1. Anchor a random hash
        bytes32 h = keccak256("test");
        anchors.witness(h);
        assertEq(anchors.witnessedAt(h), block.timestamp);
        
        // 2. anchorShake with honest signature
        uint256 handId = _raise(usd, 5000);
        (Shake memory sh, bytes memory sig) = _shake(handId, E0, vm.addr(E1), connA, 10_000, 9_000);
        
        // We expect ShakeWitnessed event
        vm.expectEmit(true, true, false, true, address(anchors));
        emit AHandWitness.ShakeWitnessed(handId, vm.addr(E0), vm.addr(E1), connA, 1000, uint40(block.timestamp));
        anchors.witnessShake(sh, sig);
        
        // Repeated anchor is idempotent
        anchors.witnessShake(sh, sig);
        
        // 3. anchorGive with honest signature
        (Give memory g, bytes memory gs) = _give(handId, E0, solver);
        vm.expectEmit(true, true, true, true, address(anchors));
        emit AHandWitness.GiveWitnessed(handId, vm.addr(E0), solver, g.solutionHash, uint40(block.timestamp));
        anchors.witnessGive(g, gs);
        
        // Invalid signature must revert
        vm.expectRevert(AHandWitness.BadSignature.selector);
        anchors.witnessGive(g, "garbage");
    }
}

contract EvilSignals {
    function mintRaise(address, uint256) external pure {
        revert("MALICIOUS_REVERT");
    }
    function mintSettlement(
        uint256, address, address, address[] calldata, uint16[] calldata, address, uint96
    ) external pure {
        revert("MALICIOUS_REVERT");
    }
    function onFinalize(uint256, address) external pure {
        revert("MALICIOUS_REVERT");
    }
}
