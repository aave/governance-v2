import {task} from 'hardhat/config';
import {ZERO_ADDRESS} from '../../helpers/constants';
import {deployExecutor} from '../../helpers/contracts-deployments';

task(`deploy:executor`, `Deploy governance for tests and development purposes`)
  .addFlag('verify')
  .addParam('admin', '', ZERO_ADDRESS)
  .addParam('delay', '', '10')
  .addParam('gracePeriod')
  .addParam('minimumDelay')
  .addParam('maximumDelay')
  .addParam('propositionThreshold', '', '2000')
  .addParam('voteDuration')
  .addParam('voteDifferential')
  .addParam('minimumQuorum')
  .setAction(
    async (
      {
        admin,
        delay,
        gracePeriod,
        minimumDelay,
        maximumDelay,
        propositionThreshold,
        voteDuration,
        voteDifferential,
        minimumQuorum,
        verify,
      },
      _DRE
    ) => {
      _DRE.run('set-DRE');
      return await deployExecutor(
        admin,
        delay,
        gracePeriod,
        minimumDelay,
        maximumDelay,
        propositionThreshold,
        voteDuration,
        voteDifferential,
        minimumQuorum,
        verify
      );
    }
  );
