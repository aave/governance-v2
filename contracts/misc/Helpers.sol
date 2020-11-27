// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

function add256(uint256 a, uint256 b) pure returns (uint256) {
  uint256 c = a + b;
  require(c >= a, 'addition overflow');
  return c;
}

function sub256(uint256 a, uint256 b) pure returns (uint256) {
  require(b <= a, 'subtraction underflow');
  return a - b;
}

// TODO review
function mul256(uint256 a, uint256 b) pure returns (uint256) {
  if (a == 0) {
    return 0;
  }

  uint256 c = a * b;
  require(c / a == b, 'SafeMath: multiplication overflow');

  return c;
}

// TODO review
function div256(uint256 a, uint256 b) pure returns (uint256) {
  require(b > 0, 'SafeMath: division by zero');
  uint256 c = a / b;

  return c;
}

function getChainId() pure returns (uint256) {
  uint256 chainId;
  assembly {
    chainId := chainid()
  }
  return chainId;
}

function isContract(address account) view returns (bool) {
  // According to EIP-1052, 0x0 is the value returned for not-yet created accounts
  // and 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470 is returned
  // for accounts without code, i.e. `keccak256('')`
  bytes32 codehash;
  bytes32 accountHash = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470;
  // solhint-disable-next-line no-inline-assembly
  assembly {
    codehash := extcodehash(account)
  }
  return (codehash != accountHash && codehash != 0x0);
}
