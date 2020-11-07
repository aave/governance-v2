import {tEthereumAddress, eContractid} from './types';
import {getFirstSigner} from './contracts-getters';
import {AaveGovernanceV2Factory} from '../types';
import {withSaveAndVerify} from './contracts-helpers';
import {AaveGovernanceV2} from '../types/AaveGovernanceV2';

export const deployAaveGovernanceV2 = async (
  args: [tEthereumAddress, string, string],
  verify?: boolean
): Promise<AaveGovernanceV2> =>
  withSaveAndVerify(
    await new AaveGovernanceV2Factory(await getFirstSigner()).deploy(...args),
    eContractid.AaveGovernanceV2,
    args,
    verify
  );
