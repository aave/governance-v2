// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {IAaveGovernanceV2} from './IAaveGovernanceV2.sol';

interface IProposalValidator {
  function validateCreatorOfProposal(
    IAaveGovernanceV2 governance,
    address user,
    uint256 blockNumber
  ) external view;

  function isPropositionPowerEnough(
    IAaveGovernanceV2 governance,
    address user,
    uint256 blockNumber
  ) external view returns (bool);

  function getMinimumPropositionPowerNeeded(IAaveGovernanceV2 governance, uint256 blockNumber)
    external
    view
    returns (uint256);

  function isProposalPassed(IAaveGovernanceV2 governance, uint256 proposalId)
    external
    view
    returns (bool);

  function isQuorumValid(IAaveGovernanceV2 governance, uint256 proposalId)
    external
    view
    returns (bool);

  function isVoteDifferentialValid(IAaveGovernanceV2 governance, uint256 proposalId)
    external
    view
    returns (bool);

  function getMinimumVotingPowerNeeded(uint256 votingSupply) external view returns (uint256);

  function PROPOSITION_THRESHOLD() external view returns (uint256);

  function VOTING_DURATION() external view returns (uint256);

  function VOTE_DIFFERENTIAL() external view returns (uint256);

  function MINIMUM_QUORUM() external view returns (uint256);

  function ONE_HUNDRED_WITH_PRECISION() external view returns (uint256);
}
