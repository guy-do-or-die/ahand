// SPDX-License-Identifier: MIT

pragma solidity >=0.8.20;

import "./AHand.sol";

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "@opengsn/contracts/src/ERC2771Recipient.sol";


contract AHandBase is Context, ERC2771Recipient, ERC1155 {

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

    event Up(address indexed from, address indexed to);
    event Down(address indexed from, address indexed to);

    constructor() ERC1155("aHand") {}

    function raise(string calldata problem, address ref) public payable {
        require(msg.value > 0);
        
        address sender = _msgSender();

        AHand handInstance = new AHand{value: msg.value}(sender, problem, ref);
        hands[handsNumber++] = address(handInstance);
        _mint(sender, RAISE, 1, "");
        emit Raised(address(handInstance), sender);
    }

    function getHand(address contractAddress) internal pure returns (AHand handInstance) {
        handInstance = AHand(payable(contractAddress));
    }

    function getProblem(address hand) public view {
        getHand(hand).problem();
    }

    function shake(address hand, address ref, address newRef) public {
        address sender = _msgSender(); 

        getHand(hand).shake(ref, newRef, sender);
        _mint(sender, SHAKE, 1, "");
    }

    function give(address hand, address ref, address newRef, string calldata solution) public {
        address sender = _msgSender();

        getHand(hand).give(ref, newRef, sender, solution);
        _mint(sender, GIVE, 1, "");
    }

    function thank(address hand, uint solutionIndex, string calldata comment) public {
        address sender = _msgSender();

        AHand handInstance = getHand(hand);

        handInstance.thank(sender, solutionIndex);
        (address giver, ) = handInstance.solutions(solutionIndex);

        _mint(sender, THANK, 1, "");

        _mint(sender, UP, bytes(comment).length > 100 ? 2 : 1, "");
        _mint(giver, UP, 1, "");
    }

    function thumbsUp(address account) public {
        address sender = _msgSender();

        require(balanceOf(sender, UP) > 0);

        _burn(sender, UP, 1);
        _mint(account, UP, 1, "");

        emit Up(sender, account);
    }

    function thumbsDown(address account) public {
        address sender = _msgSender();

        require(balanceOf(sender, UP) > 0, "You need to have at least one UP token");

        _burn(sender, UP, 1);
        _mint(account, DOWN, 1, "");

        if (balanceOf(sender, UP) > 0) _burn(account, UP, 1);

        emit Down(sender, account);
    }

    function getImage(uint tokenId) internal pure returns (bytes memory) {
        string memory emoji;
        if (tokenId == RAISE) emoji = unicode"✋";
        else if (tokenId == SHAKE) emoji = unicode"🤝";
        else if (tokenId == GIVE) emoji = unicode"🙌";
        else if (tokenId == THANK) emoji = unicode"🙏";
        else if (tokenId == UP) emoji = unicode"👍";
        else if (tokenId == DOWN) emoji = unicode"👎";
        else return "";

        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="', Strings.toString(PIC_SIZE), '" height="', Strings.toString(PIC_SIZE), '">',
            '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="128" font-family="EmojiFont, sans-serif">',
            emoji, '</text></svg>'
        );
    }

    function uri(uint tokenId) public pure override returns (string memory) {
        string memory name;
        if (tokenId == RAISE) name = "Raised";
        else if (tokenId == SHAKE) name = "Shaken";
        else if (tokenId == GIVE) name = "Given";
        else if (tokenId == THANK) name = "Thanked";
        else if (tokenId == UP) name = "Thumb Up";
        else if (tokenId == DOWN) name = "Thumb Down";
        else return "";

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(
                    abi.encodePacked(
                        abi.encodePacked(
                            "{",
                                '  "image": "', Base64.encode(getImage(tokenId)), '"',
                                ', "name": "', name, '"',
                                ', "description": "aHand move"',
                            "}"
                        )
                    )
                )
            )
        );
    }

    function _msgSender() internal view virtual override(Context, ERC2771Recipient) returns (address sender) {
        return ERC2771Recipient._msgSender();
    }

    function _msgData() internal view virtual override(Context, ERC2771Recipient) returns (bytes calldata) {
        return ERC2771Recipient._msgData();
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public virtual override {
        require(from == address(0) || to == address(0), "Non-transferable token");
        super.safeTransferFrom(from, to, id, amount, data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public virtual override {
        require(from == address(0) || to == address(0), "Non-transferable token");
        super.safeBatchTransferFrom(from, to, ids, amounts, data);
    }

}
