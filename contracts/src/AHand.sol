// SPDX-License-Identifier: MIT

pragma solidity >=0.8.20;


contract AHand {

    struct Solution {
        address giver;
        string solution;
    }

    address public base;
    address public raiser;

    string public problem;

    uint public solutionsNumber;
    bool public solved;

    uint constant MAX_SHAKES_CHAIN_LENGTH = 100;

    mapping(address => address) public refs;
    mapping(address => address) public shakes;

    mapping(uint => Solution) public solutions;

    event Shaken(address indexed ref, address indexed shaker);
    event Given(uint solutionIndex, address indexed ref, address indexed giver);
    event Thanked(uint solutionIndex, address thanker, address indexed receiver, uint amount);

    modifier onlyBase() {
        require(msg.sender == base, "Can be called from base contract only");
        _;
    }

    constructor(address _raiser, string memory _problem, address ref) payable {
        require(_raiser != address(0), "Invalid raiser address");
        refs[ref] = raiser = _raiser;
        problem = _problem;
        base = msg.sender;
    }

    receive() external payable {}
    fallback() external payable {}

    function deRef(address ref) internal view returns (address refAddress) {
        refAddress = refs[ref];
    }

    function _shake(address refAddress, address shaker) internal {
        require(!solved, "Already solved");
        require(shakes[shaker] == address(0), "Already shaken");
        require(shaker != raiser, "Raiser can't solve own problem");
        require(refAddress != address(0) && refAddress != shaker, "Invalid ref");
        require(refAddress == raiser || shakes[refAddress] != address(0), "Invalid ref");

        shakes[shaker] = refAddress;
    }

    function shake(address ref, address newRef, address shaker) external onlyBase {

        address refAddress = deRef(ref);
        require(refAddress != address(0), "No such ref");

        _shake(refAddress, shaker);
        refs[newRef] = shaker;

        emit Shaken(refAddress, shaker);
    }

    function give(address ref, address newRef, address giver, string calldata solution) external onlyBase {
        address refAddress = deRef(ref);
        _shake(refAddress, giver);
        refs[newRef] = giver;

        Solution memory _solution;
        _solution.giver = giver;
        _solution.solution = solution;

        solutions[solutionsNumber] = _solution;
        emit Given(solutionsNumber, refAddress, giver);

        solutionsNumber++;
    }

    function thank(address thanker, uint solutionIndex) external onlyBase {
        require(!solved, "Already solved");
        require(thanker == raiser, "Only raiser can thank");

        address giver = solutions[solutionIndex].giver;
        require(giver != address(0), "Solution doesn't exist");

        uint remainder = address(this).balance;

        address receiver = giver;
        uint amount = remainder / 2;

        while (receiver != raiser && amount > 0 && remainder > 0) {
            uint transferAmount = amount > remainder ? remainder : amount;

            (bool thankSuccess, ) = payable(receiver).call{value: transferAmount}("");
            require(thankSuccess, "Thank shaker failed");

            emit Thanked(solutionIndex, thanker, receiver, transferAmount);

            remainder -= transferAmount;
            receiver = shakes[receiver];
            amount /= 2;
        }
        
        if (remainder > 0) {
            (bool thankSuccess, ) = payable(deRef(giver)).call{value: remainder}("");
            require(thankSuccess, "Thank giver failed");
        }

        solved = true;
    }

    function shakesChain(address ref) external view returns (address[] memory chain) {
        address refAddress = deRef(ref);
        require(refAddress != address(0), "No such ref");
        
        chain = new address[](MAX_SHAKES_CHAIN_LENGTH);

        if(shakes[refAddress] == address(0)) {
            return new address[](0);
        }
        
        uint counter = 0;
        
        while(refAddress != address(0) && counter < MAX_SHAKES_CHAIN_LENGTH) {
            chain[counter] = refAddress;
            refAddress = shakes[refAddress];
            counter++;
        }
        
        assembly {
            mstore(chain, counter)
        }
    }

}
