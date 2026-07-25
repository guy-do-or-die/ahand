// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: withdraw — the only exit for value. Aggregate,
        fixed-destination, retryable, policy-immune.
//////////////////////////////////////////////////////////////*/

contract AHandWithdrawTest is AHandTestBase {
    /*──────────────── aggregation ────────────────*/

    /// claims[token][beneficiary] pools across Hands: two reclaimed hands,
    /// one withdraw, one transfer of the sum.
    function test_Withdraw_AggregatesAcrossHands() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();
        vm.warp(core.getHand(h1).expiry);
        core.reclaim(h1);
        core.reclaim(h2);
        assertEq(core.claims(address(usd), raiser), uint256(DEPOSIT) * 2, "claims aggregate");

        uint256 balBefore = usd.balanceOf(raiser);
        vm.expectEmit();
        emit AHandCore.PayoutWithdrawn(address(usd), raiser, uint256(DEPOSIT) * 2);
        core.withdraw(address(usd), raiser);

        assertEq(usd.balanceOf(raiser) - balBefore, uint256(DEPOSIT) * 2, "one transfer, full sum");
        assertEq(core.claims(address(usd), raiser), 0, "ledger zeroed");
        assertEq(usd.balanceOf(address(core)), 0, "escrow drained");
    }

    /// Settlement claims aggregate the same way: two settled hands, the
    /// charity's cut pools before a single withdraw.
    function test_Withdraw_AggregatesSettlementClaims() public {
        uint256 h1 = makeRaise();
        uint256 h2 = makeRaise();
        settleSimple(h1);
        settleSimple(h2);
        assertEq(core.claims(address(usd), charity), 20e6, "10% of each hand");

        core.withdraw(address(usd), charity);
        assertEq(usd.balanceOf(charity), 20e6);

        core.withdraw(address(usd), giver);
        assertEq(usd.balanceOf(giver), 180e6, "giver residuals pooled too");
    }

    /*──────────────── fixed destination ────────────────*/

    /// Permissionless with a fixed destination: a stranger pays the gas, the
    /// beneficiary receives every unit.
    function test_Withdraw_FixedDestination_StrangerPays() public {
        uint256 h = makeRaise();
        vm.warp(core.getHand(h).expiry);
        core.reclaim(h);

        vm.prank(stranger);
        core.withdraw(address(usd), raiser);

        assertEq(usd.balanceOf(raiser), 1_000_000e6, "full refund landed on the raiser");
        assertEq(usd.balanceOf(stranger), 0, "caller cannot redirect");
    }

    /*──────────────── ZeroClaim ────────────────*/

    function test_Withdraw_NoClaim_ZeroClaim() public {
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), stranger);
    }

    /// Nothing is ever credited to the zero beneficiary, so withdraw(token, 0)
    /// dies on the same ZeroClaim guard — no special case needed.
    function test_Withdraw_ZeroBeneficiary_ZeroClaim() public {
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), address(0));
    }

    function test_Withdraw_UnknownToken_ZeroClaim() public {
        uint256 h = makeRaise();
        vm.warp(core.getHand(h).expiry);
        core.reclaim(h);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(0xdead), raiser); // claim exists, but under usd only
    }

    function test_Withdraw_Twice_ZeroClaim() public {
        uint256 h = makeRaise();
        vm.warp(core.getHand(h).expiry);
        core.reclaim(h);
        core.withdraw(address(usd), raiser);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), raiser);
    }

    /*──────────────── blacklist: revert, persist, retry ────────────────*/

    /// A USDC-style blacklist makes the payout leg revert. The claim must
    /// survive the failed attempt untouched and pay out once unblocked.
    function test_Withdraw_BlacklistedBeneficiary_ClaimPersistsAndRetries() public {
        BlacklistToken bl = new BlacklistToken();
        AHandCore blCore = deployCore(address(bl));
        bl.mint(raiser, 1_000e6);
        vm.prank(raiser);
        bl.approve(address(blCore), type(uint256).max);

        RaiseParams memory p = defaultParams();
        p.token = address(bl);
        vm.prank(raiser);
        uint256 h = blCore.raise(p, DEFAULT_REF, noTags());
        vm.warp(blCore.getHand(h).expiry);
        blCore.reclaim(h);

        bl.setBlocked(raiser, true);
        vm.expectRevert(bytes("BLACKLISTED"));
        blCore.withdraw(address(bl), raiser);
        assertEq(blCore.claims(address(bl), raiser), DEPOSIT, "claim survives the failed leg");

        bl.setBlocked(raiser, false);
        blCore.withdraw(address(bl), raiser); // same call, now clean
        assertEq(bl.balanceOf(raiser), 1_000e6, "retry pays in full");
        assertEq(blCore.claims(address(bl), raiser), 0);
    }

    /*──────────────── policy immunity ────────────────*/

    /// tokenEnabled gates raises only: accrued claims exit even after the
    /// policy admin turns the token off.
    function test_Withdraw_WorksAfterTokenDisabled() public {
        uint256 h = makeRaise();
        vm.warp(core.getHand(h).expiry);
        core.reclaim(h);

        vm.prank(policyAdmin);
        core.setTokenEnabled(false);

        core.withdraw(address(usd), raiser);
        assertEq(usd.balanceOf(raiser), 1_000_000e6, "policy cannot trap value");
    }
}
