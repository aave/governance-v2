import {expect, use} from 'chai';
import {MAX_UINT_AMOUNT, ZERO_ADDRESS} from '../helpers/constants';
import {makeSuite, TestEnv} from './helpers/make-suite';
import {solidity} from 'ethereum-waffle';
import {BytesLike, formatEther, parseEther, splitSignature} from 'ethers/lib/utils';
import {BigNumberish, BigNumber, Wallet} from 'ethers';
import {waitForTx, advanceBlockTo, latestBlock, DRE, advanceBlock} from '../helpers/misc-utils';
import {deployGovernanceStrategy} from '../helpers/contracts-deployments';
import {buildPermitParams, getSignatureFromTypedData} from './helpers/permit';
import {fail} from 'assert';
use(solidity);

const ipfsBytes32Hash = '0x47858569385046d7f77f5032ae41e511b40a7fbfbd315503ba3d99a6dc885f2b';

makeSuite('Aave Governance V2 tests', (testEnv: TestEnv) => {
  let votingDelay: BigNumber;
  let votingDuration: BigNumber;
  let executionDelay: BigNumber;
  let currentVote: BigNumber;
  let minimumPower: BigNumber;

  before(async () => {
    const {
      gov,
      executor,
      strategy,
      aave,
      users: [user1, user2],
      minter,
    } = testEnv;
    votingDelay = await gov.getVotingDelay();
    votingDuration = await executor.VOTING_DURATION();
    executionDelay = await executor.getDelay();

    // Supply does not change during the tests
    minimumPower = await executor.getMinimumVotingPowerNeeded(
      await strategy.getTotalVotingSupplyAt(await latestBlock())
    );
    // Add some funds to user1
    await aave.connect(minter.signer).transfer(user1.address, minimumPower.add('1'));
    await aave.connect(minter.signer).transfer(user2.address, minimumPower.div('2'));
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

    // Transfer funds to user to create proposal and vote
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
    const balance = await aave.connect(user.signer).balanceOf(user.address);
    await advanceBlockTo(Number(startBlock.toString()));

    // Vote
    await expect(gov.connect(user.signer).submitVote(proposalId, true))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(proposalId, user.address, true, balance);
  });

  it('Vote a proposal by permit', async () => {
    const {
      users: [, user2],
      minter,
      aave,
      gov,
    } = testEnv;
    const {chainId} = await DRE.ethers.provider.getNetwork();
    const configChainId = DRE.network.config.chainId;
    // ChainID must exist in current provider to work
    expect(configChainId).to.be.equal(chainId);
    if (!chainId) {
      fail("Current network doesn't have CHAIN ID");
    }

    // Prepare signature
    const msgParams = buildPermitParams(chainId, gov.address, currentVote.toString(), true);
    const ownerPrivateKey = require('../test-wallets.js').accounts[3].secretKey; // deployer, minter, user1, user3

    const {v, r, s} = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    const balance = await aave.connect(minter.signer).balanceOf(user2.address);

    // Publish vote by signature using other address as relayer
    const votePermitTx = await gov
      .connect(user2.signer)
      .submitVoteBySignature(currentVote, true, v, r, s);

    await expect(Promise.resolve(votePermitTx))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(currentVote, user2.address, true, balance);
  });

  it('Queue a proposal', async () => {
    const {
      gov,
      users: [user],
    } = testEnv;
    const {endBlock} = await gov.getProposalById(currentVote);

    // Move time to end block
    await advanceBlockTo(Number(endBlock.add('5').toString()));

    // Check success vote
    const proposalState = await gov.getProposalState(currentVote);
    expect(proposalState).to.be.equal(4);
    // Queue
    const queueTx = await gov.connect(user.signer).queue(currentVote);
    const queueTxResponse = await waitForTx(queueTx);
    const blockTime = await DRE.ethers.provider.getBlock(queueTxResponse.blockNumber);

    const executionTime = blockTime.timestamp + Number(executionDelay.toString());

    await expect(Promise.resolve(queueTx))
      .to.emit(gov, 'ProposalQueued')
      .withArgs(currentVote, executionTime, user.address);
  });

  it('Execute a proposal without payload', async () => {
    const {
      gov,
      users: [user],
    } = testEnv;
    const {executionTime} = await gov.getProposalById(currentVote);
    await advanceBlock(Number(executionTime.toString()));

    // Execute the propoal
    const executeTx = await gov.connect(user.signer).execute(currentVote);

    await expect(Promise.resolve(executeTx))
      .to.emit(gov, 'ProposalExecuted')
      .withArgs(currentVote, user.address);
  });

  it('Set governance strategy', async () => {
    const {gov, deployer, aave, stkAave} = testEnv;

    const strategy = await deployGovernanceStrategy(aave.address, stkAave.address);

    // Set new strategy
    await gov.connect(deployer.signer).setGovernanceStrategy(strategy.address);
    const govStrategy = await gov.getGovernanceStrategy();

    expect(govStrategy).to.equal(strategy.address);
  });

  it('Set voting delay', async () => {
    const {gov, deployer} = testEnv;

    // Set voting delay
    await gov.connect(deployer.signer).setVotingDelay('10');
    const govVotingDelay = await gov.getVotingDelay();

    expect(govVotingDelay).to.equal('10');
  });

  it('Blacklist executor', async () => {
    const {gov, deployer, executor} = testEnv;

    // Blacklist
    await gov.connect(deployer.signer).blacklistExecutors([executor.address]);
    const isWhitelisted = await gov
      .connect(deployer.signer)
      .isExecutorWhitelisted(executor.address);

    expect(isWhitelisted).to.equal(false);
  });

  it('Whitelist executor', async () => {
    const {
      gov,
      deployer, // is owner of gov
      executor,
    } = testEnv;

    // Whitelist
    await gov.connect(deployer.signer).whitelistExecutors([executor.address]);
    const isWhitelisted = await gov
      .connect(deployer.signer)
      .isExecutorWhitelisted(executor.address);

    expect(isWhitelisted).to.equal(true);
  });

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
