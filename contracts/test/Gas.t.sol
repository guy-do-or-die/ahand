// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore, Shake, Give, SignedShake} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {shakeStructHash, giveStructHash, digestOf} from "./Helpers.sol";

/// Core's gas price list: what a network charges for each transaction, written to
/// `snapshots/GasTest.json`. The file is in git, so a change of any price shows in the diff, and
/// `forge test --gas-snapshot-check true` fails on any change. Each number is the gas forge reports
/// for a call made straight from the test, which counts it as a whole transaction: 21 000, the
/// calldata and the execution. Checked against real transactions on a local node (anvil): they
/// differ by a dozen gas at most, from different bytes in the calldata. The gas of the call frame
/// alone (`snapshotGasLastFrame`) is lower by 4 800 for `thank` and `reclaim`, so it is not used.
contract GasTest is Test {
    uint256 constant REWARD = 100e6;
    uint256 constant ROOT_PK = 0xA0A0; // the link's root key
    uint256 constant NEXT_PK = 0xB0B0; // the first key a Shake passes the Hand to
    uint256 constant GIVER_PK = 0xCA401;
    uint16 constant GAS_K = 200; // payout gas, thousands

    AHandCore core;
    MockUSD usd;
    address raiser;
    address giver;
    uint40 expiry;

    function setUp() public {
        core = new AHandCore();
        usd = new MockUSD();
        raiser = makeAddr("raiser");
        giver = vm.addr(GIVER_PK);
        expiry = uint40(block.timestamp + 30 days);
        _fund(usd);
    }

    function _fund(MockUSD token) internal {
        token.mint(raiser, 1e30);
        vm.prank(raiser);
        token.approve(address(core), type(uint256).max);
    }

    function _raise(MockUSD token, uint256 reward) internal returns (uint256 id) {
        vm.prank(raiser);
        id = core.raise(address(token), reward, expiry, vm.addr(ROOT_PK), 0, GAS_K, keccak256("ask"));
    }

    /// Thanks along a route of `n` Shakes, each keeping 1 % for a payee who has never held the
    /// token; the giver gets the rest.
    function _thank(uint256 id, uint256 n) internal {
        SignedShake[] memory shakes = new SignedShake[](n);
        bytes32 routeHash;
        uint256 key = ROOT_PK;
        uint16 claim = 10_000;
        for (uint256 i; i < n; ++i) {
            Shake memory shake =
                Shake(vm.addr(NEXT_PK + i), address(uint160(0x5000 + i)), claim, claim - 100, keccak256("why"));
            bytes32 shakeHash = shakeStructHash(core, id, shake);
            shakes[i] = SignedShake(shake, _sign(key, digestOf(address(core), shakeHash)));
            routeHash = keccak256(abi.encode(routeHash, shakeHash));
            key = NEXT_PK + i;
            claim -= 100;
        }
        Give memory g = Give(routeHash, giver, giver, claim, keccak256("answer"));
        bytes32 digest = digestOf(address(core), giveStructHash(core, id, g));
        bytes memory keySig = _sign(key, digest);
        bytes memory giverSig = _sign(GIVER_PK, digest);
        vm.prank(raiser);
        core.thank(id, shakes, g, keySig, giverSig);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// The very first Hand: Core's counter and its balance of the token are written for the first time.
    function test_gas_raise_firstHand() public {
        _raise(usd, REWARD);
        vm.snapshotValue("raise_firstHand", vm.lastFrameGas().gasTotalUsed);
    }

    function test_gas_raise_nextHand() public {
        _raise(usd, REWARD);
        _raise(usd, REWARD);
        vm.snapshotValue("raise_nextHand", vm.lastFrameGas().gasTotalUsed);
    }

    function test_gas_raise_withoutReward() public {
        _raise(usd, REWARD);
        _raise(usd, 0);
        vm.snapshotValue("raise_withoutReward", vm.lastFrameGas().gasTotalUsed);
    }

    function test_gas_thank_direct() public {
        uint256 id = _raise(usd, REWARD);
        _thank(id, 0);
        vm.snapshotValue("thank_direct", vm.lastFrameGas().gasTotalUsed);
    }

    function test_gas_thank_oneShake() public {
        uint256 id = _raise(usd, REWARD);
        _thank(id, 1);
        vm.snapshotValue("thank_oneShake", vm.lastFrameGas().gasTotalUsed);
    }

    function test_gas_thank_threeShakes() public {
        uint256 id = _raise(usd, REWARD);
        _thank(id, 3);
        vm.snapshotValue("thank_threeShakes", vm.lastFrameGas().gasTotalUsed);
    }

    function test_gas_thank_tenShakes() public {
        uint256 id = _raise(usd, REWARD);
        _thank(id, 10);
        vm.snapshotValue("thank_tenShakes", vm.lastFrameGas().gasTotalUsed);
    }

    function test_gas_reclaim() public {
        uint256 id = _raise(usd, REWARD);
        vm.warp(expiry);
        core.reclaim(id);
        vm.snapshotValue("reclaim", vm.lastFrameGas().gasTotalUsed);
    }

    /// The giver's payout waits while the token blocks the giver; once unblocked, anyone delivers it.
    function test_gas_withdraw() public {
        BlacklistToken token = new BlacklistToken();
        _fund(token);
        uint256 id = _raise(token, REWARD);
        token.setBlocked(giver, true);
        _thank(id, 0);
        token.setBlocked(giver, false);
        core.withdraw(address(token), giver, giver);
        vm.snapshotValue("withdraw", vm.lastFrameGas().gasTotalUsed);
    }
}
