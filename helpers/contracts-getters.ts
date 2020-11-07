import {AaveGovernanceV2Factory} from '../types';
import {DRE, getDb} from './misc-utils';
import {eContractid, tEthereumAddress} from './types';

export const getFirstSigner = async () => (await DRE.ethers.getSigners())[0];

export const getAaveGovernanceV2 = async (address?: tEthereumAddress) =>
  await AaveGovernanceV2Factory.connect(
    address ||
      (await getDb().get(`${eContractid.AaveGovernanceV2}.${DRE.network.name}`).value()).address,
    await getFirstSigner()
  );
