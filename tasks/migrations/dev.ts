import {BigNumber} from 'ethers';
import {task} from 'hardhat/config';
import {getFirstSigner} from '../../helpers/contracts-getters';

const ONE_DAY = BigNumber.from('60').mul('60').mul('24');

task(`migrate:dev`, `Deploy governance for tests and development purposes`)
  .addFlag('verify')
  .addFlag('silent')
  .setAction(async ({verify, silent}, _DRE) => {
    await _DRE.run('set-DRE');
    const [adminSigner, tokenMinterSigner] = await _DRE.ethers.getSigners();
    const admin = await adminSigner.getAddress();
    const tokenMinter = await tokenMinterSigner.getAddress();
    // Deploy mocked AAVE v2
    const token = await _DRE.run('deploy:mocked-aave', {
      minter: tokenMinter,
      verify,
    });

    // Deploy mocked AAVE v2
    const stkToken = await _DRE.run('deploy:mocked-stk-aave', {
      minter: tokenMinter,
      verify,
    });

    // Deploy strategy
    const strategy = await _DRE.run('deploy:strategy', {
      aave: token.address,
      stkAave: stkToken.address,
    });

    // Deploy governance v2
    const governance = await _DRE.run('deploy:gov', {
      strategy: strategy.address,
      guardian: admin,
      verify,
    });

    // Deploy executor
    const delay = '60'; // 60 seconds
    const gracePeriod = ONE_DAY.mul('14').toString();
    const minimumDelay = '0';
    const maximumDelay = ONE_DAY.mul('30').toString();
    const propositionThreshold = '100';
    const voteDuration = '5'; // 5 blocks, to prevent to hang local EVM in testing
    const voteDifferential = '500';
    const minimumQuorum = '2000';

    const executor = await _DRE.run('deploy:executor', {
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
    await _DRE.run('init:gov', {governance: governance.address, executor: executor.address});

    if (!silent) {
      console.log('- Contracts deployed for development');
    }
  });
