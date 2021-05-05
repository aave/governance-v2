const shell = require('shelljs'); // This is a dep at solidity-coverage, no need to install separately

const accounts = require(`./test-wallets.js`).accounts;

module.exports = {
  skipFiles: ['./mocks', './interfaces', './misc', './dependencies'],
  mocha: {
    enableTimeouts: false,
  },
  providerOptions: {
    accounts,
  },
  onCompileComplete: async function (config) {
    console.log('running');
    shell.exec(
      "typechain --target ethers-v5 --outDir types/ './artifacts/contracts/**/!(*.dbg).json'"
    );
  },
};
