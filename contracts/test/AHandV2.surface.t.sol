// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {
    AllocationKind,
    AnonymousShakerWithMargin,
    ArtifactExpired,
    BoundsViolated,
    CapabilityProof,
    CharityNotAllowed,
    ClaimBelowFloor,
    ClaimMismatch,
    ClaimMustNotGrow,
    DeadlineExceedsExpiry,
    ExpiryInPast,
    GiverAcceptanceInvalid,
    Hand,
    HandExpired,
    HandNotExpired,
    InexactDeposit,
    InsufficientGas,
    InvalidVisibilityData,
    MarginRoundsToZero,
    NoChange,
    NotActive,
    NotPendingAdmin,
    NotRaiser,
    OnlyPolicyAdmin,
    OnlySelf,
    RouteHashMismatch,
    ShakerAcceptanceInvalid,
    TagsInvalid,
    TransferInexact,
    UnexpectedAcceptance,
    UnexpectedCharityRecipient,
    WrongHand,
    ZeroAddress,
    ZeroCapability,
    ZeroCharityAllocation,
    ZeroClaim,
    ZeroGiver,
    ZeroPotTerms
} from "../src/AHandTypes.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {HookToken} from "./mocks/HookToken.sol";

/// @dev A contract account that forwards to `pushExact`: the self-only frame must
///      refuse a contract caller exactly as it refuses an EOA (I-17).
contract PushExactCaller {
    function poke(AHandCore c, address token_, address to, uint256 amount) external {
        c.pushExact(token_, to, amount);
    }
}

/*//////////////////////////////////////////////////////////////
        SUITE: surface and facts — DESIGN §3.4, §3.6, §10, §11,
        I-17, I-18, I-20, I-25, I-30, Appendix A.
        Pins the external surface (exactly the Appendix A selectors, no
        dead surface, no receive/fallback), the policyAdmin bounds, the
        facts view, the storage layout and the event vocabulary/order.
//////////////////////////////////////////////////////////////*/

contract AHandV2SurfaceTest is AHandTestBase {
    address newAdmin = makeAddr("newAdmin");
    address charityB = makeAddr("charityB");

    /*──────────────── §3.6 storage layout snapshot (forge inspect AHandCore storage-layout) ────────────────*/
    // Inherited OZ EIP712 fallback strings occupy slots 0 and 1 and stay empty ("aHand"/"3" are short strings).
    uint256 constant SLOT_NAME_FALLBACK = 0;
    uint256 constant SLOT_VERSION_FALLBACK = 1;
    uint256 constant SLOT_HANDS_COUNT = 2;
    uint256 constant SLOT_POLICY_ADMIN = 3;
    uint256 constant SLOT_PENDING_ADMIN_AND_REVISION = 4; // pendingPolicyAdmin @ offset 0 (20 B), policyRevision @ offset 20 (8 B)
    uint256 constant SLOT_HANDS = 5;
    uint256 constant SLOT_CHARITY_ALLOWED = 6;
    uint256 constant SLOT_CLAIMS = 7;
    uint256 constant HAND_SLOTS = 8;

    /*──────────────── I-18 opcode fingerprint of the frozen build (cast disassemble, metadata stripped) ────────────────*/
    uint256 constant CORE_CALL_SITES = 6;
    uint256 constant CORE_STATICCALL_SITES = 8;

    /*──────────────── Appendix A selector inventory (forge inspect AHandCore methodIdentifiers) ────────────────*/
    string[25] SURFACE = [
        "BPS_DENOMINATOR()",
        "DOMAIN_SEPARATOR()",
        "ERC1271_GAS()",
        "MAX_CHARITY_BPS()",
        "MAX_DISCOVERY_REF()",
        "MAX_PUBLIC_TAGS()",
        "PUSH_GAS()",
        "PUSH_RESERVE()",
        "acceptPolicyAdmin()",
        "charityAllowed(address)",
        "claims(address,address)",
        "eip712Domain()",
        "facts(uint256)",
        "getHand(uint256)",
        "handsCount()",
        "pendingPolicyAdmin()",
        "policyAdmin()",
        "policyRevision()",
        "pushExact(address,address,uint256)",
        "raise((address,uint256,uint40,address,uint16,uint16,address,uint8,bytes32,bytes32),bytes,bytes32[])",
        "reclaim(uint256)",
        "setCharityAllowed(address,bool)",
        "thank(uint256,((uint256,address,address,uint16,uint16,bytes32,uint40),bytes,bytes)[],((uint256,bytes32,address,bytes32,uint16,uint40),bytes,bytes))",
        "transferPolicyAdmin(address)",
        "withdraw(address,address)"
    ];

    /// Dead surface (I-30, P6) and every admin lever the design forbids (I-20, §18 #5): none may dispatch.
    string[26] DEAD = [
        "setTokenEnabled(bool)",
        "tokenEnabled()",
        "setRaiseOpen(bool)",
        "raiseOpen()",
        "pause()",
        "unpause()",
        "paused()",
        "rescue(address,address,uint256)",
        "rescueERC20(address,address,uint256)",
        "upgradeTo(address)",
        "upgradeToAndCall(address,bytes)",
        "usdScale()",
        "MAX_SHAKES()",
        "MIN_EXPIRY()",
        "MAX_EXPIRY()",
        "MIN_CHARITY_BPS()",
        "THANK_PERMIT_TYPEHASH()",
        "rewardToken()",
        "owner()",
        "transferOwnership(address)",
        "renounceOwnership()",
        "setSignals(address)",
        "signals()",
        "finalize(uint256)",
        "withdrawTo(address,address)",
        "pending(address,address)"
    ];

    /*//////////////////////////////////////////////////////////
                    1. Selector inventory (I-17, I-30, App. A)
    //////////////////////////////////////////////////////////*/

    /// Every Appendix A function exists and dispatches to a body: views answer,
    /// mutators reach their first check and revert with THEIR error (never empty data).
    function test_Surface_EveryAppendixASelectorDispatches() public {
        // constants and views: plain calls succeed
        _assertDispatches(abi.encodeCall(core.BPS_DENOMINATOR, ()));
        _assertDispatches(abi.encodeCall(core.DOMAIN_SEPARATOR, ()));
        _assertDispatches(abi.encodeCall(core.ERC1271_GAS, ()));
        _assertDispatches(abi.encodeCall(core.MAX_CHARITY_BPS, ()));
        _assertDispatches(abi.encodeCall(core.MAX_DISCOVERY_REF, ()));
        _assertDispatches(abi.encodeCall(core.MAX_PUBLIC_TAGS, ()));
        _assertDispatches(abi.encodeCall(core.PUSH_GAS, ()));
        _assertDispatches(abi.encodeCall(core.PUSH_RESERVE, ()));
        _assertDispatches(abi.encodeCall(core.charityAllowed, (charity)));
        _assertDispatches(abi.encodeCall(core.claims, (address(usd), giver)));
        _assertDispatches(abi.encodeCall(core.eip712Domain, ()));
        _assertDispatches(abi.encodeCall(core.facts, (1)));
        _assertDispatches(abi.encodeCall(core.getHand, (1)));
        _assertDispatches(abi.encodeCall(core.handsCount, ()));
        _assertDispatches(abi.encodeCall(core.pendingPolicyAdmin, ()));
        _assertDispatches(abi.encodeCall(core.policyAdmin, ()));
        _assertDispatches(abi.encodeCall(core.policyRevision, ()));

        // mutators, from a stranger: each reaches its own first check
        vm.startPrank(stranger);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();
        vm.expectRevert(OnlySelf.selector);
        core.pushExact(address(usd), stranger, 1);
        RaiseParams memory p = defaultParams();
        p.rootCapability = address(0);
        vm.expectRevert(ZeroAddress.selector);
        core.raise(p, DEFAULT_REF, noTags());
        vm.expectRevert(NotActive.selector);
        core.reclaim(1);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setCharityAllowed(stranger, true);
        Terminal memory t;
        vm.expectRevert(NotActive.selector);
        core.thank(1, new Hop[](0), t);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.transferPolicyAdmin(stranger);
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), stranger);
        vm.stopPrank();
    }

    /// The compiled ABI selectors equal the Appendix A signatures byte for byte
    /// (parameter shapes pinned: Hop[]/Terminal tuples, uint8 for Visibility).
    function test_Surface_SelectorsMatchAppendixASignatures() public view {
        assertEq(core.raise.selector, _sel(SURFACE[19]), "raise");
        assertEq(core.thank.selector, _sel(SURFACE[22]), "thank");
        assertEq(core.reclaim.selector, _sel(SURFACE[20]), "reclaim");
        assertEq(core.withdraw.selector, _sel(SURFACE[24]), "withdraw");
        assertEq(core.pushExact.selector, _sel(SURFACE[18]), "pushExact");
        assertEq(core.setCharityAllowed.selector, _sel(SURFACE[21]), "setCharityAllowed");
        assertEq(core.transferPolicyAdmin.selector, _sel(SURFACE[23]), "transferPolicyAdmin");
        assertEq(core.acceptPolicyAdmin.selector, _sel(SURFACE[8]), "acceptPolicyAdmin");
        assertEq(core.facts.selector, _sel(SURFACE[12]), "facts");
        assertEq(core.getHand.selector, _sel(SURFACE[13]), "getHand");
        assertEq(core.DOMAIN_SEPARATOR.selector, _sel(SURFACE[1]), "DOMAIN_SEPARATOR");
        assertEq(core.eip712Domain.selector, _sel(SURFACE[11]), "eip712Domain");
        assertEq(core.handsCount.selector, _sel(SURFACE[14]), "handsCount");
        assertEq(core.claims.selector, _sel(SURFACE[10]), "claims");
        assertEq(core.charityAllowed.selector, _sel(SURFACE[9]), "charityAllowed");
        assertEq(core.policyAdmin.selector, _sel(SURFACE[16]), "policyAdmin");
        assertEq(core.pendingPolicyAdmin.selector, _sel(SURFACE[15]), "pendingPolicyAdmin");
        assertEq(core.policyRevision.selector, _sel(SURFACE[17]), "policyRevision");
        assertEq(core.BPS_DENOMINATOR.selector, _sel(SURFACE[0]), "BPS_DENOMINATOR");
        assertEq(core.MAX_CHARITY_BPS.selector, _sel(SURFACE[3]), "MAX_CHARITY_BPS");
        assertEq(core.MAX_PUBLIC_TAGS.selector, _sel(SURFACE[5]), "MAX_PUBLIC_TAGS");
        assertEq(core.MAX_DISCOVERY_REF.selector, _sel(SURFACE[4]), "MAX_DISCOVERY_REF");
        assertEq(core.ERC1271_GAS.selector, _sel(SURFACE[2]), "ERC1271_GAS");
        assertEq(core.PUSH_GAS.selector, _sel(SURFACE[6]), "PUSH_GAS");
        assertEq(core.PUSH_RESERVE.selector, _sel(SURFACE[7]), "PUSH_RESERVE");
    }

    /// The dispatch table of the deployed runtime code is EXACTLY the 25 Appendix A
    /// selectors: every `PUSH4 x; EQ` comparison in the code is one of them and each
    /// of them appears. (Opcode walk, metadata stripped; a selector used only inside
    /// `abi.encodeCall`/revert data is shifted, not compared, so it is not counted.)
    function test_Surface_DispatchTableIsExactlyAppendixA() public view {
        bytes4[] memory table = _dispatchTable(address(core).code);
        assertEq(table.length, SURFACE.length, "dispatch table width");
        for (uint256 i; i < SURFACE.length; ++i) {
            assertTrue(_contains(table, _sel(SURFACE[i])), string.concat("missing from dispatch: ", SURFACE[i]));
        }
    }

    /// I-30: no dead surface, no admin lever beyond §10 — each forbidden selector
    /// fails AT DISPATCH (empty revert data: no body, no fallback) and is compared
    /// nowhere in the runtime code.
    function test_Surface_DeadSelectorsAbsent() public {
        bytes4[] memory table = _dispatchTable(address(core).code);
        for (uint256 i; i < DEAD.length; ++i) {
            bytes4 sel = _sel(DEAD[i]);
            assertFalse(_contains(table, sel), string.concat("dead selector compared in code: ", DEAD[i]));
            _assertNoDispatch(_wellFormedCall(sel), DEAD[i]);
        }
    }

    /// I-17: no `receive`, no `fallback` — plain value, empty calldata and unknown
    /// calldata all revert with no data.
    function test_Surface_NoReceiveNoFallback() public {
        vm.deal(address(this), 1 ether);
        (bool ok, bytes memory ret) = address(core).call{value: 1}("");
        assertFalse(ok, "no receive()");
        assertEq(ret.length, 0, "receive: no data");
        (ok, ret) = address(core).call("");
        assertFalse(ok, "empty calldata reverts");
        assertEq(ret.length, 0, "empty calldata: no data");
        (ok, ret) = address(core).call(hex"deadbeef");
        assertFalse(ok, "no fallback()");
        assertEq(ret.length, 0, "fallback: no data");
        (ok, ret) = address(core).call{value: 1}(abi.encodeCall(core.handsCount, ()));
        assertFalse(ok, "non-payable view rejects value");
        assertEq(address(core).balance, 0, "Core never holds ether");
    }

    /// I-17 / H8': `pushExact` is reachable from no external account — EOA, contract,
    /// the policy admin and the raiser all get `OnlySelf`, and nothing moves.
    function test_Surface_PushExact_OnlySelf() public {
        uint256 h = makeRaise();
        assertEq(usd.balanceOf(address(core)), DEPOSIT);

        vm.prank(stranger);
        vm.expectRevert(OnlySelf.selector);
        core.pushExact(address(usd), stranger, DEPOSIT);

        vm.prank(policyAdmin);
        vm.expectRevert(OnlySelf.selector);
        core.pushExact(address(usd), policyAdmin, DEPOSIT);

        vm.prank(raiser);
        vm.expectRevert(OnlySelf.selector);
        core.pushExact(address(usd), raiser, DEPOSIT);

        PushExactCaller caller = new PushExactCaller();
        vm.expectRevert(OnlySelf.selector);
        caller.poke(core, address(usd), address(caller), DEPOSIT);

        // zero amount is no loophole either
        vm.expectRevert(OnlySelf.selector);
        core.pushExact(address(usd), stranger, 0);

        assertEq(usd.balanceOf(address(core)), DEPOSIT, "custody untouched");
        assertEq(core.facts(h).pool, DEPOSIT);
    }

    /// The frame works from inside: a push under `thank` lands and emits
    /// `PayoutPushed` (no lock conflict — `pushExact` carries no nonReentrant).
    function test_Surface_PushExact_SelfCallUnderThankSucceeds() public {
        uint256 h = makeRaise();
        vm.recordLogs();
        settleSimple(h);
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        uint256 pushed;
        uint256 deferred;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == AHandCore.PayoutPushed.selector) ++pushed;
            if (logs[i].topics[0] == AHandCore.PayoutDeferred.selector) ++deferred;
        }
        assertEq(pushed, 2, "charity + giver pushed through the frame");
        assertEq(deferred, 0, "no frame failed under the lock");
        assertEq(usd.balanceOf(giver), 90e6);
        assertEq(usd.balanceOf(charity), 10e6);
    }

    /*//////////////////////////////////////////////////////////
                    2. Constants (§3.6, Appendix A)
    //////////////////////////////////////////////////////////*/

    /// The only bounds that survive (D34, ADR-0005, ADR-0007, H14) and the three
    /// PROVISIONAL gas constants (§18 #7: frozen at ADR-0015 acceptance).
    function test_Constants_MatchDesign() public view {
        assertEq(core.BPS_DENOMINATOR(), 10_000);
        assertEq(core.MAX_CHARITY_BPS(), 3_000);
        assertEq(core.MAX_PUBLIC_TAGS(), 8);
        assertEq(core.MAX_DISCOVERY_REF(), 128);
        assertEq(core.ERC1271_GAS(), 350_000);
        assertEq(core.PUSH_GAS(), 200_000);
        assertEq(core.PUSH_RESERVE(), 30_000);
        assertEq(AHandMath.BPS, core.BPS_DENOMINATOR(), "one literal");
    }

    /// §6.3: domain "aHand"/"3", ERC-5267 fields, library mirror equality (I-14).
    function test_Domain_V3_ERC5267_AndLibraryMirror() public view {
        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = core.eip712Domain();
        assertEq(fields, hex"0f", "name, version, chainId, verifyingContract");
        assertEq(name, "aHand");
        assertEq(version, "3");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(core));
        assertEq(salt, bytes32(0));
        assertEq(extensions.length, 0);

        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("aHand"),
                keccak256("3"),
                block.chainid,
                address(core)
            )
        );
        assertEq(core.DOMAIN_SEPARATOR(), expected, "domain v3");
        assertEq(domainSeparatorOf(core), expected, "AHandSig mirror");
    }

    /*//////////////////////////////////////////////////////////
                    3. Constructor (§10, I-20)
    //////////////////////////////////////////////////////////*/

    function test_Constructor_ZeroAdmin_ZeroAddress() public {
        address[] memory charities = new address[](1);
        charities[0] = charity;
        vm.expectRevert(ZeroAddress.selector);
        new AHandCore(charities, address(0));
    }

    /// S35 at the constructor: the allowlist never holds address(0) …
    function test_Constructor_ZeroCharity_ZeroAddress() public {
        address[] memory charities = new address[](2);
        charities[0] = charity;
        charities[1] = address(0);
        vm.expectRevert(ZeroAddress.selector);
        new AHandCore(charities, policyAdmin);
    }

    /// … nor the Core being deployed (its address is known at construction).
    function test_Constructor_SelfCharity_CharityNotAllowed() public {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address[] memory charities = new address[](2);
        charities[0] = charity;
        charities[1] = predicted;
        vm.expectRevert(CharityNotAllowed.selector);
        new AHandCore(charities, policyAdmin);
    }

    /// A repeated seed is a no-op change: NoChange, exactly as the setter.
    function test_Constructor_DuplicateCharity_NoChange() public {
        address[] memory charities = new address[](2);
        charities[0] = charity;
        charities[1] = charity;
        vm.expectRevert(NoChange.selector);
        new AHandCore(charities, policyAdmin);
    }

    /// Genesis events in order: Transferred(0, admin), then one CharityPolicyUpdated
    /// per seed under revision 1; state: revision 1, admin set, nothing pending.
    function test_Constructor_GenesisState_AndEventOrder() public {
        address[] memory charities = new address[](2);
        charities[0] = charity;
        charities[1] = charityB;

        vm.recordLogs();
        AHandCore c = new AHandCore(charities, policyAdmin);
        Vm.Log[] memory logs = _coreLogsOf(vm.getRecordedLogs(), address(c));

        assertEq(logs.length, 3, "Transferred + 2 seeds, nothing else");
        _assertTopics2(logs[0], AHandCore.PolicyAdminTransferred.selector, address(0), policyAdmin);
        _assertCharityPolicyUpdated(logs[1], charity, true, 1);
        _assertCharityPolicyUpdated(logs[2], charityB, true, 1);

        assertEq(c.policyAdmin(), policyAdmin);
        assertEq(c.pendingPolicyAdmin(), address(0));
        assertEq(c.policyRevision(), 1);
        assertTrue(c.charityAllowed(charity));
        assertTrue(c.charityAllowed(charityB));
        assertFalse(c.charityAllowed(address(0)));
        assertFalse(c.charityAllowed(address(c)));
        assertEq(c.handsCount(), 0);
    }

    /// An empty genesis list is legal: revision still starts at 1 (the first setter change is 2).
    function test_Constructor_EmptyAllowlist_RevisionOne() public {
        vm.recordLogs();
        AHandCore c = new AHandCore(new address[](0), policyAdmin);
        Vm.Log[] memory logs = _coreLogsOf(vm.getRecordedLogs(), address(c));
        assertEq(logs.length, 1, "only Transferred(0, admin)");
        assertEq(c.policyRevision(), 1);

        vm.prank(policyAdmin);
        vm.expectEmit(address(c));
        emit AHandCore.CharityPolicyUpdated(charity, true, 2);
        c.setCharityAllowed(charity, true);
        assertEq(c.policyRevision(), 2);
    }

    /*//////////////////////////////////////////////////////////
                    4. setCharityAllowed bounds (§10, I-20)
    //////////////////////////////////////////////////////////*/

    function test_SetCharityAllowed_OnlyPolicyAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setCharityAllowed(charityB, true);

        // a nominee has no power before accepting
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(newAdmin);
        vm.prank(newAdmin);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setCharityAllowed(charityB, true);
        assertEq(core.policyRevision(), 1, "nothing changed");
    }

    /// NoChange in both directions: allowing the allowed, disallowing the absent.
    function test_SetCharityAllowed_Duplicate_NoChange() public {
        vm.startPrank(policyAdmin);
        vm.expectRevert(NoChange.selector);
        core.setCharityAllowed(charity, true);
        vm.expectRevert(NoChange.selector);
        core.setCharityAllowed(charityB, false);
        vm.stopPrank();
        assertEq(core.policyRevision(), 1, "a reverted call bumps nothing");
        assertTrue(core.charityAllowed(charity));
        assertFalse(core.charityAllowed(charityB));
    }

    /// S35 at the setter: never address(0), never Core — both directions, revision untouched.
    function test_SetCharityAllowed_ZeroAndSelf_Rejected() public {
        vm.startPrank(policyAdmin);
        vm.expectRevert(ZeroAddress.selector);
        core.setCharityAllowed(address(0), true);
        vm.expectRevert(ZeroAddress.selector);
        core.setCharityAllowed(address(0), false);
        vm.expectRevert(CharityNotAllowed.selector);
        core.setCharityAllowed(address(core), true);
        vm.expectRevert(CharityNotAllowed.selector);
        core.setCharityAllowed(address(core), false);
        vm.stopPrank();
        assertEq(core.policyRevision(), 1);
        assertFalse(core.charityAllowed(address(0)));
        assertFalse(core.charityAllowed(address(core)));
    }

    /// Consequence for raise: a zero recipient with bps > 0 and Core as recipient are
    /// both `CharityNotAllowed` (the allowlist can never contain them).
    function test_Raise_ZeroOrSelfRecipient_CharityNotAllowed() public {
        RaiseParams memory p = defaultParams();
        p.charityRecipient = address(0);
        expectRaiseRevert(CharityNotAllowed.selector, p);
        p.charityRecipient = address(core);
        expectRaiseRevert(CharityNotAllowed.selector, p);
    }

    /// policyRevision counts REAL changes, strictly +1 each, logged with the new revision.
    function test_PolicyRevision_CountsRealChanges() public {
        assertEq(core.policyRevision(), 1, "genesis");
        vm.startPrank(policyAdmin);

        vm.expectEmit(address(core));
        emit AHandCore.CharityPolicyUpdated(charityB, true, 2);
        core.setCharityAllowed(charityB, true);
        assertEq(core.policyRevision(), 2);

        vm.expectEmit(address(core));
        emit AHandCore.CharityPolicyUpdated(charityB, false, 3);
        core.setCharityAllowed(charityB, false);
        assertEq(core.policyRevision(), 3);

        vm.expectRevert(NoChange.selector);
        core.setCharityAllowed(charityB, false);
        assertEq(core.policyRevision(), 3, "no-op: no bump");

        vm.expectEmit(address(core));
        emit AHandCore.CharityPolicyUpdated(charity, false, 4);
        core.setCharityAllowed(charity, false);
        assertEq(core.policyRevision(), 4);

        // handover changes who governs, not what the policy says
        core.transferPolicyAdmin(newAdmin);
        vm.stopPrank();
        assertEq(core.policyRevision(), 4, "nomination: no bump");
        vm.prank(newAdmin);
        core.acceptPolicyAdmin();
        assertEq(core.policyRevision(), 4, "acceptance: no bump");

        vm.prank(newAdmin);
        vm.expectEmit(address(core));
        emit AHandCore.CharityPolicyUpdated(charity, true, 5);
        core.setCharityAllowed(charity, true);
        assertEq(core.policyRevision(), 5);
    }

    /// Prospective only (H15): de-allowing blocks NEW donation Hands, never a live one;
    /// the live Hand still pays its snapshotted recipient; re-allowing re-admits.
    function test_Policy_ProspectiveOnly() public {
        uint256 live = makeRaise();
        vm.prank(policyAdmin);
        core.setCharityAllowed(charity, false);

        expectRaiseRevert(CharityNotAllowed.selector, defaultParams());
        assertEq(makeRaise(noCharityParams()), 2, "0 % Hands are never policy-gated");

        uint256 before = usd.balanceOf(charity);
        settleSimple(live);
        assertEq(usd.balanceOf(charity) - before, 10e6, "snapshot beats allowlist");
        assertEq(core.facts(live).charityRecipient, charity);

        vm.prank(policyAdmin);
        core.setCharityAllowed(charity, true);
        assertEq(makeRaise(), 3, "re-admitted");
    }

    /// `Raised.policyRevision` names the revision under which rule (4) passed: a token
    /// hook that reaches `setCharityAllowed` mid-deposit bumps the revision AFTER the
    /// snapshot was taken (§4.1, I-20).
    function test_Policy_HookMidRaise_CannotChangeRaisedRevision() public {
        HookToken hook = new HookToken();
        AHandCore c = deployCore(charity, address(hook)); // the token IS the policy admin
        fundFor(c, address(hook), raiser, 1_000e6);
        hook.setReentry(address(c), abi.encodeCall(c.setCharityAllowed, (charityB, true)), true, false, true);

        RaiseParams memory p = defaultParams();
        p.token = address(hook);
        vm.recordLogs();
        uint256 h = makeRaiseAs(raiser, c, p, DEFAULT_REF, noTags());
        Vm.Log[] memory logs = _coreLogsOf(vm.getRecordedLogs(), address(c));

        assertTrue(hook.lastReentryOk(), "the setter is not under the lock and succeeded");
        assertEq(c.policyRevision(), 2, "policy did change during the deposit");
        assertTrue(c.charityAllowed(charityB));

        // Core logs in order: CharityPolicyUpdated (inside the deposit) then Raised
        assertEq(logs.length, 2);
        _assertCharityPolicyUpdated(logs[0], charityB, true, 2);
        assertEq(logs[1].topics[0], AHandCore.Raised.selector);
        assertEq(_raisedRevision(logs[1]), 1, "Raised names the revision the check ran under");
        assertEq(c.facts(h).pool, DEPOSIT, "deposit still exact");
    }

    /*//////////////////////////////////////////////////////////
                    5. Two-step handover (§10, I-20)
    //////////////////////////////////////////////////////////*/

    function test_Handover_OnlyPolicyAdminNominates() public {
        vm.prank(stranger);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.transferPolicyAdmin(stranger);
        vm.prank(stranger);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.transferPolicyAdmin(address(0));
        assertEq(core.pendingPolicyAdmin(), address(0));
    }

    function test_Handover_FullFlow() public {
        vm.prank(policyAdmin);
        vm.expectEmit(address(core));
        emit AHandCore.PolicyAdminTransferStarted(policyAdmin, newAdmin);
        core.transferPolicyAdmin(newAdmin);
        assertEq(core.pendingPolicyAdmin(), newAdmin);
        assertEq(core.policyAdmin(), policyAdmin, "no power moves on step one");

        vm.prank(newAdmin);
        vm.expectEmit(address(core));
        emit AHandCore.PolicyAdminTransferred(policyAdmin, newAdmin);
        core.acceptPolicyAdmin();
        assertEq(core.policyAdmin(), newAdmin);
        assertEq(core.pendingPolicyAdmin(), address(0), "pending cleared");

        // the former admin is fully demoted; the new one governs and may nominate
        vm.startPrank(policyAdmin);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.setCharityAllowed(charityB, true);
        vm.expectRevert(OnlyPolicyAdmin.selector);
        core.transferPolicyAdmin(policyAdmin);
        vm.stopPrank();
        vm.startPrank(newAdmin);
        core.setCharityAllowed(charityB, true);
        core.transferPolicyAdmin(policyAdmin);
        vm.stopPrank();
        assertEq(core.pendingPolicyAdmin(), policyAdmin);
    }

    /// Nominating the current nominee is NoChange; replacing it is fine.
    function test_Handover_RepeatedNomination_NoChange_ReplaceOk() public {
        vm.startPrank(policyAdmin);
        core.transferPolicyAdmin(newAdmin);
        vm.expectRevert(NoChange.selector);
        core.transferPolicyAdmin(newAdmin);

        vm.expectEmit(address(core));
        emit AHandCore.PolicyAdminTransferStarted(policyAdmin, stranger);
        core.transferPolicyAdmin(stranger);
        vm.stopPrank();
        assertEq(core.pendingPolicyAdmin(), stranger);

        vm.prank(newAdmin);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();
    }

    /// Cancel semantics: nominating zero IS the cancel (Started(admin, 0)); a repeated
    /// cancel and a cancel with nothing pending are both NoChange.
    function test_Handover_CancelWithZero() public {
        vm.startPrank(policyAdmin);
        vm.expectRevert(NoChange.selector);
        core.transferPolicyAdmin(address(0)); // 0 → 0 with nothing pending

        core.transferPolicyAdmin(newAdmin);
        vm.expectEmit(address(core));
        emit AHandCore.PolicyAdminTransferStarted(policyAdmin, address(0));
        core.transferPolicyAdmin(address(0));
        assertEq(core.pendingPolicyAdmin(), address(0));

        vm.expectRevert(NoChange.selector);
        core.transferPolicyAdmin(address(0)); // repeated cancel
        vm.stopPrank();

        vm.prank(newAdmin);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();
        assertEq(core.policyAdmin(), policyAdmin);
    }

    /// A zero pending can never be accepted by any account: stranger, admin, former nominee.
    function test_Handover_ZeroPending_NobodyAccepts() public {
        assertEq(core.pendingPolicyAdmin(), address(0));
        vm.prank(stranger);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();
        vm.prank(policyAdmin);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();

        vm.prank(policyAdmin);
        core.transferPolicyAdmin(newAdmin);
        vm.prank(stranger);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(address(0));
        vm.prank(newAdmin);
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();

        assertEq(core.policyAdmin(), policyAdmin, "policyAdmin never zero");
    }

    /// A second acceptance is NotPendingAdmin: acceptance consumes the nomination.
    function test_Handover_AcceptTwice_NotPendingAdmin() public {
        vm.prank(policyAdmin);
        core.transferPolicyAdmin(newAdmin);
        vm.startPrank(newAdmin);
        core.acceptPolicyAdmin();
        vm.expectRevert(NotPendingAdmin.selector);
        core.acceptPolicyAdmin();
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////
                    6. facts() and getHand() (§3.4, I-25)
    //////////////////////////////////////////////////////////*/

    function test_Facts_UnraisedId_AllZero() public view {
        IAHandFacts.HandFacts memory f = core.facts(1);
        assertEq(uint8(f.status), uint8(Status.None));
        assertEq(f.raiser, address(0));
        assertEq(f.token, address(0));
        assertEq(f.pool, 0);
        assertEq(f.expiry, 0);
        assertEq(f.closedAt, 0);
        assertEq(f.rootCapability, address(0));
        assertEq(f.metadataCommitment, bytes32(0));
        assertEq(f.settlementHash, bytes32(0));
        _assertFactsEqualHand(1);
        _assertFactsEqualHand(type(uint256).max);
    }

    /// Every Raise-time fact of the default Hand, equal to the params and to getHand.
    function test_Facts_ActiveHand_CarriesEveryRaiseTimeFact() public {
        RaiseParams memory p = defaultParams();
        uint256 h = makeRaise(p);
        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Active));
        assertEq(f.raiser, raiser);
        assertEq(f.token, address(usd));
        assertEq(f.pool, DEPOSIT);
        assertEq(f.charityBps, 1_000);
        assertEq(f.charityRecipient, charity);
        assertEq(f.minGiverClaimBps, 5_000);
        assertEq(f.rootCapability, vm.addr(E0));
        assertEq(f.expiry, p.expiry);
        assertEq(f.closedAt, 0);
        assertEq(uint8(f.visibility), uint8(Visibility.Public));
        assertEq(f.metadataCommitment, p.metadataCommitment);
        assertEq(f.discoveryCommitment, p.discoveryCommitment);
        assertEq(f.settlementHash, bytes32(0));
        _assertFactsEqualHand(h);
    }

    /// Zero shapes preserved: Dark zero-pot Hand without donation.
    function test_Facts_DarkZeroPot_ZerosPreserved() public {
        RaiseParams memory p = zeroPotParams();
        p.visibility = Visibility.Dark;
        p.discoveryCommitment = bytes32(0);
        uint256 h = makeRaise(p, "", noTags());
        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Active));
        assertEq(f.token, address(0));
        assertEq(f.pool, 0);
        assertEq(f.charityBps, 0);
        assertEq(f.charityRecipient, address(0));
        assertEq(f.minGiverClaimBps, 5_000);
        assertEq(uint8(f.visibility), uint8(Visibility.Dark));
        assertEq(f.discoveryCommitment, bytes32(0));
        assertEq(f.metadataCommitment, p.metadataCommitment);
        _assertFactsEqualHand(h);
    }

    /// Terminal facts after thank: Settled, closedAt = now, settlementHash = Settled.settlementHash ≠ 0,
    /// Raise-time facts unchanged, pool never zeroed.
    function test_Facts_AfterThank_TerminalFacts() public {
        uint256 h = makeRaise();
        vm.warp(block.timestamp + 3 days);
        vm.recordLogs();
        settleSimple(h);
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        (bytes32 settledHash, uint40 settledClosedAt) = _settledTerminalFacts(logs[0]);

        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Settled));
        assertEq(f.closedAt, uint40(block.timestamp));
        assertEq(f.closedAt, settledClosedAt, "event == storage");
        assertTrue(f.settlementHash != bytes32(0));
        assertEq(f.settlementHash, settledHash, "event == storage");
        assertEq(f.pool, DEPOSIT, "pool never zeroed");
        assertEq(f.raiser, raiser);
        assertEq(f.charityRecipient, charity);
        assertEq(f.rootCapability, vm.addr(E0));
        _assertFactsEqualHand(h);
    }

    /// Terminal facts after reclaim: Reclaimed, closedAt = now, settlementHash stays zero, pool untouched.
    function test_Facts_AfterReclaim_TerminalFacts() public {
        uint256 h = makeRaise();
        warpToExpiry(h);
        vm.prank(stranger);
        core.reclaim(h);
        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Reclaimed));
        assertEq(f.closedAt, uint40(block.timestamp));
        assertEq(f.closedAt, f.expiry);
        assertEq(f.settlementHash, bytes32(0), "settlementHash != 0 iff Settled");
        assertEq(f.pool, DEPOSIT, "pool never zeroed");
        _assertFactsEqualHand(h);
    }

    /// facts() is a pure storage read: Core initiates no call of any kind while answering.
    function test_Facts_NoExternalCalls() public {
        uint256 h = makeRaise();
        vm.startStateDiffRecording();
        core.facts(h);
        core.getHand(h);
        VmSafe.AccountAccess[] memory acc = vm.stopAndReturnStateDiff();
        for (uint256 i; i < acc.length; ++i) {
            assertTrue(acc[i].accessor != address(core), "Core must initiate nothing inside a facts read");
        }
    }

    /// I-25 over the whole Raise-time parameter space (bounded to valid inputs).
    function testFuzz_Facts_EqualRaiseParams(
        uint256 amount,
        uint16 charityBps,
        uint16 minGiverClaimBps,
        uint40 expiryDelta,
        address root,
        bytes32 meta,
        bytes32 discovery,
        bool preview
    ) public {
        amount = bound(amount, 10_000, 1e30); // cut(amount, bps) ≥ 1 for every bps ≥ 1
        charityBps = uint16(bound(charityBps, 1, 3_000));
        minGiverClaimBps = uint16(bound(minGiverClaimBps, 1, 10_000));
        expiryDelta = uint40(bound(expiryDelta, 1, 3650 days));
        vm.assume(root != address(0));
        vm.assume(meta != bytes32(0) && discovery != bytes32(0));
        fund(address(usd), raiser, amount);

        RaiseParams memory p = RaiseParams({
            token: address(usd),
            amount: amount,
            expiry: uint40(block.timestamp) + expiryDelta,
            charityRecipient: charity,
            charityBps: charityBps,
            minGiverClaimBps: minGiverClaimBps,
            rootCapability: root,
            visibility: preview ? Visibility.Preview : Visibility.Public,
            metadataCommitment: meta,
            discoveryCommitment: discovery
        });
        uint256 h = makeRaise(p);

        IAHandFacts.HandFacts memory f = core.facts(h);
        assertEq(uint8(f.status), uint8(Status.Active));
        assertEq(f.raiser, raiser);
        assertEq(f.token, p.token);
        assertEq(f.pool, p.amount);
        assertEq(f.charityBps, p.charityBps);
        assertEq(f.charityRecipient, p.charityRecipient);
        assertEq(f.minGiverClaimBps, p.minGiverClaimBps);
        assertEq(f.rootCapability, p.rootCapability);
        assertEq(f.expiry, p.expiry);
        assertEq(f.closedAt, 0);
        assertEq(uint8(f.visibility), uint8(p.visibility));
        assertEq(f.metadataCommitment, p.metadataCommitment);
        assertEq(f.discoveryCommitment, p.discoveryCommitment);
        assertEq(f.settlementHash, bytes32(0));
        _assertFactsEqualHand(h);
    }

    /*//////////////////////////////////////////////////////////
                    7. Storage layout (§3.6, I-18)
    //////////////////////////////////////////////////////////*/

    /// Top-level slots: OZ fallbacks empty at 0/1; counter 2; admin 3; pending+revision packed in 4.
    function test_Layout_TopLevelSlots() public {
        assertEq(vm.load(address(core), bytes32(SLOT_NAME_FALLBACK)), bytes32(0), "_nameFallback unused");
        assertEq(vm.load(address(core), bytes32(SLOT_VERSION_FALLBACK)), bytes32(0), "_versionFallback unused");
        assertEq(_word(SLOT_HANDS_COUNT), 0);
        assertEq(_word(SLOT_POLICY_ADMIN), uint256(uint160(policyAdmin)));
        assertEq(_word(SLOT_PENDING_ADMIN_AND_REVISION), uint256(1) << 160, "pending 0, revision 1");

        makeRaise();
        makeRaise(noCharityParams());
        assertEq(_word(SLOT_HANDS_COUNT), 2);
        assertEq(core.handsCount(), 2);

        vm.startPrank(policyAdmin);
        core.setCharityAllowed(charityB, true); // revision 2
        core.transferPolicyAdmin(newAdmin);
        vm.stopPrank();
        assertEq(
            _word(SLOT_PENDING_ADMIN_AND_REVISION),
            uint256(uint160(newAdmin)) | (uint256(2) << 160),
            "pendingPolicyAdmin @0, policyRevision @20"
        );

        vm.prank(newAdmin);
        core.acceptPolicyAdmin();
        assertEq(_word(SLOT_POLICY_ADMIN), uint256(uint160(newAdmin)));
        assertEq(_word(SLOT_PENDING_ADMIN_AND_REVISION), uint256(2) << 160, "pending cleared, revision kept");
    }

    /// `_hands[id]` at keccak(id, 5): 8 slots, packed exactly as §3.4 — and nothing beyond.
    function test_Layout_HandSlots_Active() public {
        RaiseParams memory p = defaultParams();
        uint256 h = makeRaise(p);
        uint256 base = _handBase(h);

        uint256 slot0 = uint256(uint160(raiser)) | (uint256(p.expiry) << 160) | (uint256(0) << 200)
            | (uint256(uint8(Visibility.Public)) << 240) | (uint256(uint8(Status.Active)) << 248);
        assertEq(_word(base), slot0, "slot 0: raiser | expiry | closedAt | visibility | status");
        uint256 slot1 = uint256(uint160(address(usd))) | (uint256(1_000) << 160) | (uint256(5_000) << 176);
        assertEq(_word(base + 1), slot1, "slot 1: token | charityBps | minGiverClaimBps (64 idle bits)");
        assertEq(_word(base + 2), DEPOSIT, "slot 2: pool");
        assertEq(_word(base + 3), uint256(uint160(charity)), "slot 3: charityRecipient");
        assertEq(_word(base + 4), uint256(uint160(vm.addr(E0))), "slot 4: rootCapability");
        assertEq(bytes32(_word(base + 5)), p.metadataCommitment, "slot 5: metadataCommitment");
        assertEq(bytes32(_word(base + 6)), p.discoveryCommitment, "slot 6: discoveryCommitment");
        assertEq(_word(base + 7), 0, "slot 7: settlementHash zero while Active");
        assertEq(_word(base + HAND_SLOTS), 0, "the struct ends at 8 slots");
        assertEq(_word(base - 1), 0, "nothing before the struct");
    }

    /// Zero fields are skipped, so a Dark zero-pot 0 % Hand leaves slots 2, 3 and 6 untouched; slot 1 is always written.
    function test_Layout_HandSlots_DarkZeroPot() public {
        RaiseParams memory p = zeroPotParams();
        p.visibility = Visibility.Dark;
        p.discoveryCommitment = bytes32(0);
        uint256 h = makeRaise(p, "", noTags());
        uint256 base = _handBase(h);
        uint256 slot0 = uint256(uint160(raiser)) | (uint256(p.expiry) << 160) | (uint256(uint8(Visibility.Dark)) << 240)
            | (uint256(uint8(Status.Active)) << 248);
        assertEq(_word(base), slot0);
        assertEq(_word(base + 1), uint256(5_000) << 176, "slot 1 written: minGiverClaimBps >= 1");
        assertEq(_word(base + 2), 0, "pool slot untouched");
        assertEq(_word(base + 3), 0, "charityRecipient slot untouched");
        assertEq(_word(base + 4), uint256(uint160(vm.addr(E0))));
        assertEq(bytes32(_word(base + 5)), p.metadataCommitment);
        assertEq(_word(base + 6), 0, "discoveryCommitment slot untouched");
        assertEq(_word(base + 7), 0);
    }

    /// Terminal writes land in slot 0 (status + closedAt) and slot 7 (settlementHash); nothing else moves.
    function test_Layout_HandSlots_Terminal() public {
        RaiseParams memory p = defaultParams();
        uint256 h1 = makeRaise(p);
        uint256 h2 = makeRaise(p);
        uint256 b1 = _handBase(h1);
        uint256 b2 = _handBase(h2);
        uint256[8] memory before1;
        uint256[8] memory before2;
        for (uint256 i; i < 8; ++i) {
            before1[i] = _word(b1 + i);
            before2[i] = _word(b2 + i);
        }

        vm.warp(block.timestamp + 1 days);
        settleSimple(h1);
        uint40 now1 = uint40(block.timestamp);
        uint256 slot0 = uint256(uint160(raiser)) | (uint256(p.expiry) << 160) | (uint256(now1) << 200)
            | (uint256(uint8(Visibility.Public)) << 240) | (uint256(uint8(Status.Settled)) << 248);
        assertEq(_word(b1), slot0, "Settled + closedAt in the status word");
        assertEq(bytes32(_word(b1 + 7)), core.facts(h1).settlementHash, "settlementHash slot");
        assertTrue(_word(b1 + 7) != 0);
        for (uint256 i = 1; i < 7; ++i) {
            assertEq(_word(b1 + i), before1[i], "slots 1..6 untouched by thank");
        }

        warpToExpiry(h2);
        core.reclaim(h2);
        slot0 = uint256(uint160(raiser)) | (uint256(p.expiry) << 160) | (uint256(p.expiry) << 200)
            | (uint256(uint8(Visibility.Public)) << 240) | (uint256(uint8(Status.Reclaimed)) << 248);
        assertEq(_word(b2), slot0, "Reclaimed + closedAt in the status word");
        for (uint256 i = 1; i < 8; ++i) {
            assertEq(_word(b2 + i), before2[i], "slots 1..7 untouched by reclaim");
        }
    }

    /// `raise` writes the counter and then each of its seven Hand slots exactly once, in
    /// layout order: the packed words' calldata fields are bound before the stores, so no
    /// validator branch splits a word into two SSTOREs. `thank` writes two: the status
    /// word and `settlementHash`.
    function test_Layout_WritesPerSlot_RaiseOnceThankTwo() public {
        vm.record();
        uint256 h = makeRaise();
        (, bytes32[] memory writes) = vm.accesses(address(core));
        assertEq(writes.length, 8, "counter + seven Hand slots (settlementHash is thank's)");
        assertEq(uint256(writes[0]), SLOT_HANDS_COUNT);
        uint256 base = _handBase(h);
        for (uint256 i; i < 7; ++i) {
            assertEq(uint256(writes[1 + i]), base + i, "one write per slot, in layout order");
        }

        vm.record();
        settleSimple(h);
        (, writes) = vm.accesses(address(core));
        assertEq(writes.length, 2, "status word + settlementHash");
        assertEq(uint256(writes[0]), base);
        assertEq(uint256(writes[1]), base + 7);
    }

    /// `charityAllowed` at keccak(charity, 6); `claims` at keccak(beneficiary, keccak(token, 7)).
    function test_Layout_Mappings() public {
        assertEq(_word(uint256(keccak256(abi.encode(charity, SLOT_CHARITY_ALLOWED)))), 1, "charityAllowed[charity]");
        assertEq(_word(uint256(keccak256(abi.encode(stranger, SLOT_CHARITY_ALLOWED)))), 0);
        vm.prank(policyAdmin);
        core.setCharityAllowed(charity, false);
        assertEq(_word(uint256(keccak256(abi.encode(charity, SLOT_CHARITY_ALLOWED)))), 0);

        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h = makeRaise(noCharityParams());
        bl.setBlocked(giver, true);
        settleSimple(h); // the giver's 100e6 parks
        uint256 claimSlot = uint256(keccak256(abi.encode(giver, keccak256(abi.encode(address(bl), SLOT_CLAIMS)))));
        assertEq(_word(claimSlot), DEPOSIT, "claims[token][beneficiary]");
        assertEq(core.claims(address(bl), giver), DEPOSIT);
        assertEq(
            _word(uint256(keccak256(abi.encode(address(bl), keccak256(abi.encode(giver, SLOT_CLAIMS)))))),
            0,
            "key order is token then beneficiary"
        );
    }

    /*//////////////////////////////////////////////////////////
                    8. Event shapes (§11) — signatures pin the ABI
    //////////////////////////////////////////////////////////*/

    function test_Events_SignaturesMatchDesign() public pure {
        assertEq(
            AHandCore.Raised.selector,
            keccak256(
                "Raised(uint256,address,address,uint256,uint40,address,uint8,bytes32,bytes32,bytes,uint16,address,uint16,uint64)"
            )
        );
        assertEq(AHandCore.HandTagged.selector, keccak256("HandTagged(uint256,address,bytes32[])"));
        assertEq(
            AHandCore.Settled.selector,
            keccak256(
                "Settled(uint256,address,address,uint256,address,uint256,uint256,uint256,bytes32,bytes32,bytes32,bytes32,uint256,uint40)"
            )
        );
        assertEq(
            AHandCore.RouteHopSettled.selector,
            keccak256(
                "RouteHopSettled(uint256,bytes32,uint256,address,address,uint16,uint16,address,bytes32,bytes32,uint256)"
            )
        );
        assertEq(AHandCore.Reclaimed.selector, keccak256("Reclaimed(uint256,address,address,uint256)"));
        assertEq(
            AHandCore.PayoutAllocated.selector,
            keccak256("PayoutAllocated(uint256,address,address,uint8,uint256,uint256)")
        );
        assertEq(
            AHandCore.PayoutPushed.selector, keccak256("PayoutPushed(uint256,address,address,uint8,uint256,uint256)")
        );
        assertEq(
            AHandCore.PayoutDeferred.selector,
            keccak256("PayoutDeferred(uint256,address,address,uint8,uint256,uint256)")
        );
        assertEq(AHandCore.PayoutWithdrawn.selector, keccak256("PayoutWithdrawn(address,address,uint256)"));
        assertEq(AHandCore.CharityPolicyUpdated.selector, keccak256("CharityPolicyUpdated(address,bool,uint64)"));
        assertEq(
            AHandCore.PolicyAdminTransferStarted.selector, keccak256("PolicyAdminTransferStarted(address,address)")
        );
        assertEq(AHandCore.PolicyAdminTransferred.selector, keccak256("PolicyAdminTransferred(address,address)"));
    }

    /// Appendix A error list: names AND argument shapes (hop-indexed errors carry one uint256).
    function test_Errors_SignaturesMatchDesign() public pure {
        assertEq(ZeroAddress.selector, bytes4(keccak256("ZeroAddress()")));
        assertEq(ZeroPotTerms.selector, bytes4(keccak256("ZeroPotTerms()")));
        assertEq(BoundsViolated.selector, bytes4(keccak256("BoundsViolated()")));
        assertEq(UnexpectedCharityRecipient.selector, bytes4(keccak256("UnexpectedCharityRecipient()")));
        assertEq(CharityNotAllowed.selector, bytes4(keccak256("CharityNotAllowed()")));
        assertEq(ZeroCharityAllocation.selector, bytes4(keccak256("ZeroCharityAllocation()")));
        assertEq(ExpiryInPast.selector, bytes4(keccak256("ExpiryInPast()")));
        assertEq(InvalidVisibilityData.selector, bytes4(keccak256("InvalidVisibilityData()")));
        assertEq(TagsInvalid.selector, bytes4(keccak256("TagsInvalid()")));
        assertEq(InexactDeposit.selector, bytes4(keccak256("InexactDeposit()")));
        assertEq(NotActive.selector, bytes4(keccak256("NotActive()")));
        assertEq(HandExpired.selector, bytes4(keccak256("HandExpired()")));
        assertEq(HandNotExpired.selector, bytes4(keccak256("HandNotExpired()")));
        assertEq(NotRaiser.selector, bytes4(keccak256("NotRaiser()")));
        assertEq(WrongHand.selector, bytes4(keccak256("WrongHand(uint256)")));
        assertEq(ZeroCapability.selector, bytes4(keccak256("ZeroCapability(uint256)")));
        assertEq(CapabilityProof.selector, bytes4(keccak256("CapabilityProof(uint256)")));
        assertEq(ClaimMismatch.selector, bytes4(keccak256("ClaimMismatch(uint256)")));
        assertEq(ClaimMustNotGrow.selector, bytes4(keccak256("ClaimMustNotGrow(uint256)")));
        assertEq(ClaimBelowFloor.selector, bytes4(keccak256("ClaimBelowFloor(uint256)")));
        assertEq(ArtifactExpired.selector, bytes4(keccak256("ArtifactExpired(uint256)")));
        assertEq(DeadlineExceedsExpiry.selector, bytes4(keccak256("DeadlineExceedsExpiry(uint256)")));
        assertEq(AnonymousShakerWithMargin.selector, bytes4(keccak256("AnonymousShakerWithMargin(uint256)")));
        assertEq(MarginRoundsToZero.selector, bytes4(keccak256("MarginRoundsToZero(uint256)")));
        assertEq(ShakerAcceptanceInvalid.selector, bytes4(keccak256("ShakerAcceptanceInvalid(uint256)")));
        assertEq(UnexpectedAcceptance.selector, bytes4(keccak256("UnexpectedAcceptance(uint256)")));
        assertEq(RouteHashMismatch.selector, bytes4(keccak256("RouteHashMismatch()")));
        assertEq(ZeroGiver.selector, bytes4(keccak256("ZeroGiver()")));
        assertEq(GiverAcceptanceInvalid.selector, bytes4(keccak256("GiverAcceptanceInvalid()")));
        assertEq(InsufficientGas.selector, bytes4(keccak256("InsufficientGas()")));
        assertEq(TransferInexact.selector, bytes4(keccak256("TransferInexact()")));
        assertEq(OnlySelf.selector, bytes4(keccak256("OnlySelf()")));
        assertEq(ZeroClaim.selector, bytes4(keccak256("ZeroClaim()")));
        assertEq(OnlyPolicyAdmin.selector, bytes4(keccak256("OnlyPolicyAdmin()")));
        assertEq(NotPendingAdmin.selector, bytes4(keccak256("NotPendingAdmin()")));
        assertEq(NoChange.selector, bytes4(keccak256("NoChange()")));
    }

    /*//////////////////////////////////////////////////////////
                    9. Event order per transaction (§11)
    //////////////////////////////////////////////////////////*/

    /// raise: exactly `Raised` (+ `HandTagged` iff tags), with the full snapshot and the policy revision.
    function test_Events_Raise_RaisedThenHandTagged() public {
        RaiseParams memory p = defaultParams();
        bytes32[] memory tags = tags2(bytes32(uint256(7)), bytes32(uint256(9)));

        vm.recordLogs();
        uint256 h = makeRaise(p, DEFAULT_REF, tags);
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 2, "Raised + HandTagged");

        Vm.Log memory r = logs[0];
        assertEq(r.topics.length, 4);
        assertEq(r.topics[0], AHandCore.Raised.selector);
        assertEq(r.topics[1], bytes32(h));
        assertEq(r.topics[2], _addr(raiser));
        assertEq(r.topics[3], _addr(address(usd)));
        assertEq(
            r.data,
            abi.encode(
                DEPOSIT,
                p.expiry,
                vm.addr(E0),
                uint8(Visibility.Public),
                p.metadataCommitment,
                p.discoveryCommitment,
                DEFAULT_REF,
                uint16(5_000),
                charity,
                uint16(1_000),
                uint64(1)
            ),
            "Raised data: pool, expiry, root, visibility, meta, discovery, ref, floor, recipient, bps, revision"
        );

        Vm.Log memory tg = logs[1];
        assertEq(tg.topics.length, 3);
        assertEq(tg.topics[0], AHandCore.HandTagged.selector);
        assertEq(tg.topics[1], bytes32(h));
        assertEq(tg.topics[2], _addr(raiser));
        assertEq(tg.data, abi.encode(tags));
    }

    function test_Events_Raise_NoTags_NoHandTagged() public {
        vm.recordLogs();
        makeRaise();
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 1, "only Raised");
        assertEq(logs[0].topics[0], AHandCore.Raised.selector);
    }

    /// A zero-pot raise makes NO token call: the transaction's only log is `Raised` (I-5, I-21).
    function test_Events_Raise_ZeroPot_OnlyRaised_NoTokenLogs() public {
        vm.recordLogs();
        uint256 h = makeRaise(zeroPotParams());
        Vm.Log[] memory all = vm.getRecordedLogs();
        assertEq(all.length, 1, "no Transfer, no Approval, nothing but Raised");
        assertEq(all[0].emitter, address(core));
        assertEq(all[0].topics[0], AHandCore.Raised.selector);
        assertEq(all[0].topics[3], bytes32(0), "token topic zero");
        assertEq(core.facts(h).pool, 0);
    }

    /// thank: Settled → RouteHopSettled × n (positions 0..n−1, incl. the anonymous hop) →
    /// PayoutAllocated per non-zero allocation (Charity, ShakerMargin in route order, GiverResidual)
    /// → exactly one Pushed per Allocated, same (beneficiary, kind, position, amount), same order.
    function test_Events_Thank_OrderAndPairing_AllPushed() public {
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000); // margin 1 000
        addAnonymousHop(r, E2, 9_000); // zero margin, no allocation, still a hop event
        addExplicitHop(r, E3, shakerB, SHAKER_B_PK, 8_500); // margin 500
        uint16[] memory margins = new uint16[](3);
        margins[0] = 1_000;
        margins[2] = 500;
        (uint256 C, uint256 D, uint256[] memory A, uint256 G) = expectedSplit(h, margins);

        vm.recordLogs();
        Terminal memory t = settle(r);
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 1 + 3 + 4 + 4, "Settled, 3 hops, 4 allocations, 4 pushes");

        // Settled
        _assertSettledLog(logs[0], h, r, t, C, D, G);

        // RouteHopSettled × 3, route order, self-contained
        bytes32 routeHash = routeHashOf(r);
        address parent = vm.addr(E0);
        for (uint256 i; i < 3; ++i) {
            _assertHopLog(logs[1 + i], h, routeHash, i, parent, r.hops[i].shake, A[i]);
            parent = r.hops[i].shake.childCapability;
        }

        // PayoutAllocated × 4 then PayoutPushed × 4, pairwise identical
        _assertPayout(logs[4], AHandCore.PayoutAllocated.selector, h, charity, AllocationKind.Charity, 0, C);
        _assertPayout(logs[5], AHandCore.PayoutAllocated.selector, h, shakerA, AllocationKind.ShakerMargin, 0, A[0]);
        _assertPayout(logs[6], AHandCore.PayoutAllocated.selector, h, shakerB, AllocationKind.ShakerMargin, 2, A[2]);
        _assertPayout(logs[7], AHandCore.PayoutAllocated.selector, h, giver, AllocationKind.GiverResidual, 0, G);
        _assertPayout(logs[8], AHandCore.PayoutPushed.selector, h, charity, AllocationKind.Charity, 0, C);
        _assertPayout(logs[9], AHandCore.PayoutPushed.selector, h, shakerA, AllocationKind.ShakerMargin, 0, A[0]);
        _assertPayout(logs[10], AHandCore.PayoutPushed.selector, h, shakerB, AllocationKind.ShakerMargin, 2, A[2]);
        _assertPayout(logs[11], AHandCore.PayoutPushed.selector, h, giver, AllocationKind.GiverResidual, 0, G);
        assertEq(C + A[0] + A[2] + G, DEPOSIT, "sum of PayoutAllocated == pool");
    }

    /// Pairing under a failed frame: the deferred share takes the SAME slot in the
    /// Pushed|Deferred sequence, with the same (kind, position); nothing else changes.
    function test_Events_Thank_DeferredKeepsPairingSlot() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        addExplicitHop(r, E2, shakerB, SHAKER_B_PK, 8_500);
        uint16[] memory margins = new uint16[](2);
        margins[0] = 1_000;
        margins[1] = 500;
        (uint256 C,, uint256[] memory A, uint256 G) = expectedSplit(h, margins);
        bl.setBlocked(shakerA, true);

        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 1 + 2 + 4 + 4);
        _assertPayout(logs[3], AHandCore.PayoutAllocated.selector, h, charity, AllocationKind.Charity, 0, C);
        _assertPayout(logs[4], AHandCore.PayoutAllocated.selector, h, shakerA, AllocationKind.ShakerMargin, 0, A[0]);
        _assertPayout(logs[5], AHandCore.PayoutAllocated.selector, h, shakerB, AllocationKind.ShakerMargin, 1, A[1]);
        _assertPayout(logs[6], AHandCore.PayoutAllocated.selector, h, giver, AllocationKind.GiverResidual, 0, G);
        _assertPayout(logs[7], AHandCore.PayoutPushed.selector, h, charity, AllocationKind.Charity, 0, C);
        _assertPayout(logs[8], AHandCore.PayoutDeferred.selector, h, shakerA, AllocationKind.ShakerMargin, 0, A[0]);
        _assertPayout(logs[9], AHandCore.PayoutPushed.selector, h, shakerB, AllocationKind.ShakerMargin, 1, A[1]);
        _assertPayout(logs[10], AHandCore.PayoutPushed.selector, h, giver, AllocationKind.GiverResidual, 0, G);
        assertEq(core.claims(address(bl), shakerA), A[0], "exactly its own share parked");
        assertEq(bl.balanceOf(shakerB), A[1]);
        assertEq(bl.balanceOf(giver), G);
    }

    /// Zero-shake route on a 0 % Hand: Settled, no hop events, one GiverResidual allocation + push.
    function test_Events_Thank_ZeroShake_NoCharity() public {
        uint256 h = makeRaise(noCharityParams());
        RouteBuild memory r = newRoute(h);
        vm.recordLogs();
        settle(r);
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 3, "Settled, Allocated, Pushed");
        assertEq(logs[0].topics[0], AHandCore.Settled.selector);
        _assertPayout(logs[1], AHandCore.PayoutAllocated.selector, h, giver, AllocationKind.GiverResidual, 0, DEPOSIT);
        _assertPayout(logs[2], AHandCore.PayoutPushed.selector, h, giver, AllocationKind.GiverResidual, 0, DEPOSIT);
    }

    /// Zero-pot thank: `Settled` with zero amounts, hop events, no payout events, no token logs at all.
    function test_Events_Thank_ZeroPot_SettledOnly() public {
        uint256 h = makeRaise(zeroPotParams());
        RouteBuild memory r = newRoute(h);
        addSelfHop(r, E1, 9_000); // attribution without money
        vm.recordLogs();
        settle(r);
        Vm.Log[] memory all = vm.getRecordedLogs();
        assertEq(all.length, 2, "Settled + one hop; nothing else in the whole tx");
        assertEq(all[0].topics[0], AHandCore.Settled.selector);
        assertEq(all[1].topics[0], AHandCore.RouteHopSettled.selector);
        assertTrue(core.facts(h).settlementHash != bytes32(0));
    }

    /// reclaim: Reclaimed → PayoutAllocated(RaiserRefund, 0, P) → PayoutPushed; zero-pot: Reclaimed alone.
    function test_Events_Reclaim_OrderAndShape() public {
        uint256 h = makeRaise();
        warpToExpiry(h);
        vm.recordLogs();
        vm.prank(stranger);
        core.reclaim(h);
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 3);
        Vm.Log memory rc = logs[0];
        assertEq(rc.topics.length, 3);
        assertEq(rc.topics[0], AHandCore.Reclaimed.selector);
        assertEq(rc.topics[1], bytes32(h));
        assertEq(rc.topics[2], _addr(raiser));
        assertEq(rc.data, abi.encode(address(usd), DEPOSIT));
        _assertPayout(logs[1], AHandCore.PayoutAllocated.selector, h, raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        _assertPayout(logs[2], AHandCore.PayoutPushed.selector, h, raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);

        uint256 z = makeRaise(zeroPotParams());
        warpToExpiry(z);
        vm.recordLogs();
        core.reclaim(z);
        Vm.Log[] memory all = vm.getRecordedLogs();
        assertEq(all.length, 1, "zero pot: Reclaimed alone, no token call");
        assertEq(all[0].topics[0], AHandCore.Reclaimed.selector);
        assertEq(all[0].data, abi.encode(address(0), uint256(0)));
    }

    /// reclaim with a blocked raiser: the refund parks — Deferred in the Pushed slot — then
    /// withdraw emits exactly one `PayoutWithdrawn(token, beneficiary, amount)` (no Hand link).
    function test_Events_Reclaim_Deferred_ThenWithdraw() public {
        BlacklistToken bl = new BlacklistToken();
        useToken(address(bl));
        fund(address(bl), raiser, 1_000e6);
        uint256 h = makeRaise();
        bl.setBlocked(raiser, true);
        warpToExpiry(h);

        vm.recordLogs();
        core.reclaim(h);
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 3);
        _assertPayout(logs[1], AHandCore.PayoutAllocated.selector, h, raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        _assertPayout(logs[2], AHandCore.PayoutDeferred.selector, h, raiser, AllocationKind.RaiserRefund, 0, DEPOSIT);
        assertEq(core.claims(address(bl), raiser), DEPOSIT);

        bl.setBlocked(raiser, false);
        uint256 before = bl.balanceOf(raiser);
        vm.recordLogs();
        vm.prank(stranger);
        core.withdraw(address(bl), raiser);
        logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 1, "exactly one PayoutWithdrawn");
        assertEq(logs[0].topics.length, 3);
        assertEq(logs[0].topics[0], AHandCore.PayoutWithdrawn.selector);
        assertEq(logs[0].topics[1], _addr(address(bl)));
        assertEq(logs[0].topics[2], _addr(raiser));
        assertEq(logs[0].data, abi.encode(DEPOSIT));
        assertEq(bl.balanceOf(raiser) - before, DEPOSIT);
        assertEq(core.claims(address(bl), raiser), 0);
    }

    /// Policy events: CharityPolicyUpdated(charity idx; allowed, revision), Started/Transferred(prev idx, new idx).
    function test_Events_Policy_Shapes() public {
        vm.recordLogs();
        vm.startPrank(policyAdmin);
        core.setCharityAllowed(charityB, true);
        core.transferPolicyAdmin(newAdmin);
        core.transferPolicyAdmin(address(0));
        core.transferPolicyAdmin(newAdmin);
        vm.stopPrank();
        vm.prank(newAdmin);
        core.acceptPolicyAdmin();
        Vm.Log[] memory logs = _coreLogs(vm.getRecordedLogs());
        assertEq(logs.length, 5);
        _assertCharityPolicyUpdated(logs[0], charityB, true, 2);
        _assertTopics2(logs[1], AHandCore.PolicyAdminTransferStarted.selector, policyAdmin, newAdmin);
        _assertTopics2(logs[2], AHandCore.PolicyAdminTransferStarted.selector, policyAdmin, address(0));
        _assertTopics2(logs[3], AHandCore.PolicyAdminTransferStarted.selector, policyAdmin, newAdmin);
        _assertTopics2(logs[4], AHandCore.PolicyAdminTransferred.selector, policyAdmin, newAdmin);
        for (uint256 i = 1; i < 5; ++i) {
            assertEq(logs[i].data.length, 0, "admin events carry no data");
        }
    }

    /*//////////////////////////////////////////////////////////
                    10. H2' at runtime (I-18): Core's callees under thank
    //////////////////////////////////////////////////////////*/

    /// During a thank with a contract giver, every call Core initiates targets the Hand's
    /// token, a signer (ERC-1271 staticcall) or Core itself (the frame); no delegatecall,
    /// no create, no selfdestruct; Core stores no callee.
    function test_H2_CoreCallsOnlyTokenSignersAndSelf() public {
        SmartWallet1271 wallet = newSmartWallet(GIVER_PK);
        uint256 h = makeRaise();
        RouteBuild memory r = newRoute(h);
        addExplicitHop(r, E1, shakerA, SHAKER_A_PK, 9_000);
        Terminal memory t = buildTerminal(r, address(wallet), GIVER_PK, DEFAULT_SOLUTION, defaultDeadline());

        vm.startStateDiffRecording();
        doThank(r, t);
        VmSafe.AccountAccess[] memory acc = vm.stopAndReturnStateDiff();

        bool sawToken;
        bool sawSelf;
        bool sawSigner;
        for (uint256 i; i < acc.length; ++i) {
            if (acc[i].accessor != address(core)) continue;
            VmSafe.AccountAccessKind k = acc[i].kind;
            assertTrue(
                k != VmSafe.AccountAccessKind.DelegateCall && k != VmSafe.AccountAccessKind.CallCode
                    && k != VmSafe.AccountAccessKind.Create && k != VmSafe.AccountAccessKind.SelfDestruct,
                "Core never delegatecalls, creates or self-destructs"
            );
            if (k != VmSafe.AccountAccessKind.Call && k != VmSafe.AccountAccessKind.StaticCall) continue;
            address a = acc[i].account;
            if (a == address(usd)) sawToken = true;
            else if (a == address(core)) sawSelf = true;
            else if (a == address(wallet)) sawSigner = true;
            else if (a == address(1)) continue; // ecrecover precompile: the EVM, not a callee
            else fail(string.concat("unexpected callee: ", vm.toString(a)));
        }
        assertTrue(sawToken, "token called");
        assertTrue(sawSelf, "frame called");
        assertTrue(sawSigner, "signer staticcalled");
        assertEq(uint8(core.facts(h).status), uint8(Status.Settled));
    }

    /*//////////////////////////////////////////////////////////
                11. H2' statically (I-18): the opcode inventory of the runtime
    //////////////////////////////////////////////////////////*/

    /// Every path, not one thank: Core's runtime holds no DELEGATECALL, CALLCODE, CREATE,
    /// CREATE2 or SELFDESTRUCT, and exactly the CALL / STATICCALL sites of the call-graph
    /// inventory (token `transfer`/`transferFrom` and the self frame; token `balanceOf`,
    /// `ecrecover` and signer `isValidSignature`). via-IR duplicates the SafeERC20 and
    /// `balanceOf` bodies per caller, so the counts are a fingerprint of the frozen build
    /// (solc 0.8.35, via-IR, 200 runs): a changed count is a new or moved call site and
    /// the inventory is re-done before it is accepted.
    function test_I18_RuntimeOpcodes_NoForbiddenCalls_CallSitesPinned() public view {
        bytes memory code = address(core).code;
        assertEq(opcodeCount(code, 0xf4), 0, "DELEGATECALL");
        assertEq(opcodeCount(code, 0xf2), 0, "CALLCODE");
        assertEq(opcodeCount(code, 0xf0), 0, "CREATE");
        assertEq(opcodeCount(code, 0xf5), 0, "CREATE2");
        assertEq(opcodeCount(code, 0xff), 0, "SELFDESTRUCT");
        assertEq(opcodeCount(code, 0xf1), CORE_CALL_SITES, "CALL sites");
        assertEq(opcodeCount(code, 0xfa), CORE_STATICCALL_SITES, "STATICCALL sites");
    }

    /*//////////////////////////////////////////////////////////
                                helpers
    //////////////////////////////////////////////////////////*/

    function _sel(string memory sig) internal pure returns (bytes4) {
        return bytes4(keccak256(bytes(sig)));
    }

    function _addr(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _word(uint256 slot) internal view returns (uint256) {
        return uint256(vm.load(address(core), bytes32(slot)));
    }

    function _handBase(uint256 handId) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(handId, SLOT_HANDS)));
    }

    /// A present selector dispatches: the call succeeds.
    function _assertDispatches(bytes memory data) internal {
        (bool ok, bytes memory ret) = address(core).call(data);
        assertTrue(ok, "selector must dispatch");
        assertTrue(ret.length >= 32, "view returns a word");
    }

    /// An absent selector fails at dispatch: revert with EMPTY data (no body, no fallback).
    function _assertNoDispatch(bytes memory data, string memory name) internal {
        (bool ok, bytes memory ret) = address(core).call(data);
        assertFalse(ok, string.concat("must not dispatch: ", name));
        assertEq(ret.length, 0, string.concat("must fail with no data: ", name));
    }

    /// Well-formed calldata for a dead selector: enough zero words to decode any of the
    /// DEAD signatures' static arguments (a present function would reach its body).
    function _wellFormedCall(bytes4 sel) internal pure returns (bytes memory) {
        return abi.encodePacked(sel, uint256(0), uint256(0), uint256(0));
    }

    /// Opcode walk over runtime code (metadata stripped): every `PUSH4 x` immediately
    /// followed by `EQ` is a selector comparison of the dispatcher. Distinct values.
    function _dispatchTable(bytes memory code) internal pure returns (bytes4[] memory table) {
        uint256 end = runtimeEnd(code);
        bytes4[] memory found = new bytes4[](end / 6 + 1);
        uint256 n;
        uint256 i;
        while (i < end) {
            uint8 op = uint8(code[i]);
            if (op == 0x63 && i + 5 < end && uint8(code[i + 5]) == 0x14) {
                bytes4 v = bytes4(bytes.concat(code[i + 1], code[i + 2], code[i + 3], code[i + 4]));
                bool dup;
                for (uint256 j; j < n; ++j) {
                    if (found[j] == v) {
                        dup = true;
                        break;
                    }
                }
                if (!dup) found[n++] = v;
            }
            if (op >= 0x60 && op <= 0x7f) i += 1 + (op - 0x5f);
            else ++i;
        }
        table = new bytes4[](n);
        for (uint256 j; j < n; ++j) {
            table[j] = found[j];
        }
    }

    function _contains(bytes4[] memory arr, bytes4 v) internal pure returns (bool) {
        for (uint256 i; i < arr.length; ++i) {
            if (arr[i] == v) return true;
        }
        return false;
    }

    function _coreLogs(Vm.Log[] memory logs) internal view returns (Vm.Log[] memory) {
        return _coreLogsOf(logs, address(core));
    }

    function _coreLogsOf(Vm.Log[] memory logs, address emitter) internal pure returns (Vm.Log[] memory out) {
        uint256 n;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter) ++n;
        }
        out = new Vm.Log[](n);
        uint256 j;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter) out[j++] = logs[i];
        }
    }

    function _assertTopics2(Vm.Log memory log, bytes32 sig, address a, address b) internal pure {
        assertEq(log.topics.length, 3);
        assertEq(log.topics[0], sig);
        assertEq(log.topics[1], _addr(a));
        assertEq(log.topics[2], _addr(b));
    }

    function _assertCharityPolicyUpdated(Vm.Log memory log, address charity_, bool allowed, uint64 revision)
        internal
        pure
    {
        assertEq(log.topics.length, 2);
        assertEq(log.topics[0], AHandCore.CharityPolicyUpdated.selector);
        assertEq(log.topics[1], _addr(charity_));
        assertEq(log.data, abi.encode(allowed, revision));
    }

    /// PayoutAllocated / PayoutPushed / PayoutDeferred share one shape:
    /// topics (sig, handId, token, beneficiary); data (kind u8, position, amount).
    function _assertPayout(
        Vm.Log memory log,
        bytes32 sig,
        uint256 handId,
        address beneficiary,
        AllocationKind kind,
        uint256 position,
        uint256 amount
    ) internal view {
        assertEq(log.topics.length, 4, "payout topics");
        assertEq(log.topics[0], sig, "payout signature");
        assertEq(log.topics[1], bytes32(handId), "payout handId");
        assertEq(log.topics[2], _addr(token), "payout token");
        assertEq(log.topics[3], _addr(beneficiary), "payout beneficiary");
        assertEq(log.data, abi.encode(uint8(kind), position, amount), "payout (kind, position, amount)");
    }

    /// Word `i` of ABI-encoded event data (every head word is 32 bytes).
    function _wordAt(bytes memory data, uint256 i) internal pure returns (bytes32 w) {
        require(data.length >= (i + 1) * 32, "data too short");
        assembly ("memory-safe") {
            w := mload(add(data, add(0x20, mul(i, 0x20))))
        }
    }

    /// Raised data head: pool, expiry, root, visibility, meta, discovery, ref offset, floor, recipient, bps, revision.
    function _raisedRevision(Vm.Log memory log) internal pure returns (uint64) {
        return uint64(uint256(_wordAt(log.data, 10)));
    }

    /// Settled data: token, pool, recipient, C, D, G, routeHash, giveHash, solutionHash, settlementHash, hopCount, closedAt.
    function _settledTerminalFacts(Vm.Log memory log) internal pure returns (bytes32 settlementHash, uint40 closedAt) {
        assertEq(log.topics[0], AHandCore.Settled.selector);
        settlementHash = _wordAt(log.data, 9);
        closedAt = uint40(uint256(_wordAt(log.data, 11)));
    }

    /// The full `Settled` log of a thank of `r` with `t`: topics (sig, handId, giver) and
    /// the 12-word data, checked in two halves (money, then identities).
    function _assertSettledLog(
        Vm.Log memory s,
        uint256 h,
        RouteBuild memory r,
        Terminal memory t,
        uint256 C,
        uint256 D,
        uint256 G
    ) internal view {
        assertEq(s.topics.length, 3);
        assertEq(s.topics[0], AHandCore.Settled.selector);
        assertEq(s.topics[1], bytes32(h));
        assertEq(s.topics[2], _addr(t.give.giver));
        assertEq(s.data.length, 12 * 32, "Settled data width");
        assertEq(
            _slice(s.data, 0, 6 * 32),
            abi.encode(token, DEPOSIT, core.facts(h).charityRecipient, C, D, G),
            "Settled: token, pool, recipient, C, D, G"
        );
        assertEq(
            _slice(s.data, 6 * 32, 6 * 32),
            abi.encode(
                routeHashOf(r),
                AHandSig.hashGive(t.give),
                t.give.solutionHash,
                core.facts(h).settlementHash,
                r.hops.length,
                uint40(block.timestamp)
            ),
            "Settled: routeHash, giveHash, solutionHash, settlementHash, hopCount, closedAt"
        );
    }

    /// One `RouteHopSettled` log: topics (sig, handId, routeHash); data (position, parent, child,
    /// parentClaim, childClaim, shaker, shakeHash, hopDataHash, marginAllocation).
    function _assertHopLog(
        Vm.Log memory hl,
        uint256 h,
        bytes32 routeHash,
        uint256 position,
        address parent,
        Shake memory sh,
        uint256 allocation
    ) internal pure {
        assertEq(hl.topics.length, 3);
        assertEq(hl.topics[0], AHandCore.RouteHopSettled.selector);
        assertEq(hl.topics[1], bytes32(h));
        assertEq(hl.topics[2], routeHash);
        assertEq(
            _slice(hl.data, 0, 5 * 32),
            abi.encode(position, parent, sh.childCapability, sh.parentClaimBps, sh.childClaimBps),
            "RouteHopSettled: position, parent, child, parentClaim, childClaim"
        );
        assertEq(
            _slice(hl.data, 5 * 32, 4 * 32),
            abi.encode(sh.shaker, AHandSig.hashShake(sh), sh.hopDataHash, allocation),
            "RouteHopSettled: shaker, shakeHash, hopDataHash, marginAllocation"
        );
    }

    function _slice(bytes memory data, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        require(data.length >= start + len, "slice out of range");
        out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = data[start + i];
        }
    }

    /// facts(handId) equals getHand(handId) field by field (I-25).
    function _assertFactsEqualHand(uint256 handId) internal view {
        IAHandFacts.HandFacts memory f = core.facts(handId);
        Hand memory g = core.getHand(handId);
        assertEq(uint8(f.status), uint8(g.status), "status");
        assertEq(f.raiser, g.raiser, "raiser");
        assertEq(f.token, g.token, "token");
        assertEq(f.pool, g.pool, "pool");
        assertEq(f.charityBps, g.charityBps, "charityBps");
        assertEq(f.charityRecipient, g.charityRecipient, "charityRecipient");
        assertEq(f.minGiverClaimBps, g.minGiverClaimBps, "minGiverClaimBps");
        assertEq(f.rootCapability, g.rootCapability, "rootCapability");
        assertEq(f.expiry, g.expiry, "expiry");
        assertEq(f.closedAt, g.closedAt, "closedAt");
        assertEq(uint8(f.visibility), uint8(g.visibility), "visibility");
        assertEq(f.metadataCommitment, g.metadataCommitment, "metadataCommitment");
        assertEq(f.discoveryCommitment, g.discoveryCommitment, "discoveryCommitment");
        assertEq(f.settlementHash, g.settlementHash, "settlementHash");
    }
}
