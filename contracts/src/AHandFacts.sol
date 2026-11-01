// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title  AHandMath
/// @author aHand
/// @notice The one floor formula of the protocol.
/// @dev    Used by Core for the charity feasibility check at raise and for every
///         allocation at thank. Readers never re-derive it: the committed
///         `charityAllocation`, `giverAllocation` and `occAllocations` are consumed
///         from the settlement preimage instead.
library AHandMath {
    /// @dev Basis-point denominator: every bps value is out of 10 000.
    uint16 internal constant BPS = 10_000;

    /// @notice floor(amount · bps / 10 000), exact for any uint256 `amount`.
    /// @param  amount The base amount in raw token units.
    /// @param  bps    The share in basis points.
    /// @return The floored share.
    function cut(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(amount, bps, BPS);
    }
}

/// @title  AHandSettlement
/// @author aHand
/// @notice The versioned settlement commitment: everything a second contract may
///         need to verify about a thank, hashed under one tag. Core stores the hash
///         in `Hand.settlementHash`; a reader rebuilds the preimage from the
///         `Settled` and `RouteHopSettled` events and recomputes it.
/// @dev    A new recipe is a new tag (`aHand.settlement.v3`), never a mutation of
///         this one. Dynamic arrays hash with `abi.encodePacked`, which pads EVERY
///         element to 32 bytes: `occShakers` as n words, `occClaimDeltas` as n words
///         of left-padded uint16, `occAllocations` as n words. Off-chain hashers must
///         copy that padding; tightly packing 20- or 2-byte elements gives a different hash.
library AHandSettlement {
    /// @dev Versioning tag of this recipe.
    bytes32 internal constant SETTLEMENT_TAG = keccak256("aHand.settlement.v2");

    /// @notice The flat settlement preimage (route order preserved, anonymous zeros kept).
    struct SettlementPreimage {
        uint256   handId;
        address   raiser;
        address   giver;
        address   token;
        address   charityRecipient;
        uint256   pool;               // P
        uint256   charityAllocation;  // C = floor(P · charityBps / 10 000)
        uint256   giverAllocation;    // G = (P − C) − Σ occAllocations
        bytes32   routeHash;
        bytes32   giveHash;
        bytes32   solutionHash;
        uint40    closedAt;           // block.timestamp of the thank
        address[] occShakers;         // per hop: attributed shaker (zero = anonymous)
        uint16[]  occClaimDeltas;     // per hop: margin δ_i = parentClaimBps − childClaimBps
        uint256[] occAllocations;     // per hop: A_i = floor((P − C) · δ_i / 10 000)
    }

    /// @notice The commitment of `p` for `core` on the current chain.
    /// @dev    Binds chain and Core so a preimage can never verify against another deployment.
    /// @param  core The Core that settled the Hand.
    /// @param  p    The preimage.
    /// @return The settlement hash.
    function commitment(address core, SettlementPreimage memory p) internal view returns (bytes32) {
        // the three occurrence arrays hash first (32-byte-padded elements), then the flat word list
        bytes32 shakersHash = keccak256(abi.encodePacked(p.occShakers));
        bytes32 deltasHash = keccak256(abi.encodePacked(p.occClaimDeltas));
        bytes32 allocationsHash = keccak256(abi.encodePacked(p.occAllocations));
        return keccak256(
            abi.encode(
                SETTLEMENT_TAG,
                block.chainid,
                core,
                p.handId,
                p.raiser,
                p.giver,
                p.token,
                p.charityRecipient,
                p.pool,
                p.charityAllocation,
                p.giverAllocation,
                p.routeHash,
                p.giveHash,
                p.solutionHash,
                p.closedAt,
                shakersHash,
                deltasHash,
                allocationsHash
            )
        );
    }
}
