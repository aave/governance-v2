import {task} from 'hardhat/config';
import {getAaveGovernanceV2} from '../../helpers/contracts-getters';
import {waitForTx} from '../../helpers/misc-utils';

task(`init:gov`, `Deploy governance for tests and development purposes`)
  .addParam('governance', '')
  .addParam('executor', '')
  .setAction(async ({governance, executor}, _DRE) => {
    _DRE.run('set-DRE');
    const gov = await getAaveGovernanceV2(governance);
    return await waitForTx(await gov.authorizeExecutors([executor]));
  });
