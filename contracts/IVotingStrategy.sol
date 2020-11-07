// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

interface IVotingStrategy {
  function getVotingPower(address user, uint256 blockNumber) external view returns (uint256);
}
