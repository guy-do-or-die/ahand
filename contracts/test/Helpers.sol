// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AHandCore, Shake, Give} from "../src/AHandCore.sol";

/// The signed formats written out by hand, so the tests pin them instead of asking Core
/// what it expects. A Hand's terms are read from Core, as an application reads them from `Raised`.
function domainOf(address core) view returns (bytes32) {
    return keccak256(
        abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("aHand"),
            keccak256("core"),
            block.chainid,
            core
        )
    );
}

/// What a Shake or a Give names the Hand by: everything `raise` fixes for good, not reward or expiry.
function handStructHash(AHandCore core, uint256 handId) view returns (bytes32) {
    HandView memory hand = handOf(core, handId);
    return keccak256(
        abi.encode(
            keccak256(
                "Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
            ),
            handId,
            hand.raiser,
            hand.token,
            hand.rootKey,
            hand.payoutGasK,
            hand.minClaimBps,
            hand.dataHash
        )
    );
}

function shakeStructHash(AHandCore core, uint256 handId, Shake memory shake) view returns (bytes32) {
    return keccak256(
        abi.encode(
            keccak256(
                "Shake(Hand hand,address nextKey,address payee,uint16 claimBps,uint16 nextClaimBps,bytes32 dataHash)Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
            ),
            handStructHash(core, handId),
            shake.nextKey,
            shake.payee,
            shake.claimBps,
            shake.nextClaimBps,
            shake.dataHash
        )
    );
}

function giveStructHash(AHandCore core, uint256 handId, Give memory give) view returns (bytes32) {
    return keccak256(
        abi.encode(
            keccak256(
                "Give(Hand hand,address signer,address payee,uint16 claimBps,bytes32 routeHash,bytes32 dataHash)Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)"
            ),
            handStructHash(core, handId),
            give.signer,
            give.payee,
            give.claimBps,
            give.routeHash,
            give.dataHash
        )
    );
}

function digestOf(address core, bytes32 structHash) view returns (bytes32) {
    return keccak256(abi.encodePacked("\x19\x01", domainOf(core), structHash));
}

/// What `hands(id)` returns, as one value.
struct HandView {
    address raiser;
    uint40 expiry;
    uint40 openedAt;
    uint40 closedAt;
    address token;
    uint16 payoutGasK;
    uint16 minClaimBps;
    uint256 reward;
    address rootKey;
    bytes32 dataHash;
}

/// What `thanks(id)` returns, as one value.
struct ThankView {
    bytes32 giveHash;
    bytes32 dataHash;
}

function handOf(AHandCore core, uint256 id) view returns (HandView memory) {
    (bool ok, bytes memory ret) = address(core).staticcall(abi.encodeWithSelector(core.hands.selector, id));
    require(ok, "hands() failed");
    return abi.decode(ret, (HandView));
}

function thankOf(AHandCore core, uint256 id) view returns (ThankView memory thank) {
    (thank.giveHash, thank.dataHash) = core.thanks(id);
}
