import {task} from 'hardhat/config';
import {ZERO_ADDRESS} from '../../helpers/constants';
import {deployExecutorMock} from '../../helpers/contracts-deployments';

task(`deploy:executor-mock`, `Deploy governance for tests and development purposes`)
  .addFlag('verify')
  .addParam('admin', '', ZERO_ADDRESS)
  .addParam('delay', '', '10')
  .setAction(async ({admin, delay, verify}, _DRE) => {
    _DRE.run('set-DRE');
    return await deployExecutorMock(admin, delay, verify);
  });
