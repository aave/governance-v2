// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {IAaveGovernanceV2} from '../interfaces/IAaveGovernanceV2.sol';
import {IGovernanceStrategy} from '../interfaces/IGovernanceStrategy.sol';
import {IVoteValidator} from '../interfaces/IVoteValidator.sol';
import {add256, sub256, mul256, div256} from '../misc/Helpers.sol';

contract VoteValidatorMock is IVoteValidator {
  uint256 public constant override VOTING_DURATION = 5; //
  uint256 public constant override VOTE_DIFFERENTIAL = 500; // 5%
  uint256 public constant override MINIMUM_QUORUM = 2000; //  20%
  uint256 public constant override ONE_HUNDRED_WITH_PRECISION = 10000;

  function isProposalPassed(IAaveGovernanceV2 governance, uint256 proposalId)
    external
    override
    view
    returns (bool)
  {
    return (isQuorumValid(governance, proposalId) &&
      isVoteDifferentialValid(governance, proposalId));
  }

  function getMinimumVotingPowerNeeded(uint256 votingSupply)
    public
    override
    pure
    returns (uint256)
  {
    return div256(mul256(votingSupply, MINIMUM_QUORUM), ONE_HUNDRED_WITH_PRECISION);
  }

  function isQuorumValid(IAaveGovernanceV2 governance, uint256 proposalId)
    public
    override
    view
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
    override
    view
    returns (bool)
  {
    IAaveGovernanceV2.ProposalWithoutVotes memory proposal = governance.getProposalById(proposalId);
    uint256 votingSupply = IGovernanceStrategy(proposal.strategy).getTotalVotingSupplyAt(
      proposal.startBlock
    );

    return (div256(mul256(proposal.forVotes, ONE_HUNDRED_WITH_PRECISION), votingSupply) >
      add256(
        div256(mul256(proposal.againstVotes, ONE_HUNDRED_WITH_PRECISION), votingSupply),
        VOTE_DIFFERENTIAL
      ));
  }
}
