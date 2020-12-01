import {
  AaveGovernanceV2Factory,
  AaveTokenV2Factory,
  ExecutorFactory,
  GovernanceStrategyFactory,
} from '../types';
import {DRE, getDb} from './misc-utils';
import {eContractid, tEthereumAddress} from './types';

export const getFirstSigner = async () => (await DRE.ethers.getSigners())[0];

export const getAaveGovernanceV2 = async (address?: tEthereumAddress) =>
  await AaveGovernanceV2Factory.connect(
    address ||
      (await getDb().get(`${eContractid.AaveGovernanceV2}.${DRE.network.name}`).value()).address,
    await getFirstSigner()
  );

export const getAaveV2Mocked = async (address?: tEthereumAddress) =>
  await AaveTokenV2Factory.connect(
    address ||
      (await getDb().get(`${eContractid.AaveTokenV2Mock}.${DRE.network.name}`).value()).address,
    await getFirstSigner()
  );

export const getStkAaveV2Mocked = async (address?: tEthereumAddress) =>
  await AaveTokenV2Factory.connect(
    address ||
      (await getDb().get(`${eContractid.StkAaveTokenV2Mock}.${DRE.network.name}`).value()).address,
    await getFirstSigner()
  );

export const getGovernanceStrategy = async (address?: tEthereumAddress) =>
  await GovernanceStrategyFactory.connect(
    address ||
      (await getDb().get(`${eContractid.GovernanceStrategy}.${DRE.network.name}`).value()).address,
    await getFirstSigner()
  );

export const getExecutor = async (address?: tEthereumAddress) =>
  await ExecutorFactory.connect(
    address || (await getDb().get(`${eContractid.Executor}.${DRE.network.name}`).value()).address,
    await getFirstSigner()
  );
