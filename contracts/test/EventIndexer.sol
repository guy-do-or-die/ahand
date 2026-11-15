// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {HandView} from "./Helpers.sol";

/// An outside reader that knows Core only by its logs and the time of each block, as an indexer
/// does. It rebuilds every Hand, everything pending and what each address received from Core.
/// On the way it checks the order `thank` documents: each payout right after the event it pays.
/// The event and type strings are written out by hand, so the test pins them.
contract EventIndexer {
    bytes32 constant RAISED = keccak256("Raised(uint256,address,address,uint256,uint40,address,uint16,uint16,bytes32)");
    bytes32 constant EXTENDED = keccak256("Extended(uint256,uint40)");
    bytes32 constant SHAKEN = keccak256("Shaken(uint256,address,uint256,uint256,address,uint16,uint16,bytes32)");
    bytes32 constant GIVEN = keccak256("Given(uint256,address,address,uint256,uint16,bytes32,bytes32)");
    bytes32 constant THANKED = keccak256("Thanked(uint256,address,uint256)");
    bytes32 constant RECLAIMED = keccak256("Reclaimed(uint256,address,uint256)");
    bytes32 constant PAID = keccak256("Paid(uint256,address,address,uint256)");
    bytes32 constant PENDING = keccak256("Pending(uint256,address,address,uint256)");
    bytes32 constant WITHDRAWN = keccak256("Withdrawn(address,address,uint256,address)");

    bytes32 constant HAND_TYPEHASH = keccak256(
        "Hand(uint256 handId,address raiser,address token,address rootKey,uint16 minGiverClaimBps,uint16 payoutGasK,bytes32 dataHash)"
    );
    bytes32 constant GIVE_TYPEHASH = keccak256(
        "Give(Hand hand,address signer,address payee,uint16 claimBps,bytes32 routeHash,bytes32 dataHash)Hand(uint256 handId,address raiser,address token,address rootKey,uint16 minGiverClaimBps,uint16 payoutGasK,bytes32 dataHash)"
    );

    address public immutable core;
    uint256 public handsCount;
    mapping(uint256 handId => HandView) internal hands;
    mapping(address token => mapping(address payee => uint256)) public pending;
    mapping(address token => mapping(address to => uint256)) public received;

    // The thank being read: its Hand, the next Shake's place and what the Shakes have left so far.
    uint256 thanking;
    uint256 nextPosition;
    uint256 rest;
    // The payout the last event announced and the next one must be.
    bool owed;
    uint256 owedHand;
    address owedPayee;
    uint256 owedAmount;

    constructor(address core_) {
        core = core_;
    }

    function hand(uint256 handId) external view returns (HandView memory) {
        return hands[handId];
    }

    /// Reads one transaction's logs, with the time of its block.
    function ingest(Vm.Log[] memory logs, uint256 time) external {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != core) continue;
            _read(logs[i], time);
        }
        require(!owed, "a payout is missing");
        require(thanking == 0, "a thank ended without its Give");
    }

    function _read(Vm.Log memory log, uint256 time) private {
        bytes32 topic = log.topics[0];
        if (topic == PAID || topic == PENDING) return _payout(log, topic == PAID);
        require(!owed, "a payout is missing");
        if (topic == SHAKEN) return _shaken(log);
        if (topic == GIVEN) return _given(log);
        require(thanking == 0, "a thank ended without its Give");
        if (topic == RAISED) return _raised(log, time);
        if (topic == EXTENDED) return _extended(log);
        if (topic == THANKED) return _closed(log, time, true);
        if (topic == RECLAIMED) return _closed(log, time, false);
        if (topic == WITHDRAWN) return _withdrawn(log);
        revert("an event this reader does not know");
    }

    function _raised(Vm.Log memory log, uint256 time) private {
        uint256 handId = uint256(log.topics[1]);
        require(handId == handsCount + 1, "Hands are numbered one after another");
        handsCount = handId;
        HandView storage h = hands[handId];
        h.raiser = _address(log.topics[2]);
        h.token = _address(log.topics[3]);
        h.raisedAt = uint40(time);
        RaisedTerms memory terms = abi.decode(log.data, (RaisedTerms));
        h.reward = terms.reward;
        h.expiry = terms.expiry;
        h.rootKey = terms.rootKey;
        h.minGiverClaimBps = terms.minGiverClaimBps;
        h.payoutGasK = terms.payoutGasK;
        h.dataHash = terms.dataHash;
    }

    /// The fields of `Raised` that are not topics, in their order.
    struct RaisedTerms {
        uint256 reward;
        uint40 expiry;
        address rootKey;
        uint16 minGiverClaimBps;
        uint16 payoutGasK;
        bytes32 dataHash;
    }

    /// The expiry moves later; `Raised` names the first one.
    function _extended(Vm.Log memory log) private {
        HandView storage h = hands[uint256(log.topics[1])];
        uint40 expiry = abi.decode(log.data, (uint40));
        require(expiry > h.expiry, "an expiry only moves later");
        h.expiry = expiry;
    }

    /// `Thanked` opens the reading of a route; `Reclaimed` announces the payout to the raiser.
    function _closed(Vm.Log memory log, uint256 time, bool thanked) private {
        uint256 handId = uint256(log.topics[1]);
        HandView storage h = hands[handId];
        require(_address(log.topics[2]) == h.token, "the closing event names the Hand's token");
        require(abi.decode(log.data, (uint256)) == h.reward, "the closing event names the whole reward");
        if (thanked) {
            h.thankedAt = uint40(time);
            thanking = handId;
            nextPosition = 0;
            rest = h.reward;
        } else {
            h.reclaimedAt = uint40(time);
            _owe(handId, h.raiser, h.reward);
        }
    }

    function _shaken(Vm.Log memory log) private {
        uint256 handId = uint256(log.topics[1]);
        require(handId == thanking, "a Shake belongs to the thank being read");
        (uint256 position, uint256 margin,,,,) =
            abi.decode(log.data, (uint256, uint256, address, uint16, uint16, bytes32));
        require(position == nextPosition++, "Shakes come in the order of the route");
        rest -= margin;
        _owe(handId, _address(log.topics[2]), margin);
    }

    function _given(Vm.Log memory log) private {
        uint256 handId = uint256(log.topics[1]);
        require(handId == thanking, "the Give belongs to the thank being read");
        address signer = _address(log.topics[2]);
        address payee = _address(log.topics[3]);
        (uint256 amount, uint16 claimBps, bytes32 routeHash, bytes32 dataHash) =
            abi.decode(log.data, (uint256, uint16, bytes32, bytes32));
        require(amount == rest, "the giver gets what the Shakes left");
        hands[handId].giveHash =
            keccak256(abi.encode(GIVE_TYPEHASH, _handHash(handId), signer, payee, claimBps, routeHash, dataHash));
        thanking = 0;
        _owe(handId, payee, amount);
    }

    function _payout(Vm.Log memory log, bool paid) private {
        uint256 handId = uint256(log.topics[1]);
        address token = _address(log.topics[2]);
        address payee = _address(log.topics[3]);
        uint256 amount = abi.decode(log.data, (uint256));
        require(owed && handId == owedHand, "a payout follows the event it pays");
        require(
            token == hands[handId].token && payee == owedPayee && amount == owedAmount,
            "the payout is the one announced"
        );
        owed = false;
        if (paid) received[token][payee] += amount;
        else pending[token][payee] += amount;
    }

    function _withdrawn(Vm.Log memory log) private {
        address token = _address(log.topics[1]);
        address payee = _address(log.topics[2]);
        (uint256 amount, address to) = abi.decode(log.data, (uint256, address));
        require(amount == pending[token][payee], "withdraw sends everything that waits");
        pending[token][payee] = 0;
        received[token][to] += amount;
    }

    /// A payout of zero is not logged.
    function _owe(uint256 handId, address payee, uint256 amount) private {
        if (amount == 0) return;
        owed = true;
        owedHand = handId;
        owedPayee = payee;
        owedAmount = amount;
    }

    function _handHash(uint256 handId) private view returns (bytes32) {
        HandView storage h = hands[handId];
        return keccak256(
            abi.encode(
                HAND_TYPEHASH, handId, h.raiser, h.token, h.rootKey, h.minGiverClaimBps, h.payoutGasK, h.dataHash
            )
        );
    }

    function _address(bytes32 topic) private pure returns (address) {
        return address(uint160(uint256(topic)));
    }
}
