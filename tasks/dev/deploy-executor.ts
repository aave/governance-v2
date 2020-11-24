import {task} from 'hardhat/config';
import {ZERO_ADDRESS} from '../../helpers/constants';
import {deployExecutor} from '../../helpers/contracts-deployments';

task(`deploy:executor`, `Deploy governance for tests and development purposes`)
  .addFlag('verify')
  .addParam('admin', '', ZERO_ADDRESS)
  .addParam('delay', '', '10')
  .setAction(async ({admin, delay, verify}, _DRE) => {
    _DRE.run('set-DRE');
    return await deployExecutor(admin, delay, verify);
  });
