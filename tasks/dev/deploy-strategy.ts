import {task} from 'hardhat/config';
import {ZERO_ADDRESS} from '../../helpers/constants';
import {deployGovernanceStrategy} from '../../helpers/contracts-deployments';

task(`deploy:strategy`, `Deploy governance for tests and development purposes`)
  .addFlag('verify')
  .addParam('propositionToken', '', ZERO_ADDRESS)
  .addParam('votingToken', '', ZERO_ADDRESS)
  .addParam('propositionThreshold', '', '10')
  .setAction(async ({propositionThreshold, propositionToken, votingToken, verify}, _DRE) => {
    _DRE.run('set-DRE');
    return await deployGovernanceStrategy(
      propositionToken,
      votingToken,
      propositionThreshold,
      verify
    );
  });
