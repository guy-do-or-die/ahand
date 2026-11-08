// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AHandCore, Shake, Give} from "../src/AHandCore.sol";

/// The signed formats written out by hand, so the tests pin them instead of asking Core
/// what it expects.
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

function shakeStructHash(uint256 handId, Shake memory s) pure returns (bytes32) {
    return keccak256(
        abi.encode(
            keccak256(
                "Shake(uint256 handId,address nextKey,address payee,uint16 claimBps,uint16 nextClaimBps,bytes32 dataHash)"
            ),
            handId,
            s.nextKey,
            s.payee,
            s.claimBps,
            s.nextClaimBps,
            s.dataHash
        )
    );
}

function giveStructHash(uint256 handId, Give memory g) pure returns (bytes32) {
    return keccak256(
        abi.encode(
            keccak256(
                "Give(uint256 handId,bytes32 routeHash,address signer,address payee,uint16 claimBps,bytes32 dataHash)"
            ),
            handId,
            g.routeHash,
            g.signer,
            g.payee,
            g.claimBps,
            g.dataHash
        )
    );
}

function digestOf(address core, bytes32 structHash) view returns (bytes32) {
    return keccak256(abi.encodePacked("\x19\x01", domainOf(core), structHash));
}

/// What `hands(id)` returns, decoded whole: twelve values do not fit on the stack at once.
struct HandView {
    address raiser;
    uint40 expiry;
    uint16 minGiverClaimBps;
    uint40 raisedAt;
    address token;
    uint16 payoutGasK;
    uint40 thankedAt;
    uint40 reclaimedAt;
    uint256 amount;
    address rootKey;
    bytes32 dataHash;
    bytes32 giveHash;
}

function handOf(AHandCore core, uint256 id) view returns (HandView memory) {
    (bool ok, bytes memory ret) = address(core).staticcall(abi.encodeWithSelector(core.hands.selector, id));
    require(ok, "hands() failed");
    return abi.decode(ret, (HandView));
}
