// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;
pragma experimental ABIEncoderV2;

//import "@openzeppelin/contracts/math/SafeMath.sol"
import "./openzeppelin/SafeMath.sol";
import "./Pausable.sol";

/*
* A Casino for playing «rock-paper-scissors» game
*
* With Player1 is Alice and Player2 is Bob, standard game flow is:
*
* 1 - player1CreateGame(player1SecretMoveHash, {from: alice, value: price.add(player1Deposit)});
* 2 - player2CommitMove(gameId, PAPER, {from: bob, value: price});
* 3 - player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice});
* 4 - withdrawBalance({from: bob});
*
*/
contract Casino is Pausable {

    using SafeMath for uint;
    uint constant MIN_TIMEOUT = 1;
    mapping(uint => Move) public predators;
    uint public depositPercentage;

    // gameId -> Game
    mapping(bytes32 => Game) public games;
    // playerAddress -> balances
    mapping(address => uint) public balances;
    /*
    * Records game IDs.
    * Allows player2 to join any game he wants.
    * Note: It's required to firstly check game is still opened before joining it
    * (by querying games map or watching logs)
    */
    bytes32[] public openGames;

    struct Game {
        bool isAlreadyUsed;
        uint price;
        uint player1Deposit;
        // in seconds
        uint player1RevealPeriod;
        address player2;
        Move player2Move;
        // Can hold a special value MIN_TIMEOUT allowing to ensure workflow correctness
        uint revealTimeout;
    }

    enum Move {
        UNDEFINED,
        ROCK,
        PAPER,
        SCISSORS
    }

    enum State {
        UNDEFINED,
        WAITING_PLAYER_2_MOVE,
        WAITING_PLAYER_1_REVEAL,
        CLOSED
    }

    event CreateGameEvent(
        address indexed player,
        uint amount,
        bytes32 indexed gameId,
        uint revealPeriod,
        uint lockedplayer1Deposit
    );
    event Player2MoveEvent(
        address indexed player,
        uint amount,
        bytes32 indexed gameId,
        Move move,
        uint revealTimeoutDate
    );
    event RewardPlayer2SincePlayer1RunawayEvent(
        address indexed player,
        uint amount,
        bytes32 indexed gameId
    );
    event RewardWinnerEvent(
        address indexed player,
        uint amount,
        bytes32 indexed gameId,
        Move player1Move,
        uint unlockedplayer1Deposit
    );
    event CanceledGameEvent(
        address indexed player,
        uint amount,
        bytes32 indexed gameId
    );
    event IncreasedBalanceEvent(
        address indexed player,
        uint amount
    );
    event WithdrawBalanceEvent(
        address indexed player,
        uint amount
    );

    constructor(bool isPaused, uint _depositPercentage) public Pausable(isPaused) {
        setDepositPercentage(_depositPercentage);

        predators[uint(Move.ROCK)] = Move.PAPER;
        predators[uint(Move.PAPER)] = Move.SCISSORS;
        predators[uint(Move.SCISSORS)] = Move.ROCK;
    }

    function getRock() public pure returns (Move)  {
        return Move.ROCK;
    }

    function getPaper() public pure returns (Move)  {
        return Move.PAPER;
    }

    function getScissors() public pure returns (Move)  {
        return Move.SCISSORS;
    }

    function viewGameState(bytes32 gameId) public view returns (State)  {
        require(gameId != 0, "Game ID should not be empty");

        Game storage game = games[gameId];

        if(game.isAlreadyUsed == false){
            return State.UNDEFINED;
        }

        if(game.player2 == address(0) && game.revealTimeout == MIN_TIMEOUT){
            return State.WAITING_PLAYER_2_MOVE;
        }

        if(game.player2 != address(0) && game.revealTimeout > MIN_TIMEOUT){
            return State.WAITING_PLAYER_1_REVEAL;
        }

        if(game.player2 == address(0) && game.revealTimeout == 0){
            return State.CLOSED;
        }

        revert("Game is an weird state");
    }

    function buildSecretMoveHashAsGameId(address player1, Move move, bytes32 secret) public view returns (bytes32)  {
        require(player1 != address(0), "Player should not be empty");
        require(secret != bytes32(0), "Secret should not be empty");

        return keccak256(abi.encodePacked(
                address(this),
                player1,
                uint(move),
                secret
            ));
    }

    function setDepositPercentage(uint _depositPercentage) public onlyOwner {
        require(_depositPercentage <= 100, "Deposit percentage should be between 0 and 100");
        depositPercentage = _depositPercentage;
    }

    /*
    * The player1 (1) pays a price <price> for playing (so does player2),
    * but also (2) temporarily locks an amount <player1Deposit> to force
    * him to stay until the end of the game (in case he's a sore loser)
    *
    * Note: A player1 can initiate a free game. In this case there is no
    * guaranty protecting the player2 if the player1 is uncooperative
    * (player2 has almost nothing to loose but only tx gas price for playing)
    */
    function player1CreateGame(bytes32 player1SecretMoveHash, uint revealPeriod) public payable whenNotPaused returns (bool)  {
        require(player1SecretMoveHash != bytes32(0), "Provided player1SecretMoveHash cannot be empty");
        // player1SecretMoveHash is gameId
        Game storage game = games[player1SecretMoveHash];
        require(game.isAlreadyUsed == false, "Game already used");

        openGames.push(player1SecretMoveHash);
        game.isAlreadyUsed = true;
        game.revealTimeout = MIN_TIMEOUT; //trick to save gas storage when game is closed
        uint player1Deposit = msg.value.mul(depositPercentage).div(100);
        uint price = msg.value.sub(player1Deposit);
        game.price = price;
        game.player1Deposit = player1Deposit;
        game.player1RevealPeriod = revealPeriod;
        emit CreateGameEvent(msg.sender, price, player1SecretMoveHash, revealPeriod, player1Deposit);
        return true;
    }

    function player2CommitMove(bytes32 gameId, Move player2Move) public payable whenNotPaused returns (bool)  {
        Game storage game = games[gameId];
        require(game.player2 == address(0), "Player2 already played");
        require(game.revealTimeout == MIN_TIMEOUT, "Game is closed");
        require(msg.value == game.price, "Value should equal game price");
        // add undefined move require

        game.player2 = msg.sender;
        game.player2Move = player2Move;
        uint revealTimeoutDate = now.add(game.player1RevealPeriod.mul(1 seconds));
        game.revealTimeout = revealTimeoutDate;
        emit Player2MoveEvent(msg.sender, msg.value, gameId, player2Move, revealTimeoutDate);
        return true;
    }

    function player1RevealMoveAndReward(bytes32 gameId, Move player1Move, bytes32 player1Secret) public whenNotPaused returns (bool success)  {
        Game storage game = games[gameId];
        address player2 = game.player2;
        require(player2 != address(0), "Player2 should have played");
        require(game.revealTimeout > MIN_TIMEOUT, "Game is closed");
        require(buildSecretMoveHashAsGameId(msg.sender, player1Move, player1Secret) == gameId, "Failed to decrypt player1 move with player1 secret");


        uint price = game.price;
        uint player1Deposit = game.player1Deposit;
        uint reward = price.mul(2);
        address winner;
        Move player2Move = game.player2Move;

        if (player1Move == predators[uint(player2Move)]) {
            winner = msg.sender;
            increaseBalance(msg.sender, reward.add(player1Deposit));
        } else if (player2Move == predators[uint(player1Move)]) {
            winner = player2;
            increaseBalance(player2, reward);
            increaseBalance(msg.sender, player1Deposit);
        } else {//not sure could happen, at least avoids dead lock for player1
            winner = address(0);
            //refund
            increaseBalance(player2, price);
            increaseBalance(msg.sender, price.add(player1Deposit));
        }

        emit RewardWinnerEvent(winner, reward, gameId, player1Move, player1Deposit);
        //clean
        game.price = 0;
        game.player1Deposit = 0;
        game.player2 = address(0);
        game.player2Move = Move.UNDEFINED;
        game.revealTimeout = 0;
        return true;
    }

    function rewardPlayer2SincePlayer1Runaway(bytes32 gameId) public whenNotPaused returns (bool)  {// could be trigger by anyone
        Game storage game = games[gameId];
        address player2 = game.player2;
        require(player2 != address(0), "Player2 should have played");
        uint revealTimeout = game.revealTimeout;
        require(revealTimeout > MIN_TIMEOUT, "Game is closed");
        require(now > revealTimeout, "Should wait reveal period for rewarding player2");

        //player2 takes all (reward + security deposit)
        uint reward = game.price.mul(2).add(game.player1Deposit);
        increaseBalance(player2, reward);
        emit RewardPlayer2SincePlayer1RunawayEvent(player2, reward, gameId);
        //clean
        game.price = 0;
        game.player1Deposit = 0;
        game.player2 = address(0);
        game.player2Move = Move.UNDEFINED;
        game.revealTimeout = 0;
        return true;
    }

    function cancelGame(bytes32 gameId, Move player1Move, bytes32 player1Secret) public whenNotPaused returns (bool)  {
        Game storage game = games[gameId];
        require(buildSecretMoveHashAsGameId(msg.sender, player1Move, player1Secret) == gameId, "Only player1 can cancel createGame");
        require(game.player2 == address(0), "Player2 already player (please reveal instead)");
        require(game.revealTimeout == MIN_TIMEOUT, "Game is closed");

        uint refund = game.price.add(game.player1Deposit);
        increaseBalance(msg.sender, refund);
        emit CanceledGameEvent(msg.sender, refund, gameId);
        //clean
        game.price = 0;
        game.player1Deposit = 0;
        game.player2 = address(0);
        game.player2Move = Move.UNDEFINED;
        game.revealTimeout = 0;
        return true;
    }

    function withdrawBalance() public whenNotPaused returns (bool success)  {
        uint balance = balances[msg.sender];
        require(balance > 0, "Cannot withdraw empty balance");
        balances[msg.sender] = 0;
        emit WithdrawBalanceEvent(msg.sender, balance);
        (success,) = msg.sender.call.value(balance)("");
        require(success, "WithdrawBalance transfer failed");
    }

    function increaseBalance(address player, uint amount) private {
        balances[player] = balances[player].add(amount);
        emit IncreasedBalanceEvent(player, amount);
    }

}
