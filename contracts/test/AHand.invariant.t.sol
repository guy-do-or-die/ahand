// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
    Invariant / fuzz suite for the revamped aHand stack.

    Architecture (carried over from the previous suite): one stateful
    handler owns every actor key and constructs ONLY valid calls, so
    fail_on_revert stays true and any revert is a finding, not noise.
    Ghost variables mirror what the contracts are supposed to do; the
    invariants compare the mirrors against actual state after every call.

    Logical invariants covered:
      I-1 strict conservation:
          usd.balanceOf(core) == sum(creditedReward over Active hands)
                                + sum(outstanding claims) + junkGhost
          (plus the flow identity deposited + junk == balance + withdrawn)
      I-2 terminal hands carry zero liability and creditedReward never
          mutates after raise (ghost snapshot comparison)
      I-3 claims move only through the mirrored credit sites and withdraw;
          withdraw zeroes the claim and transfers exactly that amount, and a
          withdraw to a blacklisted beneficiary reverts leaving claim and
          balance untouched. The reward token is a BlacklistToken whose block
          list the fuzzer toggles over every payee, so pushes really defer;
          every PayoutAllocated is answered, in order, by exactly one
          PayoutPushed or PayoutDeferred for the same beneficiary and amount
      I-4 Signals accounting: per-actor prevSqrt == floor(sqrt(cumulativeUsd)),
          watermark == earned-still-held + up-spent, balance == earned + received,
          totalSupply[UP] == sum of watermarks (up() conserves supply),
          receipt supplies match materialization counters
      I-5 processedSource is monotone — a flipped key never unsets
      I-6 status transitions only None->Active->{Settled|Reclaimed}
          (append-only ghost transition log + per-hand mirror)
//////////////////////////////////////////////////////////////*/

import "forge-std/Test.sol";
import "../src/AHandTypes.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSignals} from "../src/AHandSignals.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {AHandTestBase} from "./AHandTestBase.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/*//////////////////////////////////////////////////////////////
                            HANDLER
//////////////////////////////////////////////////////////////*/

/// @notice Stateful fuzz handler. Extends AHandTestBase so route building,
///         EIP-712 signing and raise plumbing are the exact helpers the
///         rest of the test tree uses — the handler adds bounding, actor
///         selection and ghost bookkeeping on top.
contract AHandInvariantHandler is AHandTestBase {
    /*//////////////////// Extra actors ////////////////////*/
    /// Sixth-hop child capability; base defines E0..E5 only.
    uint256 constant E6 = 0xE6aa;
    /// makeAddr("raiser") derives from keccak256("raiser") — recover the key
    /// so the raiser can also act as giver (exercises the merged-role
    /// materialization path in Signals).
    uint256 internal raiserPk;

    /// Signal-actor universe: every account that can ever earn or receive UP.
    /// Givers are drawn from this set and up() targets are confined to it,
    /// which keeps the supply invariants closed-form.
    address[] public signalActors; // [giver, shakerA, shakerB, raiser]
    uint256[] internal signalActorPks;

    /// Reward token of the fuzzed core; `usd` points at the same contract.
    BlacklistToken internal bl;
    /// Every address a settlement or reclaim can pay: charity, raiser, the
    /// giver pool, explicit shakers and the self-attributed hop keys E0..E5.
    /// The core itself is never blocked, so raises always land.
    address[] public payees;

    /*//////////////////// Hand tracking ////////////////////*/
    uint256[] public activeHands;  // swap-remove on settle/reclaim
    uint256[] public settledHands; // materializeThank candidates

    /*//////////////////// Ghosts — escrow ////////////////////*/
    mapping(uint256 => uint96) public ghostCredited; // creditedReward snapshot at raise
    mapping(uint256 => Status) public ghostStatus;   // mirrored lifecycle

    struct Transition {
        uint256 handId;
        Status from;
        Status to;
    }

    /// Append-only transition log; legality asserted at append AND re-scanned
    /// by the invariant so an illegal edge can never hide.
    Transition[] public transitions;

    mapping(address => uint256) public ghostClaims; // mirror of claims[usd][b]
    address[] public beneficiaries;                 // every account ever credited
    mapping(address => bool) internal isBeneficiary;
    uint256 public ghostOutstanding;     // sum over ghostClaims (DEFERRED only)
    uint256 public ghostDeposited;       // total pulled in via raise
    uint256 public ghostWithdrawnTotal;  // total paid out via withdraw
    uint256 public ghostDistributedOut;  // total PUSHED out of the contract at settlement/reclaim
    uint256 public ghostJunk;            // force-sent tokens (donateJunk)

    /*//////////////////// Ghosts — settlement facts (Signals replay) ////////////////////*/
    mapping(uint256 => address) public settledGiverOf;
    mapping(uint256 => address[]) internal occShakersOf; // route order, zeros preserved
    mapping(uint256 => uint16[]) internal occDeltasOf;   // route order margins

    /*//////////////////// Ghosts — signals ////////////////////*/
    uint256 public ghostRaisedCount;   // successful materializeRaised calls
    uint256 public ghostThankCount;    // successful materializeThank calls
    uint256 public ghostShakenMinted;  // deduped non-zero shakers across materializations
    mapping(address => uint256) public ghostUpSpent;    // earned UP burned via up()
    mapping(address => uint256) public ghostUpReceived; // UP landed via up()
    bytes32[] public ghostProcessedKeys;                // every source key we flipped

    /*//////////////////// Coverage counters ////////////////////*/
    uint256 public pushedCount;
    uint256 public deferredCount;
    uint256 public withdrawOkCount;
    uint256 public withdrawBlockedCount;

    function setUp() public override {
        super.setUp();
        bl = new BlacklistToken();
        useRewardToken(bl);
        (, raiserPk) = makeAddrAndKey("raiser"); // same derivation as the base field

        signalActors.push(giver);
        signalActorPks.push(GIVER_PK);
        signalActors.push(shakerA);
        signalActorPks.push(SHAKER_A_PK);
        signalActors.push(shakerB);
        signalActorPks.push(SHAKER_B_PK);
        signalActors.push(raiser);
        signalActorPks.push(raiserPk);

        payees.push(charity);
        payees.push(raiser);
        payees.push(giver);
        payees.push(shakerA);
        payees.push(shakerB);
        uint256[6] memory hopKeys = [E0, E1, E2, E3, E4, E5];
        for (uint256 i; i < hopKeys.length; ++i) {
            payees.push(vm.addr(hopKeys[i]));
        }
    }

    /*//////////////////// Views for the invariant contract ////////////////////*/
    function coreContract() external view returns (AHandCore) {
        return core;
    }

    function signalsContract() external view returns (AHandSignals) {
        return signals;
    }

    function usdContract() external view returns (MockUSD) {
        return usd;
    }

    function raiserAddress() external view returns (address) {
        return raiser;
    }

    function beneficiaryCount() external view returns (uint256) {
        return beneficiaries.length;
    }

    function transitionCount() external view returns (uint256) {
        return transitions.length;
    }

    function signalActorCount() external view returns (uint256) {
        return signalActors.length;
    }

    function processedKeyCount() external view returns (uint256) {
        return ghostProcessedKeys.length;
    }

    function payeeCount() external view returns (uint256) {
        return payees.length;
    }

    /*//////////////////// Internal bookkeeping ////////////////////*/
    function _transition(uint256 handId, Status from, Status to) internal {
        require(ghostStatus[handId] == from, "ghost: unexpected from-status");
        bool legal = (from == Status.None && to == Status.Active)
            || (from == Status.Active && (to == Status.Settled || to == Status.Reclaimed));
        require(legal, "ghost: illegal transition");
        ghostStatus[handId] = to;
        transitions.push(Transition({handId: handId, from: from, to: to}));
    }

    function _track(address beneficiary) internal {
        if (!isBeneficiary[beneficiary]) {
            isBeneficiary[beneficiary] = true;
            beneficiaries.push(beneficiary);
        }
    }

    /// @dev A DEFERRED allocation: the push failed and the amount parked as a
    ///      withdrawable claim.
    function _credit(address beneficiary, uint256 amount) internal {
        ghostClaims[beneficiary] += amount;
        ghostOutstanding += amount;
        _track(beneficiary);
    }

    /// @dev A PUSHED allocation: value left the contract straight to the
    ///      recipient. It never enters the claims ledger; the flow identity
    ///      accounts for it via ghostDistributedOut.
    function _distribute(address beneficiary, uint256 amount) internal {
        ghostDistributedOut += amount;
        _track(beneficiary); // so the invariant still asserts claims==0 for it
    }

    /// @dev Mirror one core _pay with an oracle independent of the core: the
    ///      push fails exactly when the token blacklists the recipient.
    function _mirrorPay(address to, uint256 amount) internal {
        if (bl.blocked(to)) _credit(to, amount);
        else _distribute(to, amount);
    }

    /// @dev Pair the core's payout events of the call recorded since
    ///      vm.recordLogs(): each non-zero PayoutAllocated is answered, in
    ///      order, by exactly one PayoutPushed or PayoutDeferred for the same
    ///      Hand, beneficiary and amount, on the branch the blacklist predicts.
    function _checkPayoutEvents(uint256 handId) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        address[] memory allocTo = new address[](logs.length);
        uint256[] memory allocAmount = new uint256[](logs.length);
        uint256 allocs;
        uint256 outcomes;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(core)) continue;
            bytes32 sig = logs[i].topics[0];
            if (sig == AHandCore.PayoutAllocated.selector) {
                (,, uint96 amount) = abi.decode(logs[i].data, (uint8, uint8, uint96));
                assertGt(amount, 0, "handler: zero PayoutAllocated");
                allocTo[allocs] = address(uint160(uint256(logs[i].topics[3])));
                allocAmount[allocs++] = amount;
            } else if (sig == AHandCore.PayoutPushed.selector || sig == AHandCore.PayoutDeferred.selector) {
                assertLt(outcomes, allocs, "handler: payout outcome without an allocation");
                address to = address(uint160(uint256(logs[i].topics[3])));
                assertEq(uint256(logs[i].topics[1]), handId, "handler: payout outcome for another hand");
                assertEq(to, allocTo[outcomes], "handler: payout outcome beneficiary != allocation");
                assertEq(abi.decode(logs[i].data, (uint96)), allocAmount[outcomes], "handler: payout outcome amount != allocation");
                bool deferred = sig == AHandCore.PayoutDeferred.selector;
                assertEq(deferred, bl.blocked(to), "handler: push/defer branch disagrees with the blacklist");
                if (deferred) ++deferredCount;
                else ++pushedCount;
                ++outcomes;
            }
        }
        assertEq(outcomes, allocs, "handler: allocation without exactly one push/defer");
    }

    function _removeActive(uint256 index) internal {
        activeHands[index] = activeHands[activeHands.length - 1];
        activeHands.pop();
    }

    /*//////////////////////////////////////////////////////////
                            ACTIONS
    //////////////////////////////////////////////////////////*/

    /// @notice Raise a Hand with bounded, always-valid parameters.
    function raise(uint96 amountSeed, uint40 expirySeed, uint16 charitySeed, uint16 floorSeed) external {
        // amount >= 100 with charityBps >= 100 guarantees charityAllocation >= 1;
        // charityBps <= 3000 guarantees distributable > 0.
        uint96 amount = uint96(bound(amountSeed, 100, 10_000e6));
        uint40 expiry = uint40(block.timestamp + bound(expirySeed, 1 days, 180 days));
        uint16 charityBps = uint16(bound(charitySeed, 1_00, 30_00));
        uint16 floorBps = uint16(bound(floorSeed, 1, 10_000));

        RaiseParams memory p = defaultParams();
        p.amount = amount;
        p.expiry = expiry;
        p.charityBps = charityBps;
        p.minGiverClaimBps = floorBps;

        usd.mint(raiser, amount);
        uint256 handId = makeRaise(p);

        activeHands.push(handId);
        ghostCredited[handId] = amount;
        ghostDeposited += amount;
        _transition(handId, Status.None, Status.Active);
    }

    /// @notice Settle a random active Hand through a random 0..6-hop route mixing
    ///         anonymous / self-attributed / explicit (duplicable) shakers, then
    ///         mirror the exact floor math into the claim ghosts and stash the
    ///         occurrence arrays for a later materializeThank replay.
    function thank(uint256 handSeed, uint256 hopSeed, uint256 modeSeed, uint256 marginSeed, uint256 giverSeed)
        external
    {
        if (activeHands.length == 0) return;
        uint256 index = handSeed % activeHands.length;
        uint256 handId = activeHands[index];
        Hand memory h = core.getHand(handId);
        if (block.timestamp >= h.expiry) return; // thank window is strictly before expiry

        uint96 charityAlloc = uint96((uint256(h.creditedReward) * h.charityBps) / 10_000);
        uint96 distributable = h.creditedReward - charityAlloc;

        uint256[6] memory childKeys = [E1, E2, E3, E4, E5, E6];
        uint256 hops = hopSeed % 7; // 0..6, zero-shake routes included

        RouteBuild memory r = newRoute();
        uint96[] memory hopAllocs = new uint96[](hops);
        uint16[] memory margins = new uint16[](hops);

        for (uint256 i; i < hops; ++i) {
            uint256 mode = uint256(keccak256(abi.encode(modeSeed, i))) % 4;
            uint16 maxMargin = r.claim - h.minGiverClaimBps; // telescopic floor headroom
            uint16 margin = uint16(uint256(keccak256(abi.encode(marginSeed, i))) % (uint256(maxMargin) + 1));

            address shakerAddr;
            uint256 shakerPk;
            if (mode == 0) {
                margin = 0; // anonymous hops are zero-margin by protocol law
            } else if (mode == 1) {
                shakerAddr = vm.addr(r.parentPk); // self-attributed: no acceptance
            } else if (mode == 2) {
                shakerAddr = shakerA; // explicit shaker — duplicates across hops welcome
                shakerPk = SHAKER_A_PK;
            } else {
                shakerAddr = shakerB;
                shakerPk = SHAKER_B_PK;
            }

            if (margin != 0 && (uint256(distributable) * margin) / 10_000 == 0) {
                margin = 0; // dodge MarginRoundsToZero — a valid-call handler never reverts
            }

            addHop(r, handId, childKeys[i], shakerAddr, shakerPk, r.claim - margin, h.expiry);
            margins[i] = margin;
            if (margin != 0) hopAllocs[i] = uint96((uint256(distributable) * margin) / 10_000);
        }

        // Random giver from the actor universe; raiser==giver hits the merged-role path.
        uint256 giverIndex = giverSeed % signalActors.length;
        address giverAddr = signalActors[giverIndex];
        (Give memory g, bytes memory giveSig) = buildGive(handId, r, giverAddr, h.expiry);
        vm.recordLogs();
        doThank(handId, r, g, giveSig, signStruct(signalActorPks[giverIndex], AHandSig.hashGiverAcceptance(AHandSig.hashGive(g))));

        // Mirror phase-B math: giver residual absorbs the dust, identity is exact.
        uint96 marginTotal;
        for (uint256 i; i < hops; ++i) {
            marginTotal += hopAllocs[i];
        }
        uint96 giverAlloc = distributable - marginTotal;

        _checkPayoutEvents(handId);
        _mirrorPay(h.charityRecipient, charityAlloc);
        for (uint256 i; i < hops; ++i) {
            if (hopAllocs[i] != 0) _mirrorPay(r.shakes[i].shaker, hopAllocs[i]);
        }
        _mirrorPay(giverAddr, giverAlloc);

        _removeActive(index);
        settledHands.push(handId);
        settledGiverOf[handId] = giverAddr;
        for (uint256 i; i < hops; ++i) {
            occShakersOf[handId].push(r.shakes[i].shaker);
            occDeltasOf[handId].push(margins[i]);
        }
        _transition(handId, Status.Active, Status.Settled);
    }

    /// @notice Reclaim a random active Hand — sometimes warping into the
    ///         reclaim window first, sometimes skipping when it is not open yet.
    function reclaim(uint256 handSeed, uint256 warpSeed) external {
        if (activeHands.length == 0) return;
        uint256 index = handSeed % activeHands.length;
        uint256 handId = activeHands[index];
        Hand memory h = core.getHand(handId);

        if (block.timestamp < h.expiry) {
            if (warpSeed % 2 == 0) return; // leave it in the thank window this time
            vm.warp(uint256(h.expiry) + (warpSeed % 3 days));
        }

        vm.recordLogs();
        core.reclaim(handId); // permissionless — the handler itself finalizes

        _checkPayoutEvents(handId);
        _mirrorPay(h.raiser, h.creditedReward); // full refund, zero charity cut
        _removeActive(index);
        _transition(handId, Status.Active, Status.Reclaimed);
    }

    /// @notice Withdraw the full claim of a random known beneficiary, asserting
    ///         the exact-transfer / exact-zeroing contract of the pull ledger —
    ///         or, for a still-blacklisted beneficiary, a revert that leaves the
    ///         claim and the core balance untouched.
    function withdraw(uint256 seed) external {
        uint256 count = beneficiaries.length;
        if (count == 0) return;

        // Prefer a claimant the token will pay; fall back to a blacklisted one.
        address beneficiary;
        uint256 start = seed % count;
        for (uint256 i; i < count; ++i) {
            address candidate = beneficiaries[(start + i) % count];
            if (core.claims(address(usd), candidate) == 0) continue;
            if (beneficiary == address(0) || bl.blocked(beneficiary)) beneficiary = candidate;
            if (!bl.blocked(candidate)) break;
        }
        if (beneficiary == address(0)) return; // nothing outstanding anywhere
        uint256 amount = core.claims(address(usd), beneficiary);

        assertEq(amount, ghostClaims[beneficiary], "handler: claims mirror diverged before withdraw");
        uint256 balBeneficiary = usd.balanceOf(beneficiary);
        uint256 balCore = usd.balanceOf(address(core));

        if (bl.blocked(beneficiary)) {
            vm.expectRevert(bytes("BLACKLISTED"));
            core.withdraw(address(usd), beneficiary);
            assertEq(core.claims(address(usd), beneficiary), amount, "handler: failed withdraw touched the claim");
            assertEq(usd.balanceOf(address(core)), balCore, "handler: failed withdraw moved core funds");
            ++withdrawBlockedCount;
            return;
        }

        core.withdraw(address(usd), beneficiary); // permissionless, fixed destination

        assertEq(usd.balanceOf(beneficiary) - balBeneficiary, amount, "handler: beneficiary delta != claim");
        assertEq(balCore - usd.balanceOf(address(core)), amount, "handler: core delta != claim");
        assertEq(core.claims(address(usd), beneficiary), 0, "handler: claim not zeroed");

        ghostClaims[beneficiary] = 0;
        ghostOutstanding -= amount;
        ghostWithdrawnTotal += amount;
        ++withdrawOkCount;
    }

    /// @notice Materialize the RAISED receipt for any existing Hand — valid for
    ///         every status incl. terminal ones; skip only the processed keys.
    function materializeRaised(uint256 seed) external {
        uint256 total = core.handsCount();
        if (total == 0) return;
        uint256 handId = (seed % total) + 1;
        bytes32 key = signals.raisedSourceKey(handId);
        if (signals.processedSource(key)) return; // idempotence guard, not a revert

        signals.materializeRaised(handId);

        ghostRaisedCount += 1;
        ghostProcessedKeys.push(key);
    }

    /// @notice Replay the stored settlement facts of a random settled Hand into
    ///         Signals. Timing is whatever the fuzzer picks — before or after
    ///         other hands reclaim, before or after materializeRaised.
    function materializeThank(uint256 seed) external {
        if (settledHands.length == 0) return;
        uint256 handId = settledHands[seed % settledHands.length];
        bytes32 key = signals.thankSourceKey(handId);
        if (signals.processedSource(key)) return;

        address[] memory occShakers = occShakersOf[handId];
        uint16[] memory occDeltas = occDeltasOf[handId];
        signals.materializeThank(handId, settledGiverOf[handId], occShakers, occDeltas);

        ghostThankCount += 1;
        ghostProcessedKeys.push(key);

        // Mirror the contract's O(n^2) first-occurrence dedupe of non-zero shakers.
        for (uint256 i; i < occShakers.length; ++i) {
            address shaker = occShakers[i];
            if (shaker == address(0)) continue;
            bool seen;
            for (uint256 j; j < i; ++j) {
                if (occShakers[j] == shaker) {
                    seen = true;
                    break;
                }
            }
            if (!seen) ghostShakenMinted += 1;
        }
    }

    /// @notice Spend earned UP from a random funded actor onto a random distinct
    ///         actor, bounded by the whole-units actually available.
    function up(uint256 actorSeed, uint256 targetSeed, uint256 countSeed) external {
        uint256 n = signalActors.length;
        uint256 actorStart = actorSeed % n;
        address actor;
        uint256 whole;
        for (uint256 i; i < n; ++i) {
            address candidate = signalActors[(actorStart + i) % n];
            uint256 earned = signals.earnedUp(candidate);
            if (earned >= signals.ONE_UP()) {
                actor = candidate;
                whole = earned / signals.ONE_UP();
                break;
            }
        }
        if (actor == address(0)) return; // nobody has a whole UP to spend yet

        uint256 targetIndex = targetSeed % n;
        address target = signalActors[targetIndex];
        if (target == actor) target = signalActors[(targetIndex + 1) % n];
        uint256 wholeUpCount = bound(countSeed, 1, whole);

        vm.prank(actor);
        signals.up(target, wholeUpCount, UpContext({handId: 0, reasonTag: bytes32("invariant"), evidenceHash: bytes32(0)}));

        uint256 amount = wholeUpCount * signals.ONE_UP();
        ghostUpSpent[actor] += amount;
        ghostUpReceived[target] += amount;
    }

    /// @notice Block or unblock a payee on the token's blacklist: pushes to a
    ///         blocked payee defer to a claim, and withdrawing it reverts.
    function toggleBlock(uint256 payeeSeed, bool isBlocked) external {
        bl.setBlocked(payees[payeeSeed % payees.length], isBlocked);
    }

    /// @notice Force-send tokens to the core outside any Hand. The strict
    ///         conservation invariant must account for every junk wei.
    function donateJunk(uint96 amountSeed) external {
        uint96 amount = uint96(bound(amountSeed, 1, 1_000e6));
        usd.mint(address(core), amount);
        ghostJunk += amount;
    }

    /// @notice Advance time. Expires thank windows and opens reclaim windows;
    ///         the guarded actions adapt, the invariants must not care.
    function warp(uint256 deltaSeed) external {
        vm.warp(block.timestamp + bound(deltaSeed, 1 hours, 30 days));
    }
}

/*//////////////////////////////////////////////////////////////
                        INVARIANT SUITE
//////////////////////////////////////////////////////////////*/

contract AHandInvariantTest is Test {
    AHandInvariantHandler internal handler;
    AHandCore internal core;
    AHandSignals internal signals;
    MockUSD internal usd;

    function setUp() public {
        handler = new AHandInvariantHandler();
        handler.setUp();
        core = handler.coreContract();
        signals = handler.signalsContract();
        usd = handler.usdContract();

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = AHandInvariantHandler.raise.selector;
        selectors[1] = AHandInvariantHandler.thank.selector;
        selectors[2] = AHandInvariantHandler.reclaim.selector;
        selectors[3] = AHandInvariantHandler.withdraw.selector;
        selectors[4] = AHandInvariantHandler.materializeRaised.selector;
        selectors[5] = AHandInvariantHandler.materializeThank.selector;
        selectors[6] = AHandInvariantHandler.up.selector;
        selectors[7] = AHandInvariantHandler.donateJunk.selector;
        selectors[8] = AHandInvariantHandler.warp.selector;
        selectors[9] = AHandInvariantHandler.toggleBlock.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev Per-run coverage of both payout branches and both withdraw outcomes.
    function afterInvariant() public view {
        console.log("payouts pushed / deferred:", handler.pushedCount(), handler.deferredCount());
        console.log("withdraws paid / blocked:", handler.withdrawOkCount(), handler.withdrawBlockedCount());
    }

    /// Deterministic walk through the deferred path, so the campaign cannot
    /// silently stop reaching it: blacklist every payee, settle one Hand and
    /// reclaim another (every allocation defers), watch a blocked withdraw
    /// revert in place, then unblock and drain every claim.
    function test_Handler_DrivesDeferralAndWithdraw() public {
        handler.raise(100e6, 30 days, 1_000, 5_000);
        handler.raise(100e6, 30 days, 1_000, 5_000);
        uint256 payees = handler.payeeCount();
        for (uint256 i; i < payees; ++i) {
            handler.toggleBlock(i, true);
        }

        handler.thank(0, 3, 1, 1, 0);
        handler.reclaim(0, 1); // odd seed: warp past expiry, then reclaim
        assertEq(handler.pushedCount(), 0, "every push hit the blacklist");
        assertGe(handler.deferredCount(), 3, "charity, giver and refund deferred at least");
        assertEq(handler.ghostOutstanding(), 200e6, "both deposits parked as claims");
        assertEq(usd.balanceOf(address(core)), 200e6, "claims are fully backed");
        invariant_strictConservation();

        handler.withdraw(0);
        assertEq(handler.withdrawBlockedCount(), 1, "blocked withdraw reverted in place");
        assertEq(handler.ghostOutstanding(), 200e6, "failed withdraw kept the claim");

        for (uint256 i; i < payees; ++i) {
            handler.toggleBlock(i, false);
        }
        for (uint256 i; handler.ghostOutstanding() != 0; ++i) {
            handler.withdraw(i);
        }
        assertGe(handler.withdrawOkCount(), 3, "each deferred beneficiary drained");
        assertEq(handler.ghostWithdrawnTotal(), 200e6, "withdrawals paid every claim");
        assertEq(usd.balanceOf(address(core)), 0, "nothing left behind");
        invariant_strictConservation();
    }

    /// @custom:invariant I-1 strict conservation + I-3 claim-ledger integrity.
    ///     The core's balance is EXACTLY active escrow + outstanding claims +
    ///     ghost-tracked junk; every beneficiary's on-chain claim equals its
    ///     ghost mirror (claims move only through mirrored sites); and the
    ///     lifetime flow identity deposited + junk == balance + withdrawn holds.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 400
    function invariant_strictConservation() public view {
        uint256 activeSum;
        uint256 total = core.handsCount();
        for (uint256 i = 1; i <= total; ++i) {
            Hand memory h = core.getHand(i);
            if (h.status == Status.Active) activeSum += h.creditedReward;
        }

        uint256 claimSum;
        uint256 count = handler.beneficiaryCount();
        for (uint256 i; i < count; ++i) {
            address beneficiary = handler.beneficiaries(i);
            uint256 claim = core.claims(address(usd), beneficiary);
            assertEq(claim, handler.ghostClaims(beneficiary), "claims ledger diverged from ghost mirror");
            claimSum += claim;
        }
        assertEq(claimSum, handler.ghostOutstanding(), "outstanding-claims scalar diverged");

        assertEq(
            usd.balanceOf(address(core)),
            activeSum + claimSum + handler.ghostJunk(),
            "strict conservation broken: balance != active escrow + claims + junk"
        );
        // Flow identity under hybrid push: value leaves the contract two ways —
        // pushed directly to recipients at settlement/reclaim (distributedOut)
        // and drained from deferred claims via withdraw (withdrawn).
        assertEq(
            handler.ghostDeposited() + handler.ghostJunk(),
            usd.balanceOf(address(core)) + handler.ghostDistributedOut() + handler.ghostWithdrawnTotal(),
            "flow identity broken: deposits + junk != balance + distributed + withdrawals"
        );
    }

    /// @custom:invariant I-2 creditedReward immutability + I-6 legal lifecycle.
    ///     Every Hand's creditedReward equals its raise-time ghost snapshot
    ///     (terminal hands included — the field is never zeroed), every status
    ///     matches the ghost mirror, the transition log contains only legal
    ///     edges, and thankSignalSourceHash is set iff the Hand settled.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 400
    function invariant_handLifecycle() public view {
        uint256 total = core.handsCount();
        for (uint256 i = 1; i <= total; ++i) {
            Hand memory h = core.getHand(i);
            assertEq(h.creditedReward, handler.ghostCredited(i), "creditedReward mutated after raise");
            assertTrue(h.status == handler.ghostStatus(i), "status diverged from ghost transition mirror");
            if (h.status == Status.Settled) {
                assertTrue(h.thankSignalSourceHash != bytes32(0), "settled hand missing source commitment");
            } else {
                assertEq(h.thankSignalSourceHash, bytes32(0), "non-settled hand carries source commitment");
            }
        }
        assertTrue(core.getHand(0).status == Status.None, "hand 0 must not exist");
        assertTrue(core.getHand(total + 1).status == Status.None, "hand beyond handsCount must not exist");

        uint256 edges = handler.transitionCount();
        for (uint256 i; i < edges; ++i) {
            (, Status from, Status to) = handler.transitions(i);
            bool legal = (from == Status.None && to == Status.Active)
                || (from == Status.Active && (to == Status.Settled || to == Status.Reclaimed));
            assertTrue(legal, "illegal status transition recorded");
        }
    }

    /// @custom:invariant I-4 Signals supply accounting. Per actor:
    ///     prevSqrt == floor(sqrt(cumulativeUsd)) (the emission curve),
    ///     prevSqrt == earnedUp + up-spent (total UP ever minted to them),
    ///     balanceOf(UP) == earnedUp + up-received (received only via up()).
    ///     Globally: totalSupply[UP] == sum of watermarks — up() conserves —
    ///     and every receipt supply equals its materialization counter.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 400
    function invariant_signalsAccounting() public view {
        uint256 idUp = signals.SIGNAL_UP();
        uint256 watermarkSum;
        uint256 balanceSum;
        uint256 givenSum;
        uint256 actors = handler.signalActorCount();
        for (uint256 i; i < actors; ++i) {
            address actor = handler.signalActors(i);
            uint256 watermark = signals.prevSqrt(actor);
            assertEq(watermark, Math.sqrt(signals.cumulativeUsd(actor)), "prevSqrt != floor(sqrt(cumulativeUsd))");
            uint256 earned = signals.earnedUp(actor);
            assertEq(watermark, earned + handler.ghostUpSpent(actor), "minted UP != earned held + spent");
            uint256 balance = signals.balanceOf(actor, idUp);
            assertEq(balance, earned + handler.ghostUpReceived(actor), "UP balance != earned + received");
            assertEq(signals.receivedOf(actor), handler.ghostUpReceived(actor), "receivedOf diverged from up() ghost");
            watermarkSum += watermark;
            balanceSum += balance;
            givenSum += signals.balanceOf(actor, signals.SIGNAL_GIVEN());
        }
        assertEq(signals.totalSupply(idUp), watermarkSum, "UP supply != sum of sqrt watermarks");
        assertEq(signals.totalSupply(idUp), balanceSum, "UP supply escaped the actor universe");

        assertEq(signals.totalSupply(signals.SIGNAL_RAISED()), handler.ghostRaisedCount(), "RAISED supply diverged");
        assertEq(signals.totalSupply(signals.SIGNAL_THANKED()), handler.ghostThankCount(), "THANKED supply diverged");
        assertEq(signals.totalSupply(signals.SIGNAL_GIVEN()), handler.ghostThankCount(), "GIVEN supply diverged");
        assertEq(givenSum, handler.ghostThankCount(), "GIVEN receipts escaped the giver universe");
        assertEq(signals.totalSupply(signals.SIGNAL_SHAKEN()), handler.ghostShakenMinted(), "SHAKEN supply diverged");
        assertEq(signals.totalSupply(signals.SIGNAL_DOWN()), 0, "reserved DOWN id must stay unminted");
        assertEq(
            signals.balanceOf(handler.raiserAddress(), signals.SIGNAL_RAISED()),
            handler.ghostRaisedCount(),
            "RAISED receipts must all sit with the raiser"
        );
        assertEq(
            signals.balanceOf(handler.raiserAddress(), signals.SIGNAL_THANKED()),
            handler.ghostThankCount(),
            "THANKED receipts must all sit with the raiser"
        );
    }

    /// @custom:invariant I-5 processedSource monotonicity. Every source key the
    ///     handler ever flipped is still set, and the key ledger is complete:
    ///     one key per successful materialization, never unset, never double-run.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 400
    function invariant_processedSourceMonotone() public view {
        uint256 keys = handler.processedKeyCount();
        for (uint256 i; i < keys; ++i) {
            assertTrue(signals.processedSource(handler.ghostProcessedKeys(i)), "processed source key unset");
        }
        assertEq(
            keys,
            handler.ghostRaisedCount() + handler.ghostThankCount(),
            "processed-key ledger out of sync with materialization counters"
        );
    }
}
