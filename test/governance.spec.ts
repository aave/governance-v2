import {expect, use} from 'chai';
import {ipfsBytes32Hash, MAX_UINT_AMOUNT, ZERO_ADDRESS} from '../helpers/constants';
import {makeSuite, TestEnv, deployGovernance} from './helpers/make-suite';
import {solidity} from 'ethereum-waffle';
import {BytesLike} from 'ethers/lib/utils';
import {BigNumberish, BigNumber, Signer} from 'ethers';
import {
  evmRevert,
  evmSnapshot,
  waitForTx,
  advanceBlockTo,
  DRE,
  advanceBlock,
  latestBlock,
  increaseTime,
} from '../helpers/misc-utils';
import {
  emptyBalances,
  getInitContractData,
  setBalance,
  expectProposalState,
  encodeSetDelay,
  impersonateAccountsHardhat,
} from './helpers/gov-utils';
import {deployFlashAttacks, deployGovernanceStrategy} from '../helpers/contracts-deployments';
import {buildPermitParams, getSignatureFromTypedData} from './helpers/permit';
import {fail} from 'assert';
import {FlashAttacks} from '../types/FlashAttacks';
import {ExecutorFactory} from '../types';

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

makeSuite('Aave Governance V2 tests', deployGovernance, (testEnv: TestEnv) => {
  let votingDelay: BigNumber;
  let votingDuration: BigNumber;
  let executionDelay: BigNumber;
  let minimumPower: BigNumber;
  let minimumCreatePower: BigNumber;
  let proposal1Id: BigNumber;
  let proposal2Id: BigNumber;
  let proposal3Id: BigNumber;
  let proposal4Id: BigNumber;
  let startBlock: BigNumber;
  let endBlock: BigNumber;
  let executionTime: BigNumber;
  let gracePeriod: BigNumber;
  let flashAttacks: FlashAttacks;
  let executorSigner: Signer;
  let govSigner: Signer;

  // Snapshoting main states as entry for later testing
  // Then will test by last snap shot first.
  before(async () => {
    const {gov, executor, strategy, aave, users, minter} = testEnv;
    const [user1, user2, user3, user4, user5, user6] = users;

    ({
      votingDelay,
      votingDuration,
      executionDelay,
      minimumPower,
      minimumCreatePower,
      gracePeriod,
    } = await getInitContractData(testEnv));
    // Impersonate executor
    await impersonateAccountsHardhat([executor.address, gov.address]);
    executorSigner = await DRE.ethers.provider.getSigner(executor.address);
    govSigner = await DRE.ethers.provider.getSigner(gov.address);
    // Deploy flash attacks contract and approve from minter address
    flashAttacks = await deployFlashAttacks(aave.address, minter.address, gov.address);
    await aave.connect(minter.signer).approve(flashAttacks.address, MAX_UINT_AMOUNT);

    // Cleaning users balances
    await emptyBalances(users, testEnv);

    // SNAPSHOT: EMPTY GOVERNANCE
    snapshots.set('start', await evmSnapshot());

    // Giving user 1 enough power to propose
    await setBalance(user1, minimumPower, testEnv);

    const callData = await encodeSetDelay('400', testEnv);

    //Creating first proposal: Changing delay to 300 via no sig + calldata
    const tx1 = await waitForTx(
      await gov
        .connect(user1.signer)
        .create(executor.address, [gov.address], ['0'], [''], [callData], [false], ipfsBytes32Hash)
    );
    //Creating 2nd proposal: Changing delay to 300 via sig + argument data
    const encodedArgument2 = DRE.ethers.utils.defaultAbiCoder.encode(['uint'], [300]);
    const tx2 = await waitForTx(
      await gov
        .connect(user1.signer)
        .create(
          executor.address,
          [gov.address],
          ['0'],
          ['setVotingDelay(uint256)'],
          [encodedArgument2],
          [false],
          ipfsBytes32Hash
        )
    );

    const encodedArgument3 = DRE.ethers.utils.defaultAbiCoder.encode(['address'], [user1.address]);
    const tx3 = await waitForTx(
      await gov
        .connect(user1.signer)
        .create(
          executor.address,
          [executor.address],
          ['0'],
          ['setPendingAdmin(address)'],
          [encodedArgument3],
          [false],
          ipfsBytes32Hash
        )
    );
    // cleaning up user1 balance
    await emptyBalances([user1], testEnv);

    // fixing constants
    proposal1Id = tx1.events?.[0].args?.id;
    proposal2Id = tx2.events?.[0].args?.id;
    proposal3Id = tx3.events?.[0].args?.id;
    startBlock = BigNumber.from(tx2.blockNumber).add(votingDelay);
    endBlock = BigNumber.from(tx2.blockNumber).add(votingDelay).add(votingDuration);
    await expectProposalState(proposal2Id, proposalStates.PENDING, testEnv);

    // SNAPSHOT: PENDING PROPOSAL
    snapshots.set('pending', await evmSnapshot());

    // Preparing users with different powers for test
    // user 1: 50% min voting power + 2 = 10%+ total power
    await setBalance(user1, minimumPower.div('2').add('2'), testEnv);
    // user 2: 50% min voting power + 2 = 10%+ total power
    await setBalance(user2, minimumPower.div('2').add('2'), testEnv);
    // user 3: 2 % min voting power, will be used to swing the vote
    await setBalance(user3, minimumPower.mul('2').div('100').add('10'), testEnv);
    // user 4: 75% min voting power + 10 : = 15%+ total power, can barely make fail differential
    await setBalance(user4, minimumPower.mul('75').div('100').add('10'), testEnv);
    // user 5: 50% min voting power + 2 = 10%+ total power.
    await setBalance(user5, minimumPower.div('2').add('2'), testEnv);
    let block = await DRE.ethers.provider.getBlockNumber();
    expect(await strategy.getVotingPowerAt(user5.address, block)).to.be.equal(
      minimumPower.div('2').add('2')
    );
    // user 5 delegates to user 2 => user 2 reached quorum
    await waitForTx(await aave.connect(user5.signer).delegate(user2.address));
    block = await DRE.ethers.provider.getBlockNumber();
    // checking delegation worked
    expect(await strategy.getVotingPowerAt(user5.address, block)).to.be.equal('0');
    expect(await strategy.getVotingPowerAt(user2.address, block)).to.be.equal(
      minimumPower.div('2').add('2').mul(2)
    );
    await expectProposalState(proposal3Id, proposalStates.PENDING, testEnv);
    await expectProposalState(proposal2Id, proposalStates.PENDING, testEnv);
    await expectProposalState(proposal1Id, proposalStates.PENDING, testEnv);
    const balanceAfter = await aave.connect(user1.signer).balanceOf(user1.address);
    // Pending => Active
    // => go tto start block
    await advanceBlockTo(Number(startBlock.add(2).toString()));
    await expectProposalState(proposal3Id, proposalStates.ACTIVE, testEnv);
    await expectProposalState(proposal2Id, proposalStates.ACTIVE, testEnv);
    await expectProposalState(proposal1Id, proposalStates.ACTIVE, testEnv);

    // SNAPSHOT: ACTIVE PROPOSAL
    snapshots.set('active', await evmSnapshot());

    // Active => Succeeded, user 2 votes + delegated from 5 > threshold
    await expect(gov.connect(user2.signer).submitVote(proposal2Id, true))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(proposal2Id, user2.address, true, balanceAfter.mul('2'));
    await expect(gov.connect(user2.signer).submitVote(proposal1Id, true))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(proposal1Id, user2.address, true, balanceAfter.mul('2'));
    await expect(gov.connect(user2.signer).submitVote(proposal3Id, true))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(proposal3Id, user2.address, true, balanceAfter.mul('2'));
    // go to end of voting period
    await advanceBlockTo(Number(endBlock.add('3').toString()));
    await expectProposalState(proposal3Id, proposalStates.SUCCEEDED, testEnv);
    await expectProposalState(proposal2Id, proposalStates.SUCCEEDED, testEnv);
    await expectProposalState(proposal1Id, proposalStates.SUCCEEDED, testEnv);

    // SNAPSHOT: SUCCEEDED PROPOSAL
    snapshots.set('succeeded', await evmSnapshot());

    // Succeeded => Queued:
    await (await gov.connect(user1.signer).queue(proposal1Id)).wait();
    await (await gov.connect(user1.signer).queue(proposal2Id)).wait();
    await (await gov.connect(user1.signer).queue(proposal3Id)).wait();
    await expectProposalState(proposal1Id, proposalStates.QUEUED, testEnv);
    await expectProposalState(proposal2Id, proposalStates.QUEUED, testEnv);
    await expectProposalState(proposal3Id, proposalStates.QUEUED, testEnv);
    // SNAPSHOT: QUEUED PROPOSAL
    executionTime = (await gov.getProposalById(proposal2Id)).executionTime;
    snapshots.set('queued', await evmSnapshot());
  });
  describe('Testing cancel function on queued proposal on gov + exec', function () {
    beforeEach(async () => {
      // Revert to queued state
      await evmRevert(snapshots.get('queued') || '1');
      await expectProposalState(proposal2Id, proposalStates.QUEUED, testEnv);
      // EVM Snapshots are consumed, need to snapshot again for next test
      snapshots.set('queued', await evmSnapshot());
    });
    it('should not cancel when Threshold is higher than minimum and not guardian', async () => {
      const {
        gov,
        users: [user],
        minter,
      } = testEnv;
      // giving threshold power
      await setBalance(user, minimumCreatePower, testEnv);
      // not guardian, no threshold
      await expect(gov.connect(user.signer).cancel(proposal2Id)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel a queued proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        executor,
        users: [user],
      } = testEnv;
      // removing threshold power
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);
      // active
      await expectProposalState(proposal2Id, proposalStates.QUEUED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');

      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
    it('should not cancel when proposition already canceled', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
      } = testEnv;
      // removing threshold power
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);
      await expectProposalState(proposal2Id, proposalStates.QUEUED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      await expect(gov.connect(deployer.signer).cancel(proposal2Id)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should cancel queued prop by guardian, when creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
      } = testEnv;
      // creator still above threshold power
      await setBalance(user, minimumCreatePower, testEnv);
      // cancel as guardian
      await expect(gov.connect(deployer.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
  });
  describe('Testing execute function', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('queued') || '1');
      await expectProposalState(proposal2Id, proposalStates.QUEUED, testEnv);
      snapshots.set('queued', await evmSnapshot());
    });
    it('should not execute a canceled prop', async () => {
      const {
        gov,
        deployer,
        executor,
        users: [user],
      } = testEnv;
      await expect(gov.connect(deployer.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
      await advanceBlock(Number(executionTime.toString()));

      // Execute the propoal
      const executeTx = gov.connect(user.signer).execute(proposal2Id);

      await expect(Promise.resolve(executeTx)).to.be.revertedWith('ONLY_QUEUED_PROPOSALS');
    });
    it('should not execute a queued prop before timelock', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;

      await expectProposalState(proposal2Id, proposalStates.QUEUED, testEnv);
      // 5 sec before delay reached
      await advanceBlock(Number(executionTime.sub(5).toString()));

      // Execute the propoal
      const executeTx = gov.connect(user.signer).execute(proposal2Id);

      await expect(Promise.resolve(executeTx)).to.be.revertedWith('TIMELOCK_NOT_FINISHED');
    });
    it('should not execute a queued prop after grace period (expired)', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;

      await expectProposalState(proposal2Id, proposalStates.QUEUED, testEnv);
      // 5 sec before delay reached
      await advanceBlock(Number(executionTime.add(gracePeriod).add(5).toString()));

      // Execute the propoal
      const executeTx = gov.connect(user.signer).execute(proposal2Id);

      await expect(Promise.resolve(executeTx)).to.be.revertedWith('ONLY_QUEUED_PROPOSALS');
      await expectProposalState(proposal2Id, proposalStates.EXPIRED, testEnv);
    });
    it('should execute one proposal with no sig + calldata', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      await advanceBlock(Number(executionTime.add(gracePeriod).sub(5).toString()));

      expect(await gov.getVotingDelay()).to.be.equal(votingDelay);
      // Execute the proposal: changing the delay to 300
      const executeTx = gov.connect(user.signer).execute(proposal2Id);

      await expect(Promise.resolve(executeTx))
        .to.emit(gov, 'ProposalExecuted')
        .withArgs(proposal2Id, user.address);
      expect(await gov.getVotingDelay()).to.be.equal(BigNumber.from('300'));
      const proposalState = await gov.getProposalState(proposal2Id);
      expect(proposalState).to.equal(proposalStates.EXECUTED);
    });
    it('should execute one proposal with sig + argument', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      await advanceBlock(Number(executionTime.add(gracePeriod).sub(5).toString()));

      expect(await gov.getVotingDelay()).to.be.equal(votingDelay);

      // execute the second proposal: changing delay to 400
      const executeTx1 = gov.connect(user.signer).execute(proposal1Id);

      await expect(Promise.resolve(executeTx1))
        .to.emit(gov, 'ProposalExecuted')
        .withArgs(proposal1Id, user.address);
      expect(await gov.getVotingDelay()).to.be.equal(BigNumber.from('400'));
    });
    it('should change admin via proposal', async () => {
      const {
        gov,
        executor,
        users: [user],
      } = testEnv;
      await advanceBlock(Number(executionTime.add(gracePeriod).sub(5).toString()));

      expect(await executor.getPendingAdmin()).to.be.equal(ZERO_ADDRESS);

      // execute the second proposal: changing delay to 400
      const executeTx3 = gov.connect(user.signer).execute(proposal3Id);

      await expect(Promise.resolve(executeTx3))
        .to.emit(gov, 'ProposalExecuted')
        .withArgs(proposal3Id, user.address);
      expect(await executor.getPendingAdmin()).to.be.equal(user.address);
      expect(await executor.getAdmin()).to.be.equal(gov.address);

      await (await executor.connect(user.signer).acceptAdmin()).wait();
      expect(await executor.getAdmin()).to.be.equal(user.address);
    });
  });
  describe('Testing cancel function on succeeded proposal', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('succeeded') || '1');
      await expectProposalState(proposal2Id, proposalStates.SUCCEEDED, testEnv);
      snapshots.set('succeeded', await evmSnapshot());
    });
    it('should not cancel when Threshold is higher than minimum and not guardian', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      // giving threshold power
      await setBalance(user, minimumCreatePower, testEnv);
      // not guardian, no threshold
      await expect(gov.connect(user.signer).cancel(proposal2Id)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel a succeeded proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        users: [user],
        executor,
      } = testEnv;
      // removing threshold power
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);
      // active
      await expectProposalState(proposal2Id, proposalStates.SUCCEEDED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
    it('should not cancel when proposition already canceled', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
      } = testEnv;
      // removing threshold power
      // cancelled
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);
      // active
      await expectProposalState(proposal2Id, proposalStates.SUCCEEDED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      await expect(gov.connect(deployer.signer).cancel(proposal2Id)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should cancel succeeded prop by guardian, when creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        executor,
      } = testEnv;
      // giving threshold power to creator
      await setBalance(user, minimumCreatePower, testEnv);
      // cancel as guardian
      await expect(gov.connect(deployer.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
    it('should cancel an succeeded proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        executor,
        users: [user],
      } = testEnv;
      // removing threshold power
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);

      // active
      await expectProposalState(proposal2Id, proposalStates.SUCCEEDED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
  });
  describe('Testing queue function', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('succeeded') || '1');
      await expectProposalState(proposal2Id, proposalStates.SUCCEEDED, testEnv);
      snapshots.set('succeeded', await evmSnapshot());
    });
    it('Queue a proposal', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      // Queue
      const queueTx = await gov.connect(user.signer).queue(proposal2Id);
      const queueTxResponse = await waitForTx(queueTx);
      const blockTime = await DRE.ethers.provider.getBlock(queueTxResponse.blockNumber);

      const executionTime = blockTime.timestamp + Number(executionDelay.toString());

      await expect(Promise.resolve(queueTx))
        .to.emit(gov, 'ProposalQueued')
        .withArgs(proposal2Id, executionTime, user.address);
      await expectProposalState(proposal2Id, proposalStates.QUEUED, testEnv);
    });
  });
  describe('Testing queue  revert', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('active') || '1');
      await expectProposalState(proposal2Id, proposalStates.ACTIVE, testEnv);
      snapshots.set('active', await evmSnapshot());
    });
    it('Queue an ACTIVE proposal should revert', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      await expect(gov.connect(user.signer).queue(proposal2Id)).to.be.revertedWith(
        'INVALID_STATE_FOR_QUEUE'
      );
    });
  });
  describe('Testing getProposalState revert', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('active') || '1');
      await expectProposalState(proposal2Id, proposalStates.ACTIVE, testEnv);
      snapshots.set('active', await evmSnapshot());
    });
    it('Try to queue an non existing proposal should revert with INVALID_PROPOSAL_ID', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      await expect(gov.connect(user.signer).queue('100')).to.be.revertedWith('INVALID_PROPOSAL_ID');
    });
  });
  describe('Testing voting functions', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('active') || '1');
      await expectProposalState(proposal2Id, proposalStates.ACTIVE, testEnv);
      snapshots.set('active', await evmSnapshot());
    });
    it('Vote a proposal without quorum => proposal failed', async () => {
      // User 1 has 50% min power, should fail
      const {
        gov,
        executor,
        users: [user1],
        aave,
      } = testEnv;

      // user 1 has only half of enough voting power
      const balance = await aave.connect(user1.signer).balanceOf(user1.address);
      await expect(gov.connect(user1.signer).submitVote(proposal2Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user1.address, true, balance);

      await advanceBlockTo(Number(endBlock.add('9').toString()));
      expect(await executor.isQuorumValid(gov.address, proposal2Id)).to.be.equal(false);
      expect(await executor.isVoteDifferentialValid(gov.address, proposal2Id)).to.be.equal(true);
      expect(await gov.connect(user1.signer).getProposalState(proposal2Id)).to.be.equal(
        proposalStates.FAILED
      );
    });
    it('Vote a proposal with quorum => proposal succeeded', async () => {
      // Vote
      const {
        gov,
        executor,
        strategy,
        users: [user1, user2],
        aave,
      } = testEnv;
      // User 1 + User 2 power > voting po<wer, see before() function
      const balance1 = await aave.connect(user1.signer).balanceOf(user1.address);
      await expect(gov.connect(user1.signer).submitVote(proposal2Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user1.address, true, balance1);
      //  user 2 has received delegation from user 5
      const power2 = await strategy.getVotingPowerAt(user2.address, startBlock);
      await expect(gov.connect(user2.signer).submitVote(proposal2Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user2.address, true, power2);

      // active => succeeded

      await advanceBlockTo(Number(endBlock.add('10').toString()));
      expect(await executor.isQuorumValid(gov.address, proposal2Id)).to.be.equal(true);
      expect(await executor.isVoteDifferentialValid(gov.address, proposal2Id)).to.be.equal(true);
      expect(await gov.connect(user1.signer).getProposalState(proposal2Id)).to.be.equal(
        proposalStates.SUCCEEDED
      );
    });
    it('Vote a proposal with quorum via delegation => proposal succeeded', async () => {
      // Vote
      const {
        gov,
        strategy,
        executor,
        users: [user1, user2, , , user5],
        aave,
      } = testEnv;
      // user 5 has delegated to user 2
      const balance2 = await aave.connect(user1.signer).balanceOf(user2.address);
      const balance5 = await aave.connect(user2.signer).balanceOf(user5.address);
      expect(await strategy.getVotingPowerAt(user2.address, startBlock)).to.be.equal(
        balance2.add(balance5)
      );
      await expect(gov.connect(user2.signer).submitVote(proposal2Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user2.address, true, balance2.add(balance5));
      // active => succeeded
      await advanceBlockTo(Number(endBlock.add('11').toString()));
      expect(await executor.isQuorumValid(gov.address, proposal2Id)).to.be.equal(true);
      expect(await executor.isVoteDifferentialValid(gov.address, proposal2Id)).to.be.equal(true);
      expect(await gov.connect(user1.signer).getProposalState(proposal2Id)).to.be.equal(
        proposalStates.SUCCEEDED
      );
    });
    it('Vote a proposal with quorum but not vote dif => proposal failed', async () => {
      // Vote
      const {
        gov,
        strategy,
        users: [user1, user2, user3, user4],
        minter,
        executor,
        aave,
      } = testEnv;
      // User 2 + User 5 delegation = 20% power, voting yes
      //  user 2 has received delegation from user 5
      const power2 = await strategy.getVotingPowerAt(user2.address, startBlock);
      await expect(gov.connect(user2.signer).submitVote(proposal2Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user2.address, true, power2);

      // User 4 = 15% Power, voting no
      const balance4 = await aave.connect(user4.signer).balanceOf(user4.address);
      await expect(gov.connect(user4.signer).submitVote(proposal2Id, false))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user4.address, false, balance4);

      await advanceBlockTo(Number(endBlock.add('12').toString()));
      expect(await executor.isQuorumValid(gov.address, proposal2Id)).to.be.equal(true);
      expect(await executor.isVoteDifferentialValid(gov.address, proposal2Id)).to.be.equal(false);
      expect(await gov.connect(user1.signer).getProposalState(proposal2Id)).to.be.equal(
        proposalStates.FAILED
      );
    });
    it('Vote a proposal with quorum and vote dif => proposal succeeded', async () => {
      // Vote
      const {
        gov,
        strategy,
        users: [user1, user2, user3, user4],
        minter,
        executor,
        aave,
      } = testEnv;
      // User 2 + User 5 delegation = 20% power, voting yes
      //  user 2 has received delegation from user 5
      const power2 = await strategy.getVotingPowerAt(user2.address, startBlock);
      await expect(gov.connect(user2.signer).submitVote(proposal2Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user2.address, true, power2);

      // User 4 = 15% Power, voting no
      const balance4 = await aave.connect(user4.signer).balanceOf(user4.address);
      await expect(gov.connect(user4.signer).submitVote(proposal2Id, false))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user4.address, false, balance4);

      // User 3 makes the vote swing
      const balance3 = await aave.connect(user3.signer).balanceOf(user3.address);
      await expect(gov.connect(user3.signer).submitVote(proposal2Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user3.address, true, balance3);

      await advanceBlockTo(Number(endBlock.add('13').toString()));
      expect(await executor.isQuorumValid(gov.address, proposal2Id)).to.be.equal(true);
      expect(await executor.isVoteDifferentialValid(gov.address, proposal2Id)).to.be.equal(true);
      expect(await gov.connect(user1.signer).getProposalState(proposal2Id)).to.be.equal(
        proposalStates.SUCCEEDED
      );
    });

    it('Vote a proposal by permit', async () => {
      const {
        users: [, , user3],
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
      const msgParams = buildPermitParams(chainId, gov.address, proposal2Id.toString(), true);
      const ownerPrivateKey = require('../test-wallets.js').accounts[4].secretKey; // deployer, minter, user1, user2, user3

      const {v, r, s} = getSignatureFromTypedData(ownerPrivateKey, msgParams);

      const balance = await aave.connect(minter.signer).balanceOf(user3.address);

      // Publish vote by signature using other address as relayer
      const votePermitTx = await gov
        .connect(user3.signer)
        .submitVoteBySignature(proposal2Id, true, v, r, s);

      await expect(Promise.resolve(votePermitTx))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user3.address, true, balance);

      const {votingPower} = await gov.getVoteOnProposal(proposal2Id, user3.address);
      expect(votingPower).to.be.eq(balance);
    });
    it('Revert permit vote if invalid signature', async () => {
      const {
        users: [, , user3],
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
      const msgParams = buildPermitParams(chainId, gov.address, proposal2Id.toString(), true);
      const ownerPrivateKey = require('../test-wallets.js').accounts[4].secretKey; // deployer, minter, user1, user2, user3

      const {r, s} = getSignatureFromTypedData(ownerPrivateKey, msgParams);

      // Publish vote by signature using other address as relayer
      expect(
        gov.connect(user3.signer).submitVoteBySignature(proposal2Id, true, '17', r, s)
      ).to.revertedWith('INVALID_SIGNATURE');
    });
    it('Should not allow Flash vote: the voting power should be zero', async () => {
      const {
        gov,
        users: [, , , , , user6],
      } = testEnv;

      // Check ProposalCreated event
      const support = true;

      // Vote
      await expect(flashAttacks.connect(user6.signer).flashVote(minimumPower, proposal2Id, support))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, flashAttacks.address, support, '0');
    });
    it('Prevent to vote twice', async () => {
      // Vote
      const {
        gov,
        strategy,
        users: [user2],
      } = testEnv;
      // User 2 + User 5 delegation = 20% power, voting yes
      //  user 2 has received delegation from user 5
      const power2 = await strategy.getVotingPowerAt(user2.address, startBlock);
      await expect(gov.connect(user2.signer).submitVote(proposal2Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal2Id, user2.address, true, power2);
      await expect(gov.connect(user2.signer).submitVote(proposal2Id, true)).to.be.revertedWith(
        'VOTE_ALREADY_SUBMITTED'
      );
    });
    it('Vote should revert if proposal is closed', async () => {
      // Vote
      const {
        gov,
        users: [user2],
      } = testEnv;

      await advanceBlockTo((await latestBlock()) + 20);
      await expect(gov.connect(user2.signer).submitVote(proposal2Id, true)).to.be.revertedWith(
        'VOTING_CLOSED'
      );
    });
  });
  describe('Testing cancel function on active proposal', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('active') || '1');
      await expectProposalState(proposal2Id, proposalStates.ACTIVE, testEnv);
      snapshots.set('active', await evmSnapshot());
    });
    it('should not cancel when Threshold is higher than minimum and not guardian', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      // giving threshold power
      await setBalance(user, minimumCreatePower, testEnv);
      // not guardian, no threshold
      await expect(gov.connect(user.signer).cancel(proposal2Id)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel a active proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        users: [user],
        executor,
      } = testEnv;
      // removing threshold power
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);
      // active
      await expectProposalState(proposal2Id, proposalStates.ACTIVE, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
    it('should not cancel when proposition already canceled', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        executor,
      } = testEnv;
      // removing threshold power
      // cancelled
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);
      // active
      await expectProposalState(proposal2Id, proposalStates.ACTIVE, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      await expect(gov.connect(deployer.signer).cancel(proposal2Id)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should cancel active prop by guardian, when creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        executor,
      } = testEnv;
      // giving threshold power to creator
      await setBalance(user, minimumCreatePower, testEnv);
      // cancel as guardian
      await expect(gov.connect(deployer.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
    it('should cancel an active proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        users: [user],
        executor,
      } = testEnv;
      // removing threshold power
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);

      // active
      await expectProposalState(proposal2Id, proposalStates.ACTIVE, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
  });
  describe('Testing cancel function pending proposal', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('pending') || '1');
      await expectProposalState(proposal2Id, proposalStates.PENDING, testEnv);
      snapshots.set('pending', await evmSnapshot());
    });
    it('should not cancel when Threshold is higher than minimum and not guardian', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      // giving threshold power
      await setBalance(user, minimumCreatePower, testEnv);
      // not guardian, no threshold
      await expect(gov.connect(user.signer).cancel(proposal2Id)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel a pending proposal when threshold lost and not guardian', async () => {
      const {
        gov,
        executor,
        users: [user],
      } = testEnv;
      // removing threshold power
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);
      // pending
      await expectProposalState(proposal2Id, proposalStates.PENDING, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
    it('should not cancel when proposition already canceled', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        executor,
        users: [user],
      } = testEnv;
      // removing threshold power
      // cancelled
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);
      // pending
      await expectProposalState(proposal2Id, proposalStates.PENDING, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
      await expect(gov.connect(user.signer).cancel(proposal2Id)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      await expect(gov.connect(deployer.signer).cancel(proposal2Id)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should cancel pending prop by guardian, when creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        executor,
      } = testEnv;
      // giving threshold power to creator
      await setBalance(user, minimumCreatePower, testEnv);
      // cancel as guardian
      await expect(gov.connect(deployer.signer).cancel(proposal2Id))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(proposal2Id)
        .to.emit(executor, 'CancelledAction');
      await expectProposalState(proposal2Id, proposalStates.CANCELED, testEnv);
    });
  });
  describe('Testing create function', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('start') || '1');
      snapshots.set('start', await evmSnapshot());
      const {gov} = testEnv;
      let currentCount = await gov.getProposalsCount();
      proposal2Id = currentCount.eq('0') ? currentCount : currentCount.sub('1');
    });
    it('should not create a proposal when proposer has not enought power', async () => {
      const {
        gov,
        users: [user],
        executor,
      } = testEnv;
      // Give not enough AAVE for proposition tokens
      await setBalance(user, minimumCreatePower.sub('1'), testEnv);

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
        executor,
        strategy,
      } = testEnv;

      // Count current proposal id
      const count = await gov.connect(user.signer).getProposalsCount();

      // give enough power
      await setBalance(user, minimumCreatePower, testEnv);

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
      await expectProposalState(count, proposalStates.PENDING, testEnv);
    });
    it('should create proposal when enough power via delegation', async () => {
      const {
        gov,
        users: [user, user2],
        executor,
        aave,
        strategy,
      } = testEnv;

      // Count current proposal id
      const count = await gov.connect(user.signer).getProposalsCount();

      // give enough power
      await setBalance(user, minimumCreatePower.div('2').add('1'), testEnv);
      await setBalance(user2, minimumCreatePower.div('2').add('1'), testEnv);
      await waitForTx(await aave.connect(user2.signer).delegate(user.address));

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
      await expectProposalState(count, proposalStates.PENDING, testEnv);
    });
    it('should not create a proposal without targets', async () => {
      const {
        gov,
        users: [user],
        executor,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await setBalance(user, minimumCreatePower, testEnv);

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
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await setBalance(user, minimumCreatePower, testEnv);

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
        executor,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await setBalance(user, minimumCreatePower, testEnv);

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
        executor,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await setBalance(user, minimumCreatePower, testEnv);

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
        executor,
        strategy,
      } = testEnv;
      // Give enought AAVE for proposition tokens
      await setBalance(user, minimumCreatePower, testEnv);

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
  describe('Testing create function', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('start') || '1');
      snapshots.set('start', await evmSnapshot());
    });
    it('Should not allow Flash proposal', async () => {
      const {
        users: [, , , , , user6],
        executor,
      } = testEnv;

      // Params for proposal
      const params: [
        BigNumberish,
        string,
        string[],
        BigNumberish[],
        string[],
        BytesLike[],
        boolean[],
        BytesLike
      ] = [
        minimumCreatePower,
        executor.address,
        [ZERO_ADDRESS],
        ['0'],
        [''],
        ['0x'],
        [false],
        ipfsBytes32Hash,
      ];

      // Try to create proposal
      await expect(flashAttacks.connect(user6.signer).flashProposal(...params)).to.be.revertedWith(
        'PROPOSITION_CREATION_INVALID'
      );
    });
  });
  describe('Testing setter functions', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('start') || '1');
      snapshots.set('start', await evmSnapshot());
    });

    it('Set governance strategy', async () => {
      const {gov, aave, stkAave} = testEnv;

      const strategy = await deployGovernanceStrategy(aave.address, stkAave.address);
      // impersonate executor

      // Set new strategy
      await gov.connect(executorSigner).setGovernanceStrategy(strategy.address);
      const govStrategy = await gov.getGovernanceStrategy();

      expect(govStrategy).to.equal(strategy.address);
    });

    it('Set voting delay', async () => {
      const {gov, deployer} = testEnv;

      // Set voting delay
      await gov.connect(executorSigner).setVotingDelay('10');
      const govVotingDelay = await gov.getVotingDelay();

      expect(govVotingDelay).to.equal('10');
    });
  });
  describe('Testing executor auth/unautho functions', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('start') || '1');
      snapshots.set('start', await evmSnapshot());
    });

    it('Unauthorize executor', async () => {
      const {gov, executor} = testEnv;

      // Unauthorize executor
      await gov.connect(executorSigner).unauthorizeExecutors([executor.address]);
      const isAuthorized = await gov.connect(executorSigner).isExecutorAuthorized(executor.address);

      expect(isAuthorized).to.equal(false);
    });

    it('Authorize executor', async () => {
      const {gov, executor} = testEnv;

      // Authorize
      await gov.connect(executorSigner).authorizeExecutors([executor.address]);
      const isAuthorized = await gov.connect(executorSigner).isExecutorAuthorized(executor.address);

      expect(isAuthorized).to.equal(true);
    });
    it('Revert setDelay due is not executor', async () => {
      const {executor} = testEnv;

      await expect(executor.setDelay(await executor.MINIMUM_DELAY())).to.be.revertedWith(
        'ONLY_BY_THIS_TIMELOCK'
      );
    });
    it('Revert setDelay due is out of minimum delay', async () => {
      const {executor} = testEnv;

      await expect(executor.connect(executorSigner).setDelay('0')).to.be.revertedWith(
        'DELAY_SHORTER_THAN_MINIMUM'
      );
    });
    it('Revert setDelay due is out of max delay', async () => {
      const {executor} = testEnv;

      await expect(
        executor.connect(executorSigner).setDelay(await (await executor.MAXIMUM_DELAY()).add('1'))
      ).to.be.revertedWith('DELAY_LONGER_THAN_MAXIMUM');
    });
    it('setDelay should pass delay', async () => {
      const {executor} = testEnv;

      await expect(executor.connect(executorSigner).setDelay(await executor.getDelay())).to.emit(
        executor,
        'NewDelay'
      );
    });
    it('Revert queueTransaction due caller is not admin', async () => {
      const {executor} = testEnv;

      await expect(
        executor.connect(executorSigner).queueTransaction(ZERO_ADDRESS, '0', '', [], '0', false)
      ).to.be.revertedWith('ONLY_BY_ADMIN');
    });

    it('Revert queueTransaction due executionTime is less than delay', async () => {
      const {executor} = testEnv;

      await expect(
        executor.connect(govSigner).queueTransaction(ZERO_ADDRESS, '0', '', [], '0', false)
      ).to.be.revertedWith('EXECUTION_TIME_UNDERESTIMATED');
    });
    it('Revert executeTransaction due action does not exist', async () => {
      const {executor} = testEnv;

      await expect(
        executor.connect(govSigner).executeTransaction(ZERO_ADDRESS, '0', '', [], '0', false)
      ).to.be.revertedWith('ACTION_NOT_QUEUED');
    });

    it('Revert acceptAdmin due caller is not a pending admin', async () => {
      const {executor} = testEnv;

      await expect(executor.connect(executorSigner).acceptAdmin()).to.be.revertedWith(
        'ONLY_BY_PENDING_ADMIN'
      );
    });
    it('Revert constructor due delay is shorted than minimum', async () => {
      const {deployer} = testEnv;
      await expect(
        new ExecutorFactory(deployer.signer).deploy(
          ZERO_ADDRESS,
          '1',
          '0',
          '2',
          '3',
          '0',
          '0',
          '0',
          '0'
        )
      ).to.be.revertedWith('DELAY_SHORTER_THAN_MINIMUM');
    });
    it('Revert constructor due delay is longer than maximum', async () => {
      const {deployer} = testEnv;
      await expect(
        new ExecutorFactory(deployer.signer).deploy(
          ZERO_ADDRESS,
          '1',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0'
        )
      ).to.be.revertedWith('DELAY_LONGER_THAN_MAXIMUM');
    });
  });
  describe('Testing guardian functions', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('start') || '1');
      snapshots.set('start', await evmSnapshot());
    });
    it('Revert abdication due not guardian', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;

      await expect(gov.connect(user.signer).__abdicate()).to.be.revertedWith('ONLY_BY_GUARDIAN');
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
  describe('Testing queue duplicate actions', function () {
    beforeEach(async () => {
      await evmRevert(snapshots.get('start') || '1');
      snapshots.set('start', await evmSnapshot());

      const {gov, executor, aave, users} = testEnv;
      const [user1, user2] = users;
      const encodedArgument3 = DRE.ethers.utils.defaultAbiCoder.encode(
        ['address'],
        [user1.address]
      );
      await setBalance(user1, minimumCreatePower, testEnv);
      await setBalance(user2, minimumPower, testEnv);

      await advanceBlock();

      const tx4 = await waitForTx(
        await gov
          .connect(user1.signer)
          .create(
            executor.address,
            [executor.address, executor.address],
            ['0', '0'],
            ['setPendingAdmin(address)', 'setPendingAdmin(address)'],
            [encodedArgument3, encodedArgument3],
            [false, false],
            ipfsBytes32Hash
          )
      );
      proposal4Id = tx4.events?.[0].args?.id;

      await expectProposalState(proposal4Id, proposalStates.PENDING, testEnv);

      const txStartBlock = BigNumber.from(tx4.blockNumber).add(votingDelay);
      const txEndBlock = BigNumber.from(tx4.blockNumber).add(votingDelay).add(votingDuration);

      await advanceBlockTo(Number(txStartBlock.add(2).toString()));
      await expectProposalState(proposal4Id, proposalStates.ACTIVE, testEnv);

      await expect(gov.connect(user2.signer).submitVote(proposal4Id, true))
        .to.emit(gov, 'VoteEmitted')
        .withArgs(proposal4Id, user2.address, true, minimumPower);
      // go to end of voting period
      await advanceBlockTo(Number(txEndBlock.add('3').toString()));
      await expectProposalState(proposal4Id, proposalStates.SUCCEEDED, testEnv);
    });

    it('Should not queue a proposal action twice', async () => {
      const {
        gov,
        users: [user],
      } = testEnv;
      // Queue
      await expect(gov.connect(user.signer).queue(proposal4Id)).to.revertedWith(
        'DUPLICATED_ACTION'
      );
      await expectProposalState(proposal4Id, proposalStates.SUCCEEDED, testEnv);
    });
  });
});
