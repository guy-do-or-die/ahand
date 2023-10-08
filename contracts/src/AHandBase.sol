// SPDX-License-Identifier: MIT

pragma solidity >=0.8.20;

import "./AHand.sol";


contract AHandBase {

    mapping(uint => address) public hands;
    uint public handsNumber;

    function raise(string calldata problem) public payable {
        AHand aHand = new AHand{value: msg.value}(msg.sender, problem);
        hands[handsNumber++] = address(aHand);
    }

}
