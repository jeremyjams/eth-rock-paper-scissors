// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;
pragma experimental ABIEncoderV2;

//import "@openzeppelin/contracts/math/SafeMath.sol"
import "./openzeppelin/math/SafeMath.sol";
//import "@openzeppelin/contracts/utils/EnumerableSet.sol"
import "./openzeppelin/utils/EnumerableSet.sol";
import "./Pausable.sol";


/**
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
    using EnumerableSet for EnumerableSet.Bytes32Set;
    uint constant MIN_TIMEOUT = 1;

    // playerAddress -> balances
    mapping(address => uint) public balances;
    // gameId -> Game
    mapping(bytes32 => Game) public games;
    /**
     * Records game IDs.
     * Allows player2 to join any game he wants.
     * Note: It's required to firstly check game is still opened before joining it
     * (by querying games map or watching logs)
     */
    EnumerableSet.Bytes32Set gameIds;

    struct Game {
        bool isAlreadyUsed;
        uint price;
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
        uint revealPeriod
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
        Move player1Move
    );
    event RewardBothOnDrawEvent(
        address indexed sender,
        uint amount,
        bytes32 indexed gameId,
        Move player1Move
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

    constructor(bool isPaused) public Pausable(isPaused) {
    }

    /**
     * PAPER(2)     -   ROCK(1)     = 1,    left wins
     * SCISSORS(3)  -   PAPER(2)    = 1,    left wins
     * ROCK(1)      -   SCISSORS(3) = -2,   left wins
     *
     * Note: when game is a draw, left hasn't beat right
     */
    function doesLeftBeatRight(Move leftMove, Move rightMove) private pure returns (bool)  {
        return (int(leftMove) - int(rightMove) + 3) % 3 == 1;
    }

    /**
     * View on-going games count
     */
    function viewGamesCount() public view returns (uint){
        return gameIds.length();
    }

    /**
     * Retrieve on-going game IDs by iterating from `0` to `games count`
     */
    function getGameId(uint index) public view returns (bytes32){
        return gameIds.at(index);
    }

    /**
     * View game state
     *
     * Note: This method is only used externally, to help people know what they can do
     */
    function getGameState(bytes32 gameId) public view returns (State)  {
        Game storage game = games[gameId];

        if(!game.isAlreadyUsed){
            return State.UNDEFINED;
        }

        uint revealTimeout = game.revealTimeout;
        if(game.player2 == address(0)){
            if(revealTimeout == MIN_TIMEOUT){
                return State.WAITING_PLAYER_2_MOVE;
            }
            if(revealTimeout == 0){
                return State.CLOSED;
            }
        } else {
            if(revealTimeout > MIN_TIMEOUT){
                return State.WAITING_PLAYER_1_REVEAL;
            }
        }
        assert(false);
    }

    function buildSecretMoveHashAsGameId(address player1, Move move, bytes32 secret) public view returns (bytes32)  {
        require(player1 != address(0), "Player should not be empty");
        //Added check which is optional since a player1 can forge any unique
        // gameId (not in his interest though)
        require(move != Move.UNDEFINED, "Move cannot be UNDEFINED");
        require(secret != bytes32(0), "Secret should not be empty");

        return keccak256(abi.encodePacked(
                address(this),
                player1,
                uint(move),
                secret
            ));
    }

    /**
     * Note: A player1 can initiate a free game. In this case there is no
     * guaranty protecting the player2 if the player1 is uncooperative
     * (player2 has almost nothing to loose but only tx gas price for playing)
     */
    function player1CreateGame(bytes32 player1SecretMoveHash, uint revealPeriod) public payable whenNotPaused returns (bool)  {
        require(player1SecretMoveHash != bytes32(0), "Provided player1SecretMoveHash cannot be empty");
        // player1SecretMoveHash is gameId
        Game storage game = games[player1SecretMoveHash];
        // We could use game.player1RevealPeriod but not sure we'll keep this field
        // at the end (reviewers disagree about custom player1RevealPeriod, see all previous comments)
        // game.price can't be used since could be zero
        // game.revealTimeout can't be used since will be zero when game is closed
        require(!game.isAlreadyUsed, "Game already used");

        gameIds.add(player1SecretMoveHash);
        game.isAlreadyUsed = true;
        //Setting `MIN_TIMEOUT` here allows to free space at the end of the game
        // by setting zeros in every fields. All we left at the end of the game
        // is `game.isAlreadyUsed == true`, everything else is free.
        game.revealTimeout = MIN_TIMEOUT;
        game.price = msg.value;
        game.player1RevealPeriod = revealPeriod;
        emit CreateGameEvent(msg.sender, msg.value, player1SecretMoveHash, revealPeriod);
        return true;
    }

    function player2CommitMove(bytes32 gameId, Move player2Move) public payable whenNotPaused returns (bool)  {
        Game storage game = games[gameId];
        require(game.player2 == address(0), "Player2 already played");
        require(game.revealTimeout == MIN_TIMEOUT, "Game is closed");
        require(player2Move != Move.UNDEFINED, "Move cannot be UNDEFINED");
        require(msg.value == game.price, "Value should equal game price");

        game.player2 = msg.sender;
        game.player2Move = player2Move;
        uint revealTimeoutDate = now.add(game.player1RevealPeriod);
        game.revealTimeout = revealTimeoutDate;
        emit Player2MoveEvent(msg.sender, msg.value, gameId, player2Move, revealTimeoutDate);
        return true;
    }

    /**
     * After reveal period, player2 can declare a player1-runaway, but player1
     * can still reveal, it is just riskier for him
     * Note: Player1 with an UNDEFINED move won't be able to reveal
     */
    function player1RevealMoveAndReward(Move player1Move, bytes32 player1Secret) public whenNotPaused returns (bool success)  {
        bytes32 gameId = buildSecretMoveHashAsGameId(msg.sender, player1Move, player1Secret);
        Game storage game = games[gameId];
        require(game.isAlreadyUsed, "Failed to retrieve gameId from player1 move and secret");
        address player2 = game.player2;
        require(player2 != address(0), "Player2 should have played");
        require(game.revealTimeout > MIN_TIMEOUT, "Game is closed");

        Move player2Move = game.player2Move;
        if(player1Move == player2Move){ //Game is a draw
            uint price = game.price;
            increaseBalance(msg.sender, price);
            increaseBalance(player2, price);
            emit RewardBothOnDrawEvent(msg.sender, price, gameId, player1Move);
        } else { //Game has a winner
            uint reward = game.price.mul(2);
            address winner;
            if (doesLeftBeatRight(player1Move, player2Move)) {
                winner = msg.sender;
            } else {
                winner = player2;
            }
            increaseBalance(winner, reward);
            emit RewardWinnerEvent(winner, reward, gameId, player1Move);
        }
        free(gameId);
        return true;
    }

    function rewardPlayer2SincePlayer1Runaway(bytes32 gameId) public whenNotPaused returns (bool)  {// could be trigger by anyone
        Game storage game = games[gameId];
        address player2 = game.player2;
        require(player2 != address(0), "Player2 should have played");
        uint revealTimeout = game.revealTimeout;
        require(revealTimeout > MIN_TIMEOUT, "Game is closed");
        require(now > revealTimeout, "Should wait reveal period for rewarding player2");

        uint reward = game.price.mul(2);
        free(gameId);
        increaseBalance(player2, reward);
        emit RewardPlayer2SincePlayer1RunawayEvent(player2, reward, gameId);
        return true;
    }

    /**
     * Only player1 can cancel the game
     */
    function cancelGame(Move player1Move, bytes32 player1Secret) public whenNotPaused returns (bool)  {
        bytes32 gameId = buildSecretMoveHashAsGameId(msg.sender, player1Move, player1Secret);
        Game storage game = games[gameId];
        require(game.isAlreadyUsed, "Cannot cancel non-existing game");
        require(game.player2 == address(0), "Player2 already player (please reveal instead)");
        require(game.revealTimeout == MIN_TIMEOUT, "Game is closed");

        uint refund = game.price;
        // free
        gameIds.remove(gameId);
        delete game.price;
        delete game.player1RevealPeriod;
        delete game.revealTimeout;

        increaseBalance(msg.sender, refund);
        emit CanceledGameEvent(msg.sender, refund, gameId);
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

    /**
     * Free space when game is over
     */
    function free(bytes32 gameId) private {
        Game storage game = games[gameId];
        //Let's keep gameIds length as clean as possible
        gameIds.remove(gameId);

        delete game.price;
        delete game.player2;
        delete game.player2Move;
        delete game.player1RevealPeriod;
        delete game.revealTimeout;
        //Everything is clean, we just leave `game.isAlreadyUsed == true`
        //to avoid secret reuse
    }

}
