// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: withdraw — the exit for DEFERRED value. Hybrid
        settlement pushes straight through on a well-behaved
        token, so a claim only exists when a push FAILS (a
        USDC-style blacklisted recipient). Every case here is
        driven through such a forced deferral: aggregate,
        fixed-destination, retryable, policy-immune.
//////////////////////////////////////////////////////////////*/

contract AHandWithdrawTest is AHandTestBase {
    BlacklistToken bl;
    AHandCore blCore;

    function setUp() public override {
        super.setUp();
        bl = new BlacklistToken();
        blCore = deployCore(address(bl));
        bl.mint(raiser, 10_000_000e6);
        vm.prank(raiser);
        bl.approve(address(blCore), type(uint256).max);
    }

    /// @dev Raise a default-shaped Hand on the blacklist core.
    function makeBlRaise() internal returns (uint256 handId) {
        RaiseParams memory p = defaultParams();
        p.token = address(bl);
        vm.prank(raiser);
        handId = blCore.raise(p, DEFAULT_REF, noTags());
    }

    function blClaim(address a) internal view returns (uint256) {
        return blCore.claims(address(bl), a);
    }

    /*──────────────── aggregation ────────────────*/

    /// claims[token][beneficiary] pools across Hands. Two reclaimed hands whose
    /// refund push is blocked (raiser blacklisted) defer into ONE claim; a
    /// single withdraw pays the sum in one transfer.
    function test_Withdraw_AggregatesAcrossHands() public {
        uint256 h1 = makeBlRaise();
        uint256 h2 = makeBlRaise();

        bl.setBlocked(raiser, true); // refund push will fail -> defer
        vm.warp(blCore.getHand(h1).expiry);
        blCore.reclaim(h1);
        blCore.reclaim(h2);
        assertEq(blClaim(raiser), uint256(DEPOSIT) * 2, "deferred refunds aggregate");

        bl.setBlocked(raiser, false);
        uint256 balBefore = bl.balanceOf(raiser);
        vm.expectEmit();
        emit AHandCore.PayoutWithdrawn(address(bl), raiser, uint256(DEPOSIT) * 2);
        blCore.withdraw(address(bl), raiser);

        assertEq(bl.balanceOf(raiser) - balBefore, uint256(DEPOSIT) * 2, "one transfer, full sum");
        assertEq(blClaim(raiser), 0, "ledger zeroed");
        assertEq(bl.balanceOf(address(blCore)), 0, "escrow drained");
    }

    /// Settlement claims aggregate the same way: two settled hands whose charity
    /// push is blocked defer the charity's cut, pooling before a single withdraw.
    function test_Withdraw_AggregatesSettlementClaims() public {
        uint256 h1 = makeBlRaise();
        uint256 h2 = makeBlRaise();

        bl.setBlocked(charity, true); // charity cut defers on each settlement
        settleSimpleOn(blCore, h1);
        settleSimpleOn(blCore, h2);
        assertEq(blClaim(charity), 20e6, "10% of each hand, deferred");

        // The giver's residual was NOT blocked, so it pushed straight through.
        assertEq(bl.balanceOf(giver), 180e6, "giver residuals delivered by push");
        assertEq(blClaim(giver), 0, "giver never deferred");

        bl.setBlocked(charity, false);
        blCore.withdraw(address(bl), charity);
        assertEq(bl.balanceOf(charity), 20e6);
    }

    /*──────────────── fixed destination ────────────────*/

    /// Permissionless with a fixed destination: a stranger pays the gas, the
    /// beneficiary receives every unit of a deferred claim.
    function test_Withdraw_FixedDestination_StrangerPays() public {
        uint256 h = makeBlRaise();
        bl.setBlocked(raiser, true);
        vm.warp(blCore.getHand(h).expiry);
        blCore.reclaim(h); // refund defers into claims[bl][raiser]
        assertEq(blClaim(raiser), DEPOSIT, "refund deferred");

        bl.setBlocked(raiser, false);
        vm.prank(stranger);
        blCore.withdraw(address(bl), raiser);

        assertEq(bl.balanceOf(raiser), 10_000_000e6, "full refund landed on the raiser");
        assertEq(bl.balanceOf(stranger), 0, "caller cannot redirect");
    }

    /*──────────────── ZeroClaim ────────────────*/

    function test_Withdraw_NoClaim_ZeroClaim() public {
        vm.expectRevert(ZeroClaim.selector);
        blCore.withdraw(address(bl), stranger);
    }

    /// Nothing is ever credited to the zero beneficiary, so withdraw(token, 0)
    /// dies on the same ZeroClaim guard — no special case needed.
    function test_Withdraw_ZeroBeneficiary_ZeroClaim() public {
        vm.expectRevert(ZeroClaim.selector);
        blCore.withdraw(address(bl), address(0));
    }

    /// A successful settlement pushes straight through: no claim is created, so
    /// withdraw on the (delivered) beneficiary finds nothing.
    function test_Withdraw_SuccessfulPush_LeavesNoClaim() public {
        uint256 h = makeRaise(); // primary MockUSD core: pushes always succeed
        settleSimple(h);
        assertEq(core.claims(address(usd), giver), 0, "push delivered, nothing deferred");
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), giver);
    }

    function test_Withdraw_UnknownToken_ZeroClaim() public {
        uint256 h = makeBlRaise();
        bl.setBlocked(raiser, true);
        vm.warp(blCore.getHand(h).expiry);
        blCore.reclaim(h);
        vm.expectRevert(ZeroClaim.selector);
        blCore.withdraw(address(0xdead), raiser); // claim exists, but under bl only
    }

    function test_Withdraw_Twice_ZeroClaim() public {
        uint256 h = makeBlRaise();
        bl.setBlocked(raiser, true);
        vm.warp(blCore.getHand(h).expiry);
        blCore.reclaim(h);

        bl.setBlocked(raiser, false);
        blCore.withdraw(address(bl), raiser);
        vm.expectRevert(ZeroClaim.selector);
        blCore.withdraw(address(bl), raiser);
    }

    /*──────────────── blacklist: revert, persist, retry ────────────────*/

    /// A USDC-style blacklist makes both the settlement push AND the withdraw
    /// leg revert. The claim must survive the failed withdraw attempt untouched
    /// and pay out once unblocked.
    function test_Withdraw_BlacklistedBeneficiary_ClaimPersistsAndRetries() public {
        uint256 h = makeBlRaise();
        bl.setBlocked(raiser, true);
        vm.warp(blCore.getHand(h).expiry);
        blCore.reclaim(h); // push fails -> deferred to a claim
        assertEq(blClaim(raiser), DEPOSIT, "refund deferred by the failed push");

        // Still blocked: the withdraw leg reverts, the claim stays intact.
        vm.expectRevert(bytes("BLACKLISTED"));
        blCore.withdraw(address(bl), raiser);
        assertEq(blClaim(raiser), DEPOSIT, "claim survives the failed leg");

        bl.setBlocked(raiser, false);
        blCore.withdraw(address(bl), raiser); // same call, now clean
        assertEq(bl.balanceOf(raiser), 10_000_000e6, "retry pays in full");
        assertEq(blClaim(raiser), 0);
    }

    /*──────────────── policy immunity ────────────────*/

    /// tokenEnabled gates raises only: an accrued (deferred) claim exits even
    /// after the policy admin turns the token off.
    function test_Withdraw_WorksAfterTokenDisabled() public {
        uint256 h = makeBlRaise();
        bl.setBlocked(raiser, true);
        vm.warp(blCore.getHand(h).expiry);
        blCore.reclaim(h); // refund deferred

        vm.prank(policyAdmin);
        blCore.setTokenEnabled(false);

        bl.setBlocked(raiser, false);
        blCore.withdraw(address(bl), raiser);
        assertEq(bl.balanceOf(raiser), 10_000_000e6, "policy cannot trap value");
    }
}
