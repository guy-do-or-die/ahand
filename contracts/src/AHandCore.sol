// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTypes.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title AHandCore v1
/// @notice Spec: aHand-v1-spec.md. The chain touches the hand EXACTLY TWICE:
///         raise (deposit enters) and thank|finalize (funds exit).
/// @dev No receive() or fallback() by design. ETH must be wrapped to WETH by the client.
contract AHandCore {
    using SafeERC20 for IERC20;

    /*//////////////////// Constitution (§9) ////////////////////*/
    uint256 public constant MAX_ROUTE_LEN        = 32;
    uint16  public constant BPS_DENOMINATOR      = 100_00;
    uint16  public constant MIN_CHARITY_FEE_BPS  = 1_00;
    uint16  public constant MAX_MAINT_FEE_BPS    = 10_00;
    uint16  public constant MIN_SOLVER_FLOOR_BPS = 20_00;
    uint16  public constant MAX_SOLVER_FLOOR_BPS = 90_00;
    uint40  public constant MIN_EXPIRY = 1 days;
    uint40  public constant MAX_EXPIRY = 180 days;
    uint256 public constant PUSH_GAS_STIPEND = 100_000;
    uint256 public constant SIGNALS_GAS = 3_000_000; // I-17: quarantine, receipts < money

    uint256 private immutable _deploymentChainId;
    bytes32 private immutable _deploymentDomainSeparator;
    address public immutable maintainer;    

    uint256 public handsCount;
    address public owner;
    address public pendingOwner;
    address public signals;

    mapping(uint256 => Hand) public hands;
    mapping(address => bool) public charityWhitelist;                 // reserved for timelock gating
    mapping(address => mapping(address => uint96)) public pending;   // [owner][token]

    /*//////////////////// Events & Modifiers ////////////////////*/
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SignalsSet(address indexed signals);
    event CharityWhitelistUpdated(address indexed charity, bool status);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /// @dev Transient storage-based reentrancy guard (Cancun target)
    modifier nonReentrant() {
        bytes32 slot = 0xb7a1c4371fbfb1e7fa8f6cdb642ec34b9d038fa8d390a78622f99092ec0b6389; // keccak256("AHandCore.reentrancy.slot")
        bool locked;
        assembly {
            locked := tload(slot)
            tstore(slot, 1)
        }
        if (locked) revert Reentrancy();
        _;
        assembly {
            tstore(slot, 0)
        }
    }

    constructor(address[] memory charities, address maintainer_) {
        _deploymentChainId = block.chainid;
        _deploymentDomainSeparator = AHandSig.domainSeparator(address(this));
        maintainer = maintainer_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        for (uint256 i; i < charities.length; ++i) {
            if (charities[i] == address(0)) revert ZeroAddress();
            charityWhitelist[charities[i]] = true;
        }
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        if (block.chainid == _deploymentChainId) return _deploymentDomainSeparator;
        return AHandSig.domainSeparator(address(this));
    }

    /**
     * @notice Initiates two-step ownership transfer.
     * @param newOwner Address proposed to be the new owner.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /**
     * @notice Claims ownership. Must be called by the pending owner.
     */
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function setSignals(address signals_) external onlyOwner {
        signals = signals_;
        emit SignalsSet(signals_);
    }

    function setCharityWhitelist(address charity, bool status) external onlyOwner {
        if (charity == address(0)) revert ZeroAddress();
        charityWhitelist[charity] = status;
        emit CharityWhitelistUpdated(charity, status);
    }

    /*//////////////////////////////////////////////////////////
        raise — §5.
        Deposit via balance-delta (accounting for fee-on-transfer), NOT payable.
    //////////////////////////////////////////////////////////*/
    function raise(
        address token,
        uint96  amount,
        uint40  expiry,
        uint16  charityFeeBps,
        uint16  maintFeeBps,
        uint16  minSolverClaimBps,
        address charity,
        address rootCapability,
        bytes32 metadataHash
    ) external nonReentrant returns (uint256 handId) {
        if (amount == 0) revert ZeroAmount();
        if (token == address(0) || rootCapability == address(0)) revert BoundsViolated();
        if (!charityWhitelist[charity]) revert CharityNotWhitelisted();
        if (charityFeeBps < MIN_CHARITY_FEE_BPS) revert BoundsViolated();
        if (maintFeeBps > MAX_MAINT_FEE_BPS) revert BoundsViolated();
        if (minSolverClaimBps < MIN_SOLVER_FLOOR_BPS || minSolverClaimBps > MAX_SOLVER_FLOOR_BPS)
            revert BoundsViolated();
        if (expiry < block.timestamp + MIN_EXPIRY || expiry > block.timestamp + MAX_EXPIRY)
            revert BoundsViolated();
        if (uint256(charityFeeBps) + maintFeeBps >= BPS_DENOMINATOR - minSolverClaimBps)
            revert BoundsViolated();

        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 delta = IERC20(token).balanceOf(address(this)) - balBefore;
        if (delta == 0) revert ZeroAmount();
        if (delta > type(uint96).max) revert BoundsViolated();
        uint96 credited = uint96(delta);

        handId = ++handsCount;
        hands[handId] = Hand({
            raiser: msg.sender,
            token: token,
            remainingReward: credited,          // I-12: balance is never read again
            expiry: expiry,
            charityFeeBps: charityFeeBps,
            maintFeeBps: maintFeeBps,
            minSolverClaimBps: minSolverClaimBps,
            status: Status.Active,
            charity: charity,
            rootCapability: rootCapability,
            metadataHash: metadataHash
        });
        emit Raised(handId, msg.sender, token, credited, expiry, metadataHash);

        if (signals != address(0)) {
            try IAHandSignals(signals).mintRaise{gas: SIGNALS_GAS}(msg.sender, handId) {} catch {}
        }
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        (address recovered, , ) = ECDSA.tryRecover(digest, sig);
        return recovered;
    }

    function _isValidSignature(address signer, bytes32 digest, bytes memory sig) internal view returns (bool) {
        address recovered = _recover(digest, sig);
        if (recovered != address(0) && recovered == signer) {
            return true;
        }
        if (signer.code.length > 0) {
            bytes memory data = abi.encodeWithSignature("isValidSignature(bytes32,bytes)", digest, sig);
            (bool success, bytes memory returnData) = signer.staticcall{gas: 50_000}(data);
            if (success && returnData.length >= 32) {
                return abi.decode(returnData, (bytes4)) == 0x1626ba7e;
            }
        }
        return false;
    }

    /**
     * @dev Validates the delegated capability chain and EIP-712 signatures.
     * @param handId Unique ID of the hand being resolved.
     * @param shakes Array of Shake structures representing hops in the route.
     * @param sigs Array of capability signatures matching each Shake.
     * @param give Give structure representing final solution assignment.
     * @param giveSig Signature validating the Give structure.
     * @return payees Addresses to receive telescopic routing margins.
     * @return margins Claim margin percentages for each payee.
     * @return solver Address of the solver verifying the solution.
     * @return solverClaim Bps of net reward remaining for the solver.
     */
    function _verifyRoute(
        uint256 handId,
        Shake[] calldata shakes,
        bytes[] calldata sigs,
        Give calldata give,
        bytes calldata giveSig
    ) internal view returns (address[] memory payees, uint16[] memory margins, address solver, uint16 solverClaim) {
        Hand storage h = hands[handId];
        address rootCapability = h.rootCapability;
        if (rootCapability == address(0)) revert WrongHand();

        address prevCap = rootCapability;
        uint16 prevClaim = BPS_DENOMINATOR;

        uint256 len = shakes.length;
        if (len > MAX_ROUTE_LEN) revert RouteTooLong();
        if (len != sigs.length) revert CapabilityProof();

        payees = new address[](len);
        margins = new uint16[](len);

        bytes32 ds = DOMAIN_SEPARATOR();
        for (uint256 i = 0; i < len; ++i) {
            Shake calldata s = shakes[i];
            if (s.handId != handId) revert WrongHand();

            bytes32 structHash = AHandSig.hashShake(s);
            bytes32 digest = AHandSig.digest(ds, structHash);

            address recovered = _recover(digest, sigs[i]);
            if (recovered == address(0) || recovered != prevCap) revert CapabilityProof();
            if (s.parentClaimBps != prevClaim) revert ClaimMismatch();
            if (s.childClaimBps > s.parentClaimBps) revert ClaimMustNotGrow();
            if (block.timestamp > s.deadline) revert TicketExpired();

            payees[i] = s.payout;
            margins[i] = s.parentClaimBps - s.childClaimBps;
            prevCap = s.childCapability;
            prevClaim = s.childClaimBps;
        }

        bytes32 giveStructHash = AHandSig.hashGive(give);
        bytes32 giveDigest = AHandSig.digest(ds, giveStructHash);

        if (prevCap == address(0) || !_isValidSignature(prevCap, giveDigest, giveSig)) revert CapabilityProof();
        if (give.handId != handId) revert WrongHand();
        
        uint16 minSolverClaimBps = h.minSolverClaimBps;
        if (prevClaim < minSolverClaimBps) revert SolverClaimTooSmall();

        return (payees, margins, give.solver, prevClaim);
    }

    /**
     * @dev Internal gas-limited push transfer. Defers to mapping upon failure.
     * @param token Address of the ERC20 token to pay out.
     * @param to Destination recipient address.
     * @param amt Amount of token to pay out.
     */
    function _payout(address token, address to, uint96 amt) internal {
        if (amt == 0) return;
        bytes memory cd = abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amt);
        uint256 g = PUSH_GAS_STIPEND;
        bool ok;
        assembly ("memory-safe") {
            let success := call(g, token, 0, add(cd, 32), mload(cd), 0, 0)
            switch success
            case 0 { ok := 0 }
            default {
                switch returndatasize()
                case 0 { ok := 1 }
                default {
                    if lt(returndatasize(), 32) { ok := 0 }
                    if iszero(lt(returndatasize(), 32)) {
                        returndatacopy(0, 0, 32)
                        ok := iszero(iszero(mload(0)))
                    }
                }
            }
        }
        if (ok) {
            emit PayoutPushed(token, to, amt);
        } else {
            pending[to][token] += amt;
            emit PayoutDeferred(token, to, amt);
        }
    }

    /**
     * @notice Settles a Hand with optional top-up, telescopic margins, and solver payout.
     * @param handId ID of the Hand to settle.
     * @param shakes Array of Shake structs.
     * @param sigs Signatures for each Shake.
     * @param give Give struct mapping to solver.
     * @param giveSig Signature verifying the solver assignment.
     * @param topUp Optional reward top-up added by the raiser.
     */
    function thank(
        uint256 handId,
        Shake[] calldata shakes,
        bytes[] calldata sigs,
        Give calldata give,
        bytes calldata giveSig,
        uint96 topUp
    ) external nonReentrant {
        Hand storage h = hands[handId];
        if (h.status != Status.Active) revert NotActive();
        if (msg.sender != h.raiser) revert NotRaiser();

        (address[] memory payees, uint16[] memory margins, address solver, ) = 
            _verifyRoute(handId, shakes, sigs, give, giveSig);

        address token = h.token;
        address charityRecipient = h.charity;
        uint96 pool = h.remainingReward;

        if (topUp > 0) {
            uint256 balBefore = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), topUp);
            uint256 delta = IERC20(token).balanceOf(address(this)) - balBefore;
            if (uint256(pool) + delta > type(uint96).max) revert BoundsViolated();
            pool += uint96(delta);
        }

        h.remainingReward = 0;
        h.status = Status.Settled;

        uint256 charityFee = (uint256(pool) * h.charityFeeBps) / BPS_DENOMINATOR;
        uint256 maintFee = (uint256(pool) * h.maintFeeBps) / BPS_DENOMINATOR;
        uint256 net = pool - charityFee - maintFee;

        uint256 totalDistributed = charityFee + maintFee;

        for (uint256 i = 0; i < shakes.length; ++i) {
            uint256 gross = (net * margins[i]) / BPS_DENOMINATOR;
            _payout(token, payees[i], uint96(gross));
            totalDistributed += gross;
            emit Shaken(handId, payees[i], margins[i]);
        }

        uint256 solverShare = pool - totalDistributed;
        _payout(token, solver, uint96(solverShare));
        emit Settled(handId, solver, give.solutionHash);

        _payout(token, charityRecipient, uint96(charityFee));
        if (maintFee > 0) {
            _payout(token, maintainer, uint96(maintFee));
        }

        if (signals != address(0)) {
            try IAHandSignals(signals).mintSettlement{gas: SIGNALS_GAS}(
                handId,
                msg.sender,
                solver,
                payees,
                margins,
                token,
                uint96(charityFee)
            ) {} catch {}
        }
    }

    /**
     * @notice Finalizes an expired Hand, returning the remaining reward (minus charity fee) to the raiser.
     * @param handId ID of the Hand to reclaim.
     */
    function finalize(uint256 handId) external nonReentrant {
        Hand storage h = hands[handId];
        if (h.status != Status.Active) revert NotActive();
        if (block.timestamp < h.expiry) revert NotExpired();

        address token = h.token;
        address charityRecipient = h.charity;
        address raiser = h.raiser;

        uint96 pool = h.remainingReward;
        h.remainingReward = 0;
        h.status = Status.Reclaimed;

        uint256 charityFee = (uint256(pool) * h.charityFeeBps) / BPS_DENOMINATOR;
        uint256 refund = pool - charityFee;

        _payout(token, raiser, uint96(refund));
        _payout(token, charityRecipient, uint96(charityFee));

        emit Reclaimed(handId);

        if (signals != address(0)) {
            try IAHandSignals(signals).onFinalize{gas: SIGNALS_GAS}(handId, raiser) {} catch {}
        }
    }

    /**
     * @notice Rescues pending token balance for the caller (recipient can be any address to bypass blacklists).
     * @param token Address of the ERC20 token to withdraw.
     * @param recipient Destination address of the funds.
     */
    function withdrawTo(address token, address recipient) external nonReentrant {
        if (recipient == address(0)) revert BoundsViolated();
        uint96 amt = pending[msg.sender][token];
        if (amt == 0) revert ZeroAmount();

        pending[msg.sender][token] = 0;

        IERC20(token).safeTransfer(recipient, amt);
    }
}
