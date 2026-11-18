// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore, Shake, Give, SignedShake, SignedGive} from "../src/AHandCore.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {shakeStructHash, giveStructHash, digestOf} from "./Helpers.sol";

/// Symbolic checks for Halmos; `forge test` skips them. Every argument of a `check_`
/// function stands for all of its values at once. Halmos cannot follow the deploy cheat
/// code forge 1.8 puts in tests, so run with that off:
///     FOUNDRY_DYNAMIC_TEST_LINKING=false halmos --contract CoreSymbolic
contract CoreSymbolic is Test {
    AHandCore core;
    BlacklistToken token;
    address constant RAISER = address(0xA11CE);
    address constant OTHER = address(0xB0B);
    address constant NO_KEY = address(0xDEAD); // the root key where no route is followed
    uint256 constant ROOT_PK = 0xA0A0; // the root key in the route checks
    uint256 constant NEXT_PK = 0xB0B0; // the key their Shake passes the Hand to
    uint256 constant GIVER_PK = 0xCA401;
    uint40 clock; // the time these checks move to, kept here so it is read once

    function setUp() public {
        core = new AHandCore();
        token = new BlacklistToken();
        clock = uint40(block.timestamp);
    }

    /// Raises `reward` as `who` and refunds it while the token refuses `who`: the reward
    /// is left pending.
    function _leavePending(address who, uint256 reward) internal {
        token.mint(who, reward);
        vm.startPrank(who);
        token.approve(address(core), reward);
        uint256 id = core.raise(address(token), reward, ++clock, NO_KEY, 200, 0, bytes32(0));
        vm.stopPrank();
        token.setBlocked(who, true);
        vm.warp(clock);
        core.refund(id);
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

    /// Anyone can close an expired Hand, whatever happens to its reward: the money then
    /// reaches the raiser or stays pending for the raiser. (Halmos does not count gas, so this
    /// says nothing fails for a reason other than gas.)
    function check_anyoneClosesAnExpiredHand(uint128 reward, bool blocked, address caller) public {
        vm.assume(reward > 0);
        token.mint(RAISER, reward);
        vm.startPrank(RAISER);
        token.approve(address(core), reward);
        uint256 id = core.raise(address(token), reward, ++clock, NO_KEY, 200, 0, bytes32(0));
        vm.stopPrank();
        token.setBlocked(RAISER, blocked);
        vm.warp(clock);

        vm.prank(caller);
        try core.refund(id) {}
        catch {
            assert(false);
        }
    }

    /// A refunded reward either reaches the raiser or stays pending for the raiser, in full, whoever
    /// calls `refund`.
    function check_refundPaysOrLeavesTheRewardPending(uint128 reward, bool blocked, address caller) public {
        vm.assume(reward > 0);
        token.mint(RAISER, reward);
        vm.startPrank(RAISER);
        token.approve(address(core), reward);
        uint256 id = core.raise(address(token), reward, ++clock, NO_KEY, 200, 0, bytes32(0));
        vm.stopPrank();
        token.setBlocked(RAISER, blocked);
        vm.warp(clock);

        vm.prank(caller);
        core.refund(id);

        uint256 paid = token.balanceOf(RAISER);
        uint256 waiting = core.pending(address(token), RAISER);
        assert(paid + waiting == reward);
        assert(blocked ? waiting == reward : paid == reward);
        assert(token.balanceOf(address(core)) == waiting);
    }

    /// A Hand thanked along one Shake that keeps `10 000 - next` of the reward for its payee: the
    /// margin is that part of the reward rounded down, the giver's payee gets the rest, and Core
    /// keeps nothing. Each check below leaves one number unknown: with both the reward and the
    /// claim unknown, `Math.mulDiv` multiplies two unknowns and the solver does not finish.
    /// Halmos treats signatures as given, so these say "with valid signatures, the money splits
    /// exactly"; that no other key passes is for the unit and fuzz tests.
    function _thankAlongOneShake(uint256 reward, uint16 next, bytes32 stated) internal {
        address shaker = address(0x5A);
        address giverPayee = address(0x6B);
        token.mint(RAISER, reward);
        vm.startPrank(RAISER);
        token.approve(address(core), reward);
        uint256 id = core.raise(address(token), reward, ++clock, vm.addr(ROOT_PK), 200, 0, bytes32(0));
        vm.stopPrank();

        SignedShake[] memory shakes = new SignedShake[](1);
        shakes[0].shake = Shake(vm.addr(NEXT_PK), shaker, 10_000, next, bytes32(0));
        bytes32 shakeHash = shakeStructHash(core, id, shakes[0].shake);
        shakes[0].keySig = _sign(ROOT_PK, digestOf(address(core), shakeHash));
        Give memory give =
            Give(vm.addr(GIVER_PK), giverPayee, next, keccak256(abi.encode(bytes32(0), shakeHash)), bytes32(0));
        bytes32 digest = digestOf(address(core), giveStructHash(core, id, give));
        vm.prank(RAISER);
        core.thank(id, shakes, SignedGive(give, _sign(NEXT_PK, digest), _sign(GIVER_PK, digest)), stated);

        assert(token.balanceOf(shaker) + token.balanceOf(giverPayee) == reward);
        assert(token.balanceOf(shaker) == reward * (10_000 - next) / 10_000);
        assert(token.balanceOf(address(core)) == 0);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Any claim, the smallest reward where rounding shows: 3.
    function check_thank_anyClaimSmallReward(uint16 next, bytes32 stated) public {
        vm.assume(next <= 10_000);
        _thankAlongOneShake(3, next, stated);
    }

    /// Any claim, a huge reward: nothing overflows.
    function check_thank_anyClaimHugeReward(uint16 next, bytes32 stated) public {
        vm.assume(next <= 10_000);
        _thankAlongOneShake(type(uint128).max, next, stated);
    }

    /// Any reward up to 2^128 - 1, half kept by the Shake.
    function check_thank_anyRewardHalfClaim(uint128 reward, bytes32 stated) public {
        _thankAlongOneShake(reward, 5_000, stated);
    }
}
