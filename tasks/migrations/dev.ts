import {task} from 'hardhat/config';
import {getFirstSigner} from '../../helpers/contracts-getters';

task(`migrate:dev`, `Deploy governance for tests and development purposes`)
  .addFlag('verify')
  .addFlag('silent')
  .setAction(async ({verify, silent}, _DRE) => {
    await _DRE.run('set-DRE');
    const adminSigner = await getFirstSigner();
    const admin = await adminSigner.getAddress();

    // Deploy mocked AAVE v2
    const token = await _DRE.run('deploy:mocked-aave', {
      minter: admin,
      verify,
    });

    // Deploy strategy
    const propositionThreshold = '10';
    const strategy = await _DRE.run('deploy:strategy', {
      propositionToken: token.address,
      votingToken: token.address,
      propositionThreshold,
    });

    // Deploy governance v2
    const governance = await _DRE.run('deploy:gov', {
      strategy: strategy.address,
      guardian: admin,
      verify,
    });

    // Deploy executor
    const delay = '86400'; // minimum 1 day
    const executor = await _DRE.run('deploy:executor', {admin, delay, verify});

    // Whitelist executor
    await _DRE.run('init:gov', {governance: governance.address, executor: executor.address});

    if (!silent) {
      console.log('- Contracts deployed for development');
    }
  });
