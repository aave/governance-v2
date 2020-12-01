// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {IAaveGovernanceV2} from '../interfaces/IAaveGovernanceV2.sol';
import {IGovernanceStrategy} from '../interfaces/IGovernanceStrategy.sol';
import {IProposalValidator} from '../interfaces/IProposalValidator.sol';
import {SafeMath} from '../dependencies/open-zeppelin/SafeMath.sol';

contract ProposalValidatorMock is IProposalValidator {
  using SafeMath for uint256;

  uint256 public constant override PROPOSITION_THRESHOLD = 100; // 1%
  uint256 public constant override VOTING_DURATION = 5; // Blocks in 14 days
  uint256 public constant override VOTE_DIFFERENTIAL = 500; // 5%
  uint256 public constant override MINIMUM_QUORUM = 2000; // 20%
  uint256 public constant override ONE_HUNDRED_WITH_PRECISION = 10000;

  function validateCreatorOfProposal(
    IAaveGovernanceV2 governance,
    address user,
    uint256 blockNumber
  ) external view override returns (bool) {
    return isPropositionPowerEnough(governance, user, blockNumber);
  }

  function validateProposalCancellation(
    IAaveGovernanceV2 governance,
    address user,
    uint256 blockNumber
  ) external view override returns (bool) {
    return !isPropositionPowerEnough(governance, user, blockNumber);
  }

  function isPropositionPowerEnough(
    IAaveGovernanceV2 governance,
    address user,
    uint256 blockNumber
  ) public view override returns (bool) {
    IGovernanceStrategy currentGovernanceStrategy = IGovernanceStrategy(
      governance.getGovernanceStrategy()
    );
    return
      currentGovernanceStrategy.getPropositionPowerAt(user, blockNumber) >=
      getMinimumPropositionPowerNeeded(governance, blockNumber);
  }

  function getMinimumPropositionPowerNeeded(IAaveGovernanceV2 governance, uint256 blockNumber)
    public
    view
    override
    returns (uint256)
  {
    IGovernanceStrategy currentGovernanceStrategy = IGovernanceStrategy(
      governance.getGovernanceStrategy()
    );

    return
      currentGovernanceStrategy
        .getTotalPropositionSupplyAt(blockNumber)
        .mul(PROPOSITION_THRESHOLD)
        .div(ONE_HUNDRED_WITH_PRECISION);
  }

  function isProposalPassed(IAaveGovernanceV2 governance, uint256 proposalId)
    external
    view
    override
    returns (bool)
  {
    return (isQuorumValid(governance, proposalId) &&
      isVoteDifferentialValid(governance, proposalId));
  }

  function getMinimumVotingPowerNeeded(uint256 votingSupply)
    public
    pure
    override
    returns (uint256)
  {
    return votingSupply.mul(MINIMUM_QUORUM).div(ONE_HUNDRED_WITH_PRECISION);
  }

  function isQuorumValid(IAaveGovernanceV2 governance, uint256 proposalId)
    public
    view
    override
    returns (bool)
  {
    IAaveGovernanceV2.ProposalWithoutVotes memory proposal = governance.getProposalById(proposalId);
    uint256 votingSupply = IGovernanceStrategy(proposal.strategy).getTotalVotingSupplyAt(
      proposal.startBlock
    );

    return proposal.forVotes > getMinimumVotingPowerNeeded(votingSupply);
  }

  function isVoteDifferentialValid(IAaveGovernanceV2 governance, uint256 proposalId)
    public
    view
    override
    returns (bool)
  {
    IAaveGovernanceV2.ProposalWithoutVotes memory proposal = governance.getProposalById(proposalId);
    uint256 votingSupply = IGovernanceStrategy(proposal.strategy).getTotalVotingSupplyAt(
      proposal.startBlock
    );

    return (proposal.forVotes.mul(ONE_HUNDRED_WITH_PRECISION).div(votingSupply) >
      proposal.againstVotes.mul(ONE_HUNDRED_WITH_PRECISION).div(VOTE_DIFFERENTIAL));
  }
}
