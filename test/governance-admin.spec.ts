import {expect, use} from 'chai';
import {ZERO_ADDRESS} from '../helpers/constants';
import {makeSuite, TestEnv, deployGovernanceWithoutExecutorAsOwner} from './helpers/make-suite';
import {solidity} from 'ethereum-waffle';
import {deployGovernanceStrategy} from '../helpers/contracts-deployments';

use(solidity);

makeSuite(
  'Aave Governance V2 tests: admin functions',
  deployGovernanceWithoutExecutorAsOwner,
  (testEnv: TestEnv) => {
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
  }
);
