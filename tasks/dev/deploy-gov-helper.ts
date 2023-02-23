import {task} from 'hardhat/config';
import {ZERO_ADDRESS} from '../../helpers/constants';
import {deployGovernanceV2Helper} from '../../helpers/contracts-deployments';

task(`deploy:gov-helper`, `Deploy governance helper for tests and development purposes`)
  .addFlag('verify')
  .setAction(async ({verify}, _DRE) => {
    _DRE.run('set-DRE');
    return await deployGovernanceV2Helper(verify);
  });
