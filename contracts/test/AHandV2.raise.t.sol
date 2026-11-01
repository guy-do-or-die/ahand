// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Vm} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {AHandTestBase} from "./AHandTestBase.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandMath} from "../src/AHandFacts.sol";
import {
    BoundsViolated,
    CharityNotAllowed,
    ExpiryInPast,
    Hand,
    IAHandFacts,
    InexactDeposit,
    InvalidVisibilityData,
    OnlySelf,
    RaiseParams,
    Status,
    TagsInvalid,
    UnexpectedCharityRecipient,
    Visibility,
    ZeroAddress,
    ZeroCharityAllocation,
    ZeroPotTerms
} from "../src/AHandTypes.sol";
import {BasicToken} from "./mocks/BasicToken.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {NoDecimalsToken, Token30Decimals} from "./mocks/DecimalsTokens.sol";
import {ReceiverFeeToken, SenderFeeToken} from "./mocks/FeeTokens.sol";
import {NoReturnToken} from "./mocks/NoReturnToken.sol";
import {ReturnsFalseToken} from "./mocks/ReturnsFalseToken.sol";
import {HookToken} from "./mocks/HookToken.sol";
import {FiatTokenLikeV1} from "./mocks/FiatTokenLike.sol";

/*//////////////////////////////////////////////////////////////
        Suite-local mocks: deposit-leg shapes no shared mock covers
//////////////////////////////////////////////////////////////*/

/// @notice A conforming token with zero decimals: one raw unit is one whole unit.
contract Token0Decimals is BasicToken {
    uint8 public constant decimals = 0;
}

/// @notice `transferFrom` returns `false` and moves nothing (the deposit leg of the
///         ReturnsFalse shape): SafeERC20 turns the word into `SafeERC20FailedOperation`.
contract FalseTransferFromToken is MockUSD {
    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @notice `transferFrom` MOVES the funds and then returns `false` (the S1 shape on the
///         deposit leg): the raise reverts whole, so nothing stays moved.
contract MoveThenFalseTransferFromToken is MockUSD {
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        return false;
    }
}

/// @notice The receiver is credited one unit MORE than the sender is debited: the payer
///         side is exact, the custody side is not — the second half of the entry rule.
contract BonusReceiverToken is MockUSD {
    function _move(address from, address to, uint256 amount) internal override {
        balanceOf[from] -= amount;
        balanceOf[to] += amount + 1;
        totalSupply += 1;
        emit Transfer(from, to, amount);
    }
}

/// @notice A third party that moves one unit out of a payer during a HookToken
///         deposit. It switches the token's re-entry probe off first so the nested
///         `transferFrom` does not recurse into the probe again.
contract PayerDrainer {
    function drain(HookToken token, address from, address to) external {
        token.setReentry(address(0), "", false, false, false);
        token.transferFrom(from, to, 1);
    }
}

/*//////////////////////////////////////////////////////////////
        SUITE: raise and custody — DESIGN §4.1, §5.1, I-5, I-6, I-21, I-22, I-25
//////////////////////////////////////////////////////////////*/

contract AHandV2RaiseTest is AHandTestBase {
    bytes32 constant RAISED_TOPIC = AHandCore.Raised.selector;
    bytes32 constant TAGGED_TOPIC = AHandCore.HandTagged.selector;

    /*//////////////////// helpers ////////////////////*/

    function darkParams() internal view returns (RaiseParams memory p) {
        p = defaultParams();
        p.visibility = Visibility.Dark;
        p.discoveryCommitment = bytes32(0);
    }

    /// @dev Expect the exact `Raised` record of a raise by `who` under `revision`.
    function expectRaised(uint256 handId, address who, RaiseParams memory p, bytes memory ref, uint64 revision)
        internal
    {
        vm.expectEmit(address(core));
        emit AHandCore.Raised(
            handId,
            who,
            p.token,
            p.amount,
            p.expiry,
            p.rootCapability,
            p.visibility,
            p.metadataCommitment,
            p.discoveryCommitment,
            ref,
            p.minGiverClaimBps,
            p.charityRecipient,
            p.charityBps,
            revision
        );
    }

    /// @dev Raise expecting an abi-encoded error (for errors that carry arguments).
    function expectRaiseRevertBytes(bytes memory err, RaiseParams memory p) internal {
        vm.prank(raiser);
        vm.expectRevert(err);
        core.raise(p, DEFAULT_REF, noTags());
    }

    /// @dev I-25: `facts` equals `getHand` field by field, and the Raise-time facts
    ///      equal the parameters the raise was made with.
    function assertFactsEqualStorage(uint256 handId, RaiseParams memory p, address who) internal view {
        IAHandFacts.HandFacts memory f = core.facts(handId);
        Hand memory h = core.getHand(handId);
        assertEq(uint8(f.status), uint8(h.status), "status");
        assertEq(f.raiser, h.raiser, "raiser");
        assertEq(f.token, h.token, "token");
        assertEq(f.pool, h.pool, "pool");
        assertEq(f.charityBps, h.charityBps, "charityBps");
        assertEq(f.charityRecipient, h.charityRecipient, "charityRecipient");
        assertEq(f.minGiverClaimBps, h.minGiverClaimBps, "minGiverClaimBps");
        assertEq(f.rootCapability, h.rootCapability, "rootCapability");
        assertEq(f.expiry, h.expiry, "expiry");
        assertEq(f.closedAt, h.closedAt, "closedAt");
        assertEq(uint8(f.visibility), uint8(h.visibility), "visibility");
        assertEq(f.metadataCommitment, h.metadataCommitment, "metadataCommitment");
        assertEq(f.discoveryCommitment, h.discoveryCommitment, "discoveryCommitment");
        assertEq(f.settlementHash, h.settlementHash, "settlementHash");

        assertEq(uint8(f.status), uint8(Status.Active), "Active after raise");
        assertEq(f.raiser, who, "raiser == msg.sender");
        assertEq(f.token, p.token, "token == p.token");
        assertEq(f.pool, p.amount, "pool == p.amount");
        assertEq(f.charityBps, p.charityBps, "charityBps == p");
        assertEq(f.charityRecipient, p.charityRecipient, "charityRecipient == p");
        assertEq(f.minGiverClaimBps, p.minGiverClaimBps, "floor == p");
        assertEq(f.rootCapability, p.rootCapability, "root == p");
        assertEq(f.expiry, p.expiry, "expiry == p");
        assertEq(f.closedAt, 0, "closedAt zero while Active");
        assertEq(uint8(f.visibility), uint8(p.visibility), "visibility == p");
        assertEq(f.metadataCommitment, p.metadataCommitment, "metadata == p");
        assertEq(f.discoveryCommitment, p.discoveryCommitment, "discovery == p");
        assertEq(f.settlementHash, bytes32(0), "settlementHash zero until thank");
    }

    /// @dev Σ pool over every Active Hand escrowed in `token_` (the Hand term of §5.4).
    function activePoolOf(address token_) internal view returns (uint256 total) {
        uint256 n = core.handsCount();
        for (uint256 id = 1; id <= n; ++id) {
            IAHandFacts.HandFacts memory f = core.facts(id);
            if (f.status == Status.Active && f.token == token_) total += f.pool;
        }
    }

    /// @dev Whether any recorded log is a `HandTagged`.
    function hasTaggedLog(Vm.Log[] memory logs) internal pure returns (bool) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == TAGGED_TOPIC) return true;
        }
        return false;
    }

    /// @dev The `policyRevision` field of the first `Raised` log.
    function raisedRevisionOf(Vm.Log[] memory logs) internal pure returns (uint64 revision) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != RAISED_TOPIC) continue;
            (,,,,,,,,,, revision) = abi.decode(
                logs[i].data,
                (uint256, uint40, address, uint8, bytes32, bytes32, bytes, uint16, address, uint16, uint64)
            );
            return revision;
        }
        revert("no Raised log");
    }

    /*//////////////////// happy path: storage, events, ids ////////////////////*/

    function test_Raise_StoresHandAndEscrowsExactDeposit() public {
        RaiseParams memory p = defaultParams();
        uint256 raiserBefore = usd.balanceOf(raiser);

        uint256 h = makeRaise(p);

        assertEq(h, 1, "first id is 1");
        assertEq(core.handsCount(), 1, "counter");
        assertEq(usd.balanceOf(address(core)), DEPOSIT, "custody receipt == amount");
        assertEq(raiserBefore - usd.balanceOf(raiser), DEPOSIT, "payer debit == amount");
        assertFactsEqualStorage(h, p, raiser);
    }

    function test_Raise_EmitsRaisedWithGenesisRevision() public {
        RaiseParams memory p = defaultParams();
        expectRaised(1, raiser, p, DEFAULT_REF, 1);
        makeRaise(p);
    }

    function test_Raise_IdsMonotonicFromOne() public {
        assertEq(makeRaise(), 1);
        assertEq(makeRaise(), 2);
        assertEq(makeRaise(noCharityParams()), 3);
        assertEq(makeRaise(zeroPotParams()), 4);
        assertEq(core.handsCount(), 4);
        assertEq(uint8(statusOf(5)), uint8(Status.None), "unraised id is None");
        assertEq(core.facts(5).raiser, address(0), "unraised id has no raiser");
    }

    function test_Raise_MsgSenderBecomesRaiser() public {
        fund(address(usd), stranger, DEPOSIT);
        uint256 h = makeRaiseAs(stranger, core, defaultParams(), DEFAULT_REF, noTags());
        assertEq(core.facts(h).raiser, stranger);
        assertEq(usd.balanceOf(stranger), 0, "the stranger paid");
    }

    /// A contract may be the raiser: Core sees only msg.sender (D23).
    function test_Raise_ContractRaiser() public {
        usd.mint(address(this), DEPOSIT);
        usd.approve(address(core), DEPOSIT);
        uint256 h = core.raise(defaultParams(), DEFAULT_REF, noTags());
        assertEq(core.facts(h).raiser, address(this));
        assertEq(usd.balanceOf(address(this)), 0);
    }

    function test_Raise_HandTaggedFollowsRaised() public {
        bytes32[] memory t = tags3(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)));
        RaiseParams memory p = defaultParams();
        expectRaised(1, raiser, p, DEFAULT_REF, 1);
        vm.expectEmit(address(core));
        emit AHandCore.HandTagged(1, raiser, t);
        makeRaise(p, DEFAULT_REF, t);
    }

    function test_Raise_NoTags_NoHandTagged() public {
        vm.recordLogs();
        makeRaise();
        assertFalse(hasTaggedLog(vm.getRecordedLogs()), "HandTagged must not emit for empty tags");
    }

    function test_Raise_Dark_NeverEmitsHandTagged() public {
        vm.recordLogs();
        makeRaise(darkParams(), "", noTags());
        assertFalse(hasTaggedLog(vm.getRecordedLogs()));
    }

    /*//////////////////// I-25: facts == storage for every shape ////////////////////*/

    function test_Facts_NoCharityHand() public {
        RaiseParams memory p = noCharityParams();
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
        assertEq(core.getHand(h).charityRecipient, address(0), "slot 3 left zero at 0 %");
    }

    function test_Facts_ZeroPotHand() public {
        RaiseParams memory p = zeroPotParams();
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
        assertEq(core.getHand(h).pool, 0);
        assertEq(core.getHand(h).token, address(0));
    }

    function test_Facts_DarkHand() public {
        RaiseParams memory p = darkParams();
        uint256 h = makeRaise(p, "", noTags());
        assertFactsEqualStorage(h, p, raiser);
        assertEq(core.getHand(h).discoveryCommitment, bytes32(0), "slot 6 left zero in Dark");
    }

    function test_Facts_PreviewHand() public {
        RaiseParams memory p = defaultParams();
        p.visibility = Visibility.Preview;
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
    }

    function test_Facts_UnraisedIdIsAllZero() public view {
        IAHandFacts.HandFacts memory f = core.facts(42);
        assertEq(uint8(f.status), uint8(Status.None));
        assertEq(f.raiser, address(0));
        assertEq(f.token, address(0));
        assertEq(f.pool, 0);
        assertEq(f.expiry, 0);
        assertEq(f.metadataCommitment, bytes32(0));
    }

    /*//////////////////// (1) root capability ////////////////////*/

    function test_Raise_ZeroRootCapability() public {
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(0);
        expectRaiseRevert(ZeroAddress.selector, p);
    }

    /// Order proof (1) before (2): a zero root wins over broken pot terms.
    function test_Order_ZeroRoot_BeatsZeroPotTerms() public {
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(0);
        p.amount = 0;
        expectRaiseRevert(ZeroAddress.selector, p);
    }

    /*//////////////////// (2) zero-pot terms: P == 0 ⇔ token == 0 ////////////////////*/

    function test_Raise_ZeroPotTerms_AmountWithoutToken() public {
        RaiseParams memory p = noCharityParams();
        p.token = address(0);
        expectRaiseRevert(ZeroPotTerms.selector, p);
    }

    function test_Raise_ZeroPotTerms_TokenWithoutAmount() public {
        RaiseParams memory p = noCharityParams();
        p.amount = 0;
        expectRaiseRevert(ZeroPotTerms.selector, p);
    }

    function test_Raise_ZeroPot_Accepted_NoTokenCall() public {
        RaiseParams memory p = zeroPotParams();
        // address(0) has no code: any balanceOf/transferFrom toward it would revert,
        // so a successful zero-pot raise proves no token call was made (S23)
        vm.expectCall(address(0), abi.encodeWithSelector(IERC20.balanceOf.selector, address(core)), 0);
        vm.expectCall(address(0), abi.encodeWithSelector(IERC20.balanceOf.selector, raiser), 0);
        expectRaised(1, raiser, p, DEFAULT_REF, 1);
        uint256 h = makeRaise(p);
        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(f.pool, 0);
        assertEq(f.token, address(0));
        assertEq(uint8(f.status), uint8(Status.Active));
    }

    /// A zero pot with a declared donation is a false fact: C = cut(0, bps) == 0.
    function test_Raise_ZeroPot_WithDonation_ZeroCharityAllocation() public {
        RaiseParams memory p = zeroPotParams();
        p.charityBps = 3_000;
        p.charityRecipient = charity;
        expectRaiseRevert(ZeroCharityAllocation.selector, p);
    }

    /// Order proof (2) before (3): pot terms win over an out-of-bounds bps.
    function test_Order_ZeroPotTerms_BeatsBounds() public {
        RaiseParams memory p = defaultParams();
        p.amount = 0;
        p.charityBps = 3_001;
        expectRaiseRevert(ZeroPotTerms.selector, p);
    }

    /*//////////////////// (3) the only product bounds ////////////////////*/

    function test_Raise_CharityBpsAboveMax() public {
        RaiseParams memory p = defaultParams();
        p.charityBps = 3_001;
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    function test_Raise_CharityBpsMaxAccepted() public {
        RaiseParams memory p = defaultParams();
        p.charityBps = 3_000;
        uint256 h = makeRaise(p);
        assertEq(core.facts(h).charityBps, 3_000);
    }

    /// No MIN_CHARITY_BPS exists any more: 1 bps on 100e6 pays 10 000 units.
    function test_Raise_CharityBpsOneAccepted() public {
        RaiseParams memory p = defaultParams();
        p.charityBps = 1;
        uint256 h = makeRaise(p);
        assertEq(core.facts(h).charityBps, 1);
        assertEq(AHandMath.cut(core.facts(h).pool, 1), 10_000);
    }

    function test_Raise_MinGiverClaimZero() public {
        RaiseParams memory p = defaultParams();
        p.minGiverClaimBps = 0;
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    function test_Raise_MinGiverClaimAboveDenominator() public {
        RaiseParams memory p = defaultParams();
        p.minGiverClaimBps = 10_001;
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    function test_Raise_MinGiverClaimBoundariesAccepted() public {
        RaiseParams memory p = defaultParams();
        p.minGiverClaimBps = 1;
        assertEq(core.facts(makeRaise(p)).minGiverClaimBps, 1);
        p.minGiverClaimBps = 10_000;
        assertEq(core.facts(makeRaise(p)).minGiverClaimBps, 10_000);
    }

    /// Order proof (3) before (4): bounds win over an unlisted recipient.
    function test_Order_Bounds_BeatCharityNotAllowed() public {
        RaiseParams memory p = defaultParams();
        p.charityBps = 3_001;
        p.charityRecipient = stranger;
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    /*//////////////////// (4) charity coherence ////////////////////*/

    function test_Raise_NoDonation_Accepted() public {
        RaiseParams memory p = noCharityParams();
        uint256 h = makeRaise(p);
        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(f.charityBps, 0);
        assertEq(f.charityRecipient, address(0));
    }

    /// Zero share with a recipient — even an allowlisted one — is incoherent.
    function test_Raise_UnexpectedCharityRecipient() public {
        RaiseParams memory p = noCharityParams();
        p.charityRecipient = charity;
        expectRaiseRevert(UnexpectedCharityRecipient.selector, p);
        p.charityRecipient = stranger;
        expectRaiseRevert(UnexpectedCharityRecipient.selector, p);
    }

    function test_Raise_CharityNotAllowed_Stranger() public {
        RaiseParams memory p = defaultParams();
        p.charityRecipient = stranger;
        expectRaiseRevert(CharityNotAllowed.selector, p);
    }

    /// Zero is never on the allowlist: a share without a recipient is CharityNotAllowed.
    function test_Raise_CharityNotAllowed_ZeroRecipientWithShare() public {
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(0);
        expectRaiseRevert(CharityNotAllowed.selector, p);
    }

    /// Core is never on the allowlist (S35): it cannot be a recipient.
    function test_Raise_CharityNotAllowed_CoreItself() public {
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(core);
        expectRaiseRevert(CharityNotAllowed.selector, p);
    }

    function test_Raise_CharityAllowlistIsProspective() public {
        address charityB = makeAddr("charityB");
        RaiseParams memory p = defaultParams();
        p.charityRecipient = charityB;
        expectRaiseRevert(CharityNotAllowed.selector, p);

        vm.prank(policyAdmin);
        core.setCharityAllowed(charityB, true);
        uint256 h = makeRaise(p);
        assertEq(core.facts(h).charityRecipient, charityB);

        vm.prank(policyAdmin);
        core.setCharityAllowed(charityB, false);
        expectRaiseRevert(CharityNotAllowed.selector, p);
        assertEq(core.facts(h).charityRecipient, charityB, "the live Hand keeps its snapshot");
    }

    /// P = 3, b = 3000: floor(3 · 3000 / 10 000) = 0 — a donation that pays nothing.
    function test_Raise_ZeroCharityAllocation_P3_b3000() public {
        RaiseParams memory p = defaultParams();
        p.amount = 3;
        p.charityBps = 3_000;
        expectRaiseRevert(ZeroCharityAllocation.selector, p);
    }

    /// P = 4, b = 3000: C = 1 — the smallest donation that pays a unit.
    function test_Raise_SmallestPayingDonation_P4_b3000() public {
        RaiseParams memory p = defaultParams();
        p.amount = 4;
        p.charityBps = 3_000;
        uint256 h = makeRaise(p);
        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(f.pool, 4);
        assertEq(AHandMath.cut(f.pool, f.charityBps), 1, "C == 1");
    }

    function test_Raise_ZeroCharityAllocation_DefaultBps() public {
        RaiseParams memory p = defaultParams();
        p.amount = 9; // 9 · 1000 / 10 000 floors to 0
        expectRaiseRevert(ZeroCharityAllocation.selector, p);
        p.amount = 10; // C = 1
        assertEq(core.facts(makeRaise(p)).pool, 10);
    }

    /// Order proof inside (4): allowlist before feasibility.
    function test_Order_CharityNotAllowed_BeatsZeroCharityAllocation() public {
        RaiseParams memory p = defaultParams();
        p.charityRecipient = stranger;
        p.amount = 1;
        expectRaiseRevert(CharityNotAllowed.selector, p);
    }

    /// Order proof (4) before (5): the charity rules win over a past expiry.
    function test_Order_Charity_BeatsExpiry() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp);
        p.charityRecipient = stranger;
        expectRaiseRevert(CharityNotAllowed.selector, p);

        p = defaultParams();
        p.expiry = uint40(block.timestamp);
        p.amount = 9;
        expectRaiseRevert(ZeroCharityAllocation.selector, p);

        p = noCharityParams();
        p.expiry = uint40(block.timestamp);
        p.charityRecipient = charity;
        expectRaiseRevert(UnexpectedCharityRecipient.selector, p);
    }

    /*//////////////////// (5) expiry: > now, nothing else ////////////////////*/

    function test_Raise_ExpiryNow_InPast() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp);
        expectRaiseRevert(ExpiryInPast.selector, p);
    }

    function test_Raise_ExpiryBeforeNow_InPast() public {
        vm.warp(1_700_000_000);
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp - 1);
        expectRaiseRevert(ExpiryInPast.selector, p);
        p.expiry = 0;
        expectRaiseRevert(ExpiryInPast.selector, p);
    }

    function test_Raise_ExpiryNowPlusOne_Accepted() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp + 1);
        assertEq(core.facts(makeRaise(p)).expiry, p.expiry);
    }

    function test_Raise_ExpiryTenYears_Accepted() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp + 3650 days);
        assertEq(core.facts(makeRaise(p)).expiry, p.expiry);
    }

    function test_Raise_ExpiryUint40Max_Accepted() public {
        RaiseParams memory p = defaultParams();
        p.expiry = type(uint40).max;
        assertEq(core.facts(makeRaise(p)).expiry, type(uint40).max);
    }

    /// Order proof (5) before (6): expiry wins over a missing metadata envelope.
    function test_Order_Expiry_BeatsVisibility() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp);
        p.metadataCommitment = bytes32(0);
        expectRaiseRevert(ExpiryInPast.selector, p);
    }

    /*//////////////////// (6) visibility coherence ////////////////////*/

    function test_Raise_ZeroMetadataCommitment_EveryMode() public {
        RaiseParams memory p = defaultParams();
        p.metadataCommitment = bytes32(0);
        expectRaiseRevert(InvalidVisibilityData.selector, p);

        p.visibility = Visibility.Preview;
        expectRaiseRevert(InvalidVisibilityData.selector, p);

        p = darkParams();
        p.metadataCommitment = bytes32(0);
        expectRaiseRevert(InvalidVisibilityData.selector, p, "", noTags());
    }

    function test_Raise_Public_EmptyDiscoveryRef() public {
        expectRaiseRevert(InvalidVisibilityData.selector, defaultParams(), "", noTags());
    }

    function test_Raise_Public_DiscoveryRefBounds() public {
        expectRaiseRevert(InvalidVisibilityData.selector, defaultParams(), new bytes(129), noTags());
        uint256 h1 = makeRaise(defaultParams(), new bytes(128), noTags()); // MAX_DISCOVERY_REF exact
        uint256 h2 = makeRaise(defaultParams(), new bytes(1), noTags()); // minimum
        assertEq(h1, 1);
        assertEq(h2, 2);
    }

    function test_Raise_Public_ZeroDiscoveryCommitment() public {
        RaiseParams memory p = defaultParams();
        p.discoveryCommitment = bytes32(0);
        expectRaiseRevert(InvalidVisibilityData.selector, p);
    }

    function test_Raise_Preview_SameCoherenceAsPublic() public {
        RaiseParams memory p = defaultParams();
        p.visibility = Visibility.Preview;
        expectRaiseRevert(InvalidVisibilityData.selector, p, "", noTags());
        p.discoveryCommitment = bytes32(0);
        expectRaiseRevert(InvalidVisibilityData.selector, p);
    }

    function test_Raise_Dark_Accepted() public {
        RaiseParams memory p = darkParams();
        expectRaised(1, raiser, p, "", 1);
        uint256 h = makeRaise(p, "", noTags());
        assertEq(uint8(core.facts(h).visibility), uint8(Visibility.Dark));
    }

    function test_Raise_Dark_WithDiscoveryRef() public {
        expectRaiseRevert(InvalidVisibilityData.selector, darkParams(), "x", noTags());
    }

    function test_Raise_Dark_WithDiscoveryCommitment() public {
        RaiseParams memory p = darkParams();
        p.discoveryCommitment = keccak256("discovery");
        expectRaiseRevert(InvalidVisibilityData.selector, p, "", noTags());
    }

    /// Dark with tags is a mode failure, never a tag-shape failure — even when the
    /// tags are also malformed (order proof (6) before (7)).
    function test_Raise_Dark_WithTags_IsVisibilityError() public {
        expectRaiseRevert(InvalidVisibilityData.selector, darkParams(), "", tags1(bytes32(uint256(1))));
        bytes32 t = bytes32(uint256(7));
        expectRaiseRevert(InvalidVisibilityData.selector, darkParams(), "", tags2(t, t));
    }

    function test_Order_ZeroMetadata_BeatsTags() public {
        RaiseParams memory p = defaultParams();
        p.metadataCommitment = bytes32(0);
        expectRaiseRevert(InvalidVisibilityData.selector, p, DEFAULT_REF, tags2(bytes32(uint256(2)), bytes32(uint256(1))));
    }

    /*//////////////////// (7) tags ////////////////////*/

    function test_Raise_Tags_Unsorted() public {
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags2(bytes32(uint256(2)), bytes32(uint256(1))));
    }

    function test_Raise_Tags_Duplicate() public {
        bytes32 t = bytes32(uint256(5));
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags2(t, t));
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags3(bytes32(uint256(1)), t, t));
    }

    function test_Raise_Tags_ZeroRejected() public {
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags1(bytes32(0)));
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags2(bytes32(0), bytes32(uint256(1))));
    }

    function test_Raise_Tags_NineRejected_EightAccepted() public {
        bytes32[] memory nine = new bytes32[](9);
        for (uint256 i; i < 9; ++i) {
            nine[i] = bytes32(i + 1);
        }
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, nine);

        bytes32[] memory eight = new bytes32[](8);
        for (uint256 i; i < 8; ++i) {
            eight[i] = bytes32(i + 1);
        }
        vm.expectEmit(address(core));
        emit AHandCore.HandTagged(1, raiser, eight);
        makeRaise(defaultParams(), DEFAULT_REF, eight); // MAX_PUBLIC_TAGS exact
    }

    function test_Raise_Tags_MaxValueAccepted() public {
        bytes32[] memory t = tags2(bytes32(uint256(1)), bytes32(type(uint256).max));
        makeRaise(defaultParams(), DEFAULT_REF, t);
    }

    /// Order proof (7) before (8): tags are checked before any token call.
    function test_Order_Tags_BeatDeposit() public {
        SenderFeeToken fee = new SenderFeeToken();
        useToken(address(fee));
        fund(address(fee), raiser, 1_000e6);
        bytes32 t = bytes32(uint256(5));
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags2(t, t));
        assertEq(fee.balanceOf(raiser), 1_000e6, "no token moved");
    }

    /*//////////////////// (8) exact-delta deposit, both sides ////////////////////*/

    /// Payer side: debits 110 for 100 while Core receives exactly 100.
    function test_Raise_InexactDeposit_SenderFee() public {
        SenderFeeToken fee = new SenderFeeToken();
        useToken(address(fee));
        fund(address(fee), raiser, 1_000e6);
        expectRaiseRevert(InexactDeposit.selector, defaultParams());
        assertEq(fee.balanceOf(raiser), 1_000e6, "revert undoes the fee");
        assertEq(fee.balanceOf(address(core)), 0);
    }

    /// Custody side: Core receives 99 for 100 while the payer is debited exactly 100.
    function test_Raise_InexactDeposit_ReceiverFee() public {
        ReceiverFeeToken fee = new ReceiverFeeToken();
        useToken(address(fee));
        fund(address(fee), raiser, 1_000e6);
        expectRaiseRevert(InexactDeposit.selector, defaultParams());
        assertEq(fee.balanceOf(raiser), 1_000e6);
        assertEq(fee.balanceOf(address(core)), 0);
    }

    /// Custody side, the other direction: a surplus credit is as inexact as a shortfall.
    function test_Raise_InexactDeposit_BonusReceiver() public {
        BonusReceiverToken bonus = new BonusReceiverToken();
        useToken(address(bonus));
        fund(address(bonus), raiser, 1_000e6);
        expectRaiseRevert(InexactDeposit.selector, defaultParams());
    }

    /// `transferFrom` returning false (nothing moved) is a SafeERC20 failure, not a Core error.
    function test_Raise_TransferFromReturnsFalse_SafeERC20FailedOperation() public {
        FalseTransferFromToken f = new FalseTransferFromToken();
        useToken(address(f));
        fund(address(f), raiser, 1_000e6);
        expectRaiseRevertBytes(
            abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(f)), defaultParams()
        );
    }

    /// `transferFrom` that moves and then returns false: the raise reverts whole, nothing stays moved.
    function test_Raise_TransferFromMovesThenFalse_RevertsWhole() public {
        MoveThenFalseTransferFromToken f = new MoveThenFalseTransferFromToken();
        useToken(address(f));
        fund(address(f), raiser, 1_000e6);
        expectRaiseRevertBytes(
            abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(f)), defaultParams()
        );
        assertEq(f.balanceOf(raiser), 1_000e6, "the move was undone");
        assertEq(f.balanceOf(address(core)), 0);
        assertEq(core.handsCount(), 0, "no Hand");
    }

    /// A token whose `transfer` can return false still deposits honestly: the
    /// entry rule judges the deposit leg only.
    function test_Raise_ReturnsFalseToken_DepositsHonestly() public {
        ReturnsFalseToken rf = new ReturnsFalseToken();
        useToken(address(rf));
        fund(address(rf), raiser, 1_000e6);
        uint256 h = makeRaise(defaultParams());
        assertEq(core.facts(h).pool, DEPOSIT);
        assertEq(rf.balanceOf(address(core)), DEPOSIT);
    }

    /// USDT shape: no returndata at all passes the OZ rule and the delta rule.
    function test_Raise_NoReturnToken_Accepted() public {
        NoReturnToken nr = new NoReturnToken();
        useToken(address(nr));
        fund(address(nr), raiser, 1_000e6);
        RaiseParams memory p = defaultParams();
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
        assertEq(nr.balanceOf(address(core)), DEPOSIT);
        assertEq(nr.balanceOf(raiser), 1_000e6 - DEPOSIT);
    }

    /// A proxied FiatToken (USDC shape) enters exactly; without allowance its own
    /// string revert bubbles unchanged — Core adds no error of its own.
    function test_Raise_FiatTokenLike_EntersExactly_BubblesItsReverts() public {
        FiatTokenLikeV1 usdc = deployFiatToken();
        usdc.mint(raiser, 1_000e6);
        useToken(address(usdc));

        RaiseParams memory p = defaultParams();
        vm.prank(raiser);
        vm.expectRevert(bytes("ERC20: transfer amount exceeds allowance"));
        core.raise(p, DEFAULT_REF, noTags());

        vm.prank(raiser);
        usdc.approve(address(core), type(uint256).max);
        uint256 h = makeRaise(p);
        assertEq(core.facts(h).pool, DEPOSIT);
        assertEq(usdc.balanceOf(address(core)), DEPOSIT);

        usdc.blacklist(raiser);
        vm.prank(raiser);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        core.raise(p, DEFAULT_REF, noTags());
    }

    /// Insufficient balance or allowance on a checked-arithmetic token bubbles its panic.
    function test_Raise_InsufficientFunds_BubblesTokenRevert() public {
        RaiseParams memory p = defaultParams();
        p.amount = usd.balanceOf(raiser) + 1;
        vm.prank(raiser);
        vm.expectRevert(stdError.arithmeticError);
        core.raise(p, DEFAULT_REF, noTags());

        vm.prank(raiser);
        usd.approve(address(core), DEPOSIT - 1);
        vm.prank(raiser);
        vm.expectRevert(stdError.arithmeticError);
        core.raise(defaultParams(), DEFAULT_REF, noTags());
    }

    /// A token address with no code cannot answer balanceOf: the raise reverts before any Hand exists.
    function test_Raise_CodelessToken_Reverts() public {
        RaiseParams memory p = defaultParams();
        p.token = makeAddr("not-a-token");
        vm.prank(raiser);
        vm.expectRevert();
        core.raise(p, DEFAULT_REF, noTags());
        assertEq(core.handsCount(), 0);
    }

    /*//////////////////// (8) hook token re-entering mid-deposit ////////////////////*/

    /// A hook that re-enters `raise` during the deposit hits the lock; with the
    /// failure swallowed the outer raise lands once, exactly.
    function test_Raise_HookReentersRaise_LockHolds() public {
        HookToken hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
        RaiseParams memory p = defaultParams();
        hook.setReentry(address(core), abi.encodeCall(core.raise, (p, DEFAULT_REF, noTags())), true, false, false);

        uint256 h = makeRaise(p);

        assertFalse(hook.lastReentryOk(), "the nested raise failed");
        assertEq(
            hook.lastReentryReturn(),
            abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector),
            "with the lock's error"
        );
        assertEq(h, 1);
        assertEq(core.handsCount(), 1, "exactly one Hand");
        assertEq(hook.balanceOf(address(core)), DEPOSIT, "exactly one deposit");
    }

    /// The same, with the hook bubbling the failure: the whole raise reverts with the lock's error.
    function test_Raise_HookReentersRaise_Bubbled_RevertsWhole() public {
        HookToken hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
        RaiseParams memory p = defaultParams();
        hook.setReentry(address(core), abi.encodeCall(core.raise, (p, DEFAULT_REF, noTags())), true, false, true);

        expectRaiseRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector, p);
        assertEq(core.handsCount(), 0);
        assertEq(hook.balanceOf(raiser), 1_000e6);
    }

    /// Every other money entry point is behind the same lock during the deposit.
    function test_Raise_HookReentersThankReclaimWithdraw_LockHolds() public {
        HookToken hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
        RaiseParams memory p = defaultParams();
        bytes memory locked = abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);

        hook.setReentry(address(core), abi.encodeCall(core.reclaim, (1)), true, false, false);
        makeRaise(p);
        assertFalse(hook.lastReentryOk());
        assertEq(hook.lastReentryReturn(), locked, "reclaim locked");

        hook.setReentry(address(core), abi.encodeCall(core.withdraw, (address(hook), raiser)), true, false, false);
        makeRaise(p);
        assertFalse(hook.lastReentryOk());
        assertEq(hook.lastReentryReturn(), locked, "withdraw locked");

        hook.setReentry(address(core), abi.encodeCall(core.pushExact, (address(hook), raiser, 1)), true, false, false);
        makeRaise(p);
        assertFalse(hook.lastReentryOk());
        assertEq(hook.lastReentryReturn(), abi.encodeWithSelector(OnlySelf.selector), "the frame is self-only");

        assertEq(core.handsCount(), 3);
        assertEq(hook.balanceOf(address(core)), 3 * DEPOSIT, "three exact deposits, nothing else moved");
    }

    /// Mid-deposit the Hand does not exist yet: the counter is unchanged and the
    /// prospective id reads as None (the "no half-raised Hand" argument of §4.1).
    function test_Raise_HookSeesNoNewHandMidDeposit() public {
        HookToken hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
        makeRaise(); // id 1 exists; the next raise will be id 2

        hook.setReentry(address(core), abi.encodeCall(core.handsCount, ()), true, false, true);
        uint256 h = makeRaise(defaultParams());
        assertEq(h, 2);
        assertTrue(hook.lastReentryOk());
        assertEq(abi.decode(hook.lastReentryReturn(), (uint256)), 1, "counter not yet incremented mid-deposit");

        hook.setReentry(address(core), abi.encodeCall(core.facts, (3)), true, false, true);
        h = makeRaise(defaultParams());
        assertEq(h, 3);
        IAHandFacts.HandFacts memory seen = abi.decode(hook.lastReentryReturn(), (IAHandFacts.HandFacts));
        assertEq(uint8(seen.status), uint8(Status.None), "the Hand is None while its deposit is in flight");
        assertEq(uint8(statusOf(3)), uint8(Status.Active), "and Active once the raise returns");
    }

    /// A hook that pushes extra units into Core during the deposit breaks the
    /// custody delta: the entry rule rejects it (I-5, measured on custody).
    function test_Raise_HookInflatesCustodyMidDeposit_InexactDeposit() public {
        HookToken hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
        hook.setReentry(address(hook), abi.encodeCall(hook.mint, (address(core), 1)), true, false, true);
        expectRaiseRevert(InexactDeposit.selector, defaultParams());
        assertEq(hook.balanceOf(address(core)), 0, "the surplus unit was reverted with the raise");
    }

    /// A hook that debits the payer further during the deposit breaks the payer
    /// delta: rejected too (I-5, measured on the payer).
    function test_Raise_HookDrainsPayerMidDeposit_InexactDeposit() public {
        HookToken hook = new HookToken();
        useToken(address(hook));
        fund(address(hook), raiser, 1_000e6);
        PayerDrainer drainer = new PayerDrainer();
        vm.prank(raiser);
        hook.approve(address(drainer), type(uint256).max);
        hook.setReentry(address(drainer), abi.encodeCall(drainer.drain, (hook, raiser, stranger)), true, false, true);
        expectRaiseRevert(InexactDeposit.selector, defaultParams());
        assertEq(hook.balanceOf(raiser), 1_000e6, "the side move was reverted with the raise");
        assertEq(hook.balanceOf(stranger), 0);
    }

    /*//////////////////// policyRevision snapshot before the deposit ////////////////////*/

    /// The token is the policy admin and allowlists a charity mid-deposit: the
    /// revision bumps to 2, but `Raised` names 1 — the revision under which (4) passed.
    function test_Raise_PolicyRevisionSnapshotBeforeDeposit() public {
        HookToken hook = new HookToken();
        AHandCore hookCore = deployCore(charity, address(hook));
        fundFor(hookCore, address(hook), raiser, 1_000e6);
        address charityB = makeAddr("charityB");
        hook.setReentry(address(hookCore), abi.encodeCall(hookCore.setCharityAllowed, (charityB, true)), true, false, true);

        RaiseParams memory p = defaultParams();
        p.token = address(hook);
        vm.recordLogs();
        vm.prank(raiser);
        uint256 h = hookCore.raise(p, DEFAULT_REF, noTags());

        assertTrue(hook.lastReentryOk(), "the setter is not behind the lock");
        assertEq(hookCore.policyRevision(), 2, "the policy changed mid-raise");
        assertTrue(hookCore.charityAllowed(charityB));
        assertEq(raisedRevisionOf(vm.getRecordedLogs()), 1, "Raised names the revision the check ran under");
        assertEq(hookCore.facts(h).charityRecipient, charity);
    }

    /// The mirror: the admin removes the chosen charity mid-deposit. The raise
    /// still lands (rule 4 already passed under revision 1) and says so.
    function test_Raise_PolicyRevisionSnapshot_DeallowMidDeposit() public {
        HookToken hook = new HookToken();
        AHandCore hookCore = deployCore(charity, address(hook));
        fundFor(hookCore, address(hook), raiser, 1_000e6);
        hook.setReentry(address(hookCore), abi.encodeCall(hookCore.setCharityAllowed, (charity, false)), true, false, true);

        RaiseParams memory p = defaultParams();
        p.token = address(hook);
        vm.recordLogs();
        vm.prank(raiser);
        uint256 h = hookCore.raise(p, DEFAULT_REF, noTags());

        assertFalse(hookCore.charityAllowed(charity), "de-allowed mid-raise");
        assertEq(hookCore.policyRevision(), 2);
        assertEq(raisedRevisionOf(vm.getRecordedLogs()), 1);
        assertEq(hookCore.facts(h).charityRecipient, charity, "the Hand keeps the recipient it was checked with");
    }

    function test_Raise_PolicyRevisionTracksRealChanges() public {
        vm.prank(policyAdmin);
        core.setCharityAllowed(makeAddr("charityB"), true);
        vm.prank(policyAdmin);
        core.setCharityAllowed(makeAddr("charityC"), true);
        assertEq(core.policyRevision(), 3);
        RaiseParams memory p = defaultParams();
        expectRaised(1, raiser, p, DEFAULT_REF, 3);
        makeRaise(p);
    }

    /*//////////////////// I-22: any token by behaviour ////////////////////*/

    function test_Raise_Token0Decimals() public {
        Token0Decimals t0 = new Token0Decimals();
        useToken(address(t0));
        fund(address(t0), raiser, 1_000);
        RaiseParams memory p = defaultParams();
        p.amount = 10; // C = 1 whole unit
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
        assertEq(t0.balanceOf(address(core)), 10);
        assertEq(t0.decimals(), 0);
    }

    function test_Raise_Token18Decimals() public {
        useToken(address(t18));
        RaiseParams memory p = defaultParams();
        p.amount = 1_000 ether;
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
        assertEq(t18.balanceOf(address(core)), 1_000 ether);
    }

    /// 30 decimals: a pot far above 2^96 is an ordinary pool (uint256, no cap).
    function test_Raise_Token30Decimals_PotAbove2Pow96() public {
        Token30Decimals t30 = new Token30Decimals();
        useToken(address(t30));
        uint256 amount = 1_000_000 * 1e30; // 1e36 > 2^96 ≈ 7.9e28
        assertGt(amount, uint256(type(uint96).max));
        fund(address(t30), raiser, amount);
        RaiseParams memory p = defaultParams();
        p.amount = amount;
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
        assertEq(t30.balanceOf(address(core)), amount);
        assertEq(AHandMath.cut(amount, 1_000), amount / 10, "C exact at this scale");
    }

    /// No `decimals()` at all: Core never asks (N29).
    function test_Raise_TokenWithoutDecimals() public {
        NoDecimalsToken nd = new NoDecimalsToken();
        useToken(address(nd));
        fund(address(nd), raiser, 1_000e6);
        vm.expectCall(address(nd), abi.encodeWithSignature("decimals()"), 0);
        RaiseParams memory p = defaultParams();
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
        assertEq(nd.balanceOf(address(core)), DEPOSIT);
    }

    /// The whole uint256 range enters exactly; C = floor(P · b / 1e4) is overflow-free.
    function testFuzz_Raise_PoolExactForAnyAmount(uint256 amount, uint16 charityBps) public {
        amount = bound(amount, 1, type(uint256).max);
        charityBps = uint16(bound(charityBps, 0, 3_000));
        NoDecimalsToken fresh = new NoDecimalsToken();
        useToken(address(fresh));
        fund(address(fresh), raiser, amount);

        RaiseParams memory p = defaultParams();
        p.amount = amount;
        p.charityBps = charityBps;
        if (charityBps == 0) p.charityRecipient = address(0);

        uint256 expectedC = AHandMath.cut(amount, charityBps);
        if (charityBps != 0 && expectedC == 0) {
            expectRaiseRevert(ZeroCharityAllocation.selector, p);
            return;
        }
        uint256 h = makeRaise(p);
        assertFactsEqualStorage(h, p, raiser);
        assertEq(fresh.balanceOf(address(core)), amount, "custody == pool");
        assertEq(fresh.balanceOf(raiser), 0, "payer debited exactly");
    }

    /// Any coherent parameter set raises; the facts equal the inputs.
    function testFuzz_Raise_CoherentParamsAccepted(
        uint40 expiryDelta,
        uint16 minGiverClaimBps,
        uint8 visibilityRaw,
        bytes32 metadata,
        bytes32 discovery,
        uint8 refLength
    ) public {
        expiryDelta = uint40(bound(expiryDelta, 1, type(uint40).max - block.timestamp));
        minGiverClaimBps = uint16(bound(minGiverClaimBps, 1, 10_000));
        Visibility visibility = Visibility(bound(visibilityRaw, 0, 2));
        vm.assume(metadata != bytes32(0));

        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp) + expiryDelta;
        p.minGiverClaimBps = minGiverClaimBps;
        p.visibility = visibility;
        p.metadataCommitment = metadata;
        bytes memory ref;
        if (visibility == Visibility.Dark) {
            p.discoveryCommitment = bytes32(0);
        } else {
            vm.assume(discovery != bytes32(0));
            p.discoveryCommitment = discovery;
            ref = new bytes(bound(refLength, 1, 128));
        }
        expectRaised(1, raiser, p, ref, 1);
        uint256 h = makeRaise(p, ref, noTags());
        assertFactsEqualStorage(h, p, raiser);
    }

    /*//////////////////// I-6: per-token identity across many raises ////////////////////*/

    /// After many raises across three tokens (6 dec, 18 dec, no decimals) plus
    /// zero-pot Hands, each token's custody equals Σ pool of its Active Hands;
    /// nothing leaks across tokens and no claim exists.
    function test_Raise_PerTokenIdentityAcrossThreeTokens() public {
        NoDecimalsToken nd = new NoDecimalsToken();
        fund(address(nd), raiser, 1_000_000e6);
        address[3] memory tokens = [address(usd), address(t18), address(nd)];
        uint256[3] memory amounts = [uint256(100e6), uint256(7 ether), uint256(12_345)];
        uint256[3] memory expected;

        for (uint256 i; i < 12; ++i) {
            if (i % 4 == 3) {
                makeRaise(zeroPotParams()); // zero-pot Hands touch no custody
                continue;
            }
            uint256 k = i % 3;
            RaiseParams memory p = defaultParams();
            p.token = tokens[k];
            p.amount = amounts[k] * (i + 1);
            if (k == 2) {
                p.charityBps = 0; // vary the shape: the no-decimals token takes 0 % Hands
                p.charityRecipient = address(0);
            }
            makeRaise(p);
            expected[k] += p.amount;
        }

        assertEq(core.handsCount(), 12);
        for (uint256 k; k < 3; ++k) {
            assertEq(activePoolOf(tokens[k]), expected[k], "sum of pools per token");
            assertEq(balanceOf(tokens[k], address(core)), expected[k], "custody == sum of pools, no cross-token leak");
            assertEq(claimOf(tokens[k], raiser), 0, "no claim after raises");
        }
        assertEq(activePoolOf(address(0)), 0, "zero-pot Hands carry no pool");

        // surplus is inert: a force-sent unit raises the balance, never a pool
        usd.mint(address(core), 5);
        assertEq(balanceOf(address(usd), address(core)), expected[0] + 5);
        assertEq(activePoolOf(address(usd)), expected[0], "pool unchanged by surplus");
    }

    /// The same token under two Cores: each Core's custody is its own Σ pool.
    function test_Raise_PerTokenIdentityAcrossTwoCores() public {
        AHandCore other = deployCore(charity, policyAdmin);
        fundFor(other, address(usd), raiser, 0);
        makeRaise();
        makeRaise();
        makeRaiseAs(raiser, other, defaultParams(), DEFAULT_REF, noTags());

        assertEq(usd.balanceOf(address(core)), 2 * DEPOSIT);
        assertEq(usd.balanceOf(address(other)), DEPOSIT);
        assertEq(core.handsCount(), 2);
        assertEq(other.handsCount(), 1);
        assertEq(other.facts(1).raiser, raiser);
        assertEq(uint8(other.facts(2).status), uint8(Status.None), "ids are per Core");
    }
}
