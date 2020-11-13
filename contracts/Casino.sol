// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;
pragma experimental ABIEncoderV2;

//import "@openzeppelin/contracts/math/SafeMath.sol"
import "./openzeppelin/SafeMath.sol";
import "./Pausable.sol";

contract Casino is Pausable {

    using SafeMath for uint;
    uint public gameDeposit;
    uint public gamePrice;
    mapping(uint => Move) public predators;

    uint public joinableGameId;
    // gameId -> Game
    mapping(uint => Game) public games;
    // playerAddress -> reward
    mapping(address => uint) public rewards;

    struct Game {
        GameStatus status;
        // TODO?: flat following structs
        PlayerMove playerMove0;
        PlayerMove playerMove1;
    }

    struct PlayerMove {
        address player;
        Move move;
    }

    enum Move {ROCK, PAPER, SCISSORS}
    enum GameStatus {WAITING_FIRST_PLAYER, WAITING_SECOND_PLAYER, PENDING_REWARD, CLOSED}

    event PlayEvent(uint indexed gameId, address indexed player, Move move);
    event RewardWinnerEvent(uint indexed gameId, address indexed player, uint reward);
    event WithdrawRewardEvent(address indexed player, uint reward);

    constructor(bool isPaused, uint _gamePrice) public Pausable(isPaused) {
        gamePrice = _gamePrice;
        gameDeposit = gamePrice.mul(2);

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

    /// TODO?: remove gameId
    function play(uint gameId, Move move) public payable returns (bool)  {
        require(gameId == joinableGameId, "Provided gameId is not joinable");
        require(msg.value == gamePrice, "Provided value does not match game price");
        Game storage game = games[gameId];
        GameStatus status = game.status;

        if (status == GameStatus.WAITING_FIRST_PLAYER) {
            game.playerMove0 = PlayerMove(msg.sender, move);
            game.status = GameStatus.WAITING_SECOND_PLAYER;
        } else if (status == GameStatus.WAITING_SECOND_PLAYER) {
            require(msg.sender != game.playerMove0.player, "Second player should be different from first player");
            game.playerMove1 = PlayerMove(msg.sender, move);
            game.status = GameStatus.PENDING_REWARD;
            joinableGameId = joinableGameId.add(1);
        } else {
            revert("Not waiting for new players, both players already played");
        }

        emit PlayEvent(gameId, msg.sender, move);
        return true;
    }

    function rewardWinner(uint gameId) public returns (bool success)  {
        Game storage game = games[gameId];
        GameStatus status = game.status;
        require(status == GameStatus.PENDING_REWARD, "No pending reward");

        address winner = address(0);

        if (game.playerMove0.move == predators[uint(game.playerMove1.move)]) {
            winner = game.playerMove0.player;
        } else if (game.playerMove1.move == predators[uint(game.playerMove0.move)]) {
            winner = game.playerMove1.player;
        } else {
            return false;
        }

        require(winner != address(0), "No winner found");
        uint reward = gamePrice.mul(2);
        rewards[winner] = rewards[winner].add(reward);
        game.status = GameStatus.CLOSED;
        emit RewardWinnerEvent(gameId, winner, reward);
        return true;
    }

    function withdrawReward() public returns (bool success)  {
        require(rewards[msg.sender] > 0, "No reward to withdraw");
        uint reward = rewards[msg.sender];
        rewards[msg.sender] = 0;
        emit WithdrawRewardEvent(msg.sender, reward);
        (success,) = msg.sender.call.value(reward)("");
        require(success, "WithdrawReward transfer failed");
    }

}
