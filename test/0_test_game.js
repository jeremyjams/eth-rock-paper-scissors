const Casino = artifacts.require("./Casino.sol");
const truffleAssert = require('truffle-assertions');

const { BN, toBN, soliditySha3 } = web3.utils
require('chai').use(require('chai-bn')(BN)).should();

// ganache-cli --accounts=10 --host=0.0.0.0

contract("Casino for playing «rock-paper-scissors» game", accounts => {

    // accounts
    const [ alice, bob, carol, david, anyone ] = accounts;
    const secret = soliditySha3("p4ssw0rd") //take random source instead
    let casino, gamePrice, attackerDeposit, gameId, ROCK, PAPER, SCISSORS;

    beforeEach("Fresh contract & accounts", async () => {
        casino = await Casino.new(false, 10, {from: david});
        gamePrice = await casino.gamePrice()
        attackerDeposit = await casino.attackerDeposit()
        ROCK = await casino.getMove(soliditySha3("ROCK"));
        PAPER = await casino.getMove(soliditySha3("PAPER"));
        SCISSORS = await casino.getMove(soliditySha3("SCISSORS"));
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

    describe("Attack", () => {
        it("should attack", async () => {
            const attackReceipt = await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            truffleAssert.eventEmitted(attackReceipt, 'AttackEvent', { gameId: gameId, player: alice, lockedAttackerDeposit: attackerDeposit });
            const game = await casino.games(gameId);
            assert.strictEqual(game.attacker.toString(10), alice, "Attacker should be Alice");
            const aliceLockedDeposit = await casino.locked(alice);
            assert.strictEqual(aliceLockedDeposit.toString(10), '10', "lockedAttackerDeposit for Alice should be 10");
        });

        it("should not attack since empty secretMoveHash", async () => {
            await truffleAssert.reverts(
                casino.attack('0x', {from: alice, value: attackerDeposit.add(gamePrice)}),
                "Provided attackerSecretMoveHash cannot be empty"
            );
        });

        it("should not attack twice or reuse secret", async () => {
            //attack
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            //re-attack
            await truffleAssert.reverts(
                casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)}),
                "Attacker already played (please defend or start new game instead)"
            );
        });

        it("should not attack since value does not match attacker deposit + game price", async () => {
            await truffleAssert.reverts(
                casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice).sub(toBN(1))}),
                "Value should equal attacker deposit + game price"
            );
        });
    });

    describe("Defend", () => {
        it("should defend", async () => {
            //attack
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});

            //defend
            const defendReceipt = await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});
            truffleAssert.eventEmitted(defendReceipt, 'DefenseEvent', { gameId: gameId, player: bob, move: PAPER });
            const game = await casino.games(gameId);
            assert.strictEqual(game.defender.toString(10), bob, "Defender should be Bob");
            assert.strictEqual(game.defenderMove.toString(10), PAPER.toString(10), "Move should be PAPER(1)");
        });

        it("should not defend twice", async () => {
            //attack & defend
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});
            //re-defend
            await truffleAssert.reverts(
                casino.defend(gameId, PAPER, {from: bob, value: gamePrice}),
                "Defender already played (please reveal attacker move or start new game instead)"
            );
        });

        it("should not defend since defender and attacker cannot be the same person", async () => {
            //attack
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            //defend with same identity
            await truffleAssert.reverts(
                casino.defend(gameId, PAPER, {from: alice, value: gamePrice}),
                "Attacker and defender should be different"
            );
        });

        it("should not defend since value does not match game price", async () => {
            //attack
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            //defend with wrong value
            await truffleAssert.reverts(
                casino.defend(gameId, PAPER, {from: bob, value: gamePrice.sub(toBN(1))}),
                "Value should equal game price"
            );
        });
    });

    describe("Reveal attack & reward winner", () => {
        it("should reveal attack & reward winner", async () => {
            //attack & defend
            const gameId = await casino.buildSecretMoveHashAsGameId(alice, ROCK, secret)
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});

            // check balance before reward
            const alicePastBalances = await casino.balances(alice);
            assert.strictEqual(alicePastBalances.toString(10), '0', "Alice should not have any balance");
            const bobPastBalances = await casino.balances(bob);
            assert.strictEqual(bobPastBalances.toString(10), '0', "Bob should not have any balance");
            let reward = gamePrice.mul(toBN(2))
            //reveal & reward
            const rewardWinnerReceipt = await casino.revealAttackAndReward(gameId, ROCK, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { gameId: gameId, winner: bob, reward: reward, unlockedAttackerDeposit: attackerDeposit });
            //check reward
            const aliceBalances = await casino.balances(alice);
            assert.strictEqual(aliceBalances.toString(10), '10', "Alice balance should be 10 (unlock amount)");
            const bobBalances = await casino.balances(bob);
            assert.strictEqual(bobBalances.toString(10), '20', "Bob balance should be 20 (game price * 2)");
            //check game status
            const game = await casino.games(gameId);
            assert.strictEqual(game.isClosed, true, "Game should be closed");
            //check lock & unlock
            const aliceLockedDeposit = await casino.locked(alice);
            assert.strictEqual(aliceLockedDeposit.toString(10), '0', "lockedAttackerDeposit for Alice should be 0");
        });

        it("should not unlock & reward twice", async () => {
            //attack & defend & reveal & reward
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});
            await casino.revealAttackAndReward(gameId, ROCK, secret, {from: alice});
            //try to unlock or reward twice
            await truffleAssert.reverts(
                casino.revealAttackAndReward(gameId, ROCK, secret, {from: alice}),
                "Game is closed (please start new game instead)"
            );
        });

        it("should not reveal since wrong move", async () => {
            //attack & defend
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.revealAttackAndReward(gameId, SCISSORS, secret, {from: alice}),
                "Failed to decrypt attacker move with attacker secret"
            );
        });

        it("should not reveal since wrong secret", async () => {
            //attack & defend
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.revealAttackAndReward(gameId, ROCK, soliditySha3("b4dp4ssw0rd"), {from: alice}),
                "Failed to decrypt attacker move with attacker secret"
            );
        });

        it("should not reveal since wrong sender", async () => {
            //attack & defend
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});
            //try to reveal with wrong move
            await truffleAssert.reverts(
                casino.revealAttackAndReward(gameId, ROCK, secret, {from: anyone}),
                "Failed to decrypt attacker move with attacker secret"
            );
        });

        it("should reward winner since paper > rock ", async () => {
            //attack & defend
            const attackerMove = ROCK
            const defenderMove = PAPER
            gameId = await casino.buildSecretMoveHashAsGameId(alice, attackerMove, secret)
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, defenderMove, {from: bob, value: gamePrice});
            //reward winner
            const rewardWinnerReceipt = await casino.revealAttackAndReward(gameId, attackerMove, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { gameId: gameId, winner: bob, reward: gamePrice.mul(toBN(2)), unlockedAttackerDeposit: attackerDeposit });
        });

        it("should reward winner since scissors > paper ", async () => {
            //attack & defend
            const attackerMove = SCISSORS
            const defenderMove = PAPER
            gameId = await casino.buildSecretMoveHashAsGameId(alice, attackerMove, secret)
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, defenderMove, {from: bob, value: gamePrice});
            //reward winner
            const rewardWinnerReceipt = await casino.revealAttackAndReward(gameId, attackerMove, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { gameId: gameId, winner: alice, reward: gamePrice.mul(toBN(2)), unlockedAttackerDeposit: attackerDeposit });
        });

        it("should reward winner since rock > scissors ", async () => {
            //attack & defend
            const attackerMove = SCISSORS
            const defenderMove = ROCK
            gameId = await casino.buildSecretMoveHashAsGameId(alice, attackerMove, secret)
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, defenderMove, {from: bob, value: gamePrice});
            //reward winner
            const rewardWinnerReceipt = await casino.revealAttackAndReward(gameId, attackerMove, secret, {from: alice});
            truffleAssert.eventEmitted(rewardWinnerReceipt, 'RewardWinnerEvent', { gameId: gameId, winner: bob, reward: gamePrice.mul(toBN(2)), unlockedAttackerDeposit: attackerDeposit });
        });
    });

    describe("Withdraw", () => {
        it("should withdraw balance", async () => {
            //attack, defend & reward
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});
            await casino.revealAttackAndReward(gameId, ROCK, secret, {from: alice});

            const balanceBefore = await web3.eth.getBalance(bob);
            // withdraw
            const receipt = await casino.withdrawBalance({from: bob});
            truffleAssert.eventEmitted(receipt, 'WithdrawBalanceEvent', { player: bob, reward: toBN(20) });

            // check effective withdraw amount
            const withdrawBalanceGasUsed = receipt.receipt.gasUsed;
            const tx = await web3.eth.getTransaction(receipt.tx);
            const withdrawBalanceGasPrice = tx.gasPrice;
            const withdrawBalanceCost = toBN(withdrawBalanceGasUsed).mul(toBN(withdrawBalanceGasPrice));
            const balanceAfter = await web3.eth.getBalance(bob);
            const effectiveWithdrawBalance = toBN(balanceAfter).sub(toBN(balanceBefore))
                 .add(toBN(withdrawBalanceCost)).toString(10);
            assert.strictEqual(effectiveWithdrawBalance.toString(10), '20');
        });

        it("should not withdraw balance since empty balance", async () => {
            //attack, defend & reward
            await casino.attack(gameId, {from: alice, value: attackerDeposit.add(gamePrice)});
            await casino.defend(gameId, PAPER, {from: bob, value: gamePrice});
            await casino.revealAttackAndReward(gameId, ROCK, secret, {from: alice});

            // withdraw
            await truffleAssert.reverts(
                casino.withdrawBalance({from: david}),
                "Cannot withdraw empty balance"
            );
        });
    });

});