// SPDX-License-Identifier: MIT

/****************************************************************************************************************************
*...........................................................................................................................*
*..                   .....................▒................................................................................*
*..  http://ahand.in  ....................▒.▒...............................................................................*
*..   @guy_do_or_die  ..............▒▒....▒.▒....▒▒.........................................................................*
*....................................▒▒▒..▒.▒..▒▒▒..........................................................................*
*......................................▒▒..▒..▒▒............................................................................*
*..............................░░▒▒..................░░▒....................................................................*
*...........................░░▒░░░▒░░▒............░▒.░░▒.░▒▒....................................................███████.....*
*........................░▒.░░▒░░░▒░░▒▒..........░░▒░░░▒░░░▒░░..................................................███████.....*
*.......................░░░▒░░▒░░░▒░░▒▒..........░░▒░░░▒░░░▒░░▒....................................................████.....*
*.......██████████......░░░▒░░▒░░░▒░░░▒..........░░▒░░░▒░░░▒░░▒......██████████.......████..██████.........███████.████.....*
*.....██████████████....░░░▒░░▒░░░▒░░░▒..........░░▒░░░▒░░░▒░░▒....██████████████.....██████████████.....██████████████.....*
*......███......████....░░░░░░░░░░░░░░▒.░░▒.▒░░..░░░░░░░░░░░░░▒.....███......█████....██████....████....██████....█████.....*
*.........██████████....░░░░░░░░░░░░░░▒░░░▒.▒░░░░░░░░░░░░░░░░░▒........███████████....████......████....████.......████.....*
*.....██████████████....░░░░░░░░░░▒▒▒▒░░░▒...▒▒░░░▒▒▒░░░░░░░░░▒.....██████████████....████......████....████.......████.....*
*....███████....████....▒░░░░░░░░▒░░░░░░▒.....▒▒░░░░░▒▒░░░░░░░▒...███████....█████....████......████....████.......████.....*
*....████......█████.....▒░░░░░░▒░░░░░░▒.......▒░░░░░░░░░░░░░▒....████.......█████....████......████....█████......████.....*
*....███████████████......▒░░░░░░░░░░▒▒.........▒▒░░░░░░░░░░▒.....████████████████....████......████.....██████████████.....*
*.....██████████████.......▒▒▒░░░░░░▒.............▒▒▒░░░░░░▒........██████████████....████......████......█████████████.....*
*...........................░░░░░░░░▒..............░░░░░░░░▒................................................................*
*...........................░░░░░░░░▒..............░░░░░░░░▒................................................................*
*...........................░░░░░░░░▒..............░░░░░░░░▒................................................................*
*...........................................................................................................................*
*...........................................................................................................................*
****************************************************************************************************************************/

pragma solidity >=0.8.20;


contract AHand {

    struct Solution {
        address giver;
        string solution;
    }

    address public immutable origin;
    address public immutable raiser;

    string public problem;
    string public link;

    uint public solutionsNumber;
    bool public solved;

    uint public constant MAX_SHAKES_CHAIN_LEN = 10;
    uint public constant MIN_CHARITY_RATE = 100;
    uint public constant MAX_CHARITY_RATE = 3333;
    uint public constant MAX_MAINT_RATE = 3333;
    uint public constant MAX_RATE = 10000;

    mapping(address => address) private refs;
    mapping(address => address) private shakes;

    mapping(uint => Solution) public solutions;

    event Shaken(address indexed ref, address indexed shaker);
    event Given(uint solutionIndex, address indexed ref, address indexed giver);

    event Comment(address indexed shaker, string comment);

    modifier onlyBase() {
        require(msg.sender == origin, "Can be called from origin contract only");
        _;
    }

    constructor(address _raiser, string memory _problem, string memory _link, address ref) payable {
        require(_raiser != address(0), "Invalid raiser address");
        origin = msg.sender;

        refs[ref] = raiser = _raiser;
        problem = _problem;
        link = _link;
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

    function shake(address ref, address newRef, address shaker, string calldata comment) external onlyBase {
        address refAddress = deRef(ref);
        require(refAddress != address(0), "No such ref");
        require(shakesChainLen(refAddress) < MAX_SHAKES_CHAIN_LEN, "Shakes chain too long");

        _shake(refAddress, shaker);
        refs[newRef] = shaker;

        emit Shaken(refAddress, shaker);

        if (bytes(comment).length > 0) {
            emit Comment(shaker, comment);
        }
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

    function thank(address thanker, uint solutionIndex, uint thankRate, address charity, uint charityRate, address maint, uint maintRate) external onlyBase returns (uint thankAmount) {
        require(!solved, "Already solved");
        require(thanker == raiser, "Only raiser can thank");
        require(thankRate <= MAX_RATE, "Invalid thank rate");
        require(charityRate <= MAX_CHARITY_RATE, "Invalid charity rate");
        require(maintRate <= MAX_MAINT_RATE, "Invalid maintenance rate");

        address giver = solutions[solutionIndex].giver;
        require(giver != address(0), "Solution doesn't exist");

        thankAmount = address(this).balance * thankRate / 10000;

        uint remainder = thankAmount;
        remainder -= handleCharity(charity, charityRate, thankAmount);
        remainder -= handleMaint(maint, maintRate, thankAmount);

        address receiver = giver;
        uint amount = remainder / 2;
        while (receiver != raiser && amount > 0 && remainder > 0) {
            uint transferAmount = amount > remainder ? remainder : amount;

            transfer(receiver, transferAmount);
            remainder -= transferAmount;
            receiver = shakes[receiver];
            amount /= 2;
        }
        
        if (remainder > 0) {
            transfer(giver, remainder);
        }

        if (address(this).balance == 0) {
            solved = true;
        }
    }

    function handleCharity(address target, uint rate, uint amount) internal returns (uint fee) {
        fee = amount * (rate > MIN_CHARITY_RATE ? rate : MIN_CHARITY_RATE) / MAX_RATE;
        transfer(target, fee);
    }

    function handleMaint(address target, uint rate, uint amount) internal returns (uint fee) {
        fee = 0;

        if (target != address(0) && rate > 0) {
            fee = amount * rate / MAX_RATE;
            transfer(target, fee);
        }
    }

    function transfer(address target, uint amount) internal {
        (bool success, ) = payable(target).call{value: amount}("");
        require(success, "Transferring failed");
    }

    function shakesChainLen(address ref) public view returns (uint length) {
        address refAddress = deRef(ref);
        length = 0;

        while (refAddress != address(0) && length < MAX_SHAKES_CHAIN_LEN) {
            refAddress = shakes[refAddress];
            length++;
        }
    }

    function shakesChain(address ref) external view returns (address[] memory chain) {
        address refAddress = deRef(ref);
        require(refAddress != address(0), "No such ref");
        
        chain = new address[](MAX_SHAKES_CHAIN_LEN);

        if(shakes[refAddress] == address(0)) {
            return new address[](0);
        }
        
        uint counter = 0;
        
        while(refAddress != address(0) && counter <= MAX_SHAKES_CHAIN_LEN) {
            chain[counter] = refAddress;
            refAddress = shakes[refAddress];
            counter++;
        }
        
        assembly {
            mstore(chain, counter)
        }
    }

}
