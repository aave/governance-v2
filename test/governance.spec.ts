import {expect, use} from 'chai';
import {ZERO_ADDRESS} from '../helpers/constants';
import {makeSuite, TestEnv} from './helpers/make-suite';
import {solidity} from 'ethereum-waffle';
import {BytesLike, formatEther, parseEther} from 'ethers/lib/utils';
import {BigNumberish, BigNumber} from 'ethers';
import {waitForTx, advanceBlockTo, latestBlock, DRE} from '../helpers/misc-utils';
use(solidity);

const ipfsBytes32Hash = '0x47858569385046d7f77f5032ae41e511b40a7fbfbd315503ba3d99a6dc885f2b';

makeSuite('Aave Governance V2 tests', (testEnv: TestEnv) => {
  let votingDelay: BigNumber;
  let votingDuration: BigNumber;
  let executionDelay: BigNumber;
  let currentVote: BigNumber;
  let minimumPower: BigNumber;

  before(async () => {
    const {gov, executor, strategy} = testEnv;
    votingDelay = await gov.getVotingDelay();
    votingDuration = await executor.VOTING_DURATION();
    executionDelay = await executor.getDelay();
    // Supply does not change during the tests
    minimumPower = await executor.getMinimumVotingPowerNeeded(
      await strategy.getTotalVotingSupplyAt(await latestBlock())
    );

    const {aave, minter} = testEnv;
    const balanceminter = await aave.connect(minter.signer).balanceOf(minter.address);

    console.log('minter balance :', formatEther(balanceminter));
    console.log('mininimu vote  :', formatEther(minimumPower));
  });

  beforeEach(async () => {
    const {gov} = testEnv;
    const currentCount = await gov.getProposalsCount();
    currentVote = currentCount.eq('0') ? currentCount : currentCount.sub('1');
  });

  it('Create a proposal without calldata', async () => {
    const {
      gov,
      users: [user],
      minter,
      executor,
      aave,
      strategy,
    } = testEnv;
    // Give enought AAVE for proposition tokens
    await aave.connect(minter.signer).transfer(user.address, parseEther('100000'));

    // Count current proposal id
    const count = await gov.connect(user.signer).getProposalsCount();

    // Params for proposal
    const params: [
      string,
      string[],
      BigNumberish[],
      string[],
      BytesLike[],
      boolean[],
      BytesLike
    ] = [executor.address, [ZERO_ADDRESS], ['0'], [''], ['0x'], [false], ipfsBytes32Hash];

    // Create proposal
    const tx = await gov.connect(user.signer).create(...params);

    // Check ProposalCreated event
    const startBlock = BigNumber.from(tx.blockNumber).add(votingDelay);
    const endBlock = startBlock.add(votingDuration);
    const [
      executorAddress,
      targets,
      values,
      signatures,
      calldatas,
      withDelegateCalls,
      ipfsHash,
    ] = params;

    await expect(Promise.resolve(tx))
      .to.emit(gov, 'ProposalCreated')
      .withArgs(
        count,
        user.address,
        executorAddress,
        targets,
        values,
        signatures,
        calldatas,
        withDelegateCalls,
        startBlock,
        endBlock,
        strategy.address,
        ipfsHash
      );
  });
  it('Cancel a proposal by guardian due Threshold is below of minimum', async () => {
    const {
      gov,
      deployer, // deployer is guardian
      users: [user],
      aave,
      minter,
    } = testEnv;
    // Transfer all balance from User[0] back to the minter address
    const balance = await aave.connect(user.signer).balanceOf(user.address);
    await aave.connect(user.signer).transfer(minter.address, balance);

    // Guardian cancels the proposal
    const latestProposal = (await gov.connect(user.signer).getProposalsCount()).sub('1');
    await expect(gov.connect(deployer.signer).cancel(latestProposal))
      .to.emit(gov, 'ProposalCanceled')
      .withArgs(latestProposal);
  });

  it('Vote a proposal with enougth voting power', async () => {
    const {
      gov,
      users: [user],
      minter,
      executor,
      aave,
    } = testEnv;
    // Give enought AAVE for voting power and proposal threshold
    await aave.connect(minter.signer).transfer(user.address, minimumPower.add('1'));

    // Create proposal
    const tx1 = await waitForTx(
      await gov
        .connect(user.signer)
        .create(executor.address, [ZERO_ADDRESS], ['0'], [''], ['0x'], [false], ipfsBytes32Hash)
    );

    // Check ProposalCreated event
    const proposalId = tx1.events?.[0].args?.id;
    const startBlock = BigNumber.from(tx1.blockNumber).add(votingDelay);
    const endBlock = startBlock.add(votingDuration);
    const balance = await aave.connect(user.signer).balanceOf(user.address);
    await advanceBlockTo(Number(startBlock.toString()));

    // Vote
    await expect(gov.connect(user.signer).submitVote(proposalId, true))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(proposalId, user.address, true, balance);

    // Move time to end block
    await advanceBlockTo(Number(endBlock.add('5').toString()));

    // Check success vote
    const proposalState = await gov.getProposalState(proposalId);
    expect(proposalState).to.be.equal(4);
  });

  it('Queue a proposal', async () => {
    const {
      gov,
      users: [user],
    } = testEnv;
    const state = await gov.connect(user.signer).getProposalState(currentVote);
    console.log('state', state);
    // Queue
    const queueTx = await gov.connect(user.signer).queue(currentVote);
    const queueTxResponse = await waitForTx(queueTx);
    const blockTime = await DRE.ethers.provider.getBlock(queueTxResponse.blockNumber);

    const executionTime = blockTime.timestamp + Number(executionDelay.toString());

    await expect(Promise.resolve(queueTx))
      .to.emit(gov, 'ProposalQueued')
      .withArgs(currentVote, executionTime, user.address);
  });

  xit('Execute a proposal', async () => {});
  xit('Vote a proposal by permit', async () => {});
  xit('Set governance strategy', async () => {});
  xit('Set voting delay', async () => {});
  xit('Blacklist executor', async () => {});
  xit('Whitelist executor', async () => {});
  it('Abdicate guardian', async () => {
    const {
      gov,
      deployer,
      users: [user],
    } = testEnv;

    await gov.connect(deployer.signer).__abdicate();
    const guardian = await gov.connect(deployer.signer).getGuardian();
    expect(guardian).to.equal(ZERO_ADDRESS);
  });
});
