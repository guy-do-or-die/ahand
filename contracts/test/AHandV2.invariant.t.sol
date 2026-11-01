// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
    Stateful invariants for aHand Core v2 (DESIGN §12 I-1, I-6, I-8, I-19).

    One handler owns every actor and constructs ONLY valid calls, so
    `fail_on_revert` stays on and any revert is a finding. Where a call is
    meant to fail (reclaim before expiry, thank after expiry, a blocked
    withdraw, a stranger at the policy door) the handler asserts the exact
    revert in place: a negative probe, never noise.

    Population:
      tokens   MockUSD (6 dec) · Token18 (18 dec) · NoDecimalsToken (no decimals())
               · BlacklistToken (6 dec; the fuzzer toggles its block list over every
               payee, so pushes really defer) · zero-pot Hands (token 0) · junk
               force-sends into Core on every token
      raisers  the EOA raiser · a fresh PolicyRaiser controller per Hand (decision
               maker thanks inside its window) · a fresh FundingVault per Hand
               (contributor funds, steward thanks)
      roots /  EOA keys E0..E6 · SmartWallet1271 (owner-key ERC-1271) · a fresh
      children PolicyCapability per use (policy-bounded ERC-1271 envelope)
      shakers  anonymous · self · explicit EOAs · SafeLikeSigner (approved hash,
               empty bytes) · SmartWallet1271
      givers   EOAs incl. raiser == giver · SafeLikeSigner · SmartWallet1271

    Ghosts mirror what Core promises; the invariants compare after every call:
      I-6   per-token identity  balance_t == Σ pool(Active_t) + Σ claims_t + surplus_t
      I-1   lifecycle: terminal once; closedAt != 0 ⇔ terminal; settlementHash != 0
            ⇔ Settled; pool never zeroed; ids monotonic; Settled before expiry,
            Reclaimed at or after expiry
      I-8   PayoutAllocated → exactly one Pushed|Deferred, same (kind, position,
            amount), same order, deferred ⇔ the token's own oracle; Σ Allocated ==
            pool; claims grow only by deferred grants (mirror equality)
      I-19  Granted(h, a) ghost == received + claims per (token, address) — the
            equality form of outflow(h, a) ≤ Granted(h, a) for conforming tokens
      I-20  the policy admin never touches a Hand: every Hand's raise-time facts
            equal their snapshot; policyRevision counts real changes
//////////////////////////////////////////////////////////////*/

import {Vm, console} from "forge-std/Test.sol";
import {AHandTestBase, IFaucetToken} from "./AHandTestBase.sol";
import {AHandCore} from "../src/AHandCore.sol";
import {AHandSig} from "../src/AHandSig.sol";
import {AHandMath} from "../src/AHandFacts.sol";
import {
    AllocationKind,
    HandExpired,
    HandNotExpired,
    Hop,
    IAHandFacts,
    NoChange,
    OnlyPolicyAdmin,
    RaiseParams,
    Shake,
    Status,
    Terminal,
    ZeroClaim
} from "../src/AHandTypes.sol";
import {BlacklistToken} from "./mocks/BlacklistToken.sol";
import {NoDecimalsToken} from "./mocks/DecimalsTokens.sol";
import {SafeLikeSigner} from "./mocks/SafeLikeSigner.sol";
import {SmartWallet1271} from "./mocks/SmartWallet1271.sol";
import {PolicyRaiser} from "./probes/PolicyRaiser.sol";
import {PolicyCapability} from "./probes/PolicyCapability.sol";
import {FundingVault} from "./probes/FundingVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*//////////////////////////////////////////////////////////////
                              HANDLER
//////////////////////////////////////////////////////////////*/

/// @notice Stateful fuzz handler over the Core v2 fixture. Extends AHandTestBase so
///         raise plumbing, route building, EIP-712 signing and the preimage rebuild
///         are the exact helpers every other suite uses; the handler adds bounding,
///         actor selection, the conforming-token oracle and ghost bookkeeping.
contract AHandV2InvariantHandler is AHandTestBase {
    /*//////////////////// Actor kinds ////////////////////*/

    /// @dev Who holds the Raiser role of a Hand.
    enum RaiserKind {
        Eoa, // the base `raiser` key
        Controller, // a PolicyRaiser; the decision maker thanks
        Vault // a FundingVault; the steward thanks
    }

    /// @dev What kind of signer the current route tail is.
    enum CapKind {
        Key, // an EOA key: raw ECDSA
        Wallet, // SmartWallet1271: owner-key ECDSA validated by ERC-1271
        Policy // PolicyCapability: the artifact rides inside the signature bytes
    }

    /// @dev Everything the handler knows about one Hand at raise plus its terminal facts.
    struct HandGhost {
        Status status;
        RaiserKind kind;
        address raiser; // facts.raiser: the EOA, the controller or the vault
        address operator; // who may thank: raiser, decision maker or steward
        address token;
        uint256 pool;
        uint40 expiry;
        uint40 openAt; // first second a thank may be submitted (controller window)
        uint40 closedAt;
        uint256 allocated; // Σ PayoutAllocated at the terminal transition
        bytes32 termsHash; // raise-time facts snapshot (I-20)
        CapKind rootKind;
        PolicyCapability rootPolicy;
    }

    struct Transition {
        uint256 handId;
        Status from;
        Status to;
    }

    /// @dev One expected allocation of a terminal transition, in push order.
    struct Expected {
        address to;
        AllocationKind kind;
        uint256 position;
        uint256 amount;
    }

    /*//////////////////// Keys and fixed actors ////////////////////*/

    uint256 constant E6 = 0xE6aa;
    uint256 constant WALLET_OWNER_PK = 0x3A11E7;
    uint256 constant SAFE_OWNER_PK = 0x5AFE;
    uint256 constant AGENT_PK = 0xA6E7;
    uint16 constant POLICY_MAX_MARGIN = 500;

    uint256 internal raiserPk; // the key behind makeAddr("raiser"): raiser == giver settlements
    address charity2 = makeAddr("charity2");
    address policyAdmin2 = makeAddr("policyAdmin2");
    address decisionMaker = makeAddr("decisionMaker");
    address steward = makeAddr("steward");
    address contributor = makeAddr("contributor");

    SmartWallet1271 wallet;
    SafeLikeSigner safe;
    BlacklistToken bl;
    NoDecimalsToken nodec;

    /// @notice The escrowable tokens; a raise may also pick the zero pot.
    address[] public tokens;
    mapping(address => uint256) internal maxPot;
    /// @notice Every address the blacklist fuzzer may block.
    address[] public blockables;
    /// @notice Scripted walks only: block every current and future blockable.
    bool public blockAll;
    /// @dev Children a PolicyCapability may delegate to (every EOA key and the wallet).
    address[] internal allowedChildren;
    uint256[7] internal childKeys = [E1, E2, E3, E4, E5, E6, E0];

    /*//////////////////// Hand tracking ////////////////////*/

    uint256[] public activeHands;
    mapping(uint256 => HandGhost) internal hands;
    Transition[] public transitions;

    /*//////////////////// Ghosts — money ////////////////////*/

    mapping(address => uint256) public ghostSurplus; // [token] junk force-sent into Core
    mapping(address => uint256) public ghostActivePool; // [token] Σ pool over Active Hands
    mapping(address => mapping(address => uint256)) public ghostClaims; // [token][payee]
    mapping(address => mapping(address => uint256)) public ghostGranted; // [token][payee] Granted(h, a) summed over h
    mapping(address => mapping(address => uint256)) public ghostIn; // [token][account] inflows NOT from Core
    mapping(address => mapping(address => uint256)) public ghostOut; // [token][account] every outflow
    address[] public payees; // every address ever granted anything
    mapping(address => bool) internal isPayee;

    /*//////////////////// Ghosts — policy ////////////////////*/

    mapping(address => bool) public ghostAllowed;
    uint64 public ghostRevision;
    address public ghostAdmin;

    /*//////////////////// Coverage counters ////////////////////*/

    uint256 public pushedCount;
    uint256 public deferredCount;
    uint256 public withdrawOkCount;
    uint256 public withdrawBlockedCount;
    uint256 public probeCount; // negative probes that reverted exactly as expected
    uint256 public controllerThanks;
    uint256 public vaultThanks;
    uint256 public policyCapSigned; // Shakes and Gives signed by a PolicyCapability (as parent / terminal)
    uint256 public walletCapHops; // hops signed by the smart wallet (as parent)
    uint256 public safeShakerHops;
    uint256 public walletShakerHops;
    uint256 public safeGiverThanks;
    uint256 public walletGiverThanks;
    uint256 public raiserIsGiverThanks;
    uint256 public zeroPotHands;

    /// @dev The route tail's signer kind, reset per thank (RouteBuild carries key + address).
    CapKind internal _tailKind;
    PolicyCapability internal _tailPolicy;

    function setUp() public override {
        super.setUp();
        (, raiserPk) = makeAddrAndKey("raiser");
        wallet = newSmartWallet(WALLET_OWNER_PK);
        safe = newSafe(SAFE_OWNER_PK);
        bl = new BlacklistToken();
        nodec = new NoDecimalsToken();
        vm.label(address(wallet), "wallet");
        vm.label(address(safe), "safe");
        vm.label(address(bl), "blacklistToken");
        vm.label(address(nodec), "noDecimalsToken");

        tokens.push(address(usd));
        tokens.push(address(t18));
        tokens.push(address(nodec));
        tokens.push(address(bl));
        maxPot[address(usd)] = 10_000e6;
        maxPot[address(t18)] = 1_000_000 ether;
        maxPot[address(nodec)] = 1_000_000;
        maxPot[address(bl)] = 10_000e6;
        for (uint256 i; i < tokens.length; ++i) {
            vm.prank(raiser);
            IFaucetToken(tokens[i]).approve(address(core), type(uint256).max);
            ghostIn[tokens[i]][raiser] = balanceOf(tokens[i], raiser); // the base's seed funding
        }

        for (uint256 i; i < childKeys.length; ++i) {
            allowedChildren.push(vm.addr(childKeys[i]));
            blockables.push(vm.addr(childKeys[i]));
        }
        allowedChildren.push(address(wallet));
        blockables.push(charity);
        blockables.push(charity2);
        blockables.push(raiser);
        blockables.push(giver);
        blockables.push(shakerA);
        blockables.push(shakerB);
        blockables.push(address(safe));
        blockables.push(address(wallet));

        ghostAllowed[charity] = true;
        ghostRevision = 1;
        ghostAdmin = policyAdmin;
    }

    /*//////////////////// Views for the invariant contract ////////////////////*/

    function coreContract() external view returns (AHandCore) {
        return core;
    }

    function blacklistToken() external view returns (BlacklistToken) {
        return bl;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function payeeCount() external view returns (uint256) {
        return payees.length;
    }

    function blockableCount() external view returns (uint256) {
        return blockables.length;
    }

    function transitionCount() external view returns (uint256) {
        return transitions.length;
    }

    function activeCount() external view returns (uint256) {
        return activeHands.length;
    }

    function handGhost(uint256 handId) external view returns (HandGhost memory) {
        return hands[handId];
    }

    function charityAddress() external view returns (address) {
        return charity;
    }

    function charity2Address() external view returns (address) {
        return charity2;
    }

    /// @dev Tokens `account` received FROM CORE in `token`, derived from its balance and
    ///      the non-Core flows the handler itself caused: balance = in − out + fromCore.
    function receivedFromCore(address token_, address account) public view returns (uint256) {
        uint256 bal = balanceOf(token_, account);
        uint256 inflow = ghostIn[token_][account];
        uint256 outflow = ghostOut[token_][account];
        require(bal + outflow >= inflow, "ghost: account paid out more than it ever held");
        return bal + outflow - inflow;
    }

    /// @dev The raise-time facts a policy change must never reach (I-20).
    function termsHashOf(IAHandFacts.HandFacts memory f) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                f.raiser,
                f.token,
                f.pool,
                f.charityBps,
                f.charityRecipient,
                f.minGiverClaimBps,
                f.rootCapability,
                f.expiry,
                f.visibility,
                f.metadataCommitment,
                f.discoveryCommitment
            )
        );
    }

    /*//////////////////////////////////////////////////////////
                              ACTIONS
    //////////////////////////////////////////////////////////*/

    /// @notice Raise a Hand with bounded, always-valid terms: any of the four tokens
    ///         or a zero pot; an EOA, controller or vault Raiser; an EOA key, the
    ///         smart wallet or a policy capability as root; a donation only when an
    ///         allowlisted charity exists and the declared share pays ≥ 1 unit.
    function raise(
        uint256 tokenSeed,
        uint256 kindSeed,
        uint256 amountSeed,
        uint256 expirySeed,
        uint256 charitySeed,
        uint256 floorSeed
    ) external {
        uint256 ti = tokenSeed % (tokens.length + 2); // the blacklist token twice: deferral needs it
        if (ti == tokens.length) ti = tokens.length - 1;
        else if (ti > tokens.length) ti = tokens.length; // zero pot
        RaiserKind kind = RaiserKind(kindSeed % 3);
        CapKind rootKind = CapKind((kindSeed >> 8) % 3);
        address tk;
        uint256 amount;
        if (ti < tokens.length) {
            tk = tokens[ti];
            amount = bound(amountSeed, 1, maxPot[tk]);
        } else if (kind == RaiserKind.Vault) {
            kind = RaiserKind.Eoa; // a vault pools money: a zero pot is an EOA / controller shape
        }
        uint40 expiry = uint40(block.timestamp + bound(expirySeed, 1 hours, 90 days));

        RaiseParams memory p = defaultParams();
        p.token = tk;
        p.amount = amount;
        p.expiry = expiry;
        p.minGiverClaimBps = uint16(bound(floorSeed, 1, 10_000));
        (p.charityRecipient, p.charityBps) = _charityTerms(charitySeed, amount);
        PolicyCapability rootPolicy;
        if (rootKind == CapKind.Wallet) {
            p.rootCapability = address(wallet);
        } else if (rootKind == CapKind.Policy) {
            rootPolicy = _newPolicyCapability(expiry);
            p.rootCapability = address(rootPolicy);
        }

        uint256 handId;
        address operator;
        uint40 openAt = uint40(block.timestamp);
        if (kind == RaiserKind.Eoa) {
            if (amount != 0) _mintTo(tk, raiser, amount);
            handId = makeRaise(p);
            if (amount != 0) ghostOut[tk][raiser] += amount;
            operator = raiser;
        } else if (kind == RaiserKind.Controller) {
            (handId, openAt) = _raiseThroughController(p, tk, amount, expiry);
            operator = decisionMaker;
        } else {
            handId = _raiseThroughVault(p, tk, amount, expiry);
            operator = steward;
        }

        IAHandFacts.HandFacts memory f = core.facts(handId);
        assertTrue(f.status == Status.Active, "raise: not Active");
        assertEq(f.pool, amount, "raise: pool != amount");
        assertEq(f.token, tk, "raise: token");
        assertEq(f.expiry, expiry, "raise: expiry");
        assertEq(f.closedAt, 0, "raise: closedAt");
        assertEq(f.settlementHash, bytes32(0), "raise: settlementHash");
        assertEq(f.charityRecipient, p.charityRecipient, "raise: charityRecipient");

        HandGhost storage g = hands[handId];
        g.status = Status.Active;
        g.kind = kind;
        g.raiser = f.raiser;
        g.operator = operator;
        g.token = tk;
        g.pool = amount;
        g.expiry = expiry;
        g.openAt = openAt;
        g.termsHash = termsHashOf(f);
        g.rootKind = rootKind;
        g.rootPolicy = rootPolicy;
        if (amount == 0) ++zeroPotHands;
        else ghostActivePool[tk] += amount;
        activeHands.push(handId);
        _transition(handId, Status.None, Status.Active);
    }

    /// @notice Settle a random Active Hand through a 0..5-hop route mixing anonymous,
    ///         self, explicit EOA, Safe (approved hash) and smart-wallet shakers over
    ///         EOA-key, wallet and policy-capability children, to an EOA, Safe or wallet
    ///         giver; then check the event ledger and mirror the floor math. After
    ///         expiry the thank is a negative probe: `HandExpired`.
    function thank(uint256 handSeed, uint256 hopSeed, uint256 modeSeed, uint256 marginSeed, uint256 giverSeed)
        external
    {
        if (activeHands.length == 0) return;
        uint256 index = handSeed % activeHands.length;
        uint256 handId = activeHands[index];
        HandGhost storage g = hands[handId];
        if (block.timestamp < g.openAt && g.openAt < g.expiry) vm.warp(g.openAt); // the controller's decision window
        if (block.timestamp >= g.expiry) {
            _probeThankExpired(handId, g);
            return;
        }

        RouteBuild memory r = _rootedRoute(handId, g);
        uint256 n = hopSeed % 6;
        uint16[] memory margins = new uint16[](n);
        address[] memory shakers = new address[](n);
        uint256 distributable = g.pool - AHandMath.cut(g.pool, core.facts(handId).charityBps);
        uint16 floorBps = core.facts(handId).minGiverClaimBps;
        for (uint256 i; i < n; ++i) {
            (margins[i], shakers[i]) = _appendHop(r, i, modeSeed, marginSeed, distributable, floorBps, g.expiry);
        }

        (address giverAddr, Terminal memory t) = _terminalFor(r, giverSeed, g);
        vm.recordLogs();
        _submitThank(g, r, t);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        IAHandFacts.HandFacts memory f = core.facts(handId);
        assertTrue(f.status == Status.Settled, "thank: not Settled");
        assertEq(f.closedAt, block.timestamp, "thank: closedAt");
        assertEq(
            f.settlementHash,
            settlementHashOf(preimageOf(r, t, uint40(block.timestamp))),
            "thank: settlementHash != commitment of the known route (I-23)"
        );
        Expected[] memory expected = _expectedThankAllocations(handId, f, margins, shakers, giverAddr);
        _checkSettlementEvents(logs, handId, n, expected);
        _mirrorAllocations(g.token, expected);

        if (giverAddr == raiser && g.kind == RaiserKind.Eoa) ++raiserIsGiverThanks;
        if (g.kind == RaiserKind.Controller) ++controllerThanks;
        if (g.kind == RaiserKind.Vault) ++vaultThanks;
        _closeHand(handId, index, Status.Settled);
    }

    /// @notice Reclaim a random Active Hand. Before expiry it is a negative probe
    ///         (`HandNotExpired`) or a warp into the reclaim window; at or after
    ///         expiry a stranger reclaims and the full pool refunds the raiser.
    function reclaim(uint256 handSeed, uint256 warpSeed) external {
        if (activeHands.length == 0) return;
        uint256 index = handSeed % activeHands.length;
        uint256 handId = activeHands[index];
        HandGhost storage g = hands[handId];

        if (block.timestamp < g.expiry) {
            if (warpSeed % 2 == 0) {
                vm.prank(stranger);
                vm.expectRevert(HandNotExpired.selector);
                core.reclaim(handId);
                assertTrue(core.facts(handId).status == Status.Active, "probe: early reclaim changed status");
                ++probeCount;
                return;
            }
            vm.warp(uint256(g.expiry) + (warpSeed % 3 days));
        }

        vm.recordLogs();
        vm.prank(stranger);
        core.reclaim(handId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        IAHandFacts.HandFacts memory f = core.facts(handId);
        assertTrue(f.status == Status.Reclaimed, "reclaim: not Reclaimed");
        assertEq(f.closedAt, block.timestamp, "reclaim: closedAt");
        assertEq(f.settlementHash, bytes32(0), "reclaim: settlementHash must stay zero");
        Expected[] memory expected = new Expected[](g.pool == 0 ? 0 : 1);
        if (g.pool != 0) expected[0] = Expected(g.raiser, AllocationKind.RaiserRefund, 0, g.pool);
        _checkPayoutEvents(logs, handId, g.token, expected);
        _mirrorAllocations(g.token, expected);
        _closeHand(handId, index, Status.Reclaimed);
    }

    /// @notice Withdraw one outstanding claim, preferring a beneficiary the token will
    ///         pay: exact zeroing, exact deltas, fixed destination, anyone pays. A
    ///         blacklisted beneficiary's withdraw must revert in place leaving the claim
    ///         and custody untouched. With nothing outstanding, probe `ZeroClaim`.
    function withdraw(uint256 seed) external {
        (address tk, address beneficiary) = _pickClaim(seed);
        if (beneficiary == address(0)) {
            vm.expectRevert(ZeroClaim.selector);
            core.withdraw(tokens[seed % tokens.length], stranger); // the stranger is never granted anything
            ++probeCount;
            return;
        }
        uint256 amount = core.claims(tk, beneficiary);
        assertEq(amount, ghostClaims[tk][beneficiary], "withdraw: claims mirror diverged");
        uint256 balBeneficiary = balanceOf(tk, beneficiary);
        uint256 balCore = balanceOf(tk, address(core));

        if (_blocked(tk, beneficiary)) {
            vm.prank(stranger);
            vm.expectRevert(bytes("BLACKLISTED"));
            core.withdraw(tk, beneficiary);
            assertEq(core.claims(tk, beneficiary), amount, "withdraw: failed drain touched the claim");
            assertEq(balanceOf(tk, address(core)), balCore, "withdraw: failed drain moved custody");
            ++withdrawBlockedCount;
            return;
        }

        vm.prank(stranger);
        core.withdraw(tk, beneficiary);
        assertEq(balanceOf(tk, beneficiary) - balBeneficiary, amount, "withdraw: beneficiary delta != claim");
        assertEq(balCore - balanceOf(tk, address(core)), amount, "withdraw: custody delta != claim");
        assertEq(core.claims(tk, beneficiary), 0, "withdraw: claim not zeroed");
        ghostClaims[tk][beneficiary] = 0;
        ++withdrawOkCount;
    }

    /// @notice Exercise the whole policy surface: flip a charity (and probe `NoChange`),
    ///         let a stranger knock (`OnlyPolicyAdmin`), or hand the role over in two
    ///         steps. Live Hands must never notice (invariant_policyNeverTouchesAHand).
    function policy(uint256 seed) external {
        uint256 mode = seed % 4;
        if (mode < 2) {
            address c = mode == 0 ? charity : charity2;
            bool next = !ghostAllowed[c];
            vm.prank(ghostAdmin);
            core.setCharityAllowed(c, next);
            ghostAllowed[c] = next;
            ++ghostRevision;
            vm.prank(ghostAdmin);
            vm.expectRevert(NoChange.selector);
            core.setCharityAllowed(c, next);
            ++probeCount;
        } else if (mode == 2) {
            vm.prank(stranger);
            vm.expectRevert(OnlyPolicyAdmin.selector);
            core.setCharityAllowed(charity2, !ghostAllowed[charity2]);
            ++probeCount;
        } else {
            address next = ghostAdmin == policyAdmin ? policyAdmin2 : policyAdmin;
            vm.prank(ghostAdmin);
            core.transferPolicyAdmin(next);
            vm.prank(next);
            core.acceptPolicyAdmin();
            ghostAdmin = next;
        }
    }

    /// @notice Block or unblock a payee on the blacklist token: pushes to a blocked
    ///         payee defer, and withdrawing a blocked claim reverts.
    function toggleBlock(uint256 payeeSeed, bool isBlocked) external {
        bl.setBlocked(blockables[payeeSeed % blockables.length], isBlocked);
    }

    /// @notice Scripted walks only (not a fuzz target): block or unblock every blockable,
    ///         now and as new contract actors appear.
    function setBlockAll(bool on) external {
        blockAll = on;
        for (uint256 i; i < blockables.length; ++i) {
            bl.setBlocked(blockables[i], on);
        }
    }

    /// @notice Force-send tokens into Core outside any Hand. Surplus is inert: it must
    ///         never be paid out and never raise a liability.
    function donateJunk(uint256 tokenSeed, uint256 amountSeed) external {
        address tk = tokens[tokenSeed % tokens.length];
        uint256 amount = bound(amountSeed, 1, maxPot[tk]);
        IFaucetToken(tk).mint(address(core), amount);
        ghostSurplus[tk] += amount;
    }

    /// @notice Advance time: thank windows close, reclaim windows open.
    function warp(uint256 deltaSeed) external {
        vm.warp(block.timestamp + bound(deltaSeed, 1 hours, 30 days));
    }

    /*//////////////////////////////////////////////////////////
                         RAISE INTERNALS
    //////////////////////////////////////////////////////////*/

    /// @dev A donation only to an allowlisted charity, only when it pays ≥ 1 unit.
    function _charityTerms(uint256 seed, uint256 amount) internal view returns (address recipient, uint16 bps) {
        if (amount == 0) return (address(0), 0);
        bool a = ghostAllowed[charity];
        bool b = ghostAllowed[charity2];
        if (!a && !b) return (address(0), 0);
        recipient = (a && b) ? (seed % 2 == 0 ? charity : charity2) : (a ? charity : charity2);
        bps = uint16(bound(seed >> 8, 1, 3_000));
        if (AHandMath.cut(amount, bps) == 0) return (address(0), 0);
    }

    function _newPolicyCapability(uint40 window) internal returns (PolicyCapability cap) {
        cap = new PolicyCapability(address(core), vm.addr(AGENT_PK), POLICY_MAX_MARGIN, window, allowedChildren);
        _registerBlockable(address(cap));
    }

    /// @dev A new contract actor joins the blacklist universe (blocked at once under `blockAll`).
    function _registerBlockable(address account) internal {
        blockables.push(account);
        if (blockAll) bl.setBlocked(account, true);
    }

    function _mintTo(address tk, address who, uint256 amount) internal {
        IFaucetToken(tk).mint(who, amount);
        ghostIn[tk][who] += amount;
    }

    /// @dev The principal funds a fresh PolicyRaiser whose decision window is
    ///      (now + 1, expiry − 1]; the controller is `facts.raiser`.
    function _raiseThroughController(RaiseParams memory p, address tk, uint256 amount, uint40 expiry)
        internal
        returns (uint256 handId, uint40 openAt)
    {
        PolicyRaiser ctl = new PolicyRaiser(
            core,
            PolicyRaiser.Policy({
                decisionMaker: decisionMaker,
                principal: raiser,
                deliveryDeadline: uint40(block.timestamp),
                challengeDeadline: uint40(block.timestamp + 1),
                decisionDeadline: expiry - 1
            })
        );
        _registerBlockable(address(ctl));
        p.metadataCommitment = ctl.metadataCommitment();
        if (amount != 0) {
            _mintTo(tk, raiser, amount);
            vm.prank(raiser);
            IFaucetToken(tk).approve(address(ctl), amount);
        }
        vm.prank(raiser);
        handId = ctl.fund(p, DEFAULT_REF, noTags());
        if (amount != 0) {
            ghostOut[tk][raiser] += amount;
            ghostIn[tk][address(ctl)] += amount;
            ghostOut[tk][address(ctl)] += amount;
        }
        assertEq(core.facts(handId).raiser, address(ctl), "controller: not the raiser");
        openAt = uint40(block.timestamp + 2);
    }

    /// @dev A contributor pools the pot into a fresh FundingVault; one second later
    ///      (the raise window) anyone raises; the vault is `facts.raiser`.
    function _raiseThroughVault(RaiseParams memory p, address tk, uint256 amount, uint40 expiry)
        internal
        returns (uint256 handId)
    {
        FundingVault vault = new FundingVault(core, IERC20(tk), steward, uint40(block.timestamp + 1), expiry);
        _registerBlockable(address(vault));
        _mintTo(tk, contributor, amount);
        vm.prank(contributor);
        IFaucetToken(tk).approve(address(vault), amount);
        vm.prank(contributor);
        vault.contribute(amount);
        ghostOut[tk][contributor] += amount;
        ghostIn[tk][address(vault)] += amount;
        vm.warp(block.timestamp + 1);
        handId = vault.raise(p, DEFAULT_REF, noTags());
        ghostOut[tk][address(vault)] += amount;
        assertEq(core.facts(handId).raiser, address(vault), "vault: not the raiser");
    }

    /*//////////////////////////////////////////////////////////
                         THANK INTERNALS
    //////////////////////////////////////////////////////////*/

    /// @dev A thank at or after expiry must fail `HandExpired` (controller and vault
    ///      wrap Core with their own windows, so the direct probe is EOA-only).
    function _probeThankExpired(uint256 handId, HandGhost storage g) internal {
        if (g.kind != RaiserKind.Eoa) return;
        RouteBuild memory r = _rootedRoute(handId, g);
        Terminal memory t = buildTerminal(r, giver, GIVER_PK, DEFAULT_SOLUTION, g.expiry);
        if (g.rootKind == CapKind.Policy) t.capabilitySig = g.rootPolicy.encodeGive(t.give, t.capabilitySig);
        expectThankRevert(abi.encodeWithSelector(HandExpired.selector), r, t);
        assertTrue(core.facts(handId).status == Status.Active, "probe: late thank changed status");
        ++probeCount;
    }

    /// @dev A fresh route whose tail is the Hand's root capability.
    function _rootedRoute(uint256 handId, HandGhost storage g) internal returns (RouteBuild memory r) {
        r = newRoute(handId);
        _tailKind = g.rootKind;
        _tailPolicy = g.rootPolicy;
        if (g.rootKind == CapKind.Wallet) {
            r.parentPk = WALLET_OWNER_PK;
            r.parentCap = address(wallet);
        } else if (g.rootKind == CapKind.Policy) {
            r.parentPk = AGENT_PK;
            r.parentCap = address(g.rootPolicy);
        }
    }

    /// @dev Append hop `i`: pick the shaker shape, the child capability kind and a margin
    ///      the floor, the policy and the floor math all admit; sign by the current tail;
    ///      collect the shaker's consent through its own verifier; advance the tail.
    function _appendHop(
        RouteBuild memory r,
        uint256 i,
        uint256 modeSeed,
        uint256 marginSeed,
        uint256 distributable,
        uint16 floorBps,
        uint40 expiry
    ) internal returns (uint16 margin, address shaker) {
        uint256 rnd = uint256(keccak256(abi.encode(modeSeed, i)));
        uint256 shakerMode = rnd % 6; // 0 anon · 1 self · 2 shakerA · 3 shakerB · 4 safe · 5 wallet
        uint256 childMode = (rnd >> 8) % 8; // 0..5 key · 6 wallet · 7 policy

        uint16 headroom = r.claim - floorBps;
        margin = uint16(uint256(keccak256(abi.encode(marginSeed, i))) % (uint256(headroom) + 1));
        if (_tailKind == CapKind.Policy && margin > POLICY_MAX_MARGIN) margin = POLICY_MAX_MARGIN;
        if (shakerMode == 0) margin = 0; // anonymous hops are zero-margin by protocol law
        if (margin != 0 && AHandMath.cut(distributable, margin) == 0) margin = 0; // dodge MarginRoundsToZero

        if (shakerMode == 1) shaker = r.parentCap;
        else if (shakerMode == 2) shaker = shakerA;
        else if (shakerMode == 3) shaker = shakerB;
        else if (shakerMode == 4) shaker = address(safe);
        else if (shakerMode == 5) shaker = address(wallet);

        address child;
        uint256 childPk;
        CapKind childKind;
        PolicyCapability childPolicy;
        if (childMode == 6) {
            child = address(wallet);
            childPk = WALLET_OWNER_PK;
            childKind = CapKind.Wallet;
        } else if (childMode == 7 && _tailKind != CapKind.Policy) {
            childPolicy = _newPolicyCapability(expiry);
            child = address(childPolicy);
            childPk = AGENT_PK;
            childKind = CapKind.Policy;
        } else {
            childPk = childKeys[i];
            child = vm.addr(childPk);
        }

        Shake memory s = Shake({
            handId: r.handId,
            childCapability: child,
            shaker: shaker,
            parentClaimBps: r.claim,
            childClaimBps: r.claim - margin,
            hopDataHash: (rnd >> 16) % 2 == 0 ? bytes32(0) : keccak256(abi.encode("ahand.hop.app.v1", rnd)),
            deadline: expiry
        });
        bytes32 shakeHash = AHandSig.hashShake(s);
        bytes memory capabilitySig = signStruct(r.parentPk, shakeHash);
        if (_tailKind == CapKind.Policy) {
            capabilitySig = _tailPolicy.encodeShake(s, capabilitySig);
            ++policyCapSigned;
        } else if (_tailKind == CapKind.Wallet) {
            ++walletCapHops;
        }
        addRawHop(r, Hop({shake: s, capabilitySig: capabilitySig, shakerAcceptanceSig: _acceptance(shaker, r.parentCap, shakeHash)}));
        r.parentPk = childPk;
        r.parentCap = child;
        _tailKind = childKind;
        _tailPolicy = childPolicy;
    }

    /// @dev Consent bytes per the matrix: empty for anonymous and self (the expected
    ///      capability named as shaker is a self hop, whatever we meant); an EOA signs;
    ///      the wallet's owner signs; the Safe pre-approves the digest and passes empty bytes.
    function _acceptance(address shaker, address expectedCap, bytes32 shakeHash) internal returns (bytes memory) {
        if (shaker == address(0) || shaker == expectedCap) return "";
        bytes32 structHash = AHandSig.hashShakerAcceptance(shakeHash);
        if (shaker == shakerA) return signStruct(SHAKER_A_PK, structHash);
        if (shaker == shakerB) return signStruct(SHAKER_B_PK, structHash);
        if (shaker == address(wallet)) {
            ++walletShakerHops;
            return signStruct(WALLET_OWNER_PK, structHash);
        }
        ++safeShakerHops;
        safeApprove(safe, SAFE_OWNER_PK, digestOf(structHash));
        return "";
    }

    /// @dev The terminal: Give signed by the tail (policy envelope when the tail is a
    ///      policy capability), GiverAcceptance by the chosen giver's own verifier.
    function _terminalFor(RouteBuild memory r, uint256 giverSeed, HandGhost storage g)
        internal
        returns (address giverAddr, Terminal memory t)
    {
        uint256 mode = giverSeed % 5; // 0 giver · 1 shakerA · 2 raiser · 3 safe · 4 wallet
        uint256 pk;
        if (mode == 0) (giverAddr, pk) = (giver, GIVER_PK);
        else if (mode == 1) (giverAddr, pk) = (shakerA, SHAKER_A_PK);
        else if (mode == 2) (giverAddr, pk) = (raiser, raiserPk);
        else if (mode == 3) giverAddr = address(safe);
        else (giverAddr, pk) = (address(wallet), WALLET_OWNER_PK);

        t = buildTerminal(r, giverAddr, pk, keccak256(abi.encode("solution", giverSeed)), g.expiry);
        if (_tailKind == CapKind.Policy) {
            t.capabilitySig = _tailPolicy.encodeGive(t.give, t.capabilitySig);
            ++policyCapSigned;
        }
        if (mode == 3) {
            safeApprove(safe, SAFE_OWNER_PK, digestOf(AHandSig.hashGiverAcceptance(AHandSig.hashGive(t.give))));
            ++safeGiverThanks;
        } else if (mode == 4) {
            ++walletGiverThanks;
        }
    }

    /// @dev Submit through whoever holds the Raiser role.
    function _submitThank(HandGhost storage g, RouteBuild memory r, Terminal memory t) internal {
        if (g.kind == RaiserKind.Eoa) {
            doThank(r, t);
        } else if (g.kind == RaiserKind.Controller) {
            vm.prank(g.operator);
            PolicyRaiser(g.raiser).decide(r.hops, t, keccak256(abi.encode("evidence", r.handId)));
        } else {
            vm.prank(g.operator);
            FundingVault(g.raiser).thank(r.hops, t);
        }
    }

    /// @dev The §5.2 split as the push order lists it: Charity, paid hops in route
    ///      order, GiverResidual — only non-zero allocations.
    function _expectedThankAllocations(
        uint256 handId,
        IAHandFacts.HandFacts memory f,
        uint16[] memory margins,
        address[] memory shakers,
        address giverAddr
    ) internal view returns (Expected[] memory expected) {
        (uint256 charityAlloc,, uint256[] memory allocations, uint256 residual) = expectedSplit(handId, margins);
        uint256 count = (charityAlloc != 0 ? 1 : 0) + (residual != 0 ? 1 : 0);
        for (uint256 i; i < allocations.length; ++i) {
            if (allocations[i] != 0) ++count;
        }
        expected = new Expected[](count);
        uint256 k;
        if (charityAlloc != 0) expected[k++] = Expected(f.charityRecipient, AllocationKind.Charity, 0, charityAlloc);
        for (uint256 i; i < allocations.length; ++i) {
            if (allocations[i] != 0) expected[k++] = Expected(shakers[i], AllocationKind.ShakerMargin, i, allocations[i]);
        }
        if (residual != 0) expected[k++] = Expected(giverAddr, AllocationKind.GiverResidual, 0, residual);
    }

    /// @dev Thank-specific shape: exactly one Settled and `hopCount` RouteHopSettled,
    ///      then the payout ledger.
    function _checkSettlementEvents(Vm.Log[] memory logs, uint256 handId, uint256 hopCount, Expected[] memory expected)
        internal
    {
        uint256 settled;
        uint256 hopEvents;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(core)) continue;
            if (logs[i].topics[0] == AHandCore.Settled.selector) ++settled;
            else if (logs[i].topics[0] == AHandCore.RouteHopSettled.selector) ++hopEvents;
        }
        assertEq(settled, 1, "events: exactly one Settled");
        assertEq(hopEvents, hopCount, "events: one RouteHopSettled per hop");
        _checkPayoutEvents(logs, handId, hands[handId].token, expected);
    }

    /// @dev I-8 on the recorded logs: the PayoutAllocated list equals `expected` in
    ///      order; every Allocated precedes the first outcome; each Allocated is answered
    ///      by exactly one Pushed|Deferred with the same (token, beneficiary, kind,
    ///      position, amount), in order; deferred ⇔ the token's own oracle; Σ Allocated
    ///      == pool; nothing else is emitted after the first outcome (I-16).
    function _checkPayoutEvents(Vm.Log[] memory logs, uint256 handId, address tk, Expected[] memory expected)
        internal
    {
        uint256 allocs;
        uint256 outcomes;
        uint256 sum;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (log.emitter != address(core)) continue;
            bytes32 sig = log.topics[0];
            bool isAlloc = sig == AHandCore.PayoutAllocated.selector;
            bool isOutcome = sig == AHandCore.PayoutPushed.selector || sig == AHandCore.PayoutDeferred.selector;
            if (!isAlloc && !isOutcome) {
                assertEq(outcomes, 0, "events: a fact event after the first push (I-16)");
                continue;
            }
            assertEq(uint256(log.topics[1]), handId, "events: payout event for another Hand");
            assertEq(address(uint160(uint256(log.topics[2]))), tk, "events: payout token");
            address to = address(uint160(uint256(log.topics[3])));
            (uint8 kind, uint256 position, uint256 amount) = abi.decode(log.data, (uint8, uint256, uint256));
            if (isAlloc) {
                assertEq(outcomes, 0, "events: PayoutAllocated after an outcome (H10 order)");
                assertLt(allocs, expected.length, "events: more PayoutAllocated than allocations");
                Expected memory e = expected[allocs];
                assertEq(to, e.to, "events: allocation beneficiary");
                assertEq(kind, uint8(e.kind), "events: allocation kind");
                assertEq(position, e.position, "events: allocation position");
                assertEq(amount, e.amount, "events: allocation amount");
                assertGt(amount, 0, "events: zero PayoutAllocated");
                sum += amount;
                ++allocs;
            } else {
                assertLt(outcomes, allocs, "events: outcome without an allocation");
                Expected memory e = expected[outcomes];
                assertEq(to, e.to, "events: outcome beneficiary != allocation");
                assertEq(kind, uint8(e.kind), "events: outcome kind != allocation");
                assertEq(position, e.position, "events: outcome position != allocation");
                assertEq(amount, e.amount, "events: outcome amount != allocation");
                bool deferred = sig == AHandCore.PayoutDeferred.selector;
                assertEq(deferred, _blocked(tk, to), "events: push/defer disagrees with the token oracle");
                if (deferred) ++deferredCount;
                else ++pushedCount;
                ++outcomes;
            }
        }
        assertEq(allocs, expected.length, "events: PayoutAllocated count");
        assertEq(outcomes, allocs, "events: exactly one outcome per allocation");
        assertEq(sum, hands[handId].pool, "events: sum PayoutAllocated != pool (I-3)");
        hands[handId].allocated = sum;
    }

    /// @dev Mirror the grants: every allocation is Granted(h, to); a deferred one is a claim.
    function _mirrorAllocations(address tk, Expected[] memory expected) internal {
        for (uint256 i; i < expected.length; ++i) {
            Expected memory e = expected[i];
            ghostGranted[tk][e.to] += e.amount;
            if (_blocked(tk, e.to)) ghostClaims[tk][e.to] += e.amount;
            if (!isPayee[e.to]) {
                isPayee[e.to] = true;
                payees.push(e.to);
            }
        }
    }

    /// @dev The conforming-token oracle: a push fails iff the blacklist token blocks `to`.
    function _blocked(address tk, address to) internal view returns (bool) {
        return tk == address(bl) && bl.blocked(to);
    }

    /// @dev A (token, beneficiary) with an outstanding claim, preferring one the token
    ///      will pay; zero beneficiary when nothing is outstanding anywhere.
    function _pickClaim(uint256 seed) internal view returns (address tk, address beneficiary) {
        uint256 pairs = tokens.length * payees.length;
        if (pairs == 0) return (address(0), address(0));
        uint256 start = seed % pairs;
        for (uint256 i; i < pairs; ++i) {
            uint256 k = (start + i) % pairs;
            address t_ = tokens[k / payees.length];
            address b = payees[k % payees.length];
            if (core.claims(t_, b) == 0) continue;
            if (beneficiary == address(0) || _blocked(tk, beneficiary)) (tk, beneficiary) = (t_, b);
            if (!_blocked(t_, b)) break;
        }
    }

    function _closeHand(uint256 handId, uint256 index, Status to) internal {
        HandGhost storage g = hands[handId];
        g.status = to;
        g.closedAt = uint40(block.timestamp);
        if (g.pool != 0) ghostActivePool[g.token] -= g.pool;
        activeHands[index] = activeHands[activeHands.length - 1];
        activeHands.pop();
        _transition(handId, Status.Active, to);
    }

    function _transition(uint256 handId, Status from, Status to) internal {
        bool legal = (from == Status.None && to == Status.Active)
            || (from == Status.Active && (to == Status.Settled || to == Status.Reclaimed));
        require(legal, "ghost: illegal transition");
        transitions.push(Transition(handId, from, to));
    }
}

/*//////////////////////////////////////////////////////////////
                          INVARIANT SUITE
//////////////////////////////////////////////////////////////*/

contract AHandV2InvariantTest is AHandTestBase {
    AHandV2InvariantHandler internal handler;
    BlacklistToken internal bl;

    function setUp() public override {
        handler = new AHandV2InvariantHandler();
        handler.setUp();
        core = handler.coreContract();
        bl = handler.blacklistToken();

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = AHandV2InvariantHandler.raise.selector;
        selectors[1] = AHandV2InvariantHandler.thank.selector;
        selectors[2] = AHandV2InvariantHandler.reclaim.selector;
        selectors[3] = AHandV2InvariantHandler.withdraw.selector;
        selectors[4] = AHandV2InvariantHandler.policy.selector;
        selectors[5] = AHandV2InvariantHandler.toggleBlock.selector;
        selectors[6] = AHandV2InvariantHandler.donateJunk.selector;
        selectors[7] = AHandV2InvariantHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev Per-campaign coverage of both payout branches, both withdraw outcomes and
    ///      the contract actors.
    function afterInvariant() public view {
        console.log("hands raised / zero-pot:", core.handsCount(), handler.zeroPotHands());
        console.log("payouts pushed / deferred:", handler.pushedCount(), handler.deferredCount());
        console.log("withdraws paid / blocked:", handler.withdrawOkCount(), handler.withdrawBlockedCount());
        console.log("thanks by controller / vault / raiser==giver:", handler.controllerThanks(), handler.vaultThanks(), handler.raiserIsGiverThanks());
        console.log("policy-cap signed / wallet-cap hops:", handler.policyCapSigned(), handler.walletCapHops());
        console.log("safe shaker / wallet shaker hops:", handler.safeShakerHops(), handler.walletShakerHops());
        console.log("safe giver / wallet giver thanks:", handler.safeGiverThanks(), handler.walletGiverThanks());
        console.log("negative probes passed:", handler.probeCount());
    }

    /*//////////////////// Invariants ////////////////////*/

    /// @custom:invariant I-6 per-token identity and I-8 claims ledger. For every token:
    ///     balance_t(Core) == Σ pool(Active_t) + Σ claims_t + surplus_t, where the active
    ///     sum is read from Core's own facts AND equals the incremental ghost; every
    ///     payee's claim equals its mirror (claims grow only by deferred grants and
    ///     shrink only by withdraw). Zero-pot Hands hold no token.
    /// forge-config: default.invariant.depth = 192
    function invariant_perTokenIdentity() public view {
        uint256 total = core.handsCount();
        uint256 count = handler.tokenCount();
        for (uint256 ti; ti < count; ++ti) {
            address tk = handler.tokens(ti);
            uint256 activeSum;
            for (uint256 h = 1; h <= total; ++h) {
                IAHandFacts.HandFacts memory f = core.facts(h);
                if (f.status == Status.Active && f.token == tk) activeSum += f.pool;
            }
            assertEq(activeSum, handler.ghostActivePool(tk), "active escrow diverged from ghost");
            uint256 claimSum;
            uint256 payeeN = handler.payeeCount();
            for (uint256 i; i < payeeN; ++i) {
                address b = handler.payees(i);
                uint256 claim = core.claims(tk, b);
                assertEq(claim, handler.ghostClaims(tk, b), "claims ledger diverged from ghost mirror");
                claimSum += claim;
            }
            assertEq(
                balanceOf(tk, address(core)),
                activeSum + claimSum + handler.ghostSurplus(tk),
                "per-token identity broken: balance != active escrow + claims + surplus"
            );
        }
        for (uint256 h = 1; h <= total; ++h) {
            IAHandFacts.HandFacts memory f = core.facts(h);
            assertEq(f.pool == 0, f.token == address(0), "zero pot iff zero token");
        }
    }

    /// @custom:invariant I-1 lifecycle. Status equals the ghost mirror; `closedAt != 0`
    ///     iff terminal; `settlementHash != 0` iff Settled; `pool` never changes; a
    ///     Settled Hand closed strictly before expiry and a Reclaimed one at or after it;
    ///     ids are dense from 1; the transition log holds only legal edges.
    /// forge-config: default.invariant.depth = 192
    function invariant_lifecycle() public view {
        uint256 total = core.handsCount();
        for (uint256 h = 1; h <= total; ++h) {
            IAHandFacts.HandFacts memory f = core.facts(h);
            AHandV2InvariantHandler.HandGhost memory g = handler.handGhost(h);
            assertTrue(f.status == g.status, "status diverged from ghost");
            assertEq(f.pool, g.pool, "pool mutated after raise");
            bool terminal = f.status == Status.Settled || f.status == Status.Reclaimed;
            assertEq(f.closedAt != 0, terminal, "closedAt != 0 iff terminal");
            assertEq(f.settlementHash != bytes32(0), f.status == Status.Settled, "settlementHash != 0 iff Settled");
            if (terminal) assertEq(f.closedAt, g.closedAt, "closedAt diverged from ghost");
            if (f.status == Status.Settled) assertLt(f.closedAt, f.expiry, "settled at or after expiry");
            if (f.status == Status.Reclaimed) assertGe(f.closedAt, f.expiry, "reclaimed before expiry");
            if (f.status == Status.Active) assertEq(f.closedAt, 0, "active Hand carries closedAt");
        }
        assertTrue(core.facts(0).status == Status.None, "hand 0 must not exist");
        assertTrue(core.facts(total + 1).status == Status.None, "hand beyond handsCount must not exist");

        uint256 edges = handler.transitionCount();
        uint256 raises;
        for (uint256 i; i < edges; ++i) {
            (uint256 handId, Status from, Status to) = handler.transitions(i);
            bool legal = (from == Status.None && to == Status.Active)
                || (from == Status.Active && (to == Status.Settled || to == Status.Reclaimed));
            assertTrue(legal, "illegal status transition recorded");
            assertTrue(handId >= 1 && handId <= total, "transition on an unknown id");
            if (from == Status.None) ++raises;
        }
        assertEq(raises, total, "one raise transition per id");
        assertEq(edges - raises + handler.activeCount(), total, "every Hand is Active or closed exactly once");
    }

    /// @custom:invariant I-19 grant bound, in its equality form for conforming tokens.
    ///     For every (token, address): Granted == received-from-Core + outstanding claim
    ///     (hence outflow ≤ Granted), and Σ PayoutAllocated of every terminal Hand equals
    ///     its pool while an Active Hand has allocated nothing. Nobody outside the payee
    ///     universe ever receives anything.
    /// forge-config: default.invariant.depth = 192
    function invariant_grantsBoundOutflow() public view {
        uint256 tokenN = handler.tokenCount();
        uint256 payeeN = handler.payeeCount();
        for (uint256 ti; ti < tokenN; ++ti) {
            address tk = handler.tokens(ti);
            for (uint256 i; i < payeeN; ++i) {
                address a = handler.payees(i);
                uint256 received = handler.receivedFromCore(tk, a);
                uint256 claim = core.claims(tk, a);
                assertEq(handler.ghostGranted(tk, a), received + claim, "granted != received + claims");
            }
            assertEq(handler.receivedFromCore(tk, stranger), 0, "a stranger received tokens from Core");
            assertEq(core.claims(tk, stranger), 0, "a stranger holds a claim");
        }
        uint256 total = core.handsCount();
        for (uint256 h = 1; h <= total; ++h) {
            IAHandFacts.HandFacts memory f = core.facts(h);
            uint256 allocated = handler.handGhost(h).allocated;
            if (f.status == Status.Active) assertEq(allocated, 0, "active Hand allocated something");
            else assertEq(allocated, f.pool, "sum PayoutAllocated != pool at the terminal transition");
        }
    }

    /// @custom:invariant I-20 the policy admin never touches a Hand. Every Hand's
    ///     raise-time facts equal their snapshot whatever the allowlist or admin did
    ///     since; the allowlist equals its mirror; policyRevision counts real changes;
    ///     the admin is the mirrored one with nothing pending; zero and Core are never
    ///     allowlisted.
    /// forge-config: default.invariant.depth = 192
    function invariant_policyNeverTouchesAHand() public view {
        uint256 total = core.handsCount();
        for (uint256 h = 1; h <= total; ++h) {
            assertEq(handler.termsHashOf(core.facts(h)), handler.handGhost(h).termsHash, "raise-time facts changed");
        }
        assertEq(core.charityAllowed(handler.charityAddress()), handler.ghostAllowed(handler.charityAddress()), "allowlist: charity");
        assertEq(core.charityAllowed(handler.charity2Address()), handler.ghostAllowed(handler.charity2Address()), "allowlist: charity2");
        assertFalse(core.charityAllowed(address(0)), "zero allowlisted");
        assertFalse(core.charityAllowed(address(core)), "Core allowlisted");
        assertEq(core.policyRevision(), handler.ghostRevision(), "policyRevision != count of real changes");
        assertEq(core.policyAdmin(), handler.ghostAdmin(), "policyAdmin diverged");
        assertEq(core.pendingPolicyAdmin(), address(0), "a handover left pending");
    }

    /*//////////////////// Deterministic walks ////////////////////*/

    /// @dev Every invariant, on demand, so the scripted walks check what the campaign checks.
    function _assertAllInvariants() internal view {
        invariant_perTokenIdentity();
        invariant_lifecycle();
        invariant_grantsBoundOutflow();
        invariant_policyNeverTouchesAHand();
    }

    /// Deterministic walk through the deferred path, so the campaign cannot silently
    /// stop reaching it: block every payee on the blacklist token, settle one Hand and
    /// reclaim another (every allocation defers), watch a blocked withdraw revert in
    /// place, then unblock and drain every claim.
    function test_Handler_DrivesDeferralAndWithdraw() public {
        uint256 blIndex = 3; // tokens[3] is the blacklist token
        assertEq(handler.tokens(blIndex), address(bl));
        handler.setBlockAll(true);
        // two EOA-raised blacklist Hands, EOA-key root, 10 % to the seeded charity
        handler.raise(blIndex, 0, 100e6, 30 days, 1_000, 5_000);
        handler.raise(blIndex, 0, 100e6, 30 days, 1_000, 5_000);
        assertEq(core.handsCount(), 2);
        uint256 pool = core.facts(1).pool + core.facts(2).pool;

        handler.thank(0, 3, 1, 1, 0); // 3 hops, EOA giver
        handler.reclaim(0, 1); // odd seed: warp past expiry, then reclaim
        assertEq(handler.pushedCount(), 0, "every push hit the blacklist");
        assertGe(handler.deferredCount(), 2, "giver residual and refund deferred at least");
        assertEq(balanceOf(address(bl), address(core)), pool, "claims are fully backed");
        _assertAllInvariants();

        handler.withdraw(0);
        assertEq(handler.withdrawBlockedCount(), 1, "blocked withdraw reverted in place");
        assertEq(handler.withdrawOkCount(), 0);

        handler.setBlockAll(false);
        uint256 guard;
        while (_outstanding(address(bl)) != 0) {
            handler.withdraw(guard);
            assertLt(++guard, 32, "drain did not converge");
        }
        assertGe(handler.withdrawOkCount(), 2, "each deferred beneficiary drained");
        assertEq(balanceOf(address(bl), address(core)), 0, "nothing left behind");
        handler.withdraw(7); // nothing outstanding: the ZeroClaim probe
        _assertAllInvariants();
    }

    /// Deterministic coverage walk over the contract actors: drive the handler with a
    /// sweep of seeds until a controller thank, a vault thank, a policy-capability hop,
    /// a Safe shaker, a Safe giver, a wallet giver and a raiser == giver settlement have
    /// each happened, over all tokens including a zero pot, with policy churn, junk and
    /// time in between; every invariant holds throughout. (The deferred path has its
    /// own walk above.)
    function test_Handler_ReachesEveryActorShape() public {
        for (uint256 s; s < 24; ++s) {
            handler.raise(s, s + (s << 8), s * 1e18 + 1, s * 1 days, s * 13 + ((s * 97) << 8), s * 101);
            handler.policy(s);
            handler.donateJunk(s, s + 1);
            handler.thank(s, s + 1, s * 31, s * 17, s);
            handler.toggleBlock(s, s % 3 == 0);
            handler.reclaim(s, s);
            handler.withdraw(s);
            if (s % 5 == 4) handler.warp(s);
            _assertAllInvariants();
        }
        afterInvariant();
        assertGt(handler.controllerThanks(), 0, "no controller thank");
        assertGt(handler.vaultThanks(), 0, "no vault thank");
        assertGt(handler.policyCapSigned(), 0, "no policy-capability signature");
        assertGt(handler.walletCapHops(), 0, "no wallet-capability hop");
        assertGt(handler.safeShakerHops(), 0, "no Safe shaker");
        assertGt(handler.walletShakerHops(), 0, "no wallet shaker");
        assertGt(handler.safeGiverThanks(), 0, "no Safe giver");
        assertGt(handler.walletGiverThanks(), 0, "no wallet giver");
        assertGt(handler.raiserIsGiverThanks(), 0, "no raiser == giver settlement");
        assertGt(handler.zeroPotHands(), 0, "no zero-pot Hand");
        assertGt(handler.pushedCount(), 0, "no delivered push");
        assertGt(handler.probeCount(), 0, "no negative probe");
    }

    function _outstanding(address tk) internal view returns (uint256 sum) {
        uint256 payeeN = handler.payeeCount();
        for (uint256 i; i < payeeN; ++i) {
            sum += core.claims(tk, handler.payees(i));
        }
    }
}
