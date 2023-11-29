// SPDX-License-Identifier: MIT

pragma solidity >=0.8.20;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./AHand.sol";


contract AHandBase is ERC1155 {

    uint public handsNumber;

    mapping(uint => address) public hands;

    uint private constant RAISE = 0;
    uint private constant SHAKE = 1;
    uint private constant GIVE = 2;
    uint private constant THANK = 3;
    uint private constant UP = 4;
    uint private constant DOWN = 5;
    uint private constant PIC_SIZE = 1024;

    event Raised(address indexed hand, address indexed raiser);

    constructor() ERC1155("") {}

    function raise(string calldata problem, address ref) public payable {
        require(msg.value > 0, "Reward can't be 0");
        AHand handInstance = new AHand{value: msg.value}(msg.sender, problem, ref);
        hands[handsNumber++] = address(handInstance);
        _mint(msg.sender, RAISE, 1, "");
        _mint(msg.sender, UP, 1, "");
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
        _mint(msg.sender, SHAKE, 1, "");
    }

    function give(address hand, address ref, address newRef, string calldata solution) public {
        getHand(hand).give(ref, newRef, msg.sender, solution);
        _mint(msg.sender, GIVE, 1, "");
        _mint(msg.sender, UP, 1, "");
    }

    function thank(address hand, uint solutionIndex) public {
        getHand(hand).thank(msg.sender, solutionIndex);
        _mint(msg.sender, THANK, 1, "");
    }

    function thumbsDown(address account) public {
        require(balanceOf(account, UP) > 0, "You need to have at least one UP token");
        _burn(account, UP, 1);
        _mint(account, DOWN, 1, "");
    }

    function getImage(uint tokenId) internal pure returns (string memory) {
        string memory emoji;
        if (tokenId == RAISE) emoji = unicode"✋";
        else if (tokenId == SHAKE) emoji = unicode"🤝";
        else if (tokenId == GIVE) emoji = unicode"🙌";
        else if (tokenId == THANK) emoji = unicode"🙏";
        else if (tokenId == UP) emoji = unicode"👍";
        else if (tokenId == DOWN) emoji = unicode"👎";
        else return "";

        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="', Strings.toString(PIC_SIZE),
            '" height="', Strings.toString(PIC_SIZE), '">',
            '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="', Strings.toString(PIC_SIZE / 2), '">',
            emoji,
            '</text></svg>'
        ));
    }

    function uri(uint tokenId) public pure override returns (string memory) {
        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(
                    abi.encodePacked(
                        abi.encodePacked(
                            "{",
                                '  "image": "', Base64.encode(bytes(getImage(tokenId))), '"',
                                ', "name":"Bit #', Strings.toString(tokenId), '"',
                                ', "description": "aHand"',
                            "}"
                        )
                    )
                )
            )
        );
    }

    function _beforeTokenTransfer(address operator, address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) internal override(ERC1155) {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
        require(from == address(0) || to == address(0), "Transfer not allowed");
    }

}
