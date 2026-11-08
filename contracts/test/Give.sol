// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// The Give digest written out by hand, so the tests pin the signed format
/// instead of asking Core what it expects.
function giveDigest(address core, uint256 handId, bytes32 dataHash) view returns (bytes32) {
    bytes32 domain = keccak256(
        abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("aHand"),
            keccak256("core"),
            block.chainid,
            core
        )
    );
    bytes32 give = keccak256(abi.encode(keccak256("Give(uint256 handId,bytes32 dataHash)"), handId, dataHash));
    return keccak256(abi.encodePacked("\x19\x01", domain, give));
}
