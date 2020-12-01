import {task} from 'hardhat/config';
import {getFirstSigner} from '../../helpers/contracts-getters';

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

    // Deploy strategy
    const strategy = await _DRE.run('deploy:strategy', {
      aave: token.address,
      stkAave: token.address,
    });

    // Deploy governance v2
    const governance = await _DRE.run('deploy:gov', {
      strategy: strategy.address,
      guardian: admin,
      verify,
    });

    // Deploy executor
    const delay = '60'; // 60 seconds
    const executor = await _DRE.run('deploy:executor-mock', {
      admin: governance.address,
      delay,
      verify,
    });

    // authorize executor
    await _DRE.run('init:gov', {governance: governance.address, executor: executor.address});

    if (!silent) {
      console.log('- Contracts deployed for development');
    }
  });
