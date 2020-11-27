import {tEthereumAddress} from '../../helpers/types';
import {fromRpcSig, ECDSASignature} from 'ethereumjs-util';
import {signTypedData_v4} from 'eth-sig-util';

export const buildPermitParams = (
  chainId: number,
  governance: tEthereumAddress,
  id: string,
  support: boolean
) => ({
  types: {
    EIP712Domain: [
      {name: 'name', type: 'string'},
      {name: 'chainId', type: 'uint256'},
      {name: 'verifyingContract', type: 'address'},
    ],
    VoteEmitted: [
      {name: 'id', type: 'uint256'},
      {name: 'support', type: 'bool'},
    ],
  },
  primaryType: 'VoteEmitted' as const,
  domain: {
    name: 'Aave Governance v2',
    version: '1',
    chainId: chainId,
    verifyingContract: governance,
  },
  message: {
    id,
    support,
  },
});

// Test case for ecrevocer bug
export const buildFakePermitParams = (
  chainId: number,
  governance: tEthereumAddress,
  id: string,
  support: boolean
) => ({
  types: {
    EIP712Domain: [
      {name: 'name', type: 'string'},
      {name: 'chainId', type: 'uint256'},
      {name: 'verifyingContract', type: 'address'},
      {name: 'version', type: 'uint256'}, // Missing EIP712Domain parameter at gov
    ],
    VoteEmitted: [
      {name: 'id', type: 'uint256'},
      {name: 'support', type: 'bool'},
    ],
  },
  primaryType: 'VoteEmitted' as const,
  domain: {
    name: 'Aave Governance v2',
    version: '1',
    chainId: chainId,
    verifyingContract: governance,
  },
  message: {
    id,
    support,
  },
});

export const getSignatureFromTypedData = (
  privateKey: string,
  typedData: any // TODO: should be TypedData, from eth-sig-utils, but TS doesn't accept it
): ECDSASignature => {
  const signature = signTypedData_v4(Buffer.from(privateKey.substring(2, 66), 'hex'), {
    data: typedData,
  });
  return fromRpcSig(signature);
};
