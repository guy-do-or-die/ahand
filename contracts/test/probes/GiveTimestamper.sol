// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IAHandFacts, Status} from "../../src/AHandTypes.sol";

/// @notice Conformance probe, §9.3 #5 (Seam 3 + Seam 2): the EAS `timestamp(bytes32)`
///         shape — first write wins, the data is opaque to the registry. A giver (or
///         its app) timestamps the `ahand.give.v1` key of a Give it delivered so
///         that a later reader can show the delivery evidence existed before the
///         Hand was reclaimed. Test-only: never deployed as protocol.
contract GiveTimestamper {
    /// @notice The first timestamp of each datum; zero if never timestamped.
    mapping(bytes32 => uint64) public timestamps;

    /// @notice A datum was timestamped.
    event Timestamped(bytes32 indexed data, uint64 timestamp);

    /// @notice The datum was timestamped before (EAS: `AlreadyTimestamped`).
    error AlreadyTimestamped();

    /// @notice Timestamp `data` with the current block time.
    /// @param  data Any 32 bytes.
    /// @return t    The recorded timestamp.
    function timestamp(bytes32 data) external returns (uint64 t) {
        if (timestamps[data] != 0) revert AlreadyTimestamped();
        t = uint64(block.timestamp);
        timestamps[data] = t;
        emit Timestamped(data, t);
    }

    /// @notice The timestamp of `data`, zero if none.
    function getTimestamp(bytes32 data) external view returns (uint64) {
        return timestamps[data];
    }
}

/// @notice Conformance probe, §9.3 #5 (Seam 3): a late-delivery reader. It joins a
///         timestamped `giveHash` with the Hand's `Reclaimed` fact and `closedAt`
///         from `IAHandFacts` alone and raises a freerider FLAG: the giver proved
///         a delivery before the Raiser let the Hand expire. Evidence, not
///         adjudication; nothing here can influence thank or reclaim. Compiled
///         against `IAHandFacts` only — never `getHand`.
contract LateDeliveryReader {
    /// @notice The Core, through its stable facts interface only.
    IAHandFacts public immutable facts;
    /// @notice The timestamp registry.
    GiveTimestamper public immutable registry;

    /// @param facts_    The Core (facts interface).
    /// @param registry_ The timestamp registry.
    constructor(IAHandFacts facts_, GiveTimestamper registry_) {
        facts = facts_;
        registry = registry_;
    }

    /// @notice The `ahand.give.v1` key of a Give on this Core and chain (§9.3 #5, §18 #10).
    /// @param  handId   The Hand.
    /// @param  giveHash hashStruct(Give) of the delivered Give.
    /// @return keccak256(abi.encode("ahand.give.v1", chainId, core, handId, giveHash)).
    function giveKey(uint256 handId, bytes32 giveHash) public view returns (bytes32) {
        return keccak256(abi.encode("ahand.give.v1", block.chainid, address(facts), handId, giveHash));
    }

    /// @notice Whether `giveHash` was timestamped before the Hand was reclaimed.
    /// @param  handId        The Hand.
    /// @param  giveHash      hashStruct(Give) of the delivered Give.
    /// @return flagged       True iff the Hand is Reclaimed and the key was timestamped strictly before `closedAt`.
    /// @return timestampedAt The key's timestamp (zero if none).
    /// @return closedAt      The Hand's terminal time (zero while Active).
    function freeriderFlag(uint256 handId, bytes32 giveHash)
        external
        view
        returns (bool flagged, uint64 timestampedAt, uint40 closedAt)
    {
        IAHandFacts.HandFacts memory f = facts.facts(handId);
        timestampedAt = registry.getTimestamp(giveKey(handId, giveHash));
        closedAt = f.closedAt;
        flagged = timestampedAt != 0 && f.status == Status.Reclaimed && timestampedAt < closedAt;
    }
}
