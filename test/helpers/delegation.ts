import {tEthereumAddress} from '../../helpers/types';

export const buildDelegateByTypeParams = (
  chainId: number,
  tokenAddress: tEthereumAddress,
  tokenName: string,
  delegatee: tEthereumAddress,
  type: string,
  nonce: string,
  expiry: string
) => ({
  types: {
    EIP712Domain: [
      {name: 'name', type: 'string'},
      {name: 'version', type: 'string'},
      {name: 'chainId', type: 'uint256'},
      {name: 'verifyingContract', type: 'address'},
    ],
    DelegateByType: [
      {name: 'delegatee', type: 'address'},
      {name: 'type', type: 'uint256'},
      {name: 'nonce', type: 'uint256'},
      {name: 'expiry', type: 'uint256'},
    ],
  },
  primaryType: 'DelegateByType' as const,
  domain: {
    name: tokenName,
    version: '1',
    chainId: chainId,
    verifyingContract: tokenAddress,
  },
  message: {
    delegatee,
    type,
    nonce,
    expiry,
  },
});

export const buildDelegateParams = (
  chainId: number,
  tokenAddress: tEthereumAddress,
  tokenName: string,
  delegatee: tEthereumAddress,
  nonce: string,
  expiry: string
) => ({
  types: {
    EIP712Domain: [
      {name: 'name', type: 'string'},
      {name: 'version', type: 'string'},
      {name: 'chainId', type: 'uint256'},
      {name: 'verifyingContract', type: 'address'},
    ],
    Delegate: [
      {name: 'delegatee', type: 'address'},
      {name: 'nonce', type: 'uint256'},
      {name: 'expiry', type: 'uint256'},
    ],
  },
  primaryType: 'Delegate' as const,
  domain: {
    name: tokenName,
    version: '1',
    chainId: chainId,
    verifyingContract: tokenAddress,
  },
  message: {
    delegatee,
    nonce,
    expiry,
  },
});
