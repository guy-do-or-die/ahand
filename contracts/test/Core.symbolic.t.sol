// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";

/// Symbolic checks for Halmos; `forge test` skips them. Every argument of a `check_`
/// function stands for all of its values at once. Halmos cannot follow the deploy cheat
/// code forge 1.8 puts in tests, so run with that off:
///     FOUNDRY_DYNAMIC_TEST_LINKING=false halmos --contract CoreSymbolic
contract CoreSymbolic is Test {
    AHandCore core;
    BlacklistToken token;
    address constant RAISER = address(0xA11CE);
    address constant OTHER = address(0xB0B);
    address constant NO_KEY = address(0xDEAD); // no route is followed in these checks
    uint40 clock; // the time these checks move to, kept here so it is read once

    function setUp() public {
        core = new AHandCore();
        token = new BlacklistToken();
        clock = uint40(block.timestamp);
    }

    /// Raises `reward` as `who` and reclaims it while the token refuses `who`: the refund
    /// is left pending.
    function _leavePending(address who, uint256 reward) internal {
        token.mint(who, reward);
        vm.startPrank(who);
        token.approve(address(core), reward);
        uint256 id = core.raise(address(token), reward, ++clock, NO_KEY, 0, 200, bytes32(0));
        vm.stopPrank();
        token.setBlocked(who, true);
        vm.warp(clock);
        core.reclaim(id);
        token.setBlocked(who, false);
    }

    /// `withdraw` moves exactly what is pending for the payee to `to` and clears only that;
    /// a destination other than the payee needs the payee itself, and the zero address is
    /// never one. A failed call changes nothing.
    function check_withdraw(uint128 mine, uint128 others, address caller, address to) public {
        vm.assume(mine > 0 && others > 0);
        _leavePending(RAISER, mine);
        _leavePending(OTHER, others);
        uint256 coreBefore = token.balanceOf(address(core));
        uint256 toBefore = token.balanceOf(to);

        vm.prank(caller);
        try core.withdraw(address(token), RAISER, to) {
            assert(to == RAISER || caller == RAISER);
            assert(to != address(0));
            assert(core.pending(address(token), RAISER) == 0);
            assert(core.pending(address(token), OTHER) == others);
            assert(token.balanceOf(address(core)) == coreBefore - mine);
            assert(token.balanceOf(to) == toBefore + mine);
        } catch {
            assert(core.pending(address(token), RAISER) == mine);
            assert(core.pending(address(token), OTHER) == others);
            assert(token.balanceOf(address(core)) == coreBefore);
        }
    }

    /// Nobody but Core itself can move Core's tokens through `transferOut`.
    function check_transferOutOnlyFromCore(address caller, address to, uint256 amount) public {
        _leavePending(RAISER, 1);
        vm.assume(caller != address(core));
        vm.prank(caller);
        try core.transferOut(address(token), to, amount) {
            assert(false);
        } catch {}
    }

    /// Anyone can close an expired Hand, whatever happens to its refund: the money then
    /// reaches the raiser or stays pending for the raiser. (Halmos does not count gas, so this
    /// says nothing fails for a reason other than gas.)
    function check_anyoneClosesAnExpiredHand(uint128 reward, bool blocked, address caller) public {
        vm.assume(reward > 0);
        token.mint(RAISER, reward);
        vm.startPrank(RAISER);
        token.approve(address(core), reward);
        uint256 id = core.raise(address(token), reward, ++clock, NO_KEY, 0, 200, bytes32(0));
        vm.stopPrank();
        token.setBlocked(RAISER, blocked);
        vm.warp(clock);

        vm.prank(caller);
        try core.reclaim(id) {}
        catch {
            assert(false);
        }
    }

    /// A refund either reaches the raiser or stays pending for the raiser, exactly the reward, whoever
    /// calls `reclaim`.
    function check_reclaimPaysOrLeavesTheRewardPending(uint128 reward, bool blocked, address caller) public {
        vm.assume(reward > 0);
        token.mint(RAISER, reward);
        vm.startPrank(RAISER);
        token.approve(address(core), reward);
        uint256 id = core.raise(address(token), reward, ++clock, NO_KEY, 0, 200, bytes32(0));
        vm.stopPrank();
        token.setBlocked(RAISER, blocked);
        vm.warp(clock);

        vm.prank(caller);
        core.reclaim(id);

        uint256 paid = token.balanceOf(RAISER);
        uint256 waiting = core.pending(address(token), RAISER);
        assert(paid + waiting == reward);
        assert(blocked ? waiting == reward : paid == reward);
        assert(token.balanceOf(address(core)) == waiting);
    }
}
