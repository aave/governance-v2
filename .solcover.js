const accounts = require(`./test-wallets.js`).accounts;

module.exports = {
  skipFiles: ['./mocks', './interfaces', './misc', './dependencies'],
  mocha: {
    enableTimeouts: false,
  },
  providerOptions: {
    accounts,
  },
};
