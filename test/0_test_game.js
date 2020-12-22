const Casino = artifacts.require("./Casino.sol");
const truffleAssert = require('truffle-assertions');

const { BN, toBN, soliditySha3 } = web3.utils
require('chai').use(require('chai-bn')(BN)).should();

// ganache-cli --accounts=10 --host=0.0.0.0

contract("Casino for playing «rock-paper-scissors» game", accounts => {

    // accounts
    const [ alice, bob, carol, david, anyone ] = accounts;
    const depositPercentage = toBN(30);
    const createGameMsgValue = toBN(10);
    const player1Deposit = toBN(Math.floor(createGameMsgValue * depositPercentage / 100))
    const price = toBN(createGameMsgValue - player1Deposit)
    const revealPeriod = 60; //seconds

    const secret = soliditySha3("p4ssw0rd") //take random source instead
    let casino, gameId, ROCK, PAPER, SCISSORS;

    beforeEach("Fresh contract & accounts", async () => {
        casino = await Casino.new(false, depositPercentage, {from: david});

        ROCK = await casino.getRock();
        PAPER = await casino.getPaper();
        SCISSORS = await casino.getScissors();

        let Move = Object.freeze({"UNDEFINED":toBN(0), "ROCK":toBN(1), "PAPER":toBN(2), "SCISSORS":toBN(3)})
        ROCK = Move.ROCK
        PAPER = Move.PAPER
        SCISSORS = Move.SCISSORS

        gameId = await casino.buildSecretMoveHashAsGameId(alice, ROCK, secret)
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
            const createGameReceipt = await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            truffleAssert.eventEmitted(createGameReceipt, 'CreateGameEvent', { player: alice, amount: price, gameId: gameId, revealPeriod: toBN(revealPeriod), lockedplayer1Deposit: player1Deposit });
        });

        it("should not createGame since empty secretMoveHash", async () => {
            await truffleAssert.reverts(
                casino.player1CreateGame('0x', revealPeriod, {from: alice, value: price.add(player1Deposit)}),
                "Provided player1SecretMoveHash cannot be empty"
            );
        });

        it("should not createGame twice or reuse secret", async () => {
            //createGame
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            //re-createGame
            await truffleAssert.reverts(
                casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)}),
                "Player1 already played"
            );
        });

    });

    describe("Player2 will commit move", () => {
        it("should player2CommitMove", async () => {
            //createGame
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});

            //player2CommitMove
            const player2CommitMoveReceipt = await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            truffleAssert.eventEmitted(player2CommitMoveReceipt, 'Player2MoveEvent', { player: bob, amount: price, gameId: gameId, move: PAPER });
            const game = await casino.games(gameId);
            assert.strictEqual(game.player2.toString(10), bob, "Player2 should be Bob");
            assert.strictEqual(game.player2Move.toString(10), PAPER.toString(10), "Move should be PAPER(1)");
        });

        it("should not player2CommitMove twice", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //re-player2CommitMove
            await truffleAssert.reverts(
                casino.player2CommitMove(gameId, PAPER, {from: bob, value: price}),
                "Player2 already played"
            );
        });

        it("should not player2CommitMove since value does not match game price", async () => {
            //createGame
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
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
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});

            // check balance before reward
            const alicePastBalances = await casino.balances(alice);
            assert.strictEqual(alicePastBalances.toString(10), '0', "Alice should not have any balance");
            const bobPastBalances = await casino.balances(bob);
            assert.strictEqual(bobPastBalances.toString(10), '0', "Bob should not have any balance");
            let reward = price.mul(toBN(2))
            //reveal & reward
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: bob, amount: reward, gameId: gameId, player1Move: ROCK, unlockedplayer1Deposit: player1Deposit });
            //check reward
            const aliceBalances = await casino.balances(alice);
            assert.strictEqual(aliceBalances.toString(10), player1Deposit.toString(10), "Alice balance should have unlocked deposit");
            const bobBalances = await casino.balances(bob);
            assert.strictEqual(bobBalances.toString(10), price.mul(toBN(2)).toString(10), "Bob balance should equal game price * 2");
        });

        it("should not reward twice", async () => {
            //createGame & player2CommitMove & reveal & reward
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            await casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice});
            //try to reward twice
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(gameId, ROCK, secret, {from: alice}),
                "Game is closed"
            );
        });

        it("should not reveal since wrong move", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(gameId, SCISSORS, secret, {from: alice}),
                "Failed to decrypt player1 move with player1 secret"
            );
        });

        it("should not reveal since wrong secret", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            await casino.player2CommitMove(gameId, PAPER, {from: bob, value: price});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.player1RevealMoveAndReward(gameId, ROCK, soliditySha3("b4dp4ssw0rd"), {from: alice}),
                "Failed to decrypt player1 move with player1 secret"
            );
        });

        it("should not reveal since wrong sender", async () => {
            //createGame & player2CommitMove
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
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
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(gameId, player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: bob, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move, unlockedplayer1Deposit: player1Deposit });
        });

        it("should reward winner since scissors > paper ", async () => {
            //createGame & player2CommitMove
            const player1Move = SCISSORS
            const player2Move = PAPER
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(gameId, player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: alice, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move, unlockedplayer1Deposit: player1Deposit });
        });

        it("should reward winner since rock > scissors ", async () => {
            //createGame & player2CommitMove
            const player1Move = SCISSORS
            const player2Move = ROCK
            gameId = await casino.buildSecretMoveHashAsGameId(alice, player1Move, secret)
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
            await casino.player2CommitMove(gameId, player2Move, {from: bob, value: price});
            //reward winner
            const rewardWinnerReceipt = await casino.player1RevealMoveAndReward(gameId, player1Move, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { player: bob, amount: price.mul(toBN(2)), gameId: gameId, player1Move: player1Move, unlockedplayer1Deposit: player1Deposit });
        });
    });

    describe("Withdraw", () => {
        it("should withdraw balance", async () => {
            //createGame, player2CommitMove & reward
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
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
            await casino.player1CreateGame(gameId, revealPeriod, {from: alice, value: price.add(player1Deposit)});
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