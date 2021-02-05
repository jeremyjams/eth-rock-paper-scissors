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
    const Move = Object.freeze({"UNDEFINED":toBN(0), "ROCK":toBN(1), "PAPER":toBN(2), "SCISSORS":toBN(3)})
    const [ UNDEFINED, ROCK, PAPER, SCISSORS ] = [ Move.UNDEFINED, Move.ROCK, Move.PAPER, Move.SCISSORS ]
    const moves = [ROCK, PAPER, SCISSORS]
    const State = Object.freeze({"UNDEFINED":toBN(0), "WAITING_PLAYER_2_MOVE":toBN(1), "WAITING_PLAYER_1_REVEAL":toBN(2), "CLOSED":toBN(3)})

    const secret = soliditySha3("p4ssw0rd") //take random source instead
    let casino
    let gameIds = new Map()

    beforeEach("Fresh contract & accounts", async () => {
        casino = await Casino.new(false, {from: david});
        for (const player1move of moves) {
            const gameId = await casino.buildSecretMoveHashAsGameId(alice, player1move, secret)
            gameIds.set(player1move, gameId)
        }
    });

    describe("Check initial state", () => {
        it("should have proper initial state", async () => {
            for (const player1move of moves) {
                const gameId = gameIds.get(player1move);
                const gameStateBefore  = await casino.getGameState(gameId);
                assert.strictEqual(gameStateBefore.toString(10), State.UNDEFINED.toString(10), "Game should be UNDEFINED with " + player1move);
            }
        });
    });

    describe("Build secret move hash", () => {
        it("should build secret move hash", async () => {
            for (const player1move of moves) {
                const gameId = gameIds.get(player1move);
                const secretMoveHash = soliditySha3(casino.address, alice, player1move, secret)
                assert.strictEqual(secretMoveHash, gameId, "Generated secretMoveHash should be equal to gameId with " + player1move);
            }
        });

        it("should not build secret move hash since empty player", async () => {
            for (const player1move of moves) {
                const gameId = gameIds.get(player1move);
                await truffleAssert.reverts(
                    casino.buildSecretMoveHashAsGameId('0x0000000000000000000000000000000000000000', player1move, secret),
                    "Player should not be empty"
                );
            }
        });

        it("should not build secret move hash since invalid move", async () => {
            // STONE instead of ROCK
            const STONE = SCISSORS.add(toBN(1))
            await truffleAssert.reverts(
                casino.buildSecretMoveHashAsGameId(alice, STONE, secret)
            );
        });

        it("should not build secret move hash since empty secret", async () => {
            for (const player1move of moves) {
                const gameId = gameIds.get(player1move);
                await truffleAssert.reverts(
                    casino.buildSecretMoveHashAsGameId(alice, player1move, '0x'),
                    "Secret should not be empty"
                );
            }
        });
    });

    describe("Player1 will create game", () => {
        it("should createGame with ROCK", async () => {
            const gameId = gameIds.get(ROCK);
            const createGameReceipt = await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            truffleAssert.eventEmitted(createGameReceipt, 'CreateGameEvent', { player: alice, amount: price, gameId: gameId, revealPeriod: revealPeriod });
            const gameStateAfter  = await casino.getGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE");
        });

        it("should createGame with PAPER", async () => {
            const gameId = gameIds.get(PAPER);
            const createGameReceipt = await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            truffleAssert.eventEmitted(createGameReceipt, 'CreateGameEvent', { player: alice, amount: price, gameId: gameId, revealPeriod: revealPeriod });
            const gameStateAfter  = await casino.getGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE");
        });

        it("should createGame with SCISSORS", async () => {
            const gameId = gameIds.get(SCISSORS);
            const createGameReceipt = await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            truffleAssert.eventEmitted(createGameReceipt, 'CreateGameEvent', { player: alice, amount: price, gameId: gameId, revealPeriod: revealPeriod });
            const gameStateAfter  = await casino.getGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE");
        });

        it("should not createGame since empty secretMoveHash", async () => {
            await truffleAssert.reverts(
                casino.player1CreateGame('0x', revealPeriod, {from: alice, value: price}),
                "Provided player1SecretMoveHash cannot be empty"
            );
        });

        it("should not createGame twice or reuse secret", async () => {
            const gameId = gameIds.get(ROCK);
            //createGame
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            //re-createGame
            await truffleAssert.reverts(
                casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price}),
                "Game already used"
            );
        });

    });

    describe("Player2 will commit move after player1", () => {
        let gameId;

        beforeEach("create game", async () => {
            gameId = gameIds.get(ROCK);
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
        });

        it("should player2CommitMove ROCK", async () => {
            const player2move = ROCK
            //player2CommitMove
            const player2CommitMoveReceipt = await casino.player2CommitMove(gameId, player2move, {from: bob, value: price});
            truffleAssert.eventEmitted(player2CommitMoveReceipt, 'Player2MoveEvent', { player: bob, amount: price, gameId: gameId, move: player2move });
            const gameStateAfter  = await casino.getGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_1_REVEAL.toString(10), "Game should be WAITING_PLAYER_1_REVEAL");
            const game = await casino.games(gameId);
            assert.strictEqual(game.player2.toString(10), bob, "Player2 should be Bob");
            assert.strictEqual(game.player2Move.toString(10), player2move.toString(10), "Move should be " + player2move);
        });

        it("should player2CommitMove PAPER", async () => {
            const player2move = PAPER
            //player2CommitMove
            const player2CommitMoveReceipt = await casino.player2CommitMove(gameId, player2move, {from: bob, value: price});
            truffleAssert.eventEmitted(player2CommitMoveReceipt, 'Player2MoveEvent', { player: bob, amount: price, gameId: gameId, move: player2move });
            const gameStateAfter  = await casino.getGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_1_REVEAL.toString(10), "Game should be WAITING_PLAYER_1_REVEAL");
            const game = await casino.games(gameId);
            assert.strictEqual(game.player2.toString(10), bob, "Player2 should be Bob");
            assert.strictEqual(game.player2Move.toString(10), player2move.toString(10), "Move should be " + player2move);
        });

        it("should player2CommitMove SCISSORS", async () => {
            const player2move = SCISSORS
            //player2CommitMove
            const player2CommitMoveReceipt = await casino.player2CommitMove(gameId, player2move, {from: bob, value: price});
            truffleAssert.eventEmitted(player2CommitMoveReceipt, 'Player2MoveEvent', { player: bob, amount: price, gameId: gameId, move: player2move });
            const gameStateAfter  = await casino.getGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_1_REVEAL.toString(10), "Game should be WAITING_PLAYER_1_REVEAL");
            const game = await casino.games(gameId);
            assert.strictEqual(game.player2.toString(10), bob, "Player2 should be Bob");
            assert.strictEqual(game.player2Move.toString(10), player2move.toString(10), "Move should be " + player2move);
        });

        it("should not player2CommitMove UNDEFINED", async () => {
            const player2move = UNDEFINED
            //player2CommitMove
            await truffleAssert.reverts(
                casino.player2CommitMove(gameId, player2move, {from: bob, value: price}),
                "Move cannot be UNDEFINED"
            );
            const gameStateAfter  = await casino.getGameState(gameId);
            assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE");
        });

        it("should not player2CommitMove twice", async () => {
            const player2move = ROCK
            await casino.player2CommitMove(gameId, player2move, {from: bob, value: price});
            //re-player2CommitMove
            await truffleAssert.reverts(
                casino.player2CommitMove(gameId, player2move, {from: bob, value: price}),
                "Player2 already played"
            );
        });

        it("should not player2CommitMove twice, even with other move", async () => {
            await casino.player2CommitMove(gameId, ROCK, {from: bob, value: price});
            //re-player2CommitMove
            await truffleAssert.reverts(
                casino.player2CommitMove(gameId, PAPER, {from: bob, value: price}),
                "Player2 already played"
            );
        });

        it("should not player2CommitMove since value does not match game price", async () => {
            //player2CommitMove with wrong value
            await truffleAssert.reverts(
                casino.player2CommitMove(gameId, ROCK, {from: bob, value: price.sub(toBN(1))}),
                "Value should equal game price"
            );
        });
    });

    describe("Player1 will reveal & reward winner", () => {
        let gameId, player1move

        beforeEach("prepare game ID", async () => {
            player1move = ROCK
            gameId = gameIds.get(player1move);
        });

        it("should player1 reveal & reward winner with right reward amount", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});

            // check balance before reward
            const alicePastBalances = await casino.balances(alice);
            assert.strictEqual(alicePastBalances.toString(10), '0', "Alice should not have any balance");
            const bobPastBalances = await casino.balances(bob);
            assert.strictEqual(bobPastBalances.toString(10), '0', "Bob should not have any balance");
            const reward = price.mul(toBN(2))
            //reveal & reward
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(ROCK, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: bob, amount: reward, gameId: gameId, player1Move: ROCK });
            const gameStateAfter  = await casino.getGameState(gameId);
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
            await casino.player1RevealMoveAndReward(ROCK, secret, {from: alice});
            //try to reward twice
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(ROCK, secret, {from: alice}),
                "Player2 should have played"
            );
        });

        it("should not reveal since wrong move", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(SCISSORS, secret, {from: alice}),
                "Failed to retrieve gameId from player1 move and secret"
            );
        });

        it("should not reveal since wrong secret", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(ROCK, soliditySha3("b4dp4ssw0rd"), {from: alice}),
                "Failed to retrieve gameId from player1 move and secret"
            );
        });

        it("should not reveal since wrong sender", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(ROCK, secret, {from: anyone}),
                "Failed to retrieve gameId from player1 move and secret"
            );
        });
    });

    describe("Should reward winner with player1 rock", () => {
        let gameId;

        it("should reward both when rock vs rock", async () => {
            //createGame & player2CommitMove
            const player1Move = ROCK
            const player2Move = ROCK
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardBothOnDrawEvent', { sender: alice, amount: price, gameId: gameId, player1Move: player1Move });
        });

        it("should reward winner when rock vs paper ", async () => {
            //createGame & player2CommitMove
            const player1Move = ROCK
            const player2Move = PAPER
            const winner = bob
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: winner, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

        it("should reward winner since rock vs scissors ", async () => {
            //createGame & player2CommitMove
            const player1Move = ROCK
            const player2Move = SCISSORS
            const winner = alice
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: winner, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

    });

    describe("Should reward winner with player1 paper", () => {
        let gameId;

        it("should reward both when paper vs paper", async () => {
            //createGame & player2CommitMove
            const player1Move = PAPER
            const player2Move = PAPER
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardBothOnDrawEvent', { sender: alice, amount: price, gameId: gameId, player1Move: player1Move });
        });

        it("should reward winner when paper vs scissors ", async () => {
            //createGame & player2CommitMove
            const player1Move = PAPER
            const player2Move = SCISSORS
            const winner = bob
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: winner, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

        it("should reward winner since paper vs rock ", async () => {
            //createGame & player2CommitMove
            const player1Move = PAPER
            const player2Move = ROCK
            const winner = alice
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: winner, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

    });

    describe("Should reward winner with player1 scissors", () => {
        let gameId;

        it("should reward both when scissors vs scissors", async () => {
            //createGame & player2CommitMove
            const player1Move = SCISSORS
            const player2Move = SCISSORS
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardBothOnDrawEvent', { sender: alice, amount: price, gameId: gameId, player1Move: player1Move });
        });

        it("should reward winner when scissors vs rock ", async () => {
            //createGame & player2CommitMove
            const player1Move = SCISSORS
            const player2Move = ROCK
            const winner = bob
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: winner, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

        it("should reward winner since scissors vs paper ", async () => {
            //createGame & player2CommitMove
            const player1Move = SCISSORS
            const player2Move = PAPER
            const winner = alice
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: winner, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

    });

    describe("Withdraw", () => {
        let gameId;

        beforeEach("prepare game ID", async () => {
            gameId = gameIds.get(ROCK);
        });

        it("should withdraw balance", async () => {
            //createGame, player2CommitMove & reward
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            await casino.player1RevealMoveAndReward(ROCK, secret, {from: alice});

            const balanceBefore = await web3.eth.getBalance(bob);
            // withdraw
            const receipt = await casino.withdrawBalance({from: bob});
            const expectedWithdrawal = price.mul(toBN(2));
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
            await casino.player1RevealMoveAndReward(ROCK, secret, {from: alice});

            // withdraw
            await truffleAssert.reverts(
                casino.withdrawBalance({from: david}),
                "Cannot withdraw empty balance"
            );
        });
    });

});