const Game = artifacts.require("./Game.sol");
const truffleAssert = require('truffle-assertions');

const { BN, toBN } = web3.utils
require('chai').use(require('chai-bn')(BN)).should();

// ganache-cli --accounts=10 --host=0.0.0.0

contract("Game", accounts => {
    describe("Testing Game contract", () => {

        let game;
        // accounts
        const [ alice, bob, carol, david, anyone ] = accounts;

        beforeEach("Fresh contract & accounts", async () => {
            // deploy Game
            game = await Game.new({from: alice});
        });

        describe("Method", () => {
            it("should", async () => {
                assert.isTrue(true);
            });
        });

    });
});