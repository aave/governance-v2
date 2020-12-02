import {expect, use} from 'chai';
import {ipfsBytes32Hash, MAX_UINT_AMOUNT, ZERO_ADDRESS} from '../helpers/constants';
import {makeSuite, TestEnv} from './helpers/make-suite';
import {solidity} from 'ethereum-waffle';
import {BytesLike, formatEther, parseEther, splitSignature} from 'ethers/lib/utils';
import {BigNumberish, BigNumber, Wallet} from 'ethers';
import {waitForTx, advanceBlockTo, latestBlock, DRE, advanceBlock} from '../helpers/misc-utils';
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

makeSuite('Aave Governance V2 tests', (testEnv: TestEnv) => {
  let votingDelay: BigNumber;
  let votingDuration: BigNumber;
  let executionDelay: BigNumber;
  let currentVote: BigNumber;
  let minimumPower: BigNumber;
  let minimumCreatePower: BigNumber;
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
    minimumCreatePower = await executor.getMinimumPropositionPowerNeeded(
      gov.address,
      await DRE.ethers.provider.getBlockNumber()
    );
    // Add some funds to user1
    // await aave.connect(minter.signer).transfer(user1.address, minimumPower.add('1'));
    // await aave.connect(minter.signer).transfer(user2.address, minimumPower.div('2'));
  });

  beforeEach(async () => {
    const {gov} = testEnv;
    const currentCount = await gov.getProposalsCount();
    currentVote = currentCount.eq('0') ? currentCount : currentCount.sub('1');
  });
  describe('Testing create function', async function () {
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
      // Give not enough AAVE for proposition tokens
      await aave.connect(minter.signer)
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
      const userBalance = await aave.connect(user.signer).balanceOf(user.address);
      // emptying userbalance
      await aave.connect(user.signer).transfer(minter.address, userBalance);
      // Give enough AAVE for proposition tokens
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower);

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
      // await expect(gov.connect(user.signer).create(...params(1, 1, 1, 1, 2))).to.be.revertedWith(
      //   'INCONSISTENT_PARAMS_LENGTH'
      // );
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
  describe('Testing cancel function', async function () {
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
      const latestProposal = (await gov.connect(user.signer).getProposalsCount()).sub('1');
      await expect(gov.connect(user.signer).cancel(latestProposal)).to.be.revertedWith(
        'PROPOSITION_CANCELLATION_INVALID'
      );
    });
    it('should cancel when Threshold is below minimum threshold and not guardian', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        minter,
      } = testEnv;
      // removing threshold power
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance);
      await aave.connect(minter.signer)
        .transfer(user.address, minimumCreatePower.sub(BigNumber.from(1)));
      const latestProposal = (await gov.connect(user.signer).getProposalsCount()).sub('1');
      // pending
      expect(await gov.connect(user.signer).getProposalState(latestProposal)).to.be.equal(
        proposalStates.PENDING
      );
      expect(gov.connect(user.signer).cancel(latestProposal))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(latestProposal);
      expect(await gov.connect(user.signer).getProposalState(latestProposal)).to.be.equal(
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
      } = testEnv;
      // removing threshold power
      const latestProposal = (await gov.connect(user.signer).getProposalsCount()).sub('1');
      // cancelled
      expect(await gov.connect(user.signer).getProposalState(latestProposal)).to.be.equal(
        proposalStates.CANCELED
      );
      expect(gov.connect(user.signer).cancel(latestProposal)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
      // deployer is guardian
      expect(gov.connect(deployer.signer).cancel(latestProposal)).to.be.revertedWith(
        'ONLY_BEFORE_EXECUTED'
      );
    });
    it('should be canceled by guardian, even if creator still above threshold', async () => {
      const {
        gov,
        deployer, // deployer is guardian
        users: [user],
        aave,
        minter,
      } = testEnv;
      // giving threshold power to creator
      const balance = await aave.connect(user.signer).balanceOf(user.address);
      await aave.connect(user.signer).transfer(minter.address, balance); // emptying
      await aave.connect(minter.signer).transfer(user.address, minimumCreatePower); // filling
      // fetching a pending proposal
      const pendingProposal = (await gov.connect(user.signer).getProposalsCount()).sub('2');
      expect(await gov.connect(user.signer).getProposalState(pendingProposal)).to.be.equal(
        proposalStates.PENDING
      );
      await expect(gov.connect(deployer.signer).cancel(pendingProposal))
        .to.emit(gov, 'ProposalCanceled')
        .withArgs(pendingProposal);
      expect(await gov.connect(user.signer).getProposalState(pendingProposal)).to.be.equal(
        proposalStates.CANCELED
      );
    });
  });
  describe('Testing voting functions', async function () {
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
  });
  describe('Testing queue function', async function () {
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
  });
  describe('Testing execute function', async function () {
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
