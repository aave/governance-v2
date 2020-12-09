import {expect, use} from 'chai';
import {ipfsBytes32Hash, MAX_UINT_AMOUNT, ZERO_ADDRESS} from '../helpers/constants';
import {makeSuite, TestEnv, deployGovernanceNoDelay} from './helpers/make-suite';
import {solidity} from 'ethereum-waffle';
import {BytesLike, parseEther} from 'ethers/lib/utils';
import {BigNumberish, BigNumber} from 'ethers';
import {advanceBlockTo, DRE, latestBlock, waitForTx} from '../helpers/misc-utils';
import {FlashAttacks} from '../types/FlashAttacks';
import {deployFlashAttacks} from '../helpers/contracts-deployments';

use(solidity);

makeSuite('Aave Governance V2 attack test cases', deployGovernanceNoDelay, (testEnv: TestEnv) => {
  let votingDelay: BigNumber;
  let votingDuration: BigNumber;
  let executionDelay: BigNumber;
  let currentVote: BigNumber;
  let minimumPower: BigNumber;
  let minimumCreatePower: BigNumber;
  let flashAttacks: FlashAttacks;

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
    await aave.connect(minter.signer).transfer(user1.address, minimumPower.add('1'));
    await aave.connect(minter.signer).transfer(user2.address, minimumPower.div('2'));

    // Deploy flash attacks contract and approve from minter address
    flashAttacks = await deployFlashAttacks(aave.address, minter.address, gov.address);
    await aave.connect(minter.signer).approve(flashAttacks.address, MAX_UINT_AMOUNT);
  });

  beforeEach(async () => {
    const {gov} = testEnv;
    const currentCount = await gov.getProposalsCount();
    currentVote = currentCount.eq('0') ? currentCount : currentCount.sub('1');
  });

  it('Should not allow Flash proposal', async () => {
    const {
      users: [user],
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
    await expect(flashAttacks.connect(user.signer).flashProposal(...params)).to.be.revertedWith(
      'PROPOSITION_CREATION_INVALID'
    );
  });

  it('Should not allow Flash vote: the voting power should be zero', async () => {
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
    const support = true;
    await advanceBlockTo(Number(startBlock.toString()));

    // Vote
    await expect(flashAttacks.connect(user.signer).flashVote(minimumPower, proposalId, support))
      .to.emit(gov, 'VoteEmitted')
      .withArgs(proposalId, flashAttacks.address, support, '0');
  });
});
