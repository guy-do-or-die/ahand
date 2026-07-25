// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: raise — the validation matrix, in revert order
//////////////////////////////////////////////////////////////*/

contract AHandRaiseTest is AHandTestBase {
    /*──────────────── constructor: genesis policy ────────────────*/

    /// Constructor emits the full genesis policy record: admin handover from
    /// zero, token enablement, one CharityPolicyUpdated per seeded charity —
    /// all at policyRevision 1.
    function test_Constructor_GenesisPolicyEvents() public {
        MockUSD freshUsd = new MockUSD();
        address charityB = makeAddr("charityB");
        address[] memory ch = new address[](2);
        ch[0] = charity;
        ch[1] = charityB;

        vm.expectEmit();
        emit AHandCore.PolicyAdminTransferred(address(0), policyAdmin);
        vm.expectEmit();
        emit AHandCore.TokenPolicyUpdated(address(freshUsd), true, 1);
        vm.expectEmit();
        emit AHandCore.CharityPolicyUpdated(charity, true, 1);
        vm.expectEmit();
        emit AHandCore.CharityPolicyUpdated(charityB, true, 1);
        AHandCore fresh = new AHandCore(address(freshUsd), USD_SCALE, ch, policyAdmin);

        assertEq(fresh.policyRevision(), 1, "genesis revision");
        assertTrue(fresh.tokenEnabled(), "token enabled at genesis");
        assertTrue(fresh.charityAllowed(charity), "seed charity 0");
        assertTrue(fresh.charityAllowed(charityB), "seed charity 1");
        assertEq(fresh.policyAdmin(), policyAdmin);
        assertEq(fresh.pendingPolicyAdmin(), address(0));
    }

    function test_Constructor_RejectsWrongScaleAndZeroAddresses() public {
        address[] memory ch = new address[](1);
        ch[0] = charity;

        vm.expectRevert(BoundsViolated.selector); // 6-dec token demands exactly 1e12
        new AHandCore(address(usd), 1e11, ch, policyAdmin);

        vm.expectRevert(ZeroAddress.selector);
        new AHandCore(address(0), USD_SCALE, ch, policyAdmin);

        vm.expectRevert(ZeroAddress.selector);
        new AHandCore(address(usd), USD_SCALE, ch, address(0));

        address[] memory badCh = new address[](1); // zero seed charity
        vm.expectRevert(ZeroAddress.selector);
        new AHandCore(address(usd), USD_SCALE, badCh, policyAdmin);
    }

    /*──────────────── happy path: storage + events ────────────────*/

    function test_Raise_StoresHandAndPullsDeposit() public {
        RaiseParams memory p = defaultParams();
        uint256 h = makeRaise(p);

        assertEq(h, 1, "first hand");
        assertEq(core.handsCount(), 1);
        assertEq(usd.balanceOf(address(core)), DEPOSIT, "escrow holds the deposit");

        Hand memory hand = core.getHand(h);
        assertEq(hand.raiser, raiser);
        assertEq(hand.expiry, p.expiry);
        assertEq(hand.charityBps, 1_000);
        assertEq(hand.minGiverClaimBps, 5_000);
        assertEq(uint8(hand.visibility), uint8(Visibility.Public));
        assertEq(uint8(hand.status), uint8(Status.Active));
        assertEq(hand.rewardToken, address(usd));
        assertEq(hand.creditedReward, DEPOSIT);
        assertEq(hand.charityRecipient, charity);
        assertEq(hand.usdScaleAtRaise, USD_SCALE, "scale snapshot");
        assertEq(hand.rootCapability, vm.addr(E0));
        assertEq(hand.metadataCommitment, keccak256("meta"));
        assertEq(hand.discoveryCommitment, keccak256("discovery"));
        assertEq(hand.thankSignalSourceHash, bytes32(0), "zero until Thank");
    }

    function test_Raise_EmitsRaised() public {
        RaiseParams memory p = defaultParams();
        vm.expectEmit();
        emit AHandCore.Raised(
            1,
            raiser,
            address(usd),
            DEPOSIT,
            USD_SCALE,
            1, // genesis policyRevision snapshot
            p.expiry,
            vm.addr(E0),
            Visibility.Public,
            p.metadataCommitment,
            p.discoveryCommitment,
            DEFAULT_REF,
            5_000,
            charity,
            1_000
        );
        makeRaise(p);
    }

    function test_Raise_SequentialHandIds() public {
        assertEq(makeRaise(), 1);
        assertEq(makeRaise(), 2);
        assertEq(core.handsCount(), 2);
        assertEq(usd.balanceOf(address(core)), uint256(DEPOSIT) * 2, "escrow aggregates");
    }

    /*──────────────── (1) token identity + prospective policy ────────────────*/

    function test_Raise_TokenMismatch() public {
        RaiseParams memory p = defaultParams();
        p.token = address(new MockUSD());
        expectRaiseRevert(TokenMismatch.selector, p);
    }

    /// Order proof: identity is checked before policy — a foreign token reverts
    /// TokenMismatch even while raises are switched off entirely.
    function test_Raise_TokenMismatch_BeatsTokenNotEnabled() public {
        vm.prank(policyAdmin);
        core.setTokenEnabled(false);
        RaiseParams memory p = defaultParams();
        p.token = address(new MockUSD());
        expectRaiseRevert(TokenMismatch.selector, p);
    }

    function test_Raise_TokenNotEnabled() public {
        vm.prank(policyAdmin);
        core.setTokenEnabled(false);
        expectRaiseRevert(TokenNotEnabled.selector, defaultParams());
    }

    /*──────────────── (2) non-degenerate participants ────────────────*/

    function test_Raise_ZeroAmount() public {
        RaiseParams memory p = defaultParams();
        p.amount = 0;
        expectRaiseRevert(ZeroAmount.selector, p);
    }

    function test_Raise_ZeroAmount_BeatsZeroRootCapability() public {
        RaiseParams memory p = defaultParams();
        p.amount = 0;
        p.rootCapability = address(0);
        expectRaiseRevert(ZeroAmount.selector, p);
    }

    function test_Raise_ZeroRootCapability() public {
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(0);
        expectRaiseRevert(ZeroAddress.selector, p);
    }

    function test_Raise_ZeroRootCapability_BeatsUnlistedCharity() public {
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(0);
        p.charityRecipient = stranger;
        expectRaiseRevert(ZeroAddress.selector, p);
    }

    function test_Raise_CharityNotWhitelisted() public {
        RaiseParams memory p = defaultParams();
        p.charityRecipient = stranger;
        expectRaiseRevert(CharityNotWhitelisted.selector, p);
    }

    /// charityRecipient == 0 is never on the allowlist, so the zero charity
    /// resolves as CharityNotWhitelisted, not ZeroAddress.
    function test_Raise_ZeroCharity_IsNotWhitelisted() public {
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(0);
        expectRaiseRevert(CharityNotWhitelisted.selector, p);
    }

    function test_Raise_CharityNotWhitelisted_BeatsBpsBounds() public {
        RaiseParams memory p = defaultParams();
        p.charityRecipient = stranger;
        p.charityBps = 99; // also out of bounds — allowlist wins
        expectRaiseRevert(CharityNotWhitelisted.selector, p);
    }

    /*──────────────── (3) constitutional bps bounds ────────────────*/

    function test_Raise_CharityBpsBelowMin() public {
        RaiseParams memory p = defaultParams();
        p.charityBps = 99;
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    function test_Raise_CharityBpsAboveMax() public {
        RaiseParams memory p = defaultParams();
        p.charityBps = 3_001;
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    function test_Raise_CharityBpsBoundariesAccepted() public {
        RaiseParams memory p = defaultParams();
        p.charityBps = 100; // MIN_CHARITY_BPS
        makeRaise(p);
        p = defaultParams();
        p.charityBps = 3_000; // MAX_CHARITY_BPS
        makeRaise(p);
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
        makeRaise(p);
        p = defaultParams();
        p.minGiverClaimBps = 10_000;
        makeRaise(p);
    }

    /*──────────────── (4) settlement solvency ────────────────*/

    function test_Raise_ZeroCharityAllocation() public {
        RaiseParams memory p = defaultParams();
        p.amount = 9; // 9 * 1000 / 10000 floors to 0
        expectRaiseRevert(ZeroCharityAllocation.selector, p);
    }

    /// Order proof: the solvency floor computes before the expiry window.
    function test_Raise_ZeroCharityAllocation_BeatsExpiryBounds() public {
        RaiseParams memory p = defaultParams();
        p.amount = 9;
        p.expiry = uint40(block.timestamp); // also invalid
        expectRaiseRevert(ZeroCharityAllocation.selector, p);
    }

    function test_Raise_SmallestSolventAmountAccepted() public {
        RaiseParams memory p = defaultParams();
        p.amount = 10; // C = 1, D = 9 — both legs payable
        uint256 h = makeRaise(p);
        assertEq(core.getHand(h).creditedReward, 10);
    }

    // ZeroDistributable (amount == charityAllocation) is provably unreachable
    // while MAX_CHARITY_BPS == 3000: C <= 30% of amount < amount for any
    // amount that passed ZeroCharityAllocation. Defense-in-depth only — no test
    // can trigger it through raise.

    /*──────────────── (5) expiry window ────────────────*/

    function test_Raise_ExpiryTooSoon() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp + 1 days - 1);
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    function test_Raise_ExpiryTooLate() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp + 180 days + 1);
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    function test_Raise_ExpiryBoundariesAccepted() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp + 1 days); // MIN_EXPIRY exact
        makeRaise(p);
        p = defaultParams();
        p.expiry = uint40(block.timestamp + 180 days); // MAX_EXPIRY exact
        makeRaise(p);
    }

    /// Order proof: the expiry window is checked before visibility coherence.
    function test_Raise_ExpiryBounds_BeatVisibilityData() public {
        RaiseParams memory p = defaultParams();
        p.expiry = uint40(block.timestamp);
        p.metadataCommitment = bytes32(0); // also invalid
        expectRaiseRevert(BoundsViolated.selector, p);
    }

    /*──────────────── (6) visibility coherence ────────────────*/

    function test_Raise_ZeroMetadataCommitment_AnyMode() public {
        RaiseParams memory p = defaultParams();
        p.metadataCommitment = bytes32(0);
        expectRaiseRevert(InvalidVisibilityData.selector, p);

        p = darkParams();
        p.metadataCommitment = bytes32(0);
        expectRaiseRevert(InvalidVisibilityData.selector, p, "", noTags());
    }

    function test_Raise_Public_EmptyDiscoveryRef() public {
        expectRaiseRevert(InvalidVisibilityData.selector, defaultParams(), "", noTags());
    }

    function test_Raise_Public_OversizedDiscoveryRef() public {
        expectRaiseRevert(InvalidVisibilityData.selector, defaultParams(), new bytes(129), noTags());
    }

    function test_Raise_Public_MaxDiscoveryRefAccepted() public {
        makeRaise(defaultParams(), new bytes(128), noTags()); // MAX_DISCOVERY_REF exact
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

        p = defaultParams();
        p.visibility = Visibility.Preview;
        uint256 h = makeRaise(p);
        assertEq(uint8(core.getHand(h).visibility), uint8(Visibility.Preview));
    }

    function test_Raise_Dark_HappyPath() public {
        uint256 h = makeRaise(darkParams(), "", noTags());
        Hand memory hand = core.getHand(h);
        assertEq(uint8(hand.visibility), uint8(Visibility.Dark));
        assertEq(hand.discoveryCommitment, bytes32(0));
    }

    function test_Raise_Dark_WithDiscoveryRef() public {
        expectRaiseRevert(InvalidVisibilityData.selector, darkParams(), "x", noTags());
    }

    function test_Raise_Dark_WithDiscoveryCommitment() public {
        RaiseParams memory p = darkParams();
        p.discoveryCommitment = keccak256("discovery");
        expectRaiseRevert(InvalidVisibilityData.selector, p, "", noTags());
    }

    /// Dark with tags is a MODE-coherence failure, not a tag-shape failure:
    /// InvalidVisibilityData, never TagsInvalid — even when the tags themselves
    /// would also be malformed.
    function test_Raise_Dark_WithTags_IsVisibilityError() public {
        expectRaiseRevert(InvalidVisibilityData.selector, darkParams(), "", tags1(bytes32(uint256(1))));

        // duplicate tags under Dark still resolve as the visibility error
        bytes32 t = bytes32(uint256(7));
        expectRaiseRevert(InvalidVisibilityData.selector, darkParams(), "", tags2(t, t));
    }

    /*──────────────── (7) tags ────────────────*/

    function test_Raise_Tags_Unsorted() public {
        expectRaiseRevert(
            TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags2(bytes32(uint256(2)), bytes32(uint256(1)))
        );
    }

    function test_Raise_Tags_Duplicate() public {
        bytes32 t = bytes32(uint256(5));
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags2(t, t));
    }

    function test_Raise_Tags_ZeroFirst() public {
        expectRaiseRevert(
            TagsInvalid.selector, defaultParams(), DEFAULT_REF, tags2(bytes32(0), bytes32(uint256(1)))
        );
    }

    function test_Raise_Tags_NineRejected_EightAccepted() public {
        bytes32[] memory nine = new bytes32[](9);
        for (uint256 i; i < 9; ++i) nine[i] = bytes32(i + 1); // ascending, only count is wrong
        expectRaiseRevert(TagsInvalid.selector, defaultParams(), DEFAULT_REF, nine);

        bytes32[] memory eight = new bytes32[](8);
        for (uint256 i; i < 8; ++i) eight[i] = bytes32(i + 1);
        makeRaise(defaultParams(), DEFAULT_REF, eight); // MAX_PUBLIC_TAGS exact
    }

    function test_Raise_Tags_EmitHandTagged() public {
        bytes32[] memory t = tags3(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)));
        RaiseParams memory p = defaultParams();
        // Raised first, HandTagged second — assert the ordered pair.
        vm.expectEmit();
        emit AHandCore.Raised(
            1, raiser, address(usd), DEPOSIT, USD_SCALE, 1, p.expiry, vm.addr(E0), Visibility.Public,
            p.metadataCommitment, p.discoveryCommitment, DEFAULT_REF, 5_000, charity, 1_000
        );
        vm.expectEmit();
        emit AHandCore.HandTagged(1, raiser, t);
        makeRaise(p, DEFAULT_REF, t);
    }

    function test_Raise_NoTags_NoHandTagged() public {
        vm.recordLogs();
        makeRaise();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 taggedTopic = keccak256("HandTagged(uint256,address,bytes32[])");
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != taggedTopic, "HandTagged must not emit for empty tags");
        }
    }

    /*──────────────── (8) exact-delta deposit ────────────────*/

    /// A 1% skimming token delivers less than declared: the strict balance-delta
    /// check rejects the raise instead of absorbing the shortfall.
    function test_Raise_InexactDeposit_FeeOnTransfer() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        AHandCore fotCore = deployCore(address(fot));
        fot.mint(raiser, 1_000e6);
        vm.prank(raiser);
        fot.approve(address(fotCore), type(uint256).max);

        RaiseParams memory p = defaultParams();
        p.token = address(fot);
        vm.prank(raiser);
        vm.expectRevert(InexactDeposit.selector);
        fotCore.raise(p, DEFAULT_REF, noTags());
    }

    /*──────────────── helpers ────────────────*/

    function darkParams() internal view returns (RaiseParams memory p) {
        p = defaultParams();
        p.visibility = Visibility.Dark;
        p.discoveryCommitment = bytes32(0);
    }
}
