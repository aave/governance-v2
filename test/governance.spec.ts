import {expect, use} from 'chai';
import {ipfsBytes32Hash, MAX_UINT_AMOUNT, ZERO_ADDRESS} from '../helpers/constants';
import {makeSuite, TestEnv} from './helpers/make-suite';
import {solidity} from 'ethereum-waffle';
import {BytesLike, formatEther, parseEther, splitSignature} from 'ethers/lib/utils';
import {BigNumberish, BigNumber, Wallet} from 'ethers';
import {
  evmRevert,
  evmSnapshot,
  waitForTx,
  advanceBlockTo,
  latestBlock,
  DRE,
  advanceBlock,
} from '../helpers/misc-utils';
import {deployGovernanceStrategy} from '../helpers/contracts-deployments';
import {buildPermitParams, getSignatureFromTypedData} from './helpers/permit';
import {fail} from 'assert';
use(solidity);

const proposalStates = {
  PENDING: 0,
  CANCELED: 1,
  ACTIVE: 2,
  FAILED: 3,
  SUCCEEDED: 4,
  QUEUED: 5,
  EXPIRED: 6,
  EXECUTED: 7,
};

const snapshots = new Map<string, string>();

makeSuite('Aave Governance V2 tests', (testEnv: TestEnv) => {
  let votingDelay: BigNumber;
  let votingDuration: BigNumber;
  let executionDelay: BigNumber;
  let minimumPower: BigNumber;
  let minimumCreatePower: BigNumber;
  let proposalId: BigNumber;
  let startBlock: BigNumber;
  let endBlock: BigNumber;

  // Snapshoting main states as entry for later testing
  // Then will test by last snap shot first.
  before(async () => {
    const {gov, executor, strategy, aave, users, minter} = testEnv;
    const [user1, user2, user3, user4] = users;

    // Cleaning users balances
    for (let i = 0; i < users.length; i++) {
      const balanceBefore = await aave.connect(users[i].signer).balanceOf(users[i].address);
      await (await aave.connect(users[i].signer).transfer(minter.address, balanceBefore)).wait();
    }

    votingDelay = await gov.getVotingDelay();
    votingDuration = await executor.VOTING_DURATION();
    executionDelay = await executor.getDelay();

    // Supply does not change during the tests
    minimumPower = await executor.getMinimumVotingPowerNeeded(
      await strategy.getTotalVotingSupplyAt(await latestBlock())
    );
    minimumCreatePower = await executor.getMinimumPropositionPowerNeeded(
      gov.address,
      await DRE.ethers.provider.getBlockNumber()
    );

    // SNAPSHOT: EMPTY GOVERNANCE
    snapshots.set('start', await evmSnapshot());

    // Creating one pending proposal
    await aave.connect(minter.signer).transfer(user1.address, minimumCreatePower);
    const tx1 = await waitForTx(
      await gov
        .connect(user1.signer)
        .create(executor.address, [ZERO_ADDRESS], ['0'], [''], ['0x'], [false], ipfsBytes32Hash)
    );
    // cleaning up user1 balance
    const balance1 = await aave.connect(user1.signer).balanceOf(user1.address);
    await (await aave.connect(user1.signer).transfer(minter.address, balance1)).wait();

    // fixing constants
    proposalId = tx1.events?.[0].args?.id;
    startBlock = BigNumber.from(tx1.blockNumber).add(votingDelay);
    endBlock = BigNumber.from(tx1.blockNumber).add(votingDelay).add(votingDuration);
    expect(await gov.connect(user1.signer).getProposalState(proposalId)).to.be.equal(
      proposalStates.PENDING
    );

    // SNAPSHOT: PENDING PROPOSAL
    snapshots.set('pending', await evmSnapshot());

    const balanceBefore = await aave.connect(user1.signer).balanceOf(user1.address);
    // Preparing users with different powers for test
    // user 1: 50% min voting power + 2 = 10%+ total power
    await aave.connect(minter.signer).transfer(user1.address, minimumPower.div('2').add('2'));
    // user 2: 50% min voting power + 2 = 10%+ total power
    await aave.connect(minter.signer).transfer(user2.address, minimumPower.div('2').add('2'));
    // user 3: 2 % min voting power, will be used to swing the vote
    await aave
      .connect(minter.signer)
      .transfer(user3.address, minimumPower.mul('2').div('100').add('10'));
    // user 4: 75% min voting power + 10 : = 15%+ total power, can barely make fail differential
    await aave
      .connect(minter.signer)
      .transfer(user4.address, minimumPower.mul('75').div('100').add('10'));
    const balanceAfter = await aave.connect(user1.signer).balanceOf(user1.address);

    // Pending => Active
    // => go tto start block
    await advanceBlockTo(Number(startBlock.add(1).toString()));
    expect(await gov.connect(user1.signer).getProposalState(proposalId)).to.be.equal(
      proposalStates.ACTIVE
    );

    // SNAPSHOT: ACTIVE PROPOSAL
    snapshots.set('active', await evmSnapshot());

    // Active => Succeeded, user 1 + user 2 votes > threshold
    await expect(gov.connect(user1.signer).submitVote(proposalId, true))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(proposalId, user1.address, true, balanceAfter);
    await expect(gov.connect(user2.signer).submitVote(proposalId, true))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(proposalId, user2.address, true, balanceAfter);
    // go to end of voting period
    await advanceBlockTo(Number(endBlock.add('3').toString()));
    expect(await gov.connect(user1.signer).getProposalState(proposalId)).to.be.equal(
      proposalStates.SUCCEEDED
    );

    // SNAPSHOT: SUCCEEDED PROPOSAL
    snapshots.set('succeeded', await evmSnapshot());

    // Succeeded => Queued:
    const queueTx = await gov.connect(user1.signer).queue(proposalId);
    expect(await gov.connect(user1.signer).getProposalState(proposalId)).to.be.equal(
      proposalStates.QUEUED
    );

    // SNAPSHOT: QUEUED PROPOSAL
    snapshots.set('queued', await evmSnapshot());
  });
  describe('Testing cancel function on queued proposal on gov + exec', async function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('queued') || '1');
      const {
        gov,
        executor,
        users: [user],
      } = testEnv;
      const currentCount = await gov.getProposalsCount();
      proposalId = currentCount.eq('0') ? currentCount : currentCount.sub('1');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.QUEUED
      );
      snapshots.set('queued', await evmSnapshot());
    });
    it('should not cancel when Threshold is higher than minimum and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        minter,
      } = testEnv;
      // giving threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // not guardian, no threshold
      await expect(gov.connect(user.signer).cancel(proposalId)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel a queued proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
        aave,
        minter,
      } = testEnv;
      // removing threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.QUEUED
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
        
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
    it('should not cancel when proposition already canceled', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
        aave,
        minter,
      } = testEnv;
      // removing threshold power
      // cancelled
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.QUEUED
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
      await expect(gov.connect(user.signer).cancel(proposalId)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      await expect(gov.connect(deployer.signer).cancel(proposalId)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should cancel queued prop by guardian, when creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
        aave,
        minter,
      } = testEnv;
      // giving threshold power to creator
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // cancel as guardian
      await expect(gov.connect(deployer.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
    it('should cancel an queued proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        executor,
        minter,
      } = testEnv;
      // removing threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));

      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.QUEUED
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
  });
  describe('Testing execute function', async function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('queued') || '1');
      snapshots.set('queued', await evmSnapshot());
      const {
        gov,
        users: [user],
      } = testEnv;
      let currentCount = await gov.getProposalsCount();
      proposalId = currentCount.eq('0') ? currentCount : currentCount.sub('1');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.QUEUED
      );
    });
    it('Execute a proposal without payload', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      const {executionTime} = await gov.getProposalById(proposalId);
      await advanceBlock(Number(executionTime.toString()));

      // Execute the propoal
      const executeTx = await gov.connect(user.signer).execute(proposalId);

      await expect(Promise.resolve(executeTx))
        .to.emit(gov, 'ProposalExecuted')
        .withArgs(proposalId, user.address);
    });
  });
  describe('Testing cancel function on succeeded proposal', async function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('succeeded') || '1');
      const {
        gov,
        users: [user],
      } = testEnv;
      const currentCount = await gov.getProposalsCount();
      proposalId = currentCount.eq('0') ? currentCount : currentCount.sub('1');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.SUCCEEDED
      );
      snapshots.set('succeeded', await evmSnapshot());
    });
    it('should not cancel when Threshold is higher than minimum and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        minter,
      } = testEnv;
      // giving threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // not guardian, no threshold
      await expect(gov.connect(user.signer).cancel(proposalId)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel a succeeded proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        executor,
        minter,
      } = testEnv;
      // removing threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.SUCCEEDED
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
    it('should not cancel when proposition already canceled', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
        aave,
        minter,
      } = testEnv;
      // removing threshold power
      // cancelled
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.SUCCEEDED
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
      await expect(gov.connect(user.signer).cancel(proposalId)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      await expect(gov.connect(deployer.signer).cancel(proposalId)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should cancel succeeded prop by guardian, when creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        executor,
        minter,
      } = testEnv;
      // giving threshold power to creator
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // cancel as guardian
      await expect(gov.connect(deployer.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
    it('should cancel an succeeded proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
        aave,
        minter,
      } = testEnv;
      // removing threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));

      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.SUCCEEDED
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
  });
  describe('Testing queue function', async function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('succeeded') || '1');
      snapshots.set('succeeded', await evmSnapshot());
      const {
        gov,
        users: [user],
      } = testEnv;
      let currentCount = await gov.getProposalsCount();
      proposalId = currentCount.eq('0') ? currentCount : currentCount.sub('1');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.SUCCEEDED
      );
    });
    it('Queue a proposal', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      const {endBlock} = await gov.getProposalById(proposalId);

      // Move time to end block
      await advanceBlockTo(Number(endBlock.add('8').toString()));

      // Check success vote
      const proposalState = await gov.getProposalState(proposalId);
      expect(proposalState).to.be.equal(4);
      // Queue
      const queueTx = await gov.connect(user.signer).queue(proposalId);
      const queueTxResponse = await waitForTx(queueTx);
      const blockTime = await DRE.ethers.provider.getBlock(queueTxResponse.blockNumber);

      const executionTime = blockTime.timestamp + Number(executionDelay.toString());

      await expect(Promise.resolve(queueTx))
        .to.emit(gov, 'ProposalQueued')
        .withArgs(proposalId, executionTime, user.address);
    });
  });
  describe('Testing voting functions', async function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('active') || '1');
      snapshots.set('active', await evmSnapshot());
      const {
        gov,
        users: [user],
      } = testEnv;
      let currentCount = await gov.getProposalsCount();
      proposalId = currentCount.eq('0') ? currentCount : currentCount.sub('1');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.ACTIVE
      );
    });
    it('Vote a proposal without quorum => proposal failed', async () => {
      // User 1 has 50% min power, should fail
      const {
        gov,
        users: [user1],
        minter,
        executor,
        aave,
      } = testEnv;

      // almost emptying balance, user 3 has only 1 voting power
      const balance = await aave.connect(user1.signer).balanceOf(user1.address);
      await expect(gov.connect(user1.signer).submitVote(proposalId, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user1.address, true, balance);

      await advanceBlockTo(Number(endBlock.add('9').toString()));
      expect(await gov.connect(user1.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.FAILED
      );
    });
    it('Vote a proposal with quorum => proposal succeeded', async () => {
      // Vote
      const {
        gov,
        users: [user1, user2],
        minter,
        executor,
        aave,
      } = testEnv;
      // User 1 + User 2 power > voting po<wer
      const balance1 = await aave.connect(user1.signer).balanceOf(user1.address);
      await expect(gov.connect(user1.signer).submitVote(proposalId, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user1.address, true, balance1);
      const balance2 = await aave.connect(user2.signer).balanceOf(user2.address);
      await expect(gov.connect(user2.signer).submitVote(proposalId, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user2.address, true, balance2);

      // active => succeeded

      await advanceBlockTo(Number(endBlock.add('10').toString()));
      expect(await gov.connect(user1.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.SUCCEEDED
      );
    });
    it('Vote a proposal with quorum but not vote dif => proposal failed', async () => {
      // Vote
      const {
        gov,
        users: [user1, user2, user3, user4],
        minter,
        executor,
        aave,
      } = testEnv;
      // User 1 + User 2 = 20% power, voting yes
      const balance1 = await aave.connect(user1.signer).balanceOf(user1.address);
      await expect(gov.connect(user1.signer).submitVote(proposalId, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user1.address, true, balance1);
      const balance2 = await aave.connect(user2.signer).balanceOf(user2.address);
      await expect(gov.connect(user2.signer).submitVote(proposalId, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user2.address, true, balance2);

      // User 4 = 15% Power, voting no
      const balance4 = await aave.connect(user4.signer).balanceOf(user4.address);
      await expect(gov.connect(user4.signer).submitVote(proposalId, false))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user4.address, false, balance4);

      await advanceBlockTo(Number(endBlock.add('11').toString()));
      expect(await gov.connect(user1.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.FAILED
      );
    });
    it('Vote a proposal with quorum and vote dif => proposal succeeded', async () => {
      // Vote
      const {
        gov,
        users: [user1, user2, user3, user4],
        minter,
        executor,
        aave,
      } = testEnv;
      // User 1 + User 2 = 20% power, voting yes
      const balance1 = await aave.connect(user1.signer).balanceOf(user1.address);
      await expect(gov.connect(user1.signer).submitVote(proposalId, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user1.address, true, balance1);
      const balance2 = await aave.connect(user2.signer).balanceOf(user2.address);
      await expect(gov.connect(user2.signer).submitVote(proposalId, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user2.address, true, balance2);

      // User 4 = 15% Power, voting no
      const balance4 = await aave.connect(user4.signer).balanceOf(user4.address);
      await expect(gov.connect(user4.signer).submitVote(proposalId, false))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user4.address, false, balance4);

      // User 3 makes the vote swing
      const balance3 = await aave.connect(user3.signer).balanceOf(user3.address);
      await expect(gov.connect(user3.signer).submitVote(proposalId, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user3.address, true, balance3);

      await advanceBlockTo(Number(endBlock.add('12').toString()));
      expect(await gov.connect(user1.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.SUCCEEDED
      );
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
      const msgParams = buildPermitParams(chainId, gov.address, proposalId.toString(), true);
      const ownerPrivateKey = require('../test-wallets.js').accounts[3].secretKey; // deployer, minter, user1, user3

      const {v, r, s} = getSignatureFromTypedData(ownerPrivateKey, msgParams);

      const balance = await aave.connect(minter.signer).balanceOf(user2.address);

      // Publish vote by signature using other address as relayer
      const votePermitTx = await gov
        .connect(user2.signer)
        .submitVoteBySignature(proposalId, true, v, r, s);

      await expect(Promise.resolve(votePermitTx))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposalId, user2.address, true, balance);
    });
  });
  describe('Testing cancel function on active proposal', async function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('active') || '1');
      const {
        gov,
        users: [user],
      } = testEnv;
      const currentCount = await gov.getProposalsCount();
      proposalId = currentCount.eq('0') ? currentCount : currentCount.sub('1');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.ACTIVE
      );
      snapshots.set('active', await evmSnapshot());
    });
    it('should not cancel when Threshold is higher than minimum and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        minter,
      } = testEnv;
      // giving threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // not guardian, no threshold
      await expect(gov.connect(user.signer).cancel(proposalId)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel a active proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        minter,
        executor
      } = testEnv;
      // removing threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.ACTIVE
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
    it('should not cancel when proposition already canceled', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        minter,
        executor
      } = testEnv;
      // removing threshold power
      // cancelled
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.ACTIVE
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
      await expect(gov.connect(user.signer).cancel(proposalId)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      await expect(gov.connect(deployer.signer).cancel(proposalId)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should cancel active prop by guardian, when creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        executor,
        minter,
      } = testEnv;
      // giving threshold power to creator
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // cancel as guardian
      await expect(gov.connect(deployer.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
    it('should cancel an active proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        executor,
        minter,
      } = testEnv;
      // removing threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));

      // active
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.ACTIVE
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
  });
  describe('Testing cancel function pending proposal', async function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('pending') || '1');
      const {
        gov,
        users: [user],
      } = testEnv;
      const currentCount = await gov.getProposalsCount();
      proposalId = currentCount.eq('0') ? currentCount : currentCount.sub('1');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.PENDING
      );
      snapshots.set('pending', await evmSnapshot());
    });
    it('should not cancel when Threshold is higher than minimum and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        minter,
      } = testEnv;
      // giving threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // not guardian, no threshold
      await expect(gov.connect(user.signer).cancel(proposalId)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel a pending proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
        aave,
        minter,
      } = testEnv;
      // removing threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      // pending
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.PENDING
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
    it('should not cancel when proposition already canceled', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
        aave,
        minter,
      } = testEnv;
      // removing threshold power
      // cancelled
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      // pending
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.PENDING
      );
      await expect(gov.connect(user.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
      await expect(gov.connect(user.signer).cancel(proposalId)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      await expect(gov.connect(deployer.signer).cancel(proposalId)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should cancel pending prop by guardian, when creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        executor,
        aave,
        minter,
      } = testEnv;
      // giving threshold power to creator
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // cancel as guardian
      await expect(gov.connect(deployer.signer).cancel(proposalId))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposalId)
        .to.emit(executor, 'CancelledAction');
      expect(await gov.connect(user.signer).getProposalState(proposalId)).to.be.equal(
        proposalStates.CANCELED
      );
    });
  });
  describe('Testing setter functions', async function () {
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
  });
  describe('Testing create function', async function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('start') || '1');
      snapshots.set('start', await evmSnapshot());
      const {gov} = testEnv;
      let currentCount = await gov.getProposalsCount();
      proposalId = currentCount.eq('0') ? currentCount : currentCount.sub('1');
    });
    it('should not create a proposal when proposer has not enought power', async () => {
      const {
        gov,
        users: [user],
        minter,
        executor,
        aave,
        strategy,
      } = testEnv;
      const userBalance = await aave.connect(user.signer).balanceOf(user.address);
      // empty tokens
      await aave.connect(user.signer).transfer(minter.address, userBalance);
      // Give not enough AAVE for proposition tokens
      await aave
        .connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));

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
      await expect(gov.connect(user.signer).create(...params)).to.be.revertedWith(
        'PROPOSITION_CREATION_INVALID'
      );
    });
    it('should create proposal when enough power', async () => {
      const {
        gov,
        users: [user],
        minter,
        executor,
        aave,
        strategy,
      } = testEnv;

      // Count current proposal id
      const count = await gov.connect(user.signer).getProposalsCount();

      // give enough power
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower);

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
      expect(await gov.connect(user.signer).getProposalState(count)).to.be.equal(
        proposalStates.PENDING
      );
    });
    it('should not create a proposal without targets', async () => {
      const {
        gov,
        users: [user],
        minter,
        executor,
        aave,
        strategy,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower);

      // Count current proposal id
      const count = await gov.connect(user.signer).getProposalsCount();

      // Params with no target
      const params: [
        string,
        string[],
        BigNumberish[],
        string[],
        BytesLike[],
        boolean[],
        BytesLike
      ] = [executor.address, [], ['0'], [''], ['0x'], [false], ipfsBytes32Hash];

      // Create proposal
      await expect(gov.connect(user.signer).create(...params)).to.be.revertedWith(
        'INVALID_EMPTY_TARGETS'
      );
    });
    it('should not create a proposal with unauthorized executor', async () => {
      const {
        gov,
        users: [user],
        minter,
        executor,
        aave,
        strategy,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower);

      // Count current proposal id
      const count = await gov.connect(user.signer).getProposalsCount();

      // Params with not authorized user as executor
      const params: [
        string,
        string[],
        BigNumberish[],
        string[],
        BytesLike[],
        boolean[],
        BytesLike
      ] = [user.address, [ZERO_ADDRESS], ['0'], [''], ['0x'], [false], ipfsBytes32Hash];

      // Create proposal
      await expect(gov.connect(user.signer).create(...params)).to.be.revertedWith(
        'EXECUTOR_NOT_AUTHORIZED'
      );
    });
    it('should not create a proposal with less targets than calldata', async () => {
      const {
        gov,
        users: [user],
        minter,
        executor,
        aave,
        strategy,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower);

      // Count current proposal id
      const count = await gov.connect(user.signer).getProposalsCount();

      // Params with no target
      const params: [
        string,
        string[],
        BigNumberish[],
        string[],
        BytesLike[],
        boolean[],
        BytesLike
      ] = [executor.address, [], ['0'], [''], ['0x'], [false], ipfsBytes32Hash];

      // Create proposal
      await expect(gov.connect(user.signer).create(...params)).to.be.revertedWith(
        'INVALID_EMPTY_TARGETS'
      );
    });
    it('should not create a proposal with inconsistent data', async () => {
      const {
        gov,
        users: [user],
        minter,
        executor,
        aave,
        strategy,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower);

      // Count current proposal id
      const count = await gov.connect(user.signer).getProposalsCount();

      const params: (
        targetsLength: number,
        valuesLength: number,
        signaturesLength: number,
        calldataLength: number,
        withDelegatesLength: number
      ) => [string, string[], BigNumberish[], string[], BytesLike[], boolean[], BytesLike] = (
        targetsLength: number,
        valueLength: number,
        signaturesLength: number,
        calldataLength: number,
        withDelegatesLength: number
      ) => [
        executor.address,
        Array(targetsLength).fill(ZERO_ADDRESS),
        Array(valueLength).fill('0'),
        Array(signaturesLength).fill(''),
        Array(calldataLength).fill('0x'),
        Array(withDelegatesLength).fill(false),
        ipfsBytes32Hash,
      ];

      // Create proposal
      await expect(gov.connect(user.signer).create(...params(2, 1, 1, 1, 1))).to.be.revertedWith(
        'INCONSISTENT_PARAMS_LENGTH'
      );
      await expect(gov.connect(user.signer).create(...params(1, 2, 1, 1, 1))).to.be.revertedWith(
        'INCONSISTENT_PARAMS_LENGTH'
      );
      await expect(gov.connect(user.signer).create(...params(0, 1, 1, 1, 1))).to.be.revertedWith(
        'INVALID_EMPTY_TARGETS'
      );
      await expect(gov.connect(user.signer).create(...params(1, 1, 2, 1, 1))).to.be.revertedWith(
        'INCONSISTENT_PARAMS_LENGTH'
      );
      await expect(gov.connect(user.signer).create(...params(1, 1, 1, 2, 1))).to.be.revertedWith(
        'INCONSISTENT_PARAMS_LENGTH'
      );
      await expect(gov.connect(user.signer).create(...params(1, 1, 1, 1, 2))).to.be.revertedWith(
        'INCONSISTENT_PARAMS_LENGTH'
      );
    });
    it('should create a proposals with different data lengths', async () => {
      const {
        gov,
        users: [user],
        minter,
        executor,
        aave,
        strategy,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower);

      const params: (
        targetsLength: number,
        valuesLength: number,
        signaturesLength: number,
        calldataLength: number,
        withDelegatesLength: number
      ) => [string, string[], BigNumberish[], string[], BytesLike[], boolean[], BytesLike] = (
        targetsLength: number,
        valueLength: number,
        signaturesLength: number,
        calldataLength: number,
        withDelegatesLength: number
      ) => [
        executor.address,
        Array(targetsLength).fill(ZERO_ADDRESS),
        Array(valueLength).fill('0'),
        Array(signaturesLength).fill(''),
        Array(calldataLength).fill('0x'),
        Array(withDelegatesLength).fill(false),
        ipfsBytes32Hash,
      ];
      for (let i = 1; i < 12; i++) {
        const count = await gov.connect(user.signer).getProposalsCount();
        const tx = await gov.connect(user.signer).create(...params(i, i, i, i, i));
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
        ] = params(i, i, i, i, i);

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
      }
    });
  });
  describe('Testing executor auth/unautho functions', async function () {
    it('Unauthorize executor', async () => {
      const {gov, deployer, executor} = testEnv;

      // Unauthorize executor
      await gov.connect(deployer.signer).unauthorizeExecutors([executor.address]);
      const isAuthorized = await gov
        .connect(deployer.signer)
        .isExecutorAuthorized(executor.address);

      expect(isAuthorized).to.equal(false);
    });

    it('Authorize executor', async () => {
      const {
        gov,
        deployer, // is owner of gov
        executor,
      } = testEnv;

      // Authorize
      await gov.connect(deployer.signer).authorizeExecutors([executor.address]);
      const isAuthorized = await gov
        .connect(deployer.signer)
        .isExecutorAuthorized(executor.address);

      expect(isAuthorized).to.equal(true);
    });
  });
  describe('Testing guardian functions', async function () {
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
});
