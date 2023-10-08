// SPDX-License-Identifier: MIT

pragma solidity >=0.8.20;


contract AHand {

    struct Solution {
        address giver;
        string solution;
    }

    address public raiser;
    string public problem;

    uint public solutionsNumber;
    bool public solved;

    mapping(address => address) public shakes;
    mapping(uint => Solution) public solutions;

    event Shaken(address indexed referrer, address indexed shaker);
    event Given(uint solutionIndex, address indexed referrer, address indexed giver);

    event Thanked(address indexed receiver, uint amount);

    constructor(address _raiser, string memory _problem) payable {
        require(_raiser != address(0), "Invalid raiser address");
        raiser = _raiser;
        problem = _problem;
    }

    receive() external payable {}
    fallback() external payable {}

    function _shake(address referrer) internal {
        require(!solved, "Already solved");
        require(shakes[msg.sender] == address(0), "Already shaken");
        require(referrer != address(0) && (referrer == raiser || shakes[referrer] != address(0)), "Invalid recepient");

        shakes[msg.sender] = referrer;
    }

    function shake(address referrer) external {
        _shake(referrer);

        emit Shaken(referrer, msg.sender);
    }

    function give(address referrer, string calldata solution) external {
        _shake(referrer);

        Solution memory _solution;
        _solution.giver = msg.sender;
        _solution.solution = solution;

        solutions[solutionsNumber] = _solution;
        emit Given(solutionsNumber, referrer, msg.sender);

        solutionsNumber++;
    }

    function thank(uint solutionIndex) external {
        require(!solved, "Already solved");
        require(msg.sender == raiser, "Only raiser can thank");

        address receiver = solutions[solutionIndex].giver;
        require(receiver != address(0), "Solution doesn't exist");

        uint256 amount;
        if (shakes[receiver] == raiser) {
            amount = address(this).balance;
            payable(receiver).transfer(amount);
        } else {
            amount = address(this).balance / 2;

            while (receiver != raiser && amount > 0) {
                payable(receiver).transfer(amount);
                emit Thanked(receiver, amount);

                receiver = shakes[receiver];
                amount /= 2;
            }
        }

        solved = true;
    }

}
