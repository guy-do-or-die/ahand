// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AHandCore, Shake, Give, SignedShake, SignedGive} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {HookToken, IHookRecipient} from "./mocks/HookToken.sol";
import {shakeStructHash, giveStructHash, digestOf, HandView, handOf} from "./Helpers.sol";
import {Handler, CoreInvariantTest} from "./Core.invariant.t.sol";

/// The code an actor may have at its own address. As a wallet it answers for the actor's own key
/// (ERC-1271) or refuses every signature; as a payee of a token with hooks it takes the money,
/// refuses it, burns the gas of its payout, or lets the adversary call back into Core.
/// Its three settings live in the actor's storage, so they stay when the actor's code changes.
contract Shape is IHookRecipient {
    uint256 public hookMode; // 0 takes, 1 refuses, 2 burns the gas, 3 calls back into Core
    uint256 public signMode; // 0 answers for the actor's own key, 1 refuses every signature
    Adversary public adversary;

    function onTokenReceived(address, uint256) external {
        if (hookMode == 1) revert("refused");
        if (hookMode == 2) {
            for (;;) {}
        }
        if (hookMode == 3) adversary.reenter();
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signMode == 0) {
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(hash, signature);
            if (err == ECDSA.RecoverError.NoError && recovered == address(this)) return 0x1626ba7e;
        }
        return 0xffffffff;
    }
}

/// Everything here is a call Core must refuse, made at a random moment of the honest handler's
/// run: by the wrong caller, with a signature of the wrong key, for the wrong Hand, at the wrong
/// time, or from inside a payout. A call that goes through is a breach; one refused for another
/// reason than the one Core's own order of checks gives is a surprise. Neither may happen.
/// Besides, it changes what the three actors are: plain keys, keys with an EIP-7702 delegation, or
/// wallets with code, and how they behave when the first token pays them.
contract Adversary is Test {
    AHandCore public core;
    HookToken public hookToken;
    address[2] public tokens;
    uint256[3] keys = [0xA11CE, 0xB0B, 0xCA401];
    address[3] public actors;
    Shape public shapeCode;

    uint256 constant ROOT_PK = 0xA0A0;
    uint256 constant NEXT_PK = 0xB0B0;
    uint256 constant WRONG_PK = 0xBAD;
    address constant STRANGER = address(0x57A46E);
    uint256 constant CURVE_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    // What is wrong with a thank that is otherwise right.
    uint256 constant NOTHING = 0;
    uint256 constant GIVER_KEY = 1; // the giver's signature is by another key
    uint256 constant GIVER_HIGH_S = 2; // the giver's signature in its other, refused form
    uint256 constant GIVE_KEY = 3; // the last key's signature of the Give is by another key
    uint256 constant GIVE_KEY_HIGH_S = 4;
    uint256 constant SHAKE_KEY = 5; // the Shake is signed by another key than the root key
    uint256 constant GIVE_CLAIM = 6; // the Give asks for another claim than the route left
    uint256 constant ROUTE_HASH = 7; // the Give names another route
    uint256 constant GIVER_IS_RAISER = 8;
    uint256 constant ZERO_PAYEE = 9;
    uint256 constant ANONYMOUS = 10; // the Shake keeps a margin for nobody
    uint256 constant SHAKE_CLAIM = 11; // the Shake does not start from the whole reward
    uint256 constant OTHER_HAND = 12; // everything is signed for another Hand
    uint256 constant OTHER_CORE = 13; // everything is signed for another Core
    uint256 constant TWISTS = 14;

    uint8 constant GONE = 0; // never raised, or closed
    uint8 constant LATE = 1; // open, its expiry has come
    uint8 constant LIVE = 2; // open and can still be thanked

    uint256 public tried;
    uint256 outsideBreaches;
    uint256 outsideSurprises;
    string outsideBreach;
    string outsideSurprise;
    mapping(bytes4 error => uint256) public refusedWith;

    /// What happened inside payouts, in one slot that is never zero: a payout has little gas, and a
    /// record that ran out of it would be lost with the payout. From the low end, 64 bits each: the
    /// times a payee called back, the calls refused as they must be, the calls that went through,
    /// the calls refused for another reason.
    uint256 inside = 1 << 255;

    constructor(AHandCore core_, HookToken hookToken_, MockUSD otherToken) {
        core = core_;
        hookToken = hookToken_;
        tokens = [address(hookToken_), address(otherToken)];
        actors = [vm.addr(keys[0]), vm.addr(keys[1]), vm.addr(keys[2])];
        shapeCode = new Shape();
    }

    /* ------------------------------------------------------- what the actors are */

    /// `kind`: 0 a plain key, 1 a key with an EIP-7702 delegation to the wallet's code, 2 a wallet
    /// with code. `hooked`: the first token calls the actor whenever it pays it. Of six hook
    /// modes three call back into Core: that is what the run is for.
    function shape(uint256 who, uint256 kind, uint256 hookMode, uint256 signMode, bool hooked) external {
        address actor = actors[who % 3];
        kind %= 3;
        if (kind == 0) vm.etch(actor, "");
        if (kind == 1) vm.etch(actor, abi.encodePacked(hex"ef0100", address(shapeCode)));
        if (kind == 2) vm.etch(actor, address(shapeCode).code);
        hookMode %= 6;
        vm.store(actor, bytes32(uint256(0)), bytes32(hookMode > 3 ? 3 : hookMode));
        vm.store(actor, bytes32(uint256(1)), bytes32(signMode % 2));
        vm.store(actor, bytes32(uint256(2)), bytes32(uint256(uint160(address(this)))));
        hookToken.setHooked(actor, hooked);
    }

    /// Back to three plain keys that take what they are paid, so that everything pending can be delivered.
    function calm() external {
        for (uint256 index; index < 3; ++index) {
            vm.etch(actors[index], "");
            hookToken.setHooked(actors[index], false);
        }
    }

    /* ------------------------------------------------------------ from inside a payout */

    /// Called by an actor's code while a token pays it, which is while Core runs a thank, a refund
    /// or a withdrawal: every entry point must answer `Reentered`, whatever it is asked, and
    /// `transferOut` must answer that the caller is not Core. All seven are tried each time.
    function reenter() external {
        address actor = msg.sender;
        if (actor != actors[0] && actor != actors[1] && actor != actors[2]) return;
        uint256 record = inside + 1;
        uint256 id = record % (core.handsCount() + 1) + 1;
        bytes32 reentered = keccak256(abi.encodeWithSelector(AHandCore.Reentered.selector));
        bytes32 notCore = keccak256(abi.encodeWithSelector(AHandCore.NotCore.selector));
        SignedShake[] memory none;
        SignedGive memory signedGive;

        bytes[7] memory calls = [
            abi.encodeCall(core.raise, (tokens[0], 0, uint40(block.timestamp + 1 days), actor, 200, 0, bytes32(0))),
            abi.encodeCall(core.extend, (id, uint40(block.timestamp + 1 days))),
            abi.encodeCall(core.fund, (id, 0)),
            abi.encodeCall(core.thank, (id, none, signedGive, bytes32(0))),
            abi.encodeCall(core.refund, (id)),
            abi.encodeCall(core.withdraw, (tokens[record % 2], actor, actor)),
            abi.encodeCall(core.transferOut, (tokens[0], actor, 1))
        ];
        for (uint256 index; index < 7; ++index) {
            vm.prank(actor);
            (bool ok, bytes memory reason) = address(core).call(calls[index]);
            if (ok) record += 1 << 128;
            else if (keccak256(reason) != (index == 6 ? notCore : reentered)) record += 1 << 192;
            else record += 1 << 64;
        }
        inside = record;
    }

    function reentries() public view returns (uint256) {
        return uint64(inside);
    }

    function refusedInside() public view returns (uint256) {
        return uint64(inside >> 64);
    }

    function breaches() public view returns (uint256) {
        return outsideBreaches + uint64(inside >> 128);
    }

    function surprises() public view returns (uint256) {
        return outsideSurprises + (inside << 1 >> 193);
    }

    function lastBreach() external view returns (string memory) {
        return uint64(inside >> 128) > 0 ? "a call from inside a payout went through" : outsideBreach;
    }

    function lastSurprise() external view returns (string memory) {
        return inside << 1 >> 193 > 0 ? "a call from inside a payout was refused for another reason" : outsideSurprise;
    }

    /* ------------------------------------------------------------------- thank */

    /// A thank that is right in everything, called by someone who is not the Hand's raiser.
    function strangerThanks(uint256 seed, uint256 who, uint256 via, uint256 next) external {
        (uint256 id, HandView memory hand, uint8 state) = _pick(seed);
        address caller = actors[who % 3] == hand.raiser || who % 4 == 3 ? STRANGER : actors[who % 3];
        bytes4 refusal = state == GONE ? AHandCore.NotOpen.selector : AHandCore.NotRaiser.selector;
        (bytes memory data,) = _thank(id, hand, via, next, NOTHING);
        _try(caller, data, abi.encodeWithSelector(refusal), "a thank by another than the raiser");
    }

    /// The raiser's own thank with one thing wrong in it.
    function raiserThanksWrongly(uint256 seed, uint256 twist, uint256 via, uint256 next) external {
        (uint256 id, HandView memory hand, uint8 state) = _pick(seed);
        twist = twist % (TWISTS - 1) + 1;
        (bytes memory data, bytes memory twisted) = _thank(id, hand, via, next, twist);
        if (state == GONE) twisted = abi.encodeWithSelector(AHandCore.NotOpen.selector);
        if (state == LATE) twisted = abi.encodeWithSelector(AHandCore.Expired.selector);
        _try(hand.raiser, data, twisted, "a thank with something wrong in it");
    }

    /// The raiser's thank, right in everything, of a Hand that is closed, was never raised or has expired.
    function raiserThanksTooLate(uint256 seed, uint256 via, uint256 next) external {
        (uint256 id, HandView memory hand, uint8 state) = _pick(seed);
        if (state == LIVE) return;
        bytes4 refusal = state == GONE ? AHandCore.NotOpen.selector : AHandCore.Expired.selector;
        (bytes memory data,) = _thank(id, hand, via, next, NOTHING);
        _try(hand.raiser, data, abi.encodeWithSelector(refusal), "a thank of a Hand that cannot be thanked");
    }

    /// The raiser's thank of a Give whose giver is a wallet with code that refuses every signature:
    /// the giver's own key signed, and where there is code that is not a delegation the key no longer counts.
    function raiserThanksARefusingWallet(uint256 seed, uint256 via, uint256 next) external {
        (uint256 id, HandView memory hand, uint8 state) = _pick(seed);
        if (state != LIVE) return;
        for (uint256 step; step < 3; ++step) {
            address giver = actors[(via + step) % 3];
            bool refuses = giver.code.length > 23 && uint256(vm.load(giver, bytes32(uint256(1)))) == 1;
            if (giver == hand.raiser || !refuses) continue;
            (bytes memory data,) = _thank(id, hand, (via + step) % 3 + 3 * (via / 3), next, NOTHING);
            bytes memory refused = abi.encodeWithSelector(AHandCore.InvalidGiverSig.selector);
            _try(hand.raiser, data, refused, "a thank of a wallet that did not sign");
            return;
        }
    }

    /// The other side: a thank that is right in everything goes through, whatever its giver is: a
    /// plain key, a key with a delegation, or a wallet with code that answers for its key. It is
    /// tried and then undone, so the honest handler's books stay as they were.
    function rightfulThankGoesThrough(uint256 seed, uint256 via, uint256 next) external {
        (uint256 id, HandView memory hand, uint8 state) = _pick(seed);
        if (state != LIVE) return;
        uint256 pick = via % 3;
        if (actors[pick] == hand.raiser) pick = (pick + 1) % 3;
        address giver = actors[pick];
        if (giver.code.length > 23 && uint256(vm.load(giver, bytes32(uint256(1)))) == 1) return; // it refuses
        (bytes memory data,) = _thank(id, hand, via, next, NOTHING);

        uint256 snapshot = vm.snapshotState();
        vm.prank(hand.raiser);
        (bool ok,) = address(core).call(data);
        vm.revertToState(snapshot);

        ++tried;
        if (!ok) {
            ++outsideSurprises;
            outsideSurprise = "a rightful thank was refused";
        }
    }

    struct Draft {
        address giver;
        uint256 giverKey;
        uint256 signedFor;
        address signedCore;
        uint16 claim;
        uint256 lastKey;
        bytes32 routeHash;
        uint256 shakes;
    }

    /// The calldata of a thank of this Hand, direct or through one Shake, and the error its twist must get.
    function _thank(
        uint256 id,
        HandView memory hand,
        uint256 via,
        uint256 next,
        uint256 twist
    ) internal view returns (bytes memory data, bytes memory twisted) {
        Draft memory draft;
        uint256 pick = via % 3;
        if (actors[pick] == hand.raiser) pick = (pick + 1) % 3;
        draft.giver = actors[pick];
        draft.giverKey = keys[pick];
        draft.signedFor = twist == OTHER_HAND ? (id == 1 ? 2 : id - 1) : id;
        draft.signedCore = twist == OTHER_CORE ? address(0xC04E) : address(core);
        draft.claim = 10_000;
        draft.lastKey = ROOT_PK;

        SignedShake[] memory shakes;
        if ((via / 3) % 2 == 1 || twist == SHAKE_KEY || twist == ANONYMOUS || twist == SHAKE_CLAIM) {
            draft.claim = uint16(bound(next, 0, twist == ANONYMOUS ? 9_999 : 10_000));
            shakes = new SignedShake[](1);
            shakes[0].shake = Shake(
                vm.addr(NEXT_PK),
                twist == ANONYMOUS ? address(0) : actors[next % 3],
                twist == SHAKE_CLAIM ? 9_999 : 10_000,
                draft.claim,
                bytes32(next)
            );
            shakes[0].keySig = _sign(
                twist == SHAKE_KEY ? WRONG_PK : ROOT_PK,
                digestOf(draft.signedCore, shakeStructHash(core, draft.signedFor, shakes[0].shake))
            );
            draft.routeHash = keccak256(abi.encode(bytes32(0), shakeStructHash(core, id, shakes[0].shake)));
            draft.lastKey = NEXT_PK;
            draft.shakes = 1;
        }

        Give memory give = Give(draft.giver, draft.giver, draft.claim, draft.routeHash, bytes32(via));
        if (twist == GIVE_CLAIM) give.claimBps = draft.claim == 10_000 ? 9_999 : draft.claim + 1;
        if (twist == ROUTE_HASH) give.routeHash = keccak256("another route");
        if (twist == ZERO_PAYEE) give.payee = address(0);
        if (twist == GIVER_IS_RAISER) {
            give.signer = hand.raiser;
            give.payee = hand.raiser;
            for (uint256 index; index < 3; ++index) {
                if (actors[index] == hand.raiser) draft.giverKey = keys[index];
            }
        }
        bytes32 digest = digestOf(draft.signedCore, giveStructHash(core, draft.signedFor, give));
        bytes memory keySig = _sign(twist == GIVE_KEY ? WRONG_PK : draft.lastKey, digest);
        if (twist == GIVE_KEY_HIGH_S) keySig = _otherForm(keySig);
        bytes memory giverSig = _sign(twist == GIVER_KEY ? WRONG_PK : draft.giverKey, digest);
        if (twist == GIVER_HIGH_S) giverSig = _otherForm(giverSig);

        data = abi.encodeCall(core.thank, (id, shakes, SignedGive(give, keySig, giverSig), bytes32(0)));
        twisted = _twistError(twist, draft.shakes);
    }

    function _twistError(uint256 twist, uint256 shakes) internal pure returns (bytes memory) {
        if (twist == GIVER_KEY || twist == GIVER_HIGH_S) {
            return abi.encodeWithSelector(AHandCore.InvalidGiverSig.selector);
        }
        if (twist == GIVE_KEY || twist == GIVE_KEY_HIGH_S) {
            return abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, shakes);
        }
        if (twist == SHAKE_KEY) return abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0);
        if (twist == GIVE_CLAIM) return abi.encodeWithSelector(AHandCore.InvalidClaim.selector, shakes);
        if (twist == ROUTE_HASH) return abi.encodeWithSelector(AHandCore.InvalidRouteHash.selector);
        if (twist == GIVER_IS_RAISER) return abi.encodeWithSelector(AHandCore.GiverIsRaiser.selector);
        if (twist == ZERO_PAYEE) return abi.encodeWithSelector(AHandCore.ZeroPayee.selector);
        if (twist == ANONYMOUS) return abi.encodeWithSelector(AHandCore.AnonymousMargin.selector, 0);
        if (twist == SHAKE_CLAIM) return abi.encodeWithSelector(AHandCore.InvalidClaim.selector, 0);
        // For another Hand or another Core the first signature Core meets is by no key it expects.
        return abi.encodeWithSelector(AHandCore.InvalidKeySig.selector, 0);
    }

    /* ------------------------------------------------------ extend, fund, refund */

    /// Someone who is not the raiser moves the expiry or adds to the reward.
    function strangerMeddles(uint256 seed, uint256 who, bool extends, uint256 amount) external {
        (uint256 id, HandView memory hand, uint8 state) = _pick(seed);
        address caller = actors[who % 3] == hand.raiser || who % 4 == 3 ? STRANGER : actors[who % 3];
        bytes4 refusal = state == GONE ? AHandCore.NotOpen.selector : AHandCore.NotRaiser.selector;
        bytes memory data = extends
            ? abi.encodeCall(core.extend, (id, uint40(block.timestamp + 1 + amount % 90 days)))
            : abi.encodeCall(core.fund, (id, amount % 1e30));
        _try(caller, data, abi.encodeWithSelector(refusal), "another than the raiser extends or funds");
    }

    /// The raiser moves the expiry where it may not go, or touches a Hand that is closed or expired.
    function raiserOversteps(uint256 seed, uint256 what, uint256 by) external {
        (uint256 id, HandView memory hand, uint8 state) = _pick(seed);
        bytes4 refusal = state == GONE ? AHandCore.NotOpen.selector : AHandCore.Expired.selector;
        what %= 3;
        bytes memory data;
        if (what == 0) {
            // not later than it is
            data = abi.encodeCall(core.extend, (id, uint40(hand.expiry - by % (uint256(hand.expiry) + 1))));
            if (state == LIVE) refusal = AHandCore.ExpiryTooEarly.selector;
        } else if (what == 1) {
            // further ahead than the cap
            uint256 beyond = block.timestamp + core.MAX_EXPIRY_PERIOD() + 1 + by % 365 days;
            data = abi.encodeCall(core.extend, (id, uint40(beyond)));
            if (state == LIVE) refusal = AHandCore.ExpiryTooLate.selector;
        } else {
            if (state == LIVE) return; // adding nothing to a live Hand is the raiser's right
            data = abi.encodeCall(core.fund, (id, 0));
        }
        _try(hand.raiser, data, abi.encodeWithSelector(refusal), "the raiser extends or funds where it may not");
    }

    /// A refund before the expiry, or of a Hand that is closed or was never raised.
    function refundsEarly(uint256 seed, uint256 who) external {
        (uint256 id,, uint8 state) = _pick(seed);
        if (state == LATE) return; // from the expiry on anyone may refund
        bytes4 refusal = state == GONE ? AHandCore.NotOpen.selector : AHandCore.NotExpired.selector;
        address caller = who % 4 == 3 ? STRANGER : actors[who % 3];
        _try(caller, abi.encodeCall(core.refund, (id)), abi.encodeWithSelector(refusal), "a refund before its time");
    }

    /* ------------------------------------------------------ withdraw, transferOut, raise */

    /// What waits for one payee is sent elsewhere by another, or to nobody, or is not there at all.
    function grabsPending(uint256 who, uint256 thief, uint256 which, uint256 what) external {
        address payee = actors[who % 3];
        address token = tokens[which % 2];
        what %= 3;
        if (what == 0) {
            address other = thief % 4 == 3 || actors[thief % 3] == payee ? STRANGER : actors[thief % 3];
            bytes memory data = abi.encodeCall(core.withdraw, (token, payee, other));
            _try(other, data, abi.encodeWithSelector(AHandCore.NotPayee.selector), "another's pending payout taken");
        } else if (what == 1) {
            bytes memory data = abi.encodeCall(core.withdraw, (token, payee, address(0)));
            _try(payee, data, abi.encodeWithSelector(AHandCore.ZeroDestination.selector), "a withdrawal to nobody");
        } else {
            if (core.pending(token, payee) != 0) return;
            bytes memory data = abi.encodeCall(core.withdraw, (token, payee, payee));
            _try(STRANGER, data, abi.encodeWithSelector(AHandCore.NothingPending.selector), "a withdrawal of nothing");
        }
    }

    /// Core's own transfer called from outside.
    function callsTransferOut(uint256 who, uint256 which, uint256 amount) external {
        address caller = who % 4 == 3 ? STRANGER : actors[who % 3];
        bytes memory data = abi.encodeCall(core.transferOut, (tokens[which % 2], caller, amount));
        _try(caller, data, abi.encodeWithSelector(AHandCore.NotCore.selector), "transferOut called from outside");
    }

    /// A Hand that could never be thanked, or that would lock its reward for too long.
    function raisesBadly(uint256 who, uint256 what, uint256 by) external {
        address actor = actors[who % 3];
        uint40 expiry = uint40(block.timestamp + 1 days);
        address rootKey = vm.addr(ROOT_PK);
        uint16 minClaimBps = 0;
        bytes4 refusal;
        what %= 4;
        if (what == 0) {
            expiry = uint40(block.timestamp - by % (block.timestamp + 1));
            refusal = AHandCore.ExpiryTooEarly.selector;
        } else if (what == 1) {
            expiry = uint40(block.timestamp + core.MAX_EXPIRY_PERIOD() + 1 + by % 365 days);
            refusal = AHandCore.ExpiryTooLate.selector;
        } else if (what == 2) {
            rootKey = address(0);
            refusal = AHandCore.ZeroRootKey.selector;
        } else {
            minClaimBps = uint16(10_001 + by % 55_535);
            refusal = AHandCore.MinClaimTooHigh.selector;
        }
        bytes memory data =
            abi.encodeCall(core.raise, (tokens[by % 2], 0, expiry, rootKey, 200, minClaimBps, bytes32(0)));
        _try(actor, data, abi.encodeWithSelector(refusal), "a Hand raised with terms Core refuses");
    }

    /* ------------------------------------------------------------------ helpers */

    /// Any Hand ever raised, or the next number, which was never raised.
    function _pick(uint256 seed) internal view returns (uint256 id, HandView memory hand, uint8 state) {
        id = seed % (core.handsCount() + 1) + 1;
        hand = handOf(core, id);
        state = hand.openedAt == 0 || hand.closedAt != 0 ? GONE : block.timestamp >= hand.expiry ? LATE : LIVE;
    }

    function _try(address caller, bytes memory data, bytes memory expected, string memory what) internal {
        vm.prank(caller);
        (bool ok, bytes memory reason) = address(core).call(data);
        ++tried;
        if (ok) {
            ++outsideBreaches;
            outsideBreach = what;
        } else if (keccak256(reason) != keccak256(expected)) {
            ++outsideSurprises;
            outsideSurprise = what;
        } else {
            ++refusedWith[bytes4(reason)];
        }
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// The same signature in its other form, with `s` in the upper half: Core takes one form only.
    function _otherForm(bytes memory sig) internal pure returns (bytes memory) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        return abi.encodePacked(r, bytes32(CURVE_ORDER - uint256(s)), v == 27 ? uint8(28) : uint8(27));
    }
}

/// The honest handler's run with an adversary in it. The handler's actions and the adversary's are
/// drawn at random into one sequence; the first token calls its payees, and the three actors keep
/// changing between plain keys, delegated keys and wallets with code. An honest action may now be
/// refused (a wallet that will not sign, a payee that will not take), so a revert does not fail
/// the run here. The five invariants of the honest run must hold all the same, and no hostile
/// call may go through or be refused for a reason Core's order of checks does not give; and a
/// thank that is right in everything must go through, whatever its giver is.
/// forge-config: default.invariant.fail-on-revert = false
contract CoreHostileInvariantTest is CoreInvariantTest {
    Adversary adversary;
    HookToken hookToken;

    function setUp() public override {
        core = new AHandCore();
        hookToken = new HookToken();
        plainToken = hookToken;
        blockingToken = new BlacklistToken();
        handler = new Handler(core, plainToken, blockingToken);
        adversary = new Adversary(core, hookToken, blockingToken);

        targetContract(address(handler));
        bytes4[] memory notAnAction = new bytes4[](1);
        notAnAction[0] = Handler.drain.selector;
        excludeSelector(FuzzSelector({addr: address(handler), selectors: notAnAction}));

        targetContract(address(adversary));
        bytes4[] memory attacks = new bytes4[](12);
        attacks[0] = Adversary.shape.selector;
        attacks[1] = Adversary.strangerThanks.selector;
        attacks[2] = Adversary.raiserThanksWrongly.selector;
        attacks[3] = Adversary.raiserThanksTooLate.selector;
        attacks[4] = Adversary.strangerMeddles.selector;
        attacks[5] = Adversary.raiserOversteps.selector;
        attacks[6] = Adversary.refundsEarly.selector;
        attacks[7] = Adversary.grabsPending.selector;
        attacks[8] = Adversary.callsTransferOut.selector;
        attacks[9] = Adversary.raisesBadly.selector;
        attacks[10] = Adversary.raiserThanksARefusingWallet.selector;
        attacks[11] = Adversary.rightfulThankGoesThrough.selector;
        targetSelector(FuzzSelector({addr: address(adversary), selectors: attacks}));
    }

    /// The actors become plain keys again and take what they are paid; then, as in the honest run,
    /// every Hand is closed and everything pending is delivered.
    function afterInvariant() public override {
        adversary.calm();
        super.afterInvariant();
        invariant_noHostileCallGoesThrough();
    }

    /// No call Core must refuse went through, and each was refused for the reason Core's order of checks gives.
    function invariant_noHostileCallGoesThrough() public view {
        assertEq(adversary.breaches(), 0, adversary.lastBreach());
        assertEq(adversary.surprises(), 0, adversary.lastSurprise());
    }

    /// The adversary's own tools, one by one and in a fixed order: every kind of refusal is really
    /// met, by a Hand in each of its three states, and the actors' shapes do what they say.
    function test_hostile_everyAttackMeetsItsRefusal() public {
        // Three Hands in the first token: one refunded, one past its expiry and still open, one live.
        handler.raise(0, 0, 1_000e6, 1 days);
        handler.refund(0);
        handler.raise(1, 0, 1_000e6, 1 days);
        vm.warp(block.timestamp + 2 days);
        handler.raise(2, 0, 1_000e6, 30 days);
        assertEq(core.handsCount(), 3);

        // Every attack, with every Hand (and the number never raised) and every twist.
        for (uint256 seed; seed < 4; ++seed) {
            for (uint256 arg; arg < 14; ++arg) {
                adversary.strangerThanks(seed, arg, arg, 5_000);
                adversary.raiserThanksWrongly(seed, arg, arg, 5_000);
                adversary.raiserThanksTooLate(seed, arg, 5_000);
                adversary.strangerMeddles(seed, arg, arg % 2 == 0, arg);
                adversary.raiserOversteps(seed, arg, arg);
                adversary.refundsEarly(seed, arg);
                adversary.grabsPending(seed, arg, arg, arg);
                adversary.callsTransferOut(seed, arg, arg);
                adversary.raisesBadly(seed, arg, arg);
            }
        }
        invariant_noHostileCallGoesThrough();

        // A wallet with code that refuses every signature: the giver's own key no longer counts.
        adversary.shape(0, 2, 0, 1, false);
        uint256 triedBefore = adversary.tried();
        adversary.raiserThanksARefusingWallet(2, 0, 0); // the live Hand, the first actor as its giver
        assertEq(adversary.tried(), triedBefore + 1);
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        handler.thank(1, 0, 0, 0); // the live Hand is the second open one; its raiser is the third actor, the giver the first
        // With a delegation the key counts whatever the code says; a wallet that answers for its key is asked.
        adversary.shape(0, 1, 0, 1, false);
        uint256 snapshot = vm.snapshotState();
        handler.thank(1, 0, 0, 0);
        vm.revertToState(snapshot);
        adversary.shape(0, 2, 0, 0, false);
        handler.thank(1, 0, 0, 0);
        assertEq(core.thanksCount(), 1);

        // A rightful thank goes through for each of the three things a giver can be.
        handler.raise(1, 0, 1_000e6, 1 days); // the fourth Hand, live; its raiser is the second actor
        uint256 triedRight = adversary.tried();
        for (uint256 kind; kind < 3; ++kind) {
            adversary.shape(0, kind, 0, 0, false);
            adversary.rightfulThankGoesThrough(3, 0, 0);
        }
        assertEq(adversary.tried(), triedRight + 3);
        invariant_noHostileCallGoesThrough();

        // A payee of the first token that calls back into Core, as a wallet with code and as a key
        // with a delegation: each time all seven ways in are tried, and all are refused.
        for (uint256 round; round < 3; ++round) {
            adversary.shape(0, round % 2 == 0 ? 2 : 1, 3 + round, 0, true); // each of the three modes that call back
            handler.raise(1, 0, 1_000e6, 1 days);
            uint256 before = adversary.reentries();
            handler.thank(1, 0, 0, 0); // the Hand just raised: the second open one, after the late one
            assertEq(adversary.reentries(), before + 1, "the payee was not called, or its payout went pending");
            assertEq(adversary.refusedInside(), 7 * adversary.reentries());
        }
        // A payee that refuses and one that burns its gas leave their payouts pending.
        for (uint256 mode = 1; mode < 3; ++mode) {
            adversary.shape(0, 2, mode, 0, true);
            handler.raise(1, 0, 1_000e6, 1 days);
            uint256 waits = core.pending(address(hookToken), handler.actors(0));
            handler.thank(1, 0, 0, 0);
            assertEq(core.pending(address(hookToken), handler.actors(0)), waits + 1_000e6);
        }
        invariant_noHostileCallGoesThrough();

        // Every refusal Core has for a caller was met at least once.
        bytes4[19] memory errors = [
            AHandCore.NotOpen.selector,
            AHandCore.NotRaiser.selector,
            AHandCore.Expired.selector,
            AHandCore.GiverIsRaiser.selector,
            AHandCore.ZeroPayee.selector,
            AHandCore.InvalidClaim.selector,
            AHandCore.AnonymousMargin.selector,
            AHandCore.InvalidKeySig.selector,
            AHandCore.InvalidRouteHash.selector,
            AHandCore.InvalidGiverSig.selector,
            AHandCore.NotExpired.selector,
            AHandCore.NotPayee.selector,
            AHandCore.ZeroDestination.selector,
            AHandCore.NothingPending.selector,
            AHandCore.NotCore.selector,
            AHandCore.ExpiryTooEarly.selector,
            AHandCore.ExpiryTooLate.selector,
            AHandCore.ZeroRootKey.selector,
            AHandCore.MinClaimTooHigh.selector
        ];
        for (uint256 index; index < errors.length; ++index) {
            assertGt(adversary.refusedWith(errors[index]), 0, vm.toString(index));
        }

        // And the run ends as an honest one does: everything closed and delivered, nothing left in Core.
        afterInvariant();
        invariant_balanceEqualsOpenRewardsPlusPending();
        invariant_moneyIsConserved();
        invariant_timesAreConsistent();
        invariant_closedHandsStayClosed();
    }
}
