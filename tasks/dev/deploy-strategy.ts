import {task} from 'hardhat/config';
import {ZERO_ADDRESS} from '../../helpers/constants';
import {deployGovernanceStrategy} from '../../helpers/contracts-deployments';

task(`deploy:strategy`, `Deploy governance for tests and development purposes`)
  .addFlag('verify')
  .addParam('aave', '', ZERO_ADDRESS)
  .addParam('stkAave', '', ZERO_ADDRESS)
  .setAction(async ({aave, stkAave, verify}, _DRE) => {
    _DRE.run('set-DRE');
    return await deployGovernanceStrategy(aave, stkAave, verify);
  });
