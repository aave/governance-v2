import path from 'path';
import fs from 'fs';
import {usePlugin, task} from '@nomiclabs/buidler/config';
// @ts-ignore
import {accounts} from './test-wallets.js';
import {eEthereumNetwork} from './helpers/types';
import {BUIDLEREVM_CHAINID, COVERAGE_CHAINID} from './helpers/buidler-constants';
import {setDRE} from './helpers/misc-utils';

require('dotenv').config();

usePlugin('@nomiclabs/buidler-ethers');
usePlugin('buidler-typechain');
usePlugin('solidity-coverage');
usePlugin('@nomiclabs/buidler-waffle');
usePlugin('@nomiclabs/buidler-etherscan');
usePlugin('buidler-gas-reporter');

const DEFAULT_BLOCK_GAS_LIMIT = 12450000;
const HARDFORK = 'istanbul';
const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY || '';

task(`set-DRE`, `Inits the DRE, to have access to all the plugins' objects`).setAction(
  async (_, _DRE) => {
    setDRE(_DRE);
    return _DRE;
  }
);

const buidlerConfig: any = {
  solc: {
    version: '0.6.8',
    optimizer: {enabled: true, runs: 200},
    evmVersion: HARDFORK,
  },
  typechain: {
    outDir: 'types',
    target: 'ethers-v4',
  },
  etherscan: {
    apiKey: ETHERSCAN_KEY,
  },
  defaultNetwork: 'buidlerevm',
  mocha: {
    timeout: 0,
  },
  networks: {
    coverage: {
      url: 'http://localhost:8555',
      chainId: COVERAGE_CHAINID,
    },
    buidlerevm: {
      hardfork: 'istanbul',
      blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
      gas: DEFAULT_BLOCK_GAS_LIMIT,
      gasPrice: 8000000000,
      chainId: BUIDLEREVM_CHAINID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      accounts: accounts.map(({secretKey, balance}: {secretKey: string; balance: string}) => ({
        privateKey: secretKey,
        balance,
      })),
    },
  },
};

export default buidlerConfig;
