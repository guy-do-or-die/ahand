// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";
import {console2} from "forge-std/console2.sol";
import {
    SmartWallet1271,
    GasBomb1271,
    EvilMutator1271,
    WrongMagic1271,
    ERC1271_MAGIC
} from "./mocks/SmartWallet1271.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: ERC-1271 — contract signers across all four
        signature families (Shake, ShakerAcceptance, Give,
        GiverAcceptance). Happy paths, ECDSA-first fallthrough,
        350k gas-bomb containment, staticcall mutation and
        reentrancy blocking, strict-magic and empty-code cases.
//////////////////////////////////////////////////////////////*/

/// @notice Accepts ANY signature bytes — including empty — for any digest.
///         Models a wallet whose authorization does not live in the signature
///         payload (e.g. digests pre-approved in wallet storage). Exists to
///         prove the design note: empty acceptance bytes on an explicit hop
///         PASS when the shaker is a 1271 contract that accepts them.
contract AlwaysValid1271 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return ERC1271_MAGIC;
    }
}

/// @notice Hostile validator that reenters the core mid-verification. The
///         verifier reaches it via STATICCALL, so the state-changing reentry
///         reverts inside the validator; the high-level call bubbles that
///         revert out of isValidSignature, and the signature comes back
///         invalid. Outside a static context the attempted call is perfectly
///         live (the test proves both halves).
contract Reentrant1271 {
    AHandCore private immutable core_;
    address private immutable token_;
    address private immutable beneficiary_;

    constructor(AHandCore c, address token, address beneficiary) {
        core_ = c;
        token_ = token;
        beneficiary_ = beneficiary;
    }

    function isValidSignature(bytes32, bytes calldata) external returns (bytes4) {
        core_.withdraw(token_, beneficiary_); // would move real funds outside a static context
        return ERC1271_MAGIC;
    }
}

contract AHandERC1271Test is AHandTestBase {
    /// Owner keys for SmartWallet1271 instances — distinct from every base key.
    uint256 constant OWNER_A_PK = 0x0Aaa1;
    uint256 constant OWNER_B_PK = 0x0Bbb1;
    /// A valid secp256k1 key whose 65-byte ECDSA signatures recover to an EOA
    /// that never equals a contract signer — guarantees the ECDSA-first branch
    /// falls through to the ERC-1271 staticcall.
    uint256 constant JUNK_PK = 0xBAD1;

    /*//////////////////// contract-capability route helpers ////////////////////*/

    /// @dev Like the base addHop, but the child capability is an ARBITRARY
    ///      address (possibly a contract) whose future artifacts childSignerPk
    ///      signs. r.parentPk is generalized to "key producing bytes that
    ///      _isValidSig accepts for the tail capability": for an EOA tail the
    ///      key itself, for a SmartWallet1271 tail its owner key (1271 path),
    ///      for a hostile tail any junk key (forces the 1271 fallthrough).
    function addAddrHop(
        RouteBuild memory r,
        uint256 handId,
        address childCap,
        uint256 childSignerPk,
        address shaker,
        uint256 shakerSignerPk,
        uint16 childClaim
    ) internal view {
        Shake memory s = Shake({
            handId: handId,
            childCapability: childCap,
            shaker: shaker,
            parentClaimBps: r.claim,
            childClaimBps: childClaim,
            hopDataHash: bytes32(0),
            deadline: defaultDeadline()
        });
        bytes32 shakeHash = AHandSig.hashShake(s);
        bytes memory acceptance;
        if (shakerSignerPk != 0) acceptance = signShakerAcceptance(shakerSignerPk, shakeHash);

        r.shakes = _pushShake(r.shakes, s);
        r.sigs = _pushBytes(r.sigs, signStruct(r.parentPk, shakeHash));
        r.acceptances = _pushBytes(r.acceptances, acceptance);
        r.parentPk = childSignerPk;
        r.claim = childClaim;
    }

    /// @dev Route rooted at an arbitrary capability address (pair with
    ///      RaiseParams.rootCapability); rootSignerPk signs hop 0.
    function newRouteFor(uint256 rootSignerPk) internal pure returns (RouteBuild memory r) {
        r = newRoute();
        r.parentPk = rootSignerPk;
    }

    /// @dev prank(raiser) + thank, measuring gas around the outer call.
    function thankMeasured(
        uint256 handId,
        RouteBuild memory r,
        Give memory g,
        bytes memory giveSig,
        bytes memory giverAcceptanceSig
    ) internal returns (uint256 used) {
        vm.prank(raiser);
        uint256 before = gasleft();
        core.thank(handId, r.shakes, r.sigs, r.acceptances, g, giveSig, giverAcceptanceSig);
        used = before - gasleft();
    }

    /// @dev Same, expecting a typed revert. A matched custom error proves the
    ///      outer tx completed with a PROPER revert — an OOG of the outer call
    ///      would fail the expectation with a different failure mode.
    function thankRevertMeasured(
        bytes4 err,
        uint256 handId,
        RouteBuild memory r,
        Give memory g,
        bytes memory giveSig,
        bytes memory giverAcceptanceSig
    ) internal returns (uint256 used) {
        vm.prank(raiser);
        vm.expectRevert(err);
        uint256 before = gasleft();
        core.thank(handId, r.shakes, r.sigs, r.acceptances, g, giveSig, giverAcceptanceSig);
        used = before - gasleft();
    }

    /*//////////////////////////////////////////////////////////
                    happy paths: honest smart wallets
    //////////////////////////////////////////////////////////*/

    /// A SmartWallet1271 as mid-route capability: hop 0 delegates E0 -> wallet,
    /// and the wallet (via its owner key, validated through 1271) signs the
    /// NEXT hop's Shake. Terminal EOA settles normally.
    function test_WalletCapability_SignsNextHop_Via1271() public {
        SmartWallet1271 wallet = new SmartWallet1271(vm.addr(OWNER_A_PK));
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute(); // root E0 (EOA)
        addAddrHop(r, h, address(wallet), OWNER_A_PK, address(0), 0, 10_000); // E0 -> wallet
        addAddrHop(r, h, vm.addr(E2), E2, address(0), 0, 10_000);             // wallet signs via 1271

        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        doThank(h, r, g, gs, signGiverAcceptance(GIVER_PK, g));

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled), "smart-wallet hop settles");
        assertEq(core.claims(address(usd), charity), 10e6, "charity 10%");
        assertEq(core.claims(address(usd), giver), 90e6, "zero-margin route: giver takes D");
    }

    /// A SmartWallet1271 as the TERMINAL capability signing the Give via 1271.
    function test_WalletCapability_SignsTerminalGive_Via1271() public {
        SmartWallet1271 wallet = new SmartWallet1271(vm.addr(OWNER_A_PK));
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute();
        addAddrHop(r, h, address(wallet), OWNER_A_PK, address(0), 0, 10_000); // wallet becomes terminal

        // buildGive signs with r.parentPk == OWNER_A_PK; the sig recovers the
        // owner EOA, not the wallet, so only the 1271 staticcall can accept it.
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        doThank(h, r, g, gs, signGiverAcceptance(GIVER_PK, g));

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled), "1271 give signature settles");
        assertEq(core.claims(address(usd), giver), 90e6, "giver residual intact");
    }

    /// A SmartWallet1271 as an explicit shaker: margin > 0, acceptance co-signed
    /// by the wallet owner and validated via 1271. The wallet earns a real claim
    /// and can be paid out through withdraw.
    function test_WalletShaker_Acceptance_Via1271() public {
        SmartWallet1271 shakerWallet = new SmartWallet1271(vm.addr(OWNER_A_PK));
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute();
        addAddrHop(r, h, vm.addr(E1), E1, address(shakerWallet), OWNER_A_PK, 9_500); // 500 bps margin
        settle(h, r);

        assertEq(core.claims(address(usd), address(shakerWallet)), 4_500_000, "500bps of D = 90e6");
        assertEq(core.claims(address(usd), giver), 85_500_000, "giver residual");
        assertEq(core.claims(address(usd), charity), 10e6, "charity 10%");

        core.withdraw(address(usd), address(shakerWallet));
        assertEq(usd.balanceOf(address(shakerWallet)), 4_500_000, "smart wallet actually gets paid");
    }

    /// A SmartWallet1271 as the GIVER: GiverAcceptance validated via 1271.
    function test_WalletGiver_Acceptance_Via1271() public {
        SmartWallet1271 giverWallet = new SmartWallet1271(vm.addr(OWNER_B_PK));
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, address(giverWallet), defaultDeadline());
        doThank(h, r, g, gs, signGiverAcceptance(OWNER_B_PK, g));

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled));
        assertEq(core.claims(address(usd), address(giverWallet)), 90e6, "residual to the wallet");
    }

    /// Worst honest case: EVERY signer is a contract. 7 capability wallets
    /// (root + 6 children), 6 explicit shaker wallets, 1 giver wallet — all 14
    /// verifications (6 shakes + 6 acceptances + give + giver acceptance) take
    /// the ERC-1271 staticcall path. Measures the real gas ceiling against the
    /// design's 14 x 350k ~ 4.9M hostile bound.
    function test_FullSmartRoute_AllFourteenSignersAreContracts() public {
        SmartWallet1271[7] memory caps;
        SmartWallet1271[6] memory shakerWallets;
        for (uint256 i; i < 7; ++i) caps[i] = new SmartWallet1271(vm.addr(_capPk(i)));
        for (uint256 i; i < 6; ++i) shakerWallets[i] = new SmartWallet1271(vm.addr(_shkPk(i)));
        SmartWallet1271 giverWallet = new SmartWallet1271(vm.addr(OWNER_B_PK));

        RaiseParams memory p = defaultParams();
        p.rootCapability = address(caps[0]); // even the ROOT capability is a contract
        uint256 h = makeRaise(p);

        RouteBuild memory r = newRouteFor(_capPk(0));
        uint16 claim = 10_000;
        for (uint256 i; i < 6; ++i) {
            claim -= 500; // 10000 -> 7000, floor 5000 respected
            addAddrHop(r, h, address(caps[i + 1]), _capPk(i + 1), address(shakerWallets[i]), _shkPk(i), claim);
        }

        (Give memory g, bytes memory gs) = buildGive(h, r, address(giverWallet), defaultDeadline());
        bytes memory ga = signGiverAcceptance(OWNER_B_PK, g);

        uint256 used = thankMeasured(h, r, g, gs, ga);
        console2.log("all-contract-signers thank (14 x 1271 validations) gas:", used);
        assertLt(used, 4_900_000, "honest wallets land far inside the 4.9M hostile ceiling");

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled));
        assertEq(core.claims(address(usd), charity), 10e6, "charity 10%");
        for (uint256 i; i < 6; ++i) {
            assertEq(core.claims(address(usd), address(shakerWallets[i])), 4_500_000, "500bps hop margin");
        }
        assertEq(core.claims(address(usd), address(giverWallet)), 63e6, "residual after 6 margins");
    }

    /*//////////////////////////////////////////////////////////
            gas bombs: the 350k cap contains every family
    //////////////////////////////////////////////////////////*/

    /// GasBomb as a route capability (root): the hop-0 Shake signature falls
    /// through to the bomb, which burns exactly its 350k stipend; the outer tx
    /// reverts CapabilityProof — a typed revert, not an OOG.
    function test_GasBomb_AsRouteCapability_CapabilityProof_Contained() public {
        assertEq(core.ERC1271_GAS(), 350_000, "spec constant");
        GasBomb1271 bomb = new GasBomb1271();

        RaiseParams memory p = defaultParams();
        p.rootCapability = address(bomb);
        uint256 h = makeRaise(p);

        RouteBuild memory r = newRouteFor(JUNK_PK); // sig recovers junk EOA != bomb -> 1271 path
        addAddrHop(r, h, vm.addr(E1), E1, address(0), 0, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());

        uint256 used = thankRevertMeasured(CapabilityProof.selector, h, r, g, gs, signGiverAcceptance(GIVER_PK, g));
        console2.log("gas-bomb capability thank gas:", used);
        assertGt(used, 350_000, "bomb consumed its full capped stipend");
        assertLt(used, 1_000_000, "cap contains the burn; outer tx nowhere near OOG");
        assertEq(uint8(core.getHand(h).status), uint8(Status.Active), "hand untouched");
    }

    /// GasBomb as an explicit shaker on a paid hop: acceptance verification
    /// hits the bomb -> ShakerAcceptanceInvalid, burn capped at 350k.
    function test_GasBomb_AsShaker_ShakerAcceptanceInvalid_Contained() public {
        GasBomb1271 bomb = new GasBomb1271();
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute();
        addAddrHop(r, h, vm.addr(E1), E1, address(bomb), JUNK_PK, 9_500); // margin forces attribution
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());

        uint256 used =
            thankRevertMeasured(ShakerAcceptanceInvalid.selector, h, r, g, gs, signGiverAcceptance(GIVER_PK, g));
        console2.log("gas-bomb shaker thank gas:", used);
        assertGt(used, 350_000);
        assertLt(used, 1_000_000);
        assertEq(core.claims(address(usd), address(bomb)), 0, "no margin credited");
    }

    /// GasBomb as the TERMINAL capability: route verifies, the Give signature
    /// falls through to the bomb -> CapabilityProof from _verifyGive.
    function test_GasBomb_AsTerminalCapability_CapabilityProof_Contained() public {
        GasBomb1271 bomb = new GasBomb1271();
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute();
        addAddrHop(r, h, address(bomb), JUNK_PK, address(0), 0, 10_000); // bomb becomes terminal
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());

        uint256 used = thankRevertMeasured(CapabilityProof.selector, h, r, g, gs, signGiverAcceptance(GIVER_PK, g));
        console2.log("gas-bomb terminal-give thank gas:", used);
        assertGt(used, 350_000);
        assertLt(used, 1_000_000);
    }

    /// GasBomb as the GIVER: everything else verifies, the giver acceptance
    /// hits the bomb -> GiverAcceptanceInvalid.
    function test_GasBomb_AsGiver_GiverAcceptanceInvalid_Contained() public {
        GasBomb1271 bomb = new GasBomb1271();
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, address(bomb), defaultDeadline());

        uint256 used = thankRevertMeasured(GiverAcceptanceInvalid.selector, h, r, g, gs, signGiverAcceptance(JUNK_PK, g));
        console2.log("gas-bomb giver thank gas:", used);
        assertGt(used, 350_000);
        assertLt(used, 1_000_000);
        assertEq(uint8(core.getHand(h).status), uint8(Status.Active), "still settleable honestly");
    }

    /*//////////////////////////////////////////////////////////
            staticcall discipline: mutation and reentrancy
    //////////////////////////////////////////////////////////*/

    /// EvilMutator SSTOREs before returning the magic. Under the verifier's
    /// staticcall the SSTORE aborts the inner call, so the "valid" answer never
    /// materializes: the sig is invalid AND the mutation never lands.
    function test_EvilMutator_StaticcallBlocksSstore_SigInvalid() public {
        EvilMutator1271 mutator = new EvilMutator1271();
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute();
        addSelfHop(r, h, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h, r, address(mutator), defaultDeadline());

        thankRevertMeasured(GiverAcceptanceInvalid.selector, h, r, g, gs, signGiverAcceptance(JUNK_PK, g));

        assertEq(mutator.poked(), 0, "staticcall blocked the SSTORE");
        assertEq(core.claims(address(usd), address(mutator)), 0, "no residual credited");
        assertEq(uint8(core.getHand(h).status), uint8(Status.Active), "hand untouched");
    }

    /// A validator that reenters core.withdraw mid-verification. The staticcall
    /// context makes the reentry revert inside the validator -> sig invalid,
    /// zero state change. The very same withdraw succeeds outside verification,
    /// proving static context (not anything else) is what blocked it.
    function test_ReentrantValidator_Blocked_NoStateChange() public {
        // Fund a genuinely withdrawable claim the attacker will target.
        uint256 h1 = makeRaise();
        settleSimple(h1); // claims[usd][charity] = 10e6

        Reentrant1271 attacker = new Reentrant1271(core, address(usd), charity);
        uint256 h2 = makeRaise();

        RouteBuild memory r = newRoute();
        addSelfHop(r, h2, E1, 10_000);
        (Give memory g, bytes memory gs) = buildGive(h2, r, address(attacker), defaultDeadline());

        uint256 coreBalBefore = usd.balanceOf(address(core));
        thankRevertMeasured(GiverAcceptanceInvalid.selector, h2, r, g, gs, signGiverAcceptance(JUNK_PK, g));

        assertEq(core.claims(address(usd), charity), 10e6, "targeted claim untouched");
        assertEq(usd.balanceOf(address(core)), coreBalBefore, "no value left escrow");
        assertEq(usd.balanceOf(charity), 0, "reentrant withdraw never executed");
        assertEq(uint8(core.getHand(h2).status), uint8(Status.Active), "verification left no trace");

        // Control: the exact call the validator attempted is live outside static context.
        core.withdraw(address(usd), charity);
        assertEq(usd.balanceOf(charity), 10e6, "same call succeeds normally");

        // And the hand remains honestly settleable after the attack.
        settle(h2, r);
        assertEq(uint8(core.getHand(h2).status), uint8(Status.Settled));
    }

    /*//////////////////////////////////////////////////////////
                strict magic, empty code, ECDSA-first
    //////////////////////////////////////////////////////////*/

    /// WrongMagic answers cleanly with 0x1626ba7d: a non-reverting response
    /// that must not validate in ANY family (_isValidSig is the one shared
    /// verifier; both a capability and a giver site are exercised).
    function test_WrongMagic_Invalid_BothFamilies() public {
        WrongMagic1271 wrong = new WrongMagic1271();

        // As root capability -> CapabilityProof.
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(wrong);
        uint256 h1 = makeRaise(p);
        RouteBuild memory r1 = newRouteFor(JUNK_PK);
        addAddrHop(r1, h1, vm.addr(E1), E1, address(0), 0, 10_000);
        (Give memory g1, bytes memory gs1) = buildGive(h1, r1, giver, defaultDeadline());
        thankRevertMeasured(CapabilityProof.selector, h1, r1, g1, gs1, signGiverAcceptance(GIVER_PK, g1));

        // As giver -> GiverAcceptanceInvalid.
        uint256 h2 = makeRaise();
        RouteBuild memory r2 = newRoute();
        addSelfHop(r2, h2, E1, 10_000);
        (Give memory g2, bytes memory gs2) = buildGive(h2, r2, address(wrong), defaultDeadline());
        thankRevertMeasured(GiverAcceptanceInvalid.selector, h2, r2, g2, gs2, signGiverAcceptance(JUNK_PK, g2));
    }

    /// Contract-style (non-ECDSA) signature bytes for a signer with NO code:
    /// ECDSA recovery fails, there is no 1271 target to ask -> invalid.
    function test_EmptyCodeSigner_ContractStyleSig_CapabilityProof() public {
        address bareCap = makeAddr("bareCapability");
        RaiseParams memory p = defaultParams();
        p.rootCapability = bareCap;
        uint256 h = makeRaise(p);

        RouteBuild memory r = newRouteFor(JUNK_PK);
        addAddrHop(r, h, vm.addr(E1), E1, address(0), 0, 10_000);
        // Wallet-flavored opaque blob: wrong length for ECDSA, meaningful only
        // to a contract validator — which this signer does not have.
        r.sigs[0] = abi.encode(keccak256("session-key-proof"), uint64(7), keccak256("attestation"));
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());

        thankRevertMeasured(CapabilityProof.selector, h, r, g, gs, signGiverAcceptance(GIVER_PK, g));
        assertEq(uint8(core.getHand(h).status), uint8(Status.Active));
    }

    /// ECDSA-first ordering: a 65-byte ECDSA signature by the wallet OWNER is
    /// perfectly recoverable — but it recovers the owner EOA, never the wallet,
    /// so the ECDSA branch cannot validate a contract signer and the verifier
    /// falls through to 1271. Both branches below traverse the contract path
    /// and the WALLET's owner check decides the outcome — proving the 1271
    /// staticcall (not ECDSA recovery) is what judged the signature.
    function test_EcdsaFirst_FallsThroughToContractPath() public {
        SmartWallet1271 wallet = new SmartWallet1271(vm.addr(OWNER_A_PK));
        assertTrue(vm.addr(OWNER_A_PK) != address(wallet), "recovered owner can never equal the wallet");

        uint256 h = makeRaise();
        RouteBuild memory r = newRoute();
        addAddrHop(r, h, address(wallet), OWNER_A_PK, address(0), 0, 10_000); // wallet is terminal
        (Give memory g, bytes memory gs) = buildGive(h, r, giver, defaultDeadline());
        bytes memory ga = signGiverAcceptance(GIVER_PK, g);

        // Control: same 65-byte ECDSA format, NON-owner key. Recovers a valid
        // EOA != wallet -> 1271 path -> wallet rejects -> CapabilityProof.
        bytes memory badGs = signGive(JUNK_PK, g);
        vm.prank(raiser);
        vm.expectRevert(CapabilityProof.selector);
        core.thank(h, r.shakes, r.sigs, r.acceptances, g, badGs, ga);

        // Owner-signed bytes (gs): identical format, accepted only because the
        // wallet's isValidSignature vouches for them.
        doThank(h, r, g, gs, ga);
        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled), "contract path validated the give");
    }

    /// Design note proven: EMPTY acceptance bytes on an explicit hop are not
    /// categorically invalid — a 1271 shaker that accepts empty signatures
    /// consents by code, and the hop settles with its margin.
    function test_EmptyAcceptance_TrivialAccepting1271Shaker_Passes() public {
        AlwaysValid1271 acceptor = new AlwaysValid1271();
        uint256 h = makeRaise();

        RouteBuild memory r = newRoute();
        // shakerSignerPk = 0 -> acceptance stays EMPTY bytes on an explicit, paid hop.
        addAddrHop(r, h, vm.addr(E1), E1, address(acceptor), 0, 9_500);
        settle(h, r);

        assertEq(uint8(core.getHand(h).status), uint8(Status.Settled), "empty acceptance validated by code");
        assertEq(core.claims(address(usd), address(acceptor)), 4_500_000, "margin credited to the contract");
        assertEq(core.claims(address(usd), giver), 85_500_000, "giver residual");
    }

    /*//////////////////// key derivation for the smart route ////////////////////*/

    function _capPk(uint256 i) internal pure returns (uint256) {
        return 0xCA9_0000 + i;
    }

    function _shkPk(uint256 i) internal pure returns (uint256) {
        return 0x54A_0000 + i;
    }
}
