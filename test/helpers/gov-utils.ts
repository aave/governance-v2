import {BigNumber, Signer, BigNumberish} from 'ethers';
import {SignerWithAddress, TestEnv} from './make-suite';
import {latestBlock, DRE} from '../../helpers/misc-utils';
import {expect, use} from 'chai';
import {Test} from 'mocha';
import {getFirstSigner} from '../../helpers/contracts-getters';
import {SelfdestructTransferFactory} from '../../types';

export const emptyBalances = async (users: SignerWithAddress[], testEnv: TestEnv) => {
  for (let i = 0; i < users.length; i++) {
    const balanceBefore = await testEnv.aave.connect(users[i].signer).balanceOf(users[i].address);
    await (
      await testEnv.aave.connect(users[i].signer).transfer(testEnv.minter.address, balanceBefore)
    ).wait();
  }
};

export const setBalance = async (user: SignerWithAddress, amount: BigNumber, testEnv: TestEnv) => {
  // emptying
  const balanceBefore = await testEnv.aave.connect(user.signer).balanceOf(user.address);
  await (
    await testEnv.aave.connect(user.signer).transfer(testEnv.minter.address, balanceBefore)
  ).wait();
  // filling
  await testEnv.aave.connect(testEnv.minter.signer).transfer(user.address, amount);
};

export const getInitContractData = async (testEnv: TestEnv) => ({
  votingDelay: await testEnv.gov.getVotingDelay(),
  votingDuration: await testEnv.executor.VOTING_DURATION(),
  executionDelay: await testEnv.executor.getDelay(),
  minimumPower: await testEnv.executor.getMinimumVotingPowerNeeded(
    await testEnv.strategy.getTotalVotingSupplyAt(await latestBlock())
  ),
  minimumCreatePower: await testEnv.executor.getMinimumPropositionPowerNeeded(
    testEnv.gov.address,
    await DRE.ethers.provider.getBlockNumber()
  ),
  gracePeriod: await testEnv.executor.GRACE_PERIOD(),
});

export const expectProposalState = async (
  proposalId: BigNumber,
  state: number,
  testEnv: TestEnv
) => {
  expect(await testEnv.gov.connect(testEnv.minter.signer).getProposalState(proposalId)).to.be.equal(
    state
  );
};

export const getLastProposalId = async (testEnv: TestEnv) => {
  const currentCount = await testEnv.gov.getProposalsCount();
  return currentCount.eq('0') ? currentCount : currentCount.sub('1');
};

export const encodeSetDelay = async (newDelay: string, testEnv: TestEnv) =>
  testEnv.gov.interface.encodeFunctionData('setVotingDelay', [BigNumber.from(newDelay)]);

export const impersonateAccountsHardhat = async (accounts: string[]) => {
  if (process.env.TENDERLY === 'true') {
    return;
  }
  // eslint-disable-next-line no-restricted-syntax
  for (const account of accounts) {
    // eslint-disable-next-line no-await-in-loop
    await DRE.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [account],
    });
    // Send ether to the impersonated address, which is a non payable contract via selfdestruct
    const selfDestructContract = await new SelfdestructTransferFactory(
      await getFirstSigner()
    ).deploy();
    await (
      await selfDestructContract.destroyAndTransfer(account, {
        value: DRE.ethers.utils.parseEther('1'),
      })
    ).wait();
  }
};
