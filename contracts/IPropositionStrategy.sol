// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

interface IPropositionStrategy {
  function validateCreatorOfProposal(address user, uint256 blockNumber) external view;

  function isPropositionPowerEnough(address user, uint256 blockNumber) external view returns (bool);

  function getPropositionPowerAt(address user, uint256 blockNumber) external view returns (uint256);

  function getMinimumPropositionPowerNeeded(uint256 blockNumber) external view returns (uint256);

  function getTotalPropositionSupplyAt(uint256 blockNumber) external view returns (uint256);
}
