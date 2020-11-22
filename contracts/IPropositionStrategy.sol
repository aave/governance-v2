// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

interface IPropositionStrategy {
  function getPropositionPowerAt(address user, uint256 blockNumber) external view returns (uint256);

  function getPropositionPowerNeeded() external view returns (uint256);
}
