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
    uint public attackerDeposit;
    uint public gamePrice;
    mapping(uint => Move) public predators;

    // gameId -> Game
    mapping(bytes32 => Game) public games;
    // playerAddress -> lock
    mapping(address => uint) public locked;
    // playerAddress -> reward
    mapping(address => uint) public rewards;
    // playerAddress -> unlock
    mapping(address => uint) public unlocked;

    struct Game {
        address attacker;
        address defender;
        Move defenderMove;
        bool isClosed;
    }

    enum Move {ROCK, PAPER, SCISSORS}

    event AttackEvent(bytes32 indexed gameId, address indexed player, uint lockedAttackerDeposit);
    event DefenseEvent(bytes32 indexed gameId, address indexed player, Move move);
    event RewardWinnerEvent(bytes32 indexed gameId, address indexed winner, uint reward, uint unlockedAttackerDeposit);
    event WithdrawRewardEvent(address indexed player, uint reward);

    constructor(bool isPaused, uint _gamePrice) public Pausable(isPaused) {
        gamePrice = _gamePrice;
        attackerDeposit = gamePrice; //use percentage?

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
        require(msg.value == attackerDeposit.add(gamePrice), "Value should equal attacker deposit + game price");

        game.attacker = msg.sender;
        locked[msg.sender] = locked[msg.sender].add(gamePrice);
        emit AttackEvent(attackerSecretMoveHash, msg.sender, attackerDeposit);
        return true;
    }

    function defend(bytes32 gameId, Move defenderMove) public payable whenNotPaused returns (bool)  {
        Game storage game = games[gameId];
        require(game.defender == address(0), "Defender already played (please reveal attacker move or start new game instead)");
        require(msg.sender != game.attacker, "Attacker and defender should be different");
        require(msg.value == gamePrice, "Value should equal game price");

        game.defender = msg.sender;
        game.defenderMove = defenderMove;
        emit DefenseEvent(gameId, msg.sender, defenderMove);
        return true;
    }

    function revealAttackAndReward(bytes32 gameId, Move attackerMove, bytes32 attackerSecret) public whenNotPaused returns (bool success)  {
        Game storage game = games[gameId];
        require(!game.isClosed, "Game is closed (please start new game instead)");
        require(buildSecretMoveHashAsGameId(msg.sender, attackerMove, attackerSecret) == gameId, "Failed to decrypt attacker move with attacker secret");

        address winner;
        Move defenderMove = game.defenderMove;
        if (attackerMove == predators[uint(defenderMove)]) {
            winner = game.attacker;
        } else if (defenderMove == predators[uint(attackerMove)]) {
            winner = game.defender;
        } else {
            winner = this.owner(); //not sure could happen, at least avoids dead lock for attacker
        }
        uint reward = gamePrice.mul(2);
        rewards[winner] = rewards[winner].add(reward);
        game.isClosed = true;
        locked[msg.sender] = locked[msg.sender].sub(attackerDeposit);
        unlocked[msg.sender] = unlocked[msg.sender].add(attackerDeposit);
        emit RewardWinnerEvent(gameId, winner, reward, attackerDeposit);
        return true;
    }

    //TODO: Add reveal timeout so defender can claim reward after that

    function withdrawReward() public whenNotPaused returns (bool success)  {
        require(rewards[msg.sender] > 0, "No reward to withdraw");
        uint reward = rewards[msg.sender];
        rewards[msg.sender] = 0;
        emit WithdrawRewardEvent(msg.sender, reward);
        (success,) = msg.sender.call.value(reward)("");
        require(success, "WithdrawReward transfer failed");
    }

    //TODO: Merge unlocked/rewards maps or Add method for withdrawing unlocked funds

}
