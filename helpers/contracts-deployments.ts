import {tEthereumAddress, eContractid} from './types';
import {getAaveV2Mocked, getFirstSigner} from './contracts-getters';
import {
  AaveGovernanceV2Factory,
  ExecutorFactory,
  GovernanceStrategyFactory,
  InitializableAdminUpgradeabilityProxyFactory,
  AaveTokenV1MockFactory,
  AaveTokenV2Factory,
  ExecutorMockFactory,
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
  propositionToken: tEthereumAddress,
  votingToken: tEthereumAddress,
  propositionThreshold: string,
  verify?: boolean
) => {
  const args: [tEthereumAddress, tEthereumAddress, string] = [
    propositionToken,
    votingToken,
    propositionThreshold,
  ];
  return withSaveAndVerify(
    await new GovernanceStrategyFactory(await getFirstSigner()).deploy(...args),
    eContractid.GovernanceStrategy,
    args,
    verify
  );
};

export const deployExecutor = async (admin: tEthereumAddress, delay: string, verify?: boolean) => {
  const args: [tEthereumAddress, string] = [admin, delay];
  return withSaveAndVerify(
    await new ExecutorFactory(await getFirstSigner()).deploy(...args),
    eContractid.Executor,
    args,
    verify
  );
};

export const deployExecutorMock = async (
  admin: tEthereumAddress,
  delay: string,
  verify?: boolean
) => {
  const args: [tEthereumAddress, string] = [admin, delay];
  return withSaveAndVerify(
    await new ExecutorMockFactory(await getFirstSigner()).deploy(...args),
    eContractid.ExecutorMock,
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
