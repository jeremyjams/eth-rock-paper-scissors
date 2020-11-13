const Casino = artifacts.require("./Casino.sol");
const truffleAssert = require('truffle-assertions');

const { BN, toBN, soliditySha3 } = web3.utils
require('chai').use(require('chai-bn')(BN)).should();

// ganache-cli --accounts=10 --host=0.0.0.0

//TODO add should not & pure

contract("Casino", accounts => {
    describe("Testing Casino contract", () => {

        let casino, gameId, gamePrice, ROCK, PAPER, SCISSORS;
        // accounts
        const [ alice, bob, carol, david, anyone ] = accounts;

        beforeEach("Fresh contract & accounts", async () => {
            // deploy Game
            casino = await Casino.new(false, 10, {from: david});
            gameId = await casino.joinableGameId({from: anyone});
            gamePrice = await casino.gamePrice()

            ROCK = await casino.getMove(soliditySha3("ROCK"));
            PAPER = await casino.getMove(soliditySha3("PAPER"));
            SCISSORS = await casino.getMove(soliditySha3("SCISSORS"));
        });

        describe("Play", () => {
            it("should play", async () => {
                //player0
                const playReceipt0 = await casino.play(gameId, ROCK, {from: alice, value: gamePrice});
                truffleAssert.eventEmitted(playReceipt0, 'PlayEvent', { gameId: gameId, player: alice, move: ROCK });
                //player1
                const playReceipt1 = await casino.play(gameId, PAPER, {from: bob, value: gamePrice});
                truffleAssert.eventEmitted(playReceipt1, 'PlayEvent', { gameId: gameId, player: bob, move: PAPER });

                const game = await casino.games(gameId);
                assert.strictEqual(game.playerMove0.player.toString(10), alice, "Player should be Alice");
                assert.strictEqual(game.playerMove0.move.toString(10), ROCK.toString(10), "Move should be ROCK(0)");
                assert.strictEqual(game.playerMove1.player.toString(10), bob, "Player should be Bob");
                assert.strictEqual(game.playerMove1.move.toString(10), PAPER.toString(10), "Move should be PAPER(1)");
            });

            it("should not play since gameId is not joinable", async () => {
                await truffleAssert.reverts(
                    casino.play(toBN(gameId + toBN(1)), ROCK, {from: alice, value: gamePrice}),
                    "Provided gameId is not joinable"
                );
            });

            it("should not play since invalid move", async () => {
                // play STONE instead of ROCK
                const STONE = toBN(SCISSORS + toBN(1))
                await truffleAssert.reverts(
                    casino.play(gameId, STONE, {from: alice, value: gamePrice})
                );
            });

            it("should not play since value does not match game price (too low value)", async () => {
                await truffleAssert.reverts(
                    casino.play(gameId, ROCK, {from: alice, value: toBN(gamePrice - toBN(1))}),
                    "Provided value does not match game price"
                );
            });

            it("should not play since value does not match game price (too high value)", async () => {
                await truffleAssert.reverts(
                    casino.play(gameId, ROCK, {from: alice, value: toBN(gamePrice + toBN(1))}),
                    "Provided value does not match game price"
                );
            });

            it("should not play since second player should be different from first player", async () => {
                await casino.play(gameId, ROCK, {from: alice, value: gamePrice});
                await truffleAssert.reverts(
                    casino.play(gameId, PAPER, {from: alice, value: gamePrice}),
                    "Second player should be different from first player"
                );
            });

        });

        describe("Reward", () => {
            it("should reward winner with right reward amount", async () => {
                //play
                await casino.play(gameId, ROCK, {from: alice, value: gamePrice});
                await casino.play(gameId, PAPER, {from: bob, value: gamePrice});

                //reward winner
                const alicePastRewards = await casino.rewards(alice);
                assert.strictEqual(alicePastRewards.toString(10), '0', "Alice should not have any reward");
                const bobPastRewards = await casino.rewards(bob);
                assert.strictEqual(bobPastRewards.toString(10), '0', "Bob should not have any reward");
                let reward = gamePrice * 2
                const rewardWinnerReceipt = await casino.rewardWinner(gameId, {from: anyone});
                truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { gameId: gameId, player: bob, reward: toBN(reward) });

                const game = await casino.games(gameId);
                assert.strictEqual(game.status.toString(10), '3', "Winner should be rewarded");
                const aliceRewards = await casino.rewards(alice);
                assert.strictEqual(aliceRewards.toString(10), '0', "Alice should not have any reward");
                const bobRewards = await casino.rewards(bob);
                assert.strictEqual(bobRewards.toString(10), '20', "Bob reward should be 20");
            });

            it("should reward winner since paper > rock ", async () => {
                //play
                await casino.play(gameId, ROCK, {from: alice, value: gamePrice});
                await casino.play(gameId, PAPER, {from: bob, value: gamePrice});
                //reward winner
                let reward = gamePrice * 2
                const rewardWinnerReceipt = await casino.rewardWinner(gameId, {from: anyone});
                truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { gameId: gameId, player: bob, reward: toBN(reward) });
            });

            it("should reward winner since scissors > paper ", async () => {
                //play
                await casino.play(gameId, SCISSORS, {from: alice, value: gamePrice});
                await casino.play(gameId, PAPER, {from: bob, value: gamePrice});
                //reward winner
                let reward = gamePrice * 2
                const rewardWinnerReceipt = await casino.rewardWinner(gameId, {from: anyone});
                truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { gameId: gameId, player: alice, reward: toBN(reward) });
            });

            it("should reward winner since rock > scissors ", async () => {
                //play
                await casino.play(gameId, ROCK, {from: alice, value: gamePrice});
                await casino.play(gameId, SCISSORS, {from: bob, value: gamePrice});
                //reward winner
                let reward = gamePrice * 2
                const rewardWinnerReceipt = await casino.rewardWinner(gameId, {from: anyone});
                truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { gameId: gameId, player: alice, reward: toBN(reward) });
            });
        });

        describe("Withdraw", () => {
            it("should withdraw reward", async () => {
                // play
                await casino.play(gameId, ROCK, {from: alice, value: gamePrice});
                await casino.play(gameId, PAPER, {from: bob, value: gamePrice});
                // reward
                await casino.rewardWinner(gameId, {from: anyone});


                const balanceBefore = await web3.eth.getBalance(bob);
                // withdraw
                const receipt = await casino.withdrawReward({from: bob});
                truffleAssert.eventEmitted(receipt, 'WithdrawRewardEvent', { player: bob, reward: toBN(20) });

                // check effective withdraw amount
                const withdrawRewardGasUsed = receipt.receipt.gasUsed;
                const tx = await web3.eth.getTransaction(receipt.tx);
                const withdrawRewardGasPrice = tx.gasPrice;
                const withdrawRewardCost = toBN(withdrawRewardGasUsed).mul(toBN(withdrawRewardGasPrice));
                const balanceAfter = await web3.eth.getBalance(bob);
                const effectiveWithdrawReward = toBN(balanceAfter).sub(toBN(balanceBefore))
                     .add(toBN(withdrawRewardCost)).toString(10);
                assert.strictEqual(effectiveWithdrawReward.toString(10), '20');
            });

            it("should not withdraw reward since no reward", async () => {
                // play
                await casino.play(gameId, ROCK, {from: alice, value: gamePrice});
                await casino.play(gameId, PAPER, {from: bob, value: gamePrice});
                // reward
                await casino.rewardWinner(gameId, {from: anyone});

                // withdraw
                await truffleAssert.reverts(
                    casino.withdrawReward({from: alice}),
                    "No reward to withdraw"
                );
            });

        });

    });
});