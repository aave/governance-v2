// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {IGovernanceStrategy} from './interfaces/IGovernanceStrategy.sol';
import {IERC20} from './interfaces/IERC20.sol';
import {IDelegationAwareToken} from './interfaces/IDelegationAwareToken.sol';
import {mul256, div256} from './Helpers.sol';

contract GovernanceStrategy is IGovernanceStrategy {
  address public immutable PROPOSITION_TOKEN;
  address public immutable VOTING_TOKEN;
  uint256 public immutable PROPOSITION_THRESHOLD; // With ONE_HUNDRED_WITH_PRECISION being 100%
  uint256 public constant ONE_HUNDRED_WITH_PRECISION = 10000;

  constructor(
    address propositionToken,
    address votingToken,
    uint256 propositionThreshold
  ) {
    PROPOSITION_TOKEN = propositionToken;
    VOTING_TOKEN = votingToken;
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

  function getPropositionPowerAt(address user, uint256 blockNumber)
    public
    view
    override
    returns (uint256)
  {
    return
      IDelegationAwareToken(PROPOSITION_TOKEN).getPowerAtBlock(
        user,
        blockNumber,
        IDelegationAwareToken.DelegationType.PROPOSITION_POWER
      );
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
    return IERC20(PROPOSITION_TOKEN).totalSupplyAt(blockNumber);
  }

  function getTotalVotingSupplyAt(uint256 blockNumber) public view override returns (uint256) {
    return getTotalPropositionSupplyAt(blockNumber);
  }

  function getVotingPowerAt(address user, uint256 blockNumber)
    public
    view
    override
    returns (uint256)
  {
    return
      IDelegationAwareToken(VOTING_TOKEN).getPowerAtBlock(
        user,
        blockNumber,
        IDelegationAwareToken.DelegationType.VOTING_POWER
      );
  }
}
