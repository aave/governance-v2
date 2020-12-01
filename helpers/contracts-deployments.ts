import {tEthereumAddress, eContractid} from './types';
import {getAaveV2Mocked, getFirstSigner} from './contracts-getters';
import {
  AaveGovernanceV2Factory,
  ExecutorFactory,
  GovernanceStrategyFactory,
  InitializableAdminUpgradeabilityProxyFactory,
  AaveTokenV1MockFactory,
  AaveTokenV2Factory,
  FlashAttacksFactory,
} from '../types';
import {withSaveAndVerify} from './contracts-helpers';
import {waitForTx} from './misc-utils';
import {Interface} from 'ethers/lib/utils';

export const deployAaveGovernanceV2 = async (
  governanceStrategy: tEthereumAddress,
  votingDelay: string,
  guardian: tEthereumAddress,
  executors: tEthereumAddress[],
  verify?: boolean
) => {
  const args: [tEthereumAddress, string, string, tEthereumAddress[]] = [
    governanceStrategy,
    votingDelay,
    guardian,
    executors,
  ];
  return withSaveAndVerify(
    await new AaveGovernanceV2Factory(await getFirstSigner()).deploy(...args),
    eContractid.AaveGovernanceV2,
    args,
    verify
  );
};

export const deployGovernanceStrategy = async (
  aave: tEthereumAddress,
  stkAave: tEthereumAddress,
  verify?: boolean
) => {
  const args: [tEthereumAddress, tEthereumAddress] = [aave, stkAave];
  return withSaveAndVerify(
    await new GovernanceStrategyFactory(await getFirstSigner()).deploy(...args),
    eContractid.GovernanceStrategy,
    args,
    verify
  );
};

export const deployExecutor = async (
  admin: tEthereumAddress,
  delay: string,
  gracePeriod: string,
  minimumDelay: string,
  maximumDelay: string,
  propositionThreshold: string,
  voteDuration: string,
  voteDifferential: string,
  minimumQuorum: string,

  verify?: boolean
) => {
  const args: [tEthereumAddress, string, string, string, string, string, string, string, string] = [
    admin,
    delay,
    gracePeriod,
    minimumDelay,
    maximumDelay,
    propositionThreshold,
    voteDuration,
    voteDifferential,
    minimumQuorum,
  ];
  return withSaveAndVerify(
    await new ExecutorFactory(await getFirstSigner()).deploy(...args),
    eContractid.Executor,
    args,
    verify
  );
};

export const deployProxy = async (customId: string, verify?: boolean) =>
  await withSaveAndVerify(
    await new InitializableAdminUpgradeabilityProxyFactory(await getFirstSigner()).deploy(),
    eContractid.InitializableAdminUpgradeabilityProxy,
    [],
    verify,
    customId
  );

export const deployMockedAaveV2 = async (minter: tEthereumAddress, verify?: boolean) => {
  const proxy = await deployProxy(eContractid.AaveTokenV2Mock);

  const implementationV1 = await withSaveAndVerify(
    await new AaveTokenV1MockFactory(await getFirstSigner()).deploy(),
    eContractid.AaveTokenV1Mock,
    [],
    verify,
    eContractid.AaveTokenV1MockImpl
  );
  const implementationV2 = await withSaveAndVerify(
    await new AaveTokenV2Factory(await getFirstSigner()).deploy(),
    eContractid.AaveTokenV2,
    [],
    verify,
    eContractid.AaveTokenV2MockImpl
  );
  const encodedPayload = new Interface([
    'function initialize(address minter)',
  ]).encodeFunctionData('initialize', [minter]);
  await waitForTx(
    await proxy.functions['initialize(address,address,bytes)'](
      implementationV1.address,
      await (await getFirstSigner()).getAddress(),
      encodedPayload
    )
  );
  const encodedPayloadV2 = implementationV2.interface.encodeFunctionData('initialize');
  await waitForTx(await proxy.upgradeToAndCall(implementationV2.address, encodedPayloadV2));
  return await getAaveV2Mocked(proxy.address);
};

export const deployMockedStkAaveV2 = async (minter: tEthereumAddress, verify?: boolean) => {
  const proxy = await deployProxy(eContractid.StkAaveTokenV2Mock);

  const implementationV1 = await withSaveAndVerify(
    await new AaveTokenV1MockFactory(await getFirstSigner()).deploy(),
    eContractid.StkAaveTokenV1Mock,
    [],
    verify,
    eContractid.StkAaveTokenV1MockImpl
  );
  const implementationV2 = await withSaveAndVerify(
    await new AaveTokenV2Factory(await getFirstSigner()).deploy(),
    eContractid.StkAaveTokenV2,
    [],
    verify,
    eContractid.StkAaveTokenV2MockImpl
  );
  const encodedPayload = new Interface([
    'function initialize(address minter)',
  ]).encodeFunctionData('initialize', [minter]);
  await waitForTx(
    await proxy.functions['initialize(address,address,bytes)'](
      implementationV1.address,
      await (await getFirstSigner()).getAddress(),
      encodedPayload
    )
  );
  const encodedPayloadV2 = implementationV2.interface.encodeFunctionData('initialize');
  await waitForTx(await proxy.upgradeToAndCall(implementationV2.address, encodedPayloadV2));
  return await getAaveV2Mocked(proxy.address);
};

export const deployFlashAttacks = async (
  token: tEthereumAddress,
  minter: tEthereumAddress,
  governance: tEthereumAddress,
  verify?: boolean
) => {
  const args: [string, string, string] = [token, minter, governance];
  return await withSaveAndVerify(
    await new FlashAttacksFactory(await getFirstSigner()).deploy(...args),
    eContractid.InitializableAdminUpgradeabilityProxy,
    args,
    verify
  );
};
