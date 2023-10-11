// SPDX-License-Identifier: MIT

pragma solidity >=0.8.20;

import "./AHand.sol";


contract AHandBase {

    uint public handsNumber;

    mapping(uint => address) public hands;

    event Raised(address indexed hand, address indexed raiser);

    function raise(string calldata problem, address ref) public payable {
        AHand handInstance = new AHand{value: msg.value}(msg.sender, problem, ref);
        hands[handsNumber++] = address(handInstance);
        emit Raised(address(handInstance), msg.sender);
    }

    function getHand(address contractAddress) internal pure returns (AHand handInstance) {
        handInstance = AHand(payable(contractAddress));
    }

    function getProblem(address hand) public view {
        getHand(hand).problem();
    }

    function shake(address hand, address ref, address newRef) public {
        getHand(hand).shake(ref, newRef, msg.sender);
    }

    function give(address hand, address ref, address newRef, string calldata solution) public {
        getHand(hand).give(ref, newRef, msg.sender, solution);
    }

    function thank(address hand, uint solutionIndex) public {
        getHand(hand).thank(msg.sender, solutionIndex);
    }

}
