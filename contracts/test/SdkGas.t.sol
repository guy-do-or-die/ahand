// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore, Shake, Give, SignedShake, SignedGive} from "../src/AHandCore.sol";
import {HookToken} from "./mocks/HookToken.sol";
import {Burner} from "./Core.t.sol";
import {IHookRecipient} from "./mocks/HookToken.sol";
import {shakeStructHash, giveStructHash, digestOf} from "./Helpers.sol";

/// Code put on a payee's address: notes how much gas the payout handed it, and accepts the money.
contract Meter is IHookRecipient {
    uint256 public handed;

    function onTokenReceived(address, uint256) external {
        handed = gasleft();
    }
}

/// The gas a `thank` can need at worst, measured on Core itself and written out for the SDK
/// (Р-45, Р-46: Core bounds neither a route's length nor what payees burn; the SDK counts the
/// worst gas before the raiser sends the thank).
///
/// The worst case: the token calls its recipients, every payee burns all the gas it is handed,
/// so every payout uses its whole limit, `payoutGasK` thousand, and then stays pending in a slot
/// written for the first time; the thank is the first one on this Core and the raiser states
/// something with it. The gas Core itself spends then has four parts, each measured below:
///
///   BASE + SHAKE * shakes + (limit * 64 / 63 + PAYOUT) * payouts [+ STATING]
///
/// `limit * 64 / 63` is what must be left when a payout is called for the call to get its whole
/// limit: with this much gas no payout gets less than the Hand promised, whatever the others burn.
/// A transaction needs 21 000 and the gas of its calldata on top; the SDK adds them.
///
/// Not covered: a giver that is a contract. Core asks its code about the signature without a gas
/// limit, so the worst is whatever that code burns; the SDK takes it as a number from outside.
///
/// The file is part of the repository. This test fails when Core no longer spends what the file
/// says; `WRITE_VECTORS=true forge test --match-contract SdkGasTest` writes it anew.
contract SdkGasTest is Test {
    string constant PATH = "test/fixtures/sdk-gas.json";

    uint256 constant REWARD = 100e6;
    uint256 constant ROOT_PK = 0xA0A0; // the link's root key
    uint256 constant NEXT_PK = 0xB0B0; // the first key a Shake passes the Hand to
    uint256 constant GIVER_PK = 0xCA401;
    bytes32 constant STATED = keccak256("thanks");
    uint16 constant GAS_K = 200; // the payout gas the price list is measured with, thousands
    uint256 constant TX_GAS_CAP = 16_777_216; // gas one transaction may use: EIP-7825, Ethereum and Base
    uint256 constant TX_SIZE_LIMIT = 128 * 1024; // the largest transaction geth and reth admit to the mempool
    uint256 constant TX_ENVELOPE = 256; // bytes of a signed transaction around its calldata, with room to spare

    AHandCore core;
    HookToken token;
    address raiser;
    address giver;
    uint40 expiry;

    /// The four measured parts.
    struct Rules {
        uint256 base;
        uint256 shake;
        uint256 payout;
        uint256 stating;
    }

    /// A route's shape: Shakes that keep nothing, Shakes that keep a margin for a payee, whether
    /// the raiser states something, and the Hand's payout gas.
    struct Shape {
        uint256 unpaid;
        uint256 paid;
        bool stated;
        uint16 gasK;
    }

    function setUp() public {
        core = new AHandCore();
        token = new HookToken();
        raiser = makeAddr("raiser");
        giver = vm.addr(GIVER_PK);
        expiry = uint40(block.timestamp + 30 days);
        token.mint(raiser, 1e30);
        vm.prank(raiser);
        token.approve(address(core), type(uint256).max);
    }

    /* ------------------------------------------------------------------ the formula */

    /// The gas Core itself may spend on a thank of this shape: the formula the SDK repeats.
    function _worstExecution(Rules memory rules, Shape memory shape) internal pure returns (uint256) {
        uint256 limit = uint256(shape.gasK) * 1_000;
        uint256 perPayout = (limit * 64 + 62) / 63 + rules.payout;
        return rules.base + rules.shake * (shape.unpaid + shape.paid) + perPayout * (shape.paid + 1)
            + (shape.stated ? rules.stating : 0);
    }

    /// The four parts, from thanks whose payouts get a limit of one thousand gas: so little that a
    /// payout cannot even start, uses it up to the last gas and leaves nothing unspent to blur
    /// what is spent around it.
    function _measureRules() internal returns (Rules memory rules) {
        uint256 direct = _spent(Shape(0, 0, false, 1));
        uint256 oneUnpaid = _spent(Shape(1, 0, false, 1));
        uint256 onePaid = _spent(Shape(0, 1, false, 1));
        uint256 stated = _spent(Shape(0, 0, true, 1));
        rules.shake = oneUnpaid - direct;
        rules.payout = onePaid - oneUnpaid - 1_000;
        rules.base = direct - 1_000 - rules.payout;
        rules.stating = stated - direct;
    }

    /* ------------------------------------------------------------------ measuring */

    /// What Core spends on the worst thank of this shape, and the size of its calldata, on a state
    /// put back afterwards. Forge counts a call made straight from the test as a whole transaction;
    /// the 21 000 and the calldata's gas are taken off.
    function _spentAndSize(Shape memory shape) internal returns (uint256 execution, uint256 size) {
        uint256 snapshot = vm.snapshotState();
        (uint256 id, SignedShake[] memory shakes, SignedGive memory signedGive) = _route(shape, _burner(0));
        bytes32 stated = shape.stated ? STATED : bytes32(0);
        bytes memory data = abi.encodeCall(core.thank, (id, shakes, signedGive, stated));
        vm.prank(raiser);
        core.thank(id, shakes, signedGive, stated);
        execution = vm.lastFrameGas().gasTotalUsed - 21_000 - _calldataGas(data);
        size = data.length;
        vm.revertToState(snapshot);
    }

    function _spent(Shape memory shape) internal returns (uint256 execution) {
        (execution,) = _spentAndSize(shape);
    }

    /// A Hand in the token that calls its recipients, and a signed route of the shape: first the
    /// Shakes that pay, each a margin of one basis point to a payee of its own that burns its gas,
    /// then the Shakes that keep nothing; the Give pays `giverPayee`.
    function _route(
        Shape memory shape,
        address giverPayee
    ) internal returns (uint256 id, SignedShake[] memory shakes, SignedGive memory signedGive) {
        vm.prank(raiser);
        id = core.raise(address(token), REWARD, expiry, vm.addr(ROOT_PK), shape.gasK, 0, keccak256("ask"));

        shakes = new SignedShake[](shape.paid + shape.unpaid);
        bytes32 routeHash;
        uint256 key = ROOT_PK;
        uint16 claim = 10_000;
        for (uint256 position; position < shakes.length; ++position) {
            bool paid = position < shape.paid;
            Shake memory shake = Shake(
                vm.addr(NEXT_PK + position),
                paid ? _burner(position + 1) : address(0),
                claim,
                paid ? claim - 1 : claim,
                keccak256("why")
            );
            bytes32 shakeHash = shakeStructHash(core, id, shake);
            shakes[position] = SignedShake(shake, _sign(key, digestOf(address(core), shakeHash)));
            routeHash = keccak256(abi.encode(routeHash, shakeHash));
            key = NEXT_PK + position;
            claim = shake.nextClaimBps;
        }

        Give memory give = Give(giver, giverPayee, claim, routeHash, keccak256("answer"));
        bytes32 digest = digestOf(address(core), giveStructHash(core, id, give));
        signedGive = SignedGive(give, _sign(key, digest), _sign(GIVER_PK, digest));
    }

    /// A payee of its own number whose code burns all the gas a payout hands it.
    function _burner(uint256 number) internal returns (address payee) {
        payee = _burnerAt(number);
        vm.etch(payee, type(Burner).runtimeCode);
        token.setHooked(payee, true);
    }

    function _burnerAt(uint256 number) internal pure returns (address) {
        return address(uint160(0xB0000 + number));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Gas the calldata of a transaction costs: 4 for a zero byte, 16 for any other.
    function _calldataGas(bytes memory data) internal pure returns (uint256 gas) {
        for (uint256 index; index < data.length; ++index) {
            gas += data[index] == 0 ? 4 : 16;
        }
    }

    /* ------------------------------------------------------------------ the tests */

    /// The shapes the file carries: the SDK must reach the same worst gas for each from the rules.
    function _shapes() internal pure returns (Shape[] memory shapes) {
        shapes = new Shape[](10);
        shapes[0] = Shape(0, 0, false, GAS_K);
        shapes[1] = Shape(1, 0, false, GAS_K);
        shapes[2] = Shape(0, 1, false, GAS_K);
        shapes[3] = Shape(0, 0, true, GAS_K);
        shapes[4] = Shape(0, 10, true, GAS_K);
        shapes[5] = Shape(5, 5, false, GAS_K);
        shapes[6] = Shape(20, 0, true, GAS_K);
        shapes[7] = Shape(3, 3, false, 50);
        shapes[8] = Shape(2, 2, true, 1_000);
        shapes[9] = Shape(0, 60, true, GAS_K);
    }

    /// The rules and, for each shape, the worst gas by the formula and what Core spent when every
    /// payee burned its limit. The formula is never below what was spent, and above it only by
    /// the 1/63 kept for each payout and by what a burned payout still hands back: the 1/64 each
    /// of the two calls around the payee keeps from the call inside it.
    function test_gas_sdkRulesAreWhatCoreSpends() public {
        Rules memory rules = _measureRules();
        Shape[] memory shapes = _shapes();

        string memory cases;
        for (uint256 index; index < shapes.length; ++index) {
            Shape memory shape = shapes[index];
            (uint256 spent, uint256 size) = _spentAndSize(shape);
            uint256 worst = _worstExecution(rules, shape);
            uint256 limit = uint256(shape.gasK) * 1_000;
            assertGe(worst, spent);
            assertLe(worst - spent, (shape.paid + 1) * (limit / 63 + 2 * (limit / 64) + 64));
            cases = string.concat(
                cases,
                index == 0 ? "" : ",\n",
                '  {"shakes": ',
                vm.toString(shape.unpaid + shape.paid),
                ', "paid": ',
                vm.toString(shape.paid),
                ', "stated": ',
                shape.stated ? "true" : "false",
                ', "payoutGasK": ',
                vm.toString(shape.gasK),
                ', "calldataBytes": ',
                vm.toString(size),
                ', "worstExecution": ',
                vm.toString(worst),
                ', "spent": ',
                vm.toString(spent),
                "}"
            );
        }

        string memory json = string.concat(
            "{\n",
            '"evm": "prague",\n',
            '"rules": {"base": ',
            vm.toString(rules.base),
            ', "shake": ',
            vm.toString(rules.shake),
            ', "payout": ',
            vm.toString(rules.payout),
            ', "stating": ',
            vm.toString(rules.stating),
            "},\n",
            '"limits": {"txGas": ',
            vm.toString(TX_GAS_CAP),
            ', "txBytes": ',
            vm.toString(TX_SIZE_LIMIT),
            ', "txEnvelopeBytes": ',
            vm.toString(TX_ENVELOPE),
            "},\n",
            '"cases": [\n',
            cases,
            "\n]\n}\n"
        );
        if (vm.envOr("WRITE_VECTORS", false)) vm.writeFile(PATH, json);
        assertEq(vm.readFile(PATH), json);
    }

    /// Sent with the worst gas of the formula, a thank hands every payout its whole limit, also
    /// the last one after every other payee burned its own: the giver's payee is handed exactly
    /// what it is handed when the transaction has gas to spare. With less gas the same thank can
    /// still go through and hand that payee less: this is what the 64/63 in the formula is for.
    function test_gas_worstGasKeepsEveryPayoutItsLimit() public {
        Rules memory rules = _measureRules();
        Shape memory shape = Shape(2, 5, true, GAS_K);
        address payee = makeAddr("metered payee");
        vm.etch(payee, type(Meter).runtimeCode);
        token.setHooked(payee, true);
        (uint256 id, SignedShake[] memory shakes, SignedGive memory signedGive) = _route(shape, payee);
        bytes memory data = abi.encodeCall(core.thank, (id, shakes, signedGive, STATED));

        uint256 worst = _worstExecution(rules, shape);
        uint256 snapshot = vm.snapshotState();

        vm.prank(raiser);
        (bool ok,) = address(core).call{gas: TX_GAS_CAP}(data);
        assertTrue(ok);
        uint256 whole = Meter(payee).handed();
        assertGt(whole, uint256(GAS_K) * 1_000 / 2); // the token's own work comes out of the limit first
        vm.revertToState(snapshot);

        vm.prank(raiser);
        (ok,) = address(core).call{gas: worst}(data);
        assertTrue(ok);
        assertEq(Meter(payee).handed(), whole);
        assertEq(core.pending(address(token), payee), 0);
        assertEq(core.pending(address(token), _burnerAt(1)), REWARD / 10_000); // the burning payees are left pending
        vm.revertToState(snapshot);

        // Below the worst gas: somewhere the thank still goes through and the payee is handed less.
        bool handedLess;
        for (uint256 less = 500; less <= 100_000 && !handedLess; less += 500) {
            vm.prank(raiser);
            (ok,) = address(core).call{gas: worst - less}(data);
            handedLess = ok && Meter(payee).handed() < whole;
            vm.revertToState(snapshot);
        }
        assertTrue(handedLess);
    }
}
