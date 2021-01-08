const Casino = artifacts.require("./Casino.sol");
const truffleAssert = require('truffle-assertions');

const { BN, toBN, soliditySha3 } = web3.utils
require('chai').use(require('chai-bn')(BN)).should();

// ganache-cli --accounts=10 --host=0.0.0.0

contract("Casino for playing «rock-paper-scissors» game", accounts => {

    // accounts
    const [ alice, bob, carol, david, anyone ] = accounts;
    const createGameMsgValue = toBN(10);
    const price = createGameMsgValue
    const revealPeriod = toBN(60); //seconds

    const secret = soliditySha3("p4ssw0rd") //take random source instead
    let casino, gameId, ROCK, PAPER, SCISSORS, State;

    beforeEach("Fresh contract & accounts", async () => {
        casino = await Casino.new(false, {from: david});
        //No idea how to use ROCK, PAPER, SCISSORS without exposing them in the contract
        // removing`ROCK = await casino.getRock();` using dirty `let Move = Object.freeze({"UNDEFINED":toBN(0) [...]`
        let Move = Object.freeze({"UNDEFINED":toBN(0), "ROCK":toBN(1), "PAPER":toBN(2), "SCISSORS":toBN(3)})
        ROCK = Move.ROCK
        PAPER = Move.PAPER
        SCISSORS = Move.SCISSORS
        State = Object.freeze({"UNDEFINED":toBN(0), "WAITING_PLAYER_2_MOVE":toBN(1), "WAITING_PLAYER_1_REVEAL":toBN(2), "CLOSED":toBN(3)})

        gameId = await casino.buildSecretMoveHashAsGameId(alice, ROCK, secret)
        const gameStateBefore  = await casino.viewGameState(gameId);
        assert.strictEqual(gameStateBefore.toString(10), State.UNDEFINED.toString(10), "Game should be UNDEFINED");
    });

    describe("Build secret move hash", () => {
        it("should build secret move hash", async () => {
            const secretMoveHash = soliditySha3(casino.address, alice, ROCK, secret)
            assert.strictEqual(secretMoveHash, gameId, "Generated secretMoveHash should be equal to gameId");
        });

        it("should not build secret move hash since empty player", async () => {
            await truffleAssert.reverts(
                casino.buildSecretMoveHashAsGameId('0x0000000000000000000000000000000000000000', ROCK, secret),
                "Player should not be empty"
            );
        });

        it("should not build secret move hash since invalid move", async () => {
            // STONE instead of ROCK
            const STONE = SCISSORS.add(toBN(1))
            await truffleAssert.reverts(
                casino.buildSecretMoveHashAsGameId(alice, STONE, secret)
            );
        });

        it("should not build secret move hash since empty secret", async () => {
            await truffleAssert.reverts(
                casino.buildSecretMoveHashAsGameId(alice, ROCK, '0x'),
                "Secret should not be empty"
            );
        });
    });

    describe("Player1 will create game", () => {
        it("should createGame", async () => {
            const createGameReceipt = await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            truffleAssert.eventEmitted(createGameReceipt, 'CreateGameEvent', { player: alice, amount: price, gameId: gameId, revealPeriod: revealPeriod });
            const gameStateAfter  = await casino.viewGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE");
        });

        it("should not createGame since empty secretMoveHash", async () => {
            await truffleAssert.reverts(
                casino.player1CreateGame('0x', revealPeriod, {from: alice, value: price}),
                "Provided player1SecretMoveHash cannot be empty"
            );
        });

        it("should not createGame twice or reuse secret", async () => {
            //createGame
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            //re-createGame
            await truffleAssert.reverts(
                casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price}),
                "Game already used"
            );
        });

    });

    describe("Player2 will commit move", () => {
        it("should player2CommitMove", async () => {
            //createGame
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});

            //player2CommitMove
            const player2CommitMoveReceipt = await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            truffleAssert.eventEmitted(player2CommitMoveReceipt, 'Player2MoveEvent', { player: bob, amount: price, gameId: gameId, move: PAPER });
            const gameStateAfter  = await casino.viewGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_1_REVEAL.toString(10), "Game should be WAITING_PLAYER_1_REVEAL");
            const game = await casino.games(gameId);
            assert.strictEqual(game.player2.toString(10), bob, "Player2 should be Bob");
            assert.strictEqual(game.player2Move.toString(10), PAPER.toString(10), "Move should be PAPER(1)");
        });

        it("should not player2CommitMove twice", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //re-player2CommitMove
            await truffleAssert.reverts(
                casino.player2CommitMove(gameId, PAPER, {from: bob, value: price}),
                "Player2 already played"
            );
        });

        it("should not player2CommitMove since value does not match game price", async () => {
            //createGame
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            //player2CommitMove with wrong value
            await truffleAssert.reverts(
                casino.player2CommitMove(gameId, PAPER, {from: bob, value: price.sub(toBN(1))}),
                "Value should equal game price"
            );
        });
    });

    describe("Player1 will reveal & reward winner", () => {
        it("should player1 reveal & reward winner with right reward amount", async () => {
            //createGame & player2CommitMove
            const gameId = await casino.buildSecretMoveHashAsGameId(alice, ROCK, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});

            // check balance before reward
            const alicePastBalances = await casino.balances(alice);
            assert.strictEqual(alicePastBalances.toString(10), '0', "Alice should not have any balance");
            const bobPastBalances = await casino.balances(bob);
            assert.strictEqual(bobPastBalances.toString(10), '0', "Bob should not have any balance");
            let reward = price.mul(toBN(2))
            //reveal & reward
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: bob, amount: reward, gameId: gameId, player1Move: ROCK });
            const gameStateAfter  = await casino.viewGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.CLOSED.toString(10), "Game should be CLOSED");
            //check reward
            const aliceBalances = await casino.balances(alice);
            assert.strictEqual(aliceBalances.toString(10), "0", "Alice balance should have nothing");
            const bobBalances = await casino.balances(bob);
            assert.strictEqual(bobBalances.toString(10), price.mul(toBN(2)).toString(10), "Bob balance should equal game price * 2");
        });

        it("should not reward twice", async () => {
            //createGame & player2CommitMove & reveal & reward
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            await casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice});
            //try to reward twice
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice}),
                "Player2 should have played"
            );
        });

        it("should not reveal since wrong move", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(gameId, SCISSORS, secret, {from: alice}),
                "Failed to decrypt player1 move with player1 secret"
            );
        });

        it("should not reveal since wrong secret", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(gameId, ROCK, soliditySha3("b4dp4ssw0rd"), {from: alice}),
                "Failed to decrypt player1 move with player1 secret"
            );
        });

        it("should not reveal since wrong sender", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: anyone}),
                "Failed to decrypt player1 move with player1 secret"
            );
        });

        it("should reward winner since paper > rock ", async () => {
            //createGame & player2CommitMove
            const player1Move = ROCK
            const player2Move = PAPER
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(gameId, player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: bob, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

        it("should reward winner since scissors > paper ", async () => {
            //createGame & player2CommitMove
            const player1Move = SCISSORS
            const player2Move = PAPER
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(gameId, player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: alice, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

        it("should reward winner since rock > scissors ", async () => {
            //createGame & player2CommitMove
            const player1Move = SCISSORS
            const player2Move = ROCK
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(gameId, player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: bob, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move  });
        });
    });

    describe("Withdraw", () => {
        it("should withdraw balance", async () => {
            //createGame, player2CommitMove & reward
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            await casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice});

            const balanceBefore = await web3.eth.getBalance(bob);
            // withdraw
            const receipt = await casino.withdrawBalance({from: bob});
            let expectedWithdrawal = price.mul(toBN(2));
            truffleAssert.eventEmitted(receipt, 'WithdrawBalanceEvent', { player: bob, amount: expectedWithdrawal });

            // check effective withdraw amount
            const withdrawBalanceGasUsed = receipt.receipt.gasUsed;
            const tx = await web3.eth.getTransaction(receipt.tx);
            const withdrawBalanceGasPrice = tx.gasPrice;
            const withdrawBalanceCost = toBN(withdrawBalanceGasUsed).mul(toBN(withdrawBalanceGasPrice));
            const balanceAfter = await web3.eth.getBalance(bob);
            const effectiveWithdrawBalance = toBN(balanceAfter).sub(toBN(balanceBefore))
                 .add(toBN(withdrawBalanceCost)).toString(10);
            assert.strictEqual(effectiveWithdrawBalance.toString(10), expectedWithdrawal.toString(10));
        });

        it("should not withdraw balance since empty balance", async () => {
            //createGame, player2CommitMove & reward
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            await casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice});

            // withdraw
            await truffleAssert.reverts(
                casino.withdrawBalance({from: david}),
                "Cannot withdraw empty balance"
            );
        });
    });

});