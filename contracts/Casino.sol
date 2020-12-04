// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;
pragma experimental ABIEncoderV2;

//import "@openzeppelin/contracts/math/SafeMath.sol"
import "./openzeppelin/SafeMath.sol";
import "./Pausable.sol";

/*
* A Casino for playing «rock-paper-scissors» game
*
* With Attacker is Alice and Defender is Bob, standard game flow is:
*
* 1 - attack(attackerSecretMoveHash, {from: alice, value: gamePrice.add(attackerDeposit)});
* 2 - defend(gameId, PAPER, {from: bob, value: gamePrice});
* 3 - revealAttackAndReward(gameId, ROCK, secret, {from: alice});
* 4 - withdrawBalance({from: bob});
*
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
        address attacker; // an empty attacker means a fresh game could be started
        uint gamePrice;
        uint attackerDeposit;
        address defender;
        Move defenderMove;
        // An already rewarded and closed game has a revealTimeoutDate of ONE
        // (not using price since could possibly be initially set to ZERO)
        uint revealTimeoutDate;
    }

    enum Move {ROCK, PAPER, SCISSORS}

    //playing
    event AttackEvent(bytes32 indexed gameId, address indexed player, uint gamePrice, uint lockedAttackerDeposit);
    event DefenseEvent(bytes32 indexed gameId, address indexed player, Move move, uint revealTimeoutDate);
    //end game
    event CanceledGameEvent(bytes32 indexed gameId, uint refund);
    event RewardDefenderSinceAttackerRunawayEvent(bytes32 indexed gameId, uint reward);
    event RewardWinnerEvent(bytes32 indexed gameId, address indexed winner, uint reward, uint unlockedAttackerDeposit);
    //balance
    event IncreasedBalanceEvent(address indexed player, uint amount);
    event WithdrawBalanceEvent(address indexed player, uint amount);

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
    * The attacker (1) pays a price <gamePrice> for playing (so does defender),
    * but also (2) temporarily locks an amount <attackerDeposit> to force
    * him to stay until the end of the game (in case he's a sore loser)
    *
    * Note: An attacker can initiate a free game. In this case there is no
    * guaranty protecting the defender if the attacker is uncooperative
    * (defender has almost nothing to loose but only tx gas price for playing)
    */
    function attack(bytes32 attackerSecretMoveHash) public payable whenNotPaused returns (bool)  {
        require(attackerSecretMoveHash != bytes32(0), "Provided attackerSecretMoveHash cannot be empty");
        // attackerSecretMoveHash is gameId
        Game storage game = games[attackerSecretMoveHash];
        require(game.attacker == address(0), "Attacker already played (please defend or start new game instead)");

        game.attacker = msg.sender;
        uint attackerDeposit = msg.value.mul(depositPercentage).div(100);
        uint gamePrice = msg.value.sub(attackerDeposit);
        game.gamePrice = gamePrice;
        game.attackerDeposit = attackerDeposit;
        emit AttackEvent(attackerSecretMoveHash, msg.sender, gamePrice, attackerDeposit);
        return true;
    }

    function defend(bytes32 gameId, Move defenderMove) public payable whenNotPaused returns (bool)  {
        Game storage game = games[gameId];
        require(game.defender == address(0), "Defender already played (please reveal attacker move or start new game instead)");
        require(msg.sender != game.attacker, "Attacker and defender should be different");
        require(msg.value == game.gamePrice, "Value should equal game price");

        game.defender = msg.sender;
        game.defenderMove = defenderMove;
        uint revealTimeoutDate = now.add(REVEAL_PERIOD.mul(1 minutes));
        game.revealTimeoutDate = revealTimeoutDate;
        emit DefenseEvent(gameId, msg.sender, defenderMove, revealTimeoutDate);
        return true;
    }

    //TODO?: Split
    function revealAttackAndReward(bytes32 gameId, Move attackerMove, bytes32 attackerSecret) public whenNotPaused returns (bool success)  {
        Game storage game = games[gameId];
        address defender = game.defender;
        require(defender != address(0), "Defender should have played");
        require(buildSecretMoveHashAsGameId(msg.sender, attackerMove, attackerSecret) == gameId, "Failed to decrypt attacker move with attacker secret");
        require(game.revealTimeoutDate != 1, "Game is closed (please start new game instead)");

        game.revealTimeoutDate = 1; // game closed now
        uint gamePrice = game.gamePrice;
        uint attackerDeposit = game.attackerDeposit;
        uint reward = gamePrice.mul(2);
        address winner;
        Move defenderMove = game.defenderMove;

        if (attackerMove == predators[uint(defenderMove)]) {
            winner = msg.sender;
            increaseBalance(msg.sender, reward.add(attackerDeposit));
            // refund deposit too
        } else if (defenderMove == predators[uint(attackerMove)]) {
            winner = defender;
            increaseBalance(defender, reward);
            increaseBalance(msg.sender, attackerDeposit);
        } else {//not sure could happen, at least avoids dead lock for attacker
            winner = address(0);
            //refund
            increaseBalance(defender, gamePrice);
            increaseBalance(msg.sender, gamePrice.add(attackerDeposit));
        }

        //TODO?: Free up more game storage (elsewhere too)
        emit RewardWinnerEvent(gameId, winner, reward, attackerDeposit);
        return true;
    }

    function rewardDefenderSinceAttackerRunaway(bytes32 gameId) public whenNotPaused returns (bool)  {// could be trigger by anyone
        Game storage game = games[gameId];
        address defender = game.defender;
        require(defender != address(0), "Defender should have played");
        uint revealTimeoutDate = game.revealTimeoutDate;
        require(now > revealTimeoutDate, "Should wait reveal period for rewarding defender");
        require(game.revealTimeoutDate != 1, "Game is closed (please start new game instead)");

        game.revealTimeoutDate = 1; // game closed now
        //defender takes all (reward + security deposit)
        uint reward = game.gamePrice.mul(2).add(game.attackerDeposit);
        increaseBalance(defender, reward);
        emit RewardDefenderSinceAttackerRunawayEvent(gameId, reward);
        return true;
    }

    function cancelGame(bytes32 gameId) public whenNotPaused returns (bool)  {
        Game storage game = games[gameId];
        require(msg.sender == game.attacker, "Only attacker can cancel attack");
        require(game.defender == address(0), "Defender already player (please reveal instead)");
        require(game.revealTimeoutDate != 1, "Game is closed (please start new game instead)");

        game.revealTimeoutDate = 1; // game closed now
        uint refund = game.gamePrice.add(game.attackerDeposit);
        increaseBalance(msg.sender, refund);
        emit CanceledGameEvent(gameId, refund);
        return true;
    }

    //TODO?: Add depositBalance() public

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
