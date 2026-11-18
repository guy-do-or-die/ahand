// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AHandCore, Shake, Give} from "../../src/AHandCore.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HandView, handOf} from "../Helpers.sol";

/// A reader outside Core, such as Signals or a bonus paid on top: from Core's storage and a route
/// anyone hands it, it proves who helped in a thanked Hand and what each one was due. It reads no
/// events and trusts no indexer. The signed formats are written out again here, as any reader must.
contract FactsReader {
    bytes32 constant HAND_TYPEHASH = keccak256(
        "Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
    );
    bytes32 constant SHAKE_TYPEHASH = keccak256(
        "Shake(Hand hand,address nextKey,address payee,uint16 claimBps,uint16 nextClaimBps,bytes32 dataHash)Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
    );
    bytes32 constant GIVE_TYPEHASH = keccak256(
        "Give(Hand hand,address signer,address payee,uint16 claimBps,bytes32 routeHash,bytes32 dataHash)Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
    );

    /// What one payee was due: a shaker's margin, or the rest for the giver's payee. `dataHash` is
    /// the Shake's reason or the giver's answer.
    struct Payout {
        address payee;
        uint256 amount;
        bytes32 dataHash;
    }

    error NotThanked();
    error NotTheThankedRoute();
    error NotTheThankedGive();

    AHandCore immutable core;

    constructor(AHandCore core_) {
        core = core_;
    }

    function proveThank(
        uint256 handId,
        Shake[] calldata shakes,
        Give calldata give
    ) external view returns (address raiser, address giver, Payout[] memory payouts) {
        HandView memory hand = handOf(core, handId);
        (bytes32 thankedGive,) = core.thanks(handId);
        if (thankedGive == bytes32(0)) revert NotThanked();
        bytes32 handHash = keccak256(
            abi.encode(
                HAND_TYPEHASH,
                handId,
                hand.raiser,
                hand.token,
                hand.rootKey,
                hand.payoutGasK,
                hand.minClaimBps,
                hand.dataHash
            )
        );

        bytes32 routeHash;
        uint256 rest = hand.reward;
        payouts = new Payout[](shakes.length + 1);
        for (uint256 position; position < shakes.length; ++position) {
            Shake calldata shake = shakes[position];
            bytes32 shakeHash = keccak256(
                abi.encode(
                    SHAKE_TYPEHASH,
                    handHash,
                    shake.nextKey,
                    shake.payee,
                    shake.claimBps,
                    shake.nextClaimBps,
                    shake.dataHash
                )
            );
            routeHash = keccak256(abi.encode(routeHash, shakeHash));
            uint256 margin = Math.mulDiv(hand.reward, shake.claimBps - shake.nextClaimBps, 10_000);
            rest -= margin;
            payouts[position] = Payout(shake.payee, margin, shake.dataHash);
        }
        if (give.routeHash != routeHash) revert NotTheThankedRoute();
        bytes32 giveHash = keccak256(
            abi.encode(GIVE_TYPEHASH, handHash, give.signer, give.payee, give.claimBps, give.routeHash, give.dataHash)
        );
        if (giveHash != thankedGive) revert NotTheThankedGive();

        payouts[shakes.length] = Payout(give.payee, rest, give.dataHash);
        return (hand.raiser, give.signer, payouts);
    }
}
