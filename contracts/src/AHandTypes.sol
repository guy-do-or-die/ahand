// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*//////////////////////////////////////////////////////////////
                    aHand v1 — Types (spec §3)
//////////////////////////////////////////////////////////////*/

/// @notice Shake: EIP-712, signed by the parent capability.
struct Shake {
    uint256 handId;
    address childCapability; // bearer: fresh ephemeral key; personal: wallet of the recipient
    address payout;          // payout wallet of the forwarder - hop margin is sent here
    uint16  parentClaimBps;  // = childClaim of the previous hop (honest display during signing)
    uint16  childClaimBps;   // hop margin = parent − child
    uint40  deadline;
}

/// @notice Give: EIP-712, signed by the last capability of the route.
struct Give {
    uint256 handId;
    address solver;
    bytes32 solutionHash;
}

enum HandStatus { None, Active, Settled, Reclaimed }

struct Hand {
    address    raiser;
    address    token;            // ERC20 only; ETH = WETH (spec §4)
    uint96     remainingReward;  // the sole source of truth (I-12, I-16)
    uint40     expiry;
    uint16     charityFeeBps;
    uint16     maintFeeBps;
    uint16     minSolverClaimBps;
    HandStatus status;
    address    charity;          // locked during raise (I-10)
    address    rootCapability;   // addr(e0)
    bytes32    metadataHash;     // sha256 of canonical JSON (Appendix P)
}

/*//////////////////////////////////////////////////////////////
                        Errors (§6, §9)
//////////////////////////////////////////////////////////////*/
error OnlyOwner();
error Reentrancy();
error ZeroAddress();
error OnlyCore();
error InsufficientBalance();
error InsufficientEarned();
error LengthMismatch();
error Soulbound();
error NotPendingOwner();

error WrongHand();
error CapabilityProof();       // I-7 / I-15: signature not from the expected capability
error ClaimMismatch();         // parentClaim != childClaim of the previous hop
error ClaimMustNotGrow();      // telescopic margins (I-4)
error TicketExpired();
error SolverClaimTooSmall();   // < minSolverClaimBps
error RouteTooLong();          // > MAX_ROUTE_LEN (gas limit)
error NotRaiser();
error NotActive();             // settle-once (I-3)
error NotExpired();
error CharityNotWhitelisted();
error ZeroAmount();
error BoundsViolated();        // parameters outside of the constitutional boundaries


/*//////////////////////////////////////////////////////////////
                        Events (§5, §7)
//////////////////////////////////////////////////////////////*/
event HandRaised(uint256 indexed handId, address indexed raiser, address token,
                 uint96 amount, uint40 expiry, bytes32 metadataHash);
event Shaken(uint256 indexed handId, address indexed payout, uint16 marginBps); // during thank!
event Settled(uint256 indexed handId, address indexed solver, bytes32 solutionHash);
event Reclaimed(uint256 indexed handId);
event PayoutPushed(address indexed token, address indexed to, uint96 amount);
event PayoutDeferred(address indexed token, address indexed to, uint96 amount);

/*//////////////////////////////////////////////////////////////
        EIP-712 — shared between core and tests (names visible in wallet)
//////////////////////////////////////////////////////////////*/
library AHandSig {
    bytes32 internal constant SHAKE_TYPEHASH = keccak256(
        "Shake(uint256 handId,address childCapability,address payout,uint16 parentClaimBps,uint16 childClaimBps,uint40 deadline)"
    );
    bytes32 internal constant GIVE_TYPEHASH = keccak256(
        "Give(uint256 handId,address solver,bytes32 solutionHash)"
    );

    function domainSeparator(address core) internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("aHand")),
            keccak256(bytes("1")),
            block.chainid,
            core
        ));
    }

    function hashShake(Shake memory s) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            SHAKE_TYPEHASH, s.handId, s.childCapability, s.payout,
            s.parentClaimBps, s.childClaimBps, s.deadline
        ));
    }

    function hashGive(Give memory g) internal pure returns (bytes32) {
        return keccak256(abi.encode(GIVE_TYPEHASH, g.handId, g.solver, g.solutionHash));
    }

    function digest(bytes32 ds, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", ds, structHash));
    }
}

interface IERC20Minimal {
    function transfer(address to, uint256 amt) external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

interface IAHandSignals {
    function mintRaise(address raiser, uint256 handId) external;
    function mintSettlement(
        uint256 handId,
        address raiser,
        address solver,
        address[] calldata payees,
        uint16[] calldata margins,
        address token,
        uint96 charityFee
    ) external;
    function onFinalize(uint256 handId, address raiser) external;
}
