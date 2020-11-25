// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {IGovernanceStrategy} from './interfaces/IGovernanceStrategy.sol';
import {IERC20} from './interfaces/IERC20.sol';
import {IDelegationAwareToken} from './interfaces/IDelegationAwareToken.sol';
import {mul256, div256} from './Helpers.sol';

contract GovernanceStrategy is IGovernanceStrategy {
  uint256 public immutable PROPOSITION_THRESHOLD; // With ONE_HUNDRED_WITH_PRECISION being 100%
  uint256 public constant ONE_HUNDRED_WITH_PRECISION = 10000;
  
  address[] private _propositionTokens;
  address[] private _votingTokens;

  constructor(
    address[] memory propositionTokens,
    address[] memory votingTokens,
    uint256 propositionThreshold
  ) {
    _propositionTokens = propositionTokens;
    _votingTokens = votingTokens;
    PROPOSITION_THRESHOLD = propositionThreshold;
  }

  function validateCreatorOfProposal(address user, uint256 blockNumber) external view override {
    require(isPropositionPowerEnough(user, blockNumber), 'NOT_ENOUGH_PROPOSITION_POWER');
  }

  function isPropositionPowerEnough(address user, uint256 blockNumber)
    public
    view
    override
    returns (bool)
  {
    return
      getPropositionPowerAt(user, blockNumber) >= getMinimumPropositionPowerNeeded(blockNumber);
  }

  function getMinimumPropositionPowerNeeded(uint256 blockNumber)
    public
    view
    override
    returns (uint256)
  {
    return
      div256(
        mul256(getTotalPropositionSupplyAt(blockNumber), PROPOSITION_THRESHOLD),
        ONE_HUNDRED_WITH_PRECISION
      );
  }

  function getTotalPropositionSupplyAt(uint256 blockNumber) public view override returns (uint256) {
    uint256 aggregatedPropositionSupply;
    uint256 tokensLength = _propositionTokens.length;
    for (uint256 i = 0; i < tokensLength; i++) {
      aggregatedPropositionSupply += IERC20(_propositionTokens[i]).totalSupplyAt(blockNumber);
    }

    return aggregatedPropositionSupply;
  }

  function getTotalVotingSupplyAt(uint256 blockNumber) public view override returns (uint256) {
    return getTotalPropositionSupplyAt(blockNumber);
  }

  function getPropositionPowerAt(address user, uint256 blockNumber)
    public
    view
    override
    returns (uint256)
  {
    uint256 aggregatedUserPropositionPower;
    uint256 tokensLength = _propositionTokens.length;
    for (uint256 i = 0; i < tokensLength; i++) {
      aggregatedUserPropositionPower += IDelegationAwareToken(_propositionTokens[i])
        .getPowerAtBlock(user, blockNumber, IDelegationAwareToken.DelegationType.PROPOSITION_POWER);
    }

    return aggregatedUserPropositionPower;
  }

  function getVotingPowerAt(address user, uint256 blockNumber)
    public
    view
    override
    returns (uint256)
  {
    uint256 aggregatedUserVotingPower;
    uint256 tokensLength = _votingTokens.length;
    for (uint256 i = 0; i < tokensLength; i++) {
      aggregatedUserVotingPower += IDelegationAwareToken(_votingTokens[i]).getPowerAtBlock(
        user,
        blockNumber,
        IDelegationAwareToken.DelegationType.VOTING_POWER
      );
    }

    return aggregatedUserVotingPower;
  }
}
