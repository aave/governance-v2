import {BigNumber} from 'ethers';
import {task} from 'hardhat/config';
import {getFirstSigner} from '../../helpers/contracts-getters';
import {DRE} from '../../helpers/misc-utils';

const ONE_DAY = BigNumber.from('60').mul('60').mul('24');

task(`migrate:dev`, `Deploy governance for tests and development purposes`)
  .addFlag('verify')
  .addFlag('silent')
  .addParam('votingDelay', '', '15')
  .addParam('executorAsOwner', '', 'true') // had issue with other types than string
  .setAction(async ({votingDelay, executorAsOwner, verify, silent}, _DRE) => {
    await _DRE.run('set-DRE');
    const [adminSigner, tokenMinterSigner] = await _DRE.ethers.getSigners();
    const admin = await adminSigner.getAddress();
    const tokenMinter = await tokenMinterSigner.getAddress();
    // Deploy mocked AAVE v2
    const token = await DRE.run('deploy:mocked-aave', {
      minter: tokenMinter,
      verify,
    });

    // Deploy mocked AAVE v2
    const stkToken = await DRE.run('deploy:mocked-stk-aave', {
      minter: tokenMinter,
      verify,
    });

    // Deploy strategy
    const strategy = await DRE.run('deploy:strategy', {
      aave: token.address,
      stkAave: stkToken.address,
    });

    // Deploy governance v2
    const governance = await DRE.run('deploy:gov', {
      strategy: strategy.address,
      guardian: admin,
      votingDelay,
      verify,
    });

    // Deploy executor
    const delay = '60'; // 60 secs
    const gracePeriod = ONE_DAY.mul('14').toString();
    const minimumDelay = '1';
    const maximumDelay = ONE_DAY.mul('30').toString();
    const propositionThreshold = '100'; //  1% proposition
    const voteDuration = '6'; // 5 blocks, to prevent to hang local EVM in testing
    const voteDifferential = '500'; // 5%
    const minimumQuorum = '2000'; // 20%

    const executor = await DRE.run('deploy:executor', {
      admin: governance.address,
      delay,
      gracePeriod,
      minimumDelay,
      maximumDelay,
      propositionThreshold,
      voteDuration,
      voteDifferential,
      minimumQuorum,
      verify,
    });

    // authorize executor
    await DRE.run('init:gov', {
      executorAsOwner,
      governance: governance.address,
      executor: executor.address,
    });

    if (!silent) {
      console.log('- Contracts deployed for development');
    }
  });
