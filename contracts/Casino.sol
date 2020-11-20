// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;
pragma experimental ABIEncoderV2;

//import "@openzeppelin/contracts/math/SafeMath.sol"
import "./openzeppelin/SafeMath.sol";
import "./Pausable.sol";

/*
* A Casino for playing «rock-paper-scissors» game
*/
contract Casino is Pausable {

    using SafeMath for uint;
    uint public constant REVEAL_PERIOD = 5 minutes;
    mapping(uint => Move) public predators;
    uint public depositPercentage;

    // gameId -> Game
    mapping(bytes32 => Game) public games;
    // playerAddress -> balances
    mapping(address => uint) public balances;

    struct Game {
        uint gamePrice;
        uint attackerDeposit;
        address attacker;
        address defender;
        Move defenderMove;
        uint revealTimeoutDate;
        bool isClosed;
    }

    enum Move {ROCK, PAPER, SCISSORS}

    //playing
    event AttackEvent(bytes32 indexed gameId, address indexed player, uint lockedAttackerDeposit);
    event DefenseEvent(bytes32 indexed gameId, address indexed player, Move move, uint revealTimeoutDate);
    //end game
    event CanceledGameEvent(bytes32 indexed gameId, uint refund);
    event RewardDefenderSinceAttackerRunawayEvent(bytes32 indexed gameId, uint reward);
    event RewardWinnerEvent(bytes32 indexed gameId, address indexed winner, uint reward, uint unlockedAttackerDeposit);
    //balance
    event IncreasedBalanceEvent(address indexed player, uint amount);
    event WithdrawBalanceEvent(address indexed player, uint reward); //todo rename amount

    constructor(bool isPaused, uint _depositPercentage) public Pausable(isPaused) {
        require(_depositPercentage <= 100, "Deposit percentage should be between 0 and 100");
        depositPercentage = _depositPercentage;

        predators[uint(Move.ROCK)] = Move.PAPER;
        predators[uint(Move.PAPER)] = Move.SCISSORS;
        predators[uint(Move.SCISSORS)] = Move.ROCK;
    }

    function getMove(bytes32 move) public pure returns (Move)  {
        if (move == keccak256("ROCK")) {
            return Move.ROCK;
        } else if (move == keccak256("PAPER")) {
            return Move.PAPER;
        } else if (move == keccak256("SCISSORS")) {
            return Move.SCISSORS;
        }
        revert("Move should be keccak256(<ROCK|PAPER|SCISSORS>)");
    }

    function buildSecretMoveHashAsGameId(address player, Move move, bytes32 secret) public view returns (bytes32)  {
        require(player != address(0), "Player should not be empty");
        require(secret != bytes32(0), "Secret should not be empty");

        return keccak256(abi.encodePacked(
                address(this),
                player,
                uint(move),
                secret
            ));
    }

    /*
    * The attacker (1) pays like the defender a price <gamePrice> for playing,
    * but also (2) locks temporarily an amount <attackerDeposit> to force
    * him to stay until the end of the game even if he's a sore loser
    */
    function attack(bytes32 attackerSecretMoveHash) public payable whenNotPaused returns (bool)  {
        require(attackerSecretMoveHash != bytes32(0), "Provided attackerSecretMoveHash cannot be empty");
        Game storage game = games[attackerSecretMoveHash]; // attackerSecretMoveHash is gameId
        require(game.attacker == address(0), "Attacker already played (please defend or start new game instead)");

        uint attackerDeposit = msg.value.mul(depositPercentage).div(100);
        game.gamePrice = msg.value.sub(attackerDeposit);
        game.attackerDeposit = attackerDeposit;
        //TODO: Check value in balance too

        game.attacker = msg.sender;
        emit AttackEvent(attackerSecretMoveHash, msg.sender, attackerDeposit); //TODO Add gameprice
        return true;
    }

    function defend(bytes32 gameId, Move defenderMove) public payable whenNotPaused returns (bool)  {
        Game storage game = games[gameId];
        require(!game.isClosed, "Game is closed (please start new game instead)");
        require(game.defender == address(0), "Defender already played (please reveal attacker move or start new game instead)");
        require(msg.sender != game.attacker, "Attacker and defender should be different");
        require(msg.value == game.gamePrice, "Value should equal game price");
        //TODO: Check value in balance too

        game.defender = msg.sender;
        game.defenderMove = defenderMove;
        uint revealTimeoutDate = now.add(REVEAL_PERIOD.mul(1 minutes));
        game.revealTimeoutDate = revealTimeoutDate;
        emit DefenseEvent(gameId, msg.sender, defenderMove, revealTimeoutDate);
        return true;
    }

    //TODO: Split?
    function revealAttackAndReward(bytes32 gameId, Move attackerMove, bytes32 attackerSecret) public whenNotPaused returns (bool success)  {
        Game storage game = games[gameId];
        require(!game.isClosed, "Game is closed (please start new game instead)");
        require(buildSecretMoveHashAsGameId(msg.sender, attackerMove, attackerSecret) == gameId, "Failed to decrypt attacker move with attacker secret");

        address defender = game.defender;
        Move defenderMove = game.defenderMove;
        uint gamePrice = game.gamePrice;
        uint attackerDeposit = game.attackerDeposit;
        uint reward = gamePrice.mul(2);
        address winner;

        if (attackerMove == predators[uint(defenderMove)]) {
            winner = msg.sender;
            increaseBalance(msg.sender, reward.add(attackerDeposit)); // refund deposit too
        } else if (defenderMove == predators[uint(attackerMove)]) {
            winner = defender;
            increaseBalance(defender, reward);
            increaseBalance(msg.sender, attackerDeposit);
        } else { //not sure could happen, at least avoids dead lock for attacker
            winner = address(0);
            //refund
            increaseBalance(defender, gamePrice);
            increaseBalance(msg.sender, gamePrice.add(attackerDeposit));
        }

        game.isClosed = true;
        emit RewardWinnerEvent(gameId, winner, reward, attackerDeposit); //TODO update
        return true;
    }

    function rewardDefenderSinceAttackerRunaway(bytes32 gameId) public whenNotPaused returns (bool)  { // could be trigger by anyone
        Game storage game = games[gameId];
        require(!game.isClosed, "Game is closed");
        require(now > game.revealTimeoutDate, "Should wait reveal period for rewarding defender");

        address defender = game.defender;
        uint reward = game.gamePrice.mul(2).add(game.attackerDeposit);
        increaseBalance(defender, reward); //defender takes all (reward + security deposit)
        game.isClosed = true;
        emit RewardDefenderSinceAttackerRunawayEvent(gameId, reward);
        return true;
    }

    function cancelGame(bytes32 gameId) public whenNotPaused returns (bool)  {
        Game storage game = games[gameId];
        require(!game.isClosed, "Game is closed");
        require(msg.sender == game.attacker, "Only attacker can cancel attack");
        require(game.defender == address(0), "Defender already player (please reveal instead)");
        uint refund = game.gamePrice.add(game.attackerDeposit);
        increaseBalance(msg.sender, refund);
        game.isClosed = true;
        // TODO: eventually free up more space for game
        emit CanceledGameEvent(gameId, refund);
        return true;
    }

    function increaseBalance(address player, uint amount) private {
        balances[player] = balances[player].add(amount);
        emit IncreasedBalanceEvent(player, amount);
    }

    function withdrawBalance() public whenNotPaused returns (bool success)  {
        require(balances[msg.sender] > 0, "Cannot withdraw empty balance");
        uint reward = balances[msg.sender];
        balances[msg.sender] = 0;
        emit WithdrawBalanceEvent(msg.sender, reward);
        (success,) = msg.sender.call.value(reward)("");
        require(success, "WithdrawBalance transfer failed");
    }

}
