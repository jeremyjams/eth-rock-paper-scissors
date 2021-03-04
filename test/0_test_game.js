const Casino = artifacts.require("./Casino.sol");
const truffleAssert = require('truffle-assertions');
const timeMachine = require('ganache-time-traveler');

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
    let rockGameId, paperGameId, scissorsGameId, gameIds;

    beforeEach("Fresh contract & accounts", async () => {
        casino = await Casino.new(false, {from: david});
        rockGameId = await casino.buildSecretMoveHashAsGameId(alice, ROCK, secret)
        paperGameId = await casino.buildSecretMoveHashAsGameId(alice, PAPER, secret)
        scissorsGameId = await casino.buildSecretMoveHashAsGameId(alice, SCISSORS, secret)
        gameIds = [ rockGameId, paperGameId, scissorsGameId ]
    });

    describe("Check initial state", () => {
        it("should have proper initial state", async () => {
            //ROCK
            const rockGameStateBefore  = await casino.getGameState(rockGameId);
            assert.strictEqual(rockGameStateBefore.toString(10), State.UNDEFINED.toString(10), "Game should be UNDEFINED with ROCK");
            //PAPER
            const paperGameStateBefore  = await casino.getGameState(paperGameId);
            assert.strictEqual(paperGameStateBefore.toString(10), State.UNDEFINED.toString(10), "Game should be UNDEFINED with PAPER");
            //SCISSORS
            const scissorsGameStateBefore  = await casino.getGameState(scissorsGameId);
            assert.strictEqual(scissorsGameStateBefore.toString(10), State.UNDEFINED.toString(10), "Game should be UNDEFINED with SCISSORS");
        });
    });

    describe("Get game score", () => {
        it("should get game score", async () => {
            const Score = Object.freeze({"DRAW_GAME":toBN(0), "PLAYER1_WINS":toBN(1), "PLAYER2_WINS":toBN(2)})
            //ROCK
            const scoreRR  = await casino.getScore(ROCK, ROCK);
            assert.strictEqual(scoreRR.toString(10), Score.DRAW_GAME.toString(10), "Game should be DRAW_GAME");
            const scoreRP  = await casino.getScore(ROCK, PAPER);
            assert.strictEqual(scoreRP.toString(10), Score.PLAYER2_WINS.toString(10), "Game should be PLAYER2_WINS");
            const scoreRS  = await casino.getScore(ROCK, SCISSORS);
            assert.strictEqual(scoreRS.toString(10), Score.PLAYER1_WINS.toString(10), "Game should be PLAYER1_WINS");
            //PAPER
            const scorePP  = await casino.getScore(PAPER, PAPER);
            assert.strictEqual(scorePP.toString(10), Score.DRAW_GAME.toString(10), "Game should be DRAW_GAME");
            const scorePR  = await casino.getScore(PAPER, ROCK);
            assert.strictEqual(scorePR.toString(10), Score.PLAYER1_WINS.toString(10), "Game should be PLAYER1_WINS");
            const scorePS  = await casino.getScore(PAPER, SCISSORS);
            assert.strictEqual(scorePS.toString(10), Score.PLAYER2_WINS.toString(10), "Game should be PLAYER2_WINS");
            //SCISSORS
            const scoreSS  = await casino.getScore(SCISSORS, SCISSORS);
            assert.strictEqual(scoreSS.toString(10), Score.DRAW_GAME.toString(10), "Game should be DRAW_GAME");
            const scoreSR  = await casino.getScore(SCISSORS, ROCK);
            assert.strictEqual(scoreSR.toString(10), Score.PLAYER2_WINS.toString(10), "Game should be PLAYER2_WINS");
            const scoreSP  = await casino.getScore(SCISSORS, PAPER);
            assert.strictEqual(scoreSP.toString(10), Score.PLAYER1_WINS.toString(10), "Game should be PLAYER1_WINS");
        });
    });

    describe("Build secret move hash", () => {
        it("should build secret move hash", async () => {
            //ROCK
            const rockSecretMoveHash = soliditySha3(casino.address, alice, ROCK, secret)
            assert.strictEqual(rockSecretMoveHash, rockGameId, "Generated secretMoveHash should be equal to gameId with ROCK");
            //PAPER
            const paperSecretMoveHash = soliditySha3(casino.address, alice, PAPER, secret)
            assert.strictEqual(paperSecretMoveHash, paperGameId, "Generated secretMoveHash should be equal to gameId with PAPER");
            //SCISSORS
            const scissorsSecretMoveHash = soliditySha3(casino.address, alice, SCISSORS, secret)
            assert.strictEqual(scissorsSecretMoveHash, scissorsGameId, "Generated secretMoveHash should be equal to gameId with SCISSORS");
        });

        it("should not build secret move hash since empty player", async () => {
            for (const player1move of moves) {
                await truffleAssert.reverts(
                    casino.buildSecretMoveHashAsGameId('0x0000000000000000000000000000000000000000', player1move, secret),
                    "Provided player cannot be empty"
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
                await truffleAssert.reverts(
                    casino.buildSecretMoveHashAsGameId(alice, player1move, '0x'),
                    "Provided secret cannot be empty"
                );
            }
        });
    });

    describe("Player1 will create game", () => {
        it("should createGame with ROCK, PAPER & SCISSORS", async () => {
            //ROCK
            const rockCreateGameReceipt = await casino.player1CreateGame(rockGameId, revealPeriod, bob, {from: alice, value: price});
            truffleAssert.eventEmitted(rockCreateGameReceipt, 'CreateGameEvent', { player: alice, amount: price, gameId: rockGameId, revealPeriod: revealPeriod });
            const rockGameStateAfter  = await casino.getGameState(rockGameId);
            assert.strictEqual(rockGameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE with ROCK");
            //PAPER
            const paperCreateGameReceipt = await casino.player1CreateGame(paperGameId, revealPeriod, bob, {from: alice, value: price});
            truffleAssert.eventEmitted(paperCreateGameReceipt, 'CreateGameEvent', { player: alice, amount: price, gameId: paperGameId, revealPeriod: revealPeriod });
            const paperGameStateAfter  = await casino.getGameState(paperGameId);
            assert.strictEqual(paperGameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE with PAPER");
            //SCISSORS
            const scissorsCreateGameReceipt = await casino.player1CreateGame(scissorsGameId, revealPeriod, bob, {from: alice, value: price});
            truffleAssert.eventEmitted(scissorsCreateGameReceipt, 'CreateGameEvent', { player: alice, amount: price, gameId: scissorsGameId, revealPeriod: revealPeriod });
            const scissorsGameStateAfter  = await casino.getGameState(scissorsGameId);
            assert.strictEqual(scissorsGameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE with SCISSORS");
        });

        it("should not createGame since empty secretMoveHash", async () => {
            await truffleAssert.reverts(
                casino.player1CreateGame('0x', revealPeriod, bob, {from: alice, value: price}),
                "Provided player1SecretMoveHash cannot be empty"
            );
        });

        it("should not createGame twice or reuse secret", async () => {
            for (const gameId of gameIds) {
                //createGame
                await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
                //re-createGame
                await truffleAssert.reverts(
                    casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price}),
                    "Cannot create already initialized game"
                );
            }
        });

    });

    describe("Player1 will cancel game", () => {

        it("should cancelGame", async () => {
            casino.player1CreateGame(rockGameId, revealPeriod, bob, {from: alice, value: price})
            // time travel to cancelable date
            const cancelableFromThisPeriod = revealPeriod.toNumber() + 1;
            await timeMachine.advanceTimeAndBlock(cancelableFromThisPeriod);
            const rockCancelGameReceipt = await casino.cancelGame(ROCK, secret, {from: alice});
            truffleAssert.eventEmitted(rockCancelGameReceipt, 'CanceledGameEvent', { player: alice, amount: price, gameId: rockGameId });
            const rockGameStateAfter  = await casino.getGameState(rockGameId);
            assert.strictEqual(rockGameStateAfter.toString(10), State.CLOSED.toString(10), "Game should be CLOSED with ROCK");
            //check refund in balance
            const aliceBalance = await casino.balances(alice);
            assert.strictEqual(aliceBalance.toString(10), price.toString(10), "Alice balance should have been refunded");
            const bobBalance = await casino.balances(bob);
            assert.strictEqual(bobBalance.toString(10), "0", "Bob balance should be empty");
        });

        it("should not cancelGame since game not initialized", async () => {
            for (const player1move of moves) {
                await truffleAssert.reverts(
                    casino.cancelGame(player1move, secret, {from: alice}),
                    "Cannot cancel non-initialized game"
                );
            }
        });

        it("should not cancelGame since player2 already played", async () => {
            casino.player1CreateGame(rockGameId, revealPeriod, bob, {from: alice, value: price})
            await casino.player2CommitMove(rockGameId, ROCK, {from: bob, value: price});
            await truffleAssert.reverts(
                casino.cancelGame(ROCK, secret, {from: alice}),
                "Cannot cancel game since player2 already played"
            );
        });

        it("should not cancelGame since before cancel timeout", async () => {
            casino.player1CreateGame(rockGameId, revealPeriod, bob, {from: alice, value: price})
            // time travel before cancelable date
            const unCancelableUntilThisPeriod = revealPeriod.toNumber();
            await timeMachine.advanceTimeAndBlock(unCancelableUntilThisPeriod);
            await truffleAssert.reverts(
                casino.cancelGame(ROCK, secret, {from: alice}),
                "Cannot cancel game before next timeout"
            );
        });
    });

    describe("Player2 will commit move after player1", () => {

        beforeEach("create games", async () => {
            for (const gameId of gameIds) {
                await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
            }
        });

        it("should player2CommitMove ROCK", async () => {
            for (const gameId of gameIds) {
                const player2move = ROCK
                //player2CommitMove
                const player2CommitMoveReceipt = await casino.player2CommitMove(gameId, player2move, {from: bob, value: price});
                truffleAssert.eventEmitted(player2CommitMoveReceipt, 'Player2MoveEvent', { player: bob, amount: price, gameId: gameId, move: player2move });
                const gameStateAfter  = await casino.getGameState(gameId);
                assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_1_REVEAL.toString(10), "Game should be WAITING_PLAYER_1_REVEAL");
                const game = await casino.games(gameId);
                assert.strictEqual(game.player2.toString(10), bob, "Player2 should be Bob");
                assert.strictEqual(game.player2Move.toString(10), player2move.toString(10), "Move should be " + player2move);
            }
        });

        it("should player2CommitMove PAPER", async () => {
            for (const gameId of gameIds) {
                const player2move = PAPER
                //player2CommitMove
                const player2CommitMoveReceipt = await casino.player2CommitMove(gameId, player2move, {from: bob, value: price});
                truffleAssert.eventEmitted(player2CommitMoveReceipt, 'Player2MoveEvent', { player: bob, amount: price, gameId: gameId, move: player2move });
                const gameStateAfter  = await casino.getGameState(gameId);
                assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_1_REVEAL.toString(10), "Game should be WAITING_PLAYER_1_REVEAL");
                const game = await casino.games(gameId);
                assert.strictEqual(game.player2.toString(10), bob, "Player2 should be Bob");
                assert.strictEqual(game.player2Move.toString(10), player2move.toString(10), "Move should be " + player2move);
            }
        });

        it("should player2CommitMove SCISSORS", async () => {
            for (const gameId of gameIds) {
                const player2move = SCISSORS
                //player2CommitMove
                const player2CommitMoveReceipt = await casino.player2CommitMove(gameId, player2move, {from: bob, value: price});
                truffleAssert.eventEmitted(player2CommitMoveReceipt, 'Player2MoveEvent', { player: bob, amount: price, gameId: gameId, move: player2move });
                const gameStateAfter  = await casino.getGameState(gameId);
                assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_1_REVEAL.toString(10), "Game should be WAITING_PLAYER_1_REVEAL");
                const game = await casino.games(gameId);
                assert.strictEqual(game.player2.toString(10), bob, "Player2 should be Bob");
                assert.strictEqual(game.player2Move.toString(10), player2move.toString(10), "Move should be " + player2move);
            }
        });

        it("should not player2CommitMove UNDEFINED", async () => {
            for (const gameId of gameIds) {
                const player2move = UNDEFINED
                //player2CommitMove
                await truffleAssert.reverts(
                    casino.player2CommitMove(gameId, player2move, {from: bob, value: price}),
                    "Provided move cannot be empty"
                );
                const gameStateAfter  = await casino.getGameState(gameId);
                assert.strictEqual(gameStateAfter.toString(10), State.WAITING_PLAYER_2_MOVE.toString(10), "Game should be WAITING_PLAYER_2_MOVE");
            }
        });

        it("should not player2CommitMove since sender is not player2", async () => {
            for (const gameId of gameIds) {
                await truffleAssert.reverts(
                    casino.player2CommitMove(gameId, ROCK, {alice: bob, value: price}),
                    "Cannot commit, sender must be player2"
                );
            }
        });

        it("should not player2CommitMove twice", async () => {
            for (const gameId of gameIds) {
                const player2move = ROCK
                await casino.player2CommitMove(gameId, player2move, {from: bob, value: price});
                //re-player2CommitMove
                await truffleAssert.reverts(
                    casino.player2CommitMove(gameId, player2move, {from: bob, value: price}),
                    "Cannot commit move twice"
                );
            }
        });

        it("should not player2CommitMove twice, even with other move", async () => {
            for (const gameId of gameIds) {
                await casino.player2CommitMove(gameId, ROCK, {from: bob, value: price});
                //re-player2CommitMove
                await truffleAssert.reverts(
                    casino.player2CommitMove(gameId, PAPER, {from: bob, value: price}),
                    "Cannot commit move twice"
                );
            }
        });

        it("should not player2CommitMove since value does not match game price", async () => {
            for (const gameId of gameIds) {
                //player2CommitMove with wrong value
                await truffleAssert.reverts(
                    casino.player2CommitMove(gameId, ROCK, {from: bob, value: price.sub(toBN(1))}),
                    "Provided value should equal game price"
                );
            }
        });
    });

    describe("Player1 will reveal & reward winner", () => {

        beforeEach("create games", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(rockGameId, revealPeriod, bob, {from: alice, value: price});
            await casino.player2CommitMove(rockGameId, PAPER, {from: bob, value: price});
        });

        it("should player1 reveal & reward winner with right reward amount", async () => {
            // check balance before reward
            const alicePastBalances = await casino.balances(alice);
            assert.strictEqual(alicePastBalances.toString(10), '0', "Alice should not have any balance");
            const bobPastBalances = await casino.balances(bob);
            assert.strictEqual(bobPastBalances.toString(10), '0', "Bob should not have any balance");
            const reward = price.mul(toBN(2))
            //reveal & reward
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(ROCK, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: bob, amount: reward, gameId: rockGameId, player1Move: ROCK });
            const gameStateAfter  = await casino.getGameState(rockGameId);
            assert.strictEqual(gameStateAfter.toString(10), State.CLOSED.toString(10), "Game should be CLOSED");
            //check reward
            const aliceBalances = await casino.balances(alice);
            assert.strictEqual(aliceBalances.toString(10), "0", "Alice balance should have nothing");
            const bobBalances = await casino.balances(bob);
            assert.strictEqual(bobBalances.toString(10), price.mul(toBN(2)).toString(10), "Bob balance should equal game price * 2");
        });

        it("should not reward twice", async () => {
            await casino.player1RevealMoveAndReward(ROCK, secret, {from: alice});
            //try to reward twice
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(ROCK, secret, {from: alice}),
                "Cannot reveal-reward without player2 move"
            );
        });

        it("should not reveal since wrong move", async () => {
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(SCISSORS, secret, {from: alice}),
                "Cannot reveal-reward without player2 move"
            );
        });

        it("should not reveal since wrong secret", async () => {
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(ROCK, soliditySha3("b4dp4ssw0rd"), {from: alice}),
                "Cannot reveal-reward without player2 move"
            );
        });

        it("should not reveal since wrong sender", async () => {
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(ROCK, secret, {from: anyone}),
                "Cannot reveal-reward without player2 move"
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
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
            await casino.player1CreateGame(gameId, revealPeriod, bob, {from: alice, value: price});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: winner, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move });
        });

    });

    describe("Withdraw", () => {

        beforeEach("createGame & player2 commit move", async () => {
            await casino.player1CreateGame(rockGameId, revealPeriod, bob, {from: alice, value: price});
            await casino.player2CommitMove(rockGameId, PAPER, {from: bob, value: price});
        });

        it("should withdraw balance", async () => {
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
            await casino.player1RevealMoveAndReward(ROCK, secret, {from: alice});

            // withdraw
            await truffleAssert.reverts(
                casino.withdrawBalance({from: david}),
                "Cannot withdraw empty balance"
            );
        });
    });

});