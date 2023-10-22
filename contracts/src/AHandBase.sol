// SPDX-License-Identifier: MIT

pragma solidity >=0.8.20;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

import "./AHand.sol";


contract AHandBase is ERC1155 {

    uint public handsNumber;

    mapping(uint => address) public hands;

    event Raised(address indexed hand, address indexed raiser);

    constructor() ERC1155("") {}

    function raise(string calldata problem, address ref) public payable {
        require(msg.value > 0, "Reward can't be 0");
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

    function uri(uint256 tokenId) public view override returns (string memory) {
        return "";
        //return string(abi.encodePacked(metadata.name, ",", metadata.description, ",", metadata.image));
    }

    function _beforeTokenTransfer(address operator, address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) internal override(ERC1155) {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
        require(from == address(0) || to == address(0), "Transfer not allowed");
    }

}
