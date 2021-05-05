import BigNumber from 'bignumber.js';
import BN = require('bn.js');
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';
import {WAD} from './constants';
import {Wallet, ContractTransaction} from 'ethers';
import {HardhatRuntimeEnvironment} from 'hardhat/types';

export const toWad = (value: string | number) => new BigNumber(value).times(WAD).toFixed();

export const bnToBigNumber = (amount: BN): BigNumber => new BigNumber(<any>amount);
export const stringToBigNumber = (amount: string): BigNumber => new BigNumber(amount);

export const getDb = () => low(new FileSync('./deployed-contracts.json'));

export let DRE: HardhatRuntimeEnvironment = {} as HardhatRuntimeEnvironment;
export const setDRE = (_DRE: HardhatRuntimeEnvironment) => {
  if (!DRE.config) {
    DRE = _DRE;
  }
};

export const sleep = (milliseconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export const createRandomAddress = () => Wallet.createRandom().address;

export const evmSnapshot = async () => {
  const id = await DRE.ethers.provider.send('evm_snapshot', []);
  return id;
};

export const evmRevert = async (id: string) => {
  const reverted = await DRE.ethers.provider.send('evm_revert', [id]);
  return reverted;
};

export const timeLatest = async () => {
  const block = await DRE.ethers.provider.getBlock('latest');
  return new BigNumber(block.timestamp);
};

export const advanceBlock = async (timestamp?: number) =>
  await DRE.ethers.provider.send('evm_mine', timestamp ? [timestamp] : []);

export const latestBlock = async () =>
  parseInt((await DRE.ethers.provider.send('eth_getBlockByNumber', ['latest', false])).number);

export const advanceBlockTo = async (target: number) => {
  const currentBlock = await latestBlock();
  const start = Date.now();
  let notified;
  if (target < currentBlock)
    throw Error(`Target block #(${target}) is lower than current block #(${currentBlock})`);
  while ((await latestBlock()) < target) {
    if (!notified && Date.now() - start >= 5000) {
      notified = true;
      console.log(`advanceBlockTo: Advancing too many blocks is causing this test to be slow.'`);
    }
    await advanceBlock();
  }
};

export const increaseTime = async (secondsToIncrease: number) => {
  await DRE.ethers.provider.send('evm_increaseTime', [secondsToIncrease]);
  await DRE.ethers.provider.send('evm_mine', []);
};

export const waitForTx = async (tx: ContractTransaction) => await tx.wait();

export const filterMapBy = (raw: {[key: string]: any}, fn: (key: string) => boolean) =>
  Object.keys(raw)
    .filter(fn)
    .reduce<{[key: string]: any}>((obj, key) => {
      obj[key] = raw[key];
      return obj;
    }, {});

export const chunk = <T>(arr: Array<T>, chunkSize: number): Array<Array<T>> => {
  return arr.reduce(
    (prevVal: any, currVal: any, currIndx: number, array: Array<T>) =>
      !(currIndx % chunkSize)
        ? prevVal.concat([array.slice(currIndx, currIndx + chunkSize)])
        : prevVal,
    []
  );
};
