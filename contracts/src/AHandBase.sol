// SPDX-License-Identifier: MIT

pragma solidity >=0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./AHand.sol";


contract AHandBase is ERC1155, Ownable {

    string public name = "aHand";

    uint public raisedHandsNumber;
    uint public solvedHandsNumber;

    uint public shakesNumber;
    uint public givesNumber;
    uint public thanksNumber;

    uint public rewardsDistributed;

    mapping(uint => address) public hands;
    mapping(address => int) public trust;
    mapping(address => bool) public charities;

    uint private constant RAISE = 0;
    uint private constant SHAKE = 1;
    uint private constant GIVE = 2;
    uint private constant THANK = 3;
    uint private constant UP = 4;
    uint private constant DOWN = 5;

    uint private constant MINIMUM_REWARD = 0.00001 ether;
    uint private constant PIC_SIZE = 256;

    event Raised(address indexed hand, address indexed raiser);
    event Thanked(address indexed hand, uint solutionIndex, uint amount, string comment);

    event Up(address indexed from, address indexed to);
    event Down(address indexed from, address indexed to);

    event SuccessStory(address indexed hand, uint solutionIndex, string story);


    constructor() ERC1155("") Ownable(msg.sender) {}

    function _mintWithTrust(address account, uint id, uint amount, bytes memory data) internal {
        _mint(account, id, amount, data);

        if (id == UP) {
            uint balance = balanceOf(account, UP);

            if (trust[account] > 0 && balance > uint(trust[account])) {
                trust[account] = int(balance);
            }
        } else if (id == DOWN) {
            trust[account] -= int(amount);
        }
    }

    function raise(string calldata problem, string calldata link, address ref) public payable {
        require(msg.value > MINIMUM_REWARD, "Reward is too low");

        AHand handInstance = new AHand{value: msg.value}(msg.sender, problem, link, ref);
        hands[raisedHandsNumber] = address(handInstance);
        _mint(msg.sender, RAISE, 1, "");

        emit Raised(address(handInstance), msg.sender);

        raisedHandsNumber++;
    }

    function getHand(address contractAddress) internal pure returns (AHand handInstance) {
        handInstance = AHand(payable(contractAddress));
    }

    function shake(address hand, address ref, address newRef, string calldata comment) public {
        getHand(hand).shake(ref, newRef, msg.sender, comment);
        _mint(msg.sender, SHAKE, 1, "");

        shakesNumber++;
    }

    function give(address hand, address ref, address newRef, string calldata solution) public {
        getHand(hand).give(ref, newRef, msg.sender, solution);
        _mint(msg.sender, GIVE, 1, "");

        givesNumber++;
    }

    function thank(address hand, uint solutionIndex, uint thankRate, address charity, uint charityRate, address maint, uint maintRate, string calldata comment) public {
        require(charities[charity], "Charity is not valid");

        AHand handInstance = getHand(hand);

        uint thankAmount = handInstance.thank(msg.sender, solutionIndex, thankRate, charity, charityRate, maint, maintRate);
        (address giver, ) = handInstance.solutions(solutionIndex);

        _mint(msg.sender, THANK, 1, "");

        uint ups = 1;
        bool withSuccessStory = false;

        if (bytes(comment).length > 100) {
            ups = 2;
            withSuccessStory = true;
        }

        _mintWithTrust(msg.sender, UP,  ups, "");
        _mintWithTrust(giver, UP, 1, "");

        emit Thanked(hand, solutionIndex, thankAmount, comment);

        if (withSuccessStory) {
            emit SuccessStory(hand, solutionIndex, comment);
        }

        rewardsDistributed += thankAmount;

        if (address(hand).balance == 0) {
            solvedHandsNumber += 1;
        }

        thanksNumber++;
    }

    function thumbUp(address account) public {
        require(balanceOf(msg.sender, UP) > 0, "Insufficient UP token");

        _burn(msg.sender, UP, 1);
        _mintWithTrust(account, UP, 1, "");

        emit Up(msg.sender, account);
    }

    function thumbDown(address account) public {
        require(balanceOf(msg.sender, UP) > 0, "Insufficient UP token");

        _burn(msg.sender, UP, 1);
        _mintWithTrust(account, DOWN, 1, "");

        if (balanceOf(account, UP) > 0) _burn(account, UP, 1);

        emit Down(msg.sender, account);
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
            '<text x="50%" y="60%" text-anchor="middle" font-size="64" font-family="EmojiFont, sans-serif">',
            emoji, '</text></svg>'
        );
    }

    function uri(uint tokenId) public pure override returns (string memory) {
        string memory title;
        if (tokenId == RAISE) title = "Raised";
        else if (tokenId == SHAKE) title = "Shaken";
        else if (tokenId == GIVE) title = "Given";
        else if (tokenId == THANK) title = "Thanked";
        else if (tokenId == UP) title = "Thumb Up";
        else if (tokenId == DOWN) title = "Thumb Down";
        else return "";

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(
                    abi.encodePacked(
                        "{",
                            '  "name": "', title, '"',
                            ', "description": "http://ahand.in"',
                            ', "image": "data:image/svg+xml;base64,', Base64.encode(getImage(tokenId)), '"',
                        "}"
                    )
                )
            )
        );
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes memory data) public virtual override {
        require(from == address(0) || to == address(0), "Non-transferable token");
        super.safeTransferFrom(from, to, id, amount, data);
    }

    function safeBatchTransferFrom(address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) public virtual override {
        require(from == address(0) || to == address(0), "Non-transferable token");
        super.safeBatchTransferFrom(from, to, ids, amounts, data);
    }

    function addCharity(address charityAddress) public onlyOwner {
        charities[charityAddress] = true;
    }

    function removeCharity(address charityAddress) public onlyOwner {
        delete charities[charityAddress];
    }

}