// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./AHandTypes.sol";

/// @title AHandCore v1
/// @notice Spec: aHand-v1-spec.md. The chain touches the hand EXACTLY TWICE:
///         raise (deposit enters) and thank|finalize (funds exit).
contract AHandCore {
    /*//////////////////// Constitution (§9) ////////////////////*/
    uint256 public constant MAX_ROUTE_LEN        = 32;
    uint16  public constant MIN_CHARITY_FEE_BPS  = 100;   // 1%
    uint16  public constant MAX_MAINT_FEE_BPS    = 1000;  // 10%
    uint16  public constant MIN_SOLVER_FLOOR_BPS = 2000;
    uint16  public constant MAX_SOLVER_FLOOR_BPS = 9000;
    uint40  public constant MIN_EXPIRY = 1 days;
    uint40  public constant MAX_EXPIRY = 180 days;
    uint256 public constant PUSH_GAS_STIPEND = 50_000;

    bytes32 public immutable DOMAIN_SEPARATOR;
    address public immutable maintainer;

    uint256 public handsCount;
    mapping(uint256 => Hand) public hands;
    mapping(address => bool) public charityWhitelist;                 // reserved for timelock gating
    mapping(address => mapping(address => uint96)) public pending;   // [owner][token]

    constructor(address[] memory charities, address maintainer_) {
        DOMAIN_SEPARATOR = AHandSig.domainSeparator(address(this));
        maintainer = maintainer_;
        for (uint256 i; i < charities.length; ++i) charityWhitelist[charities[i]] = true;
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
    ) external returns (uint256 handId) {
        if (amount == 0) revert ZeroAmount();
        if (!charityWhitelist[charity]) revert CharityNotWhitelisted();
        if (charityFeeBps < MIN_CHARITY_FEE_BPS) revert BoundsViolated();
        if (maintFeeBps > MAX_MAINT_FEE_BPS) revert BoundsViolated();
        if (minSolverClaimBps < MIN_SOLVER_FLOOR_BPS || minSolverClaimBps > MAX_SOLVER_FLOOR_BPS)
            revert BoundsViolated();
        if (expiry < block.timestamp + MIN_EXPIRY || expiry > block.timestamp + MAX_EXPIRY)
            revert BoundsViolated();
        if (uint256(charityFeeBps) + maintFeeBps >= 10_000 - minSolverClaimBps)
            revert BoundsViolated();

        uint256 balBefore = IERC20Minimal(token).balanceOf(address(this));
        require(IERC20Minimal(token).transferFrom(msg.sender, address(this), amount), "transferFrom");
        uint96 credited = uint96(IERC20Minimal(token).balanceOf(address(this)) - balBefore);
        if (credited == 0) revert ZeroAmount();

        handId = ++handsCount;
        hands[handId] = Hand({
            raiser: msg.sender,
            token: token,
            remainingReward: credited,
            expiry: expiry,
            charityFeeBps: charityFeeBps,
            maintFeeBps: maintFeeBps,
            minSolverClaimBps: minSolverClaimBps,
            status: HandStatus.Active,
            charity: charity,
            rootCapability: rootCapability,
            metadataHash: metadataHash
        });
        emit HandRaised(handId, msg.sender, token, credited, expiry, metadataHash);
    }

    /*//////////////////// Verification Helpers ////////////////////*/
    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(digest, v, r, s);
    }

    function _isValidSignature(address signer, bytes32 digest, bytes memory sig) internal view returns (bool) {
        address recovered = _recover(digest, sig);
        if (recovered != address(0) && recovered == signer) {
            return true;
        }
        if (signer.code.length > 0) {
            bytes memory data = abi.encodeWithSignature("isValidSignature(bytes32,bytes)", digest, sig);
            (bool success, bytes memory returnData) = signer.staticcall{gas: 10000}(data);
            if (success && returnData.length >= 32) {
                return abi.decode(returnData, (bytes4)) == 0x1626ba7e;
            }
        }
        return false;
    }

    function _verifyRoute(
        uint256 handId,
        Shake[] calldata shakes,
        bytes[] calldata sigs,
        Give calldata give,
        bytes calldata giveSig
    ) internal view returns (address[] memory payees, uint16[] memory margins, address solver, uint16 solverClaim) {
        Hand memory h = hands[handId];
        address prevCap = h.rootCapability;
        uint16 prevClaim = 10000;

        uint256 len = shakes.length;
        if (len > MAX_ROUTE_LEN) revert RouteTooLong();

        payees = new address[](len);
        margins = new uint16[](len);

        bytes32 ds = DOMAIN_SEPARATOR;
        for (uint256 i = 0; i < len; ++i) {
            Shake calldata s = shakes[i];
            if (s.handId != handId) revert WrongHand();

            bytes32 structHash = AHandSig.hashShake(s);
            bytes32 digest = AHandSig.digest(ds, structHash);

            if (_recover(digest, sigs[i]) != prevCap) revert CapabilityProof();
            if (s.parentClaimBps != prevClaim) revert ClaimMismatch();
            if (s.childClaimBps > s.parentClaimBps) revert ClaimMustNotGrow();
            if (block.timestamp > s.deadline) revert TicketExpired();

            payees[i] = s.payout;
            margins[i] = s.parentClaimBps - s.childClaimBps;

            prevCap = s.childCapability;
            prevClaim = s.childClaimBps;
        }

        if (give.handId != handId) revert WrongHand();
        bytes32 giveHash = AHandSig.hashGive(give);
        bytes32 giveDigest = AHandSig.digest(ds, giveHash);

        if (!_isValidSignature(prevCap, giveDigest, giveSig)) revert CapabilityProof();
        if (prevClaim < h.minSolverClaimBps) revert SolverClaimTooSmall();

        return (payees, margins, give.solver, prevClaim);
    }

    /*//////////////////////////////////////////////////////////
        thank — §5/§6/§7. RED.
    //////////////////////////////////////////////////////////*/
    function thank(
        uint256 handId,
        Shake[] calldata shakes,
        bytes[] calldata sigs,
        Give calldata give,
        bytes calldata giveSig,
        uint96 topUp
    ) external {
        handId; shakes; sigs; give; giveSig; topUp;
        revert NotImplemented();
    }

    /// finalize — §5. RED.
    function finalize(uint256 handId) external {
        handId;
        revert NotImplemented();
    }

    /// withdrawTo — §5. RED.
    function withdrawTo(address token, address recipient) external {
        token; recipient;
        revert NotImplemented();
    }
}
