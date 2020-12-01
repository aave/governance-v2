// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {IAaveGovernanceV2} from '../interfaces/IAaveGovernanceV2.sol';
import {IGovernanceStrategy} from '../interfaces/IGovernanceStrategy.sol';
import {IProposalValidator} from '../interfaces/IProposalValidator.sol';
import {add256, sub256, mul256, div256} from '../misc/Helpers.sol';

/**
 * @title Proposal Validator Contract, inherited by  Aave Governance Executors
 * @dev Validates/Invalidations propositions state modifications.
 * Proposition Power functions: Validates proposition creations/ cancellation
 * Voting Power functions: Validates success of propositions.
 * @author Aave
 **/
contract ProposalValidator is IProposalValidator {
  uint256 public constant override PROPOSITION_THRESHOLD = 100; // 1%
  uint256 public constant override VOTING_DURATION = 86400; // Blocks in 14 days
  uint256 public constant override VOTE_DIFFERENTIAL = 500; // 5%
  uint256 public constant override MINIMUM_QUORUM = 2000; // 20%
  uint256 public constant override ONE_HUNDRED_WITH_PRECISION = 10000;

  /**
   * @dev Called to validate a proposal (e.g when creating new proposal in Governance)
   * @param governance Governance Contract
   * @param user Address of the proposal creator
   * @param blockNumber Block Number against which to make the test (e.g proposal creation block -1).
   * @return boolean, true if can be created
   **/
  function validateCreatorOfProposal(
    IAaveGovernanceV2 governance,
    address user,
    uint256 blockNumber
  ) external view override returns (bool) {
    return isPropositionPowerEnough(governance, user, blockNumber);
  }

  /**
   * @dev Called to validate the cancellation of a proposal
   * Needs to creator to have lost proposition power threashold
   * @param governance Governance Contract
   * @param user Address of the proposal creator
   * @param blockNumber Block Number against which to make the test (e.g proposal creation block -1).
   * @return boolean, true if can be cancelled
   **/
  function validateProposalCancellation(
    IAaveGovernanceV2 governance,
    address user,
    uint256 blockNumber
  ) external view override returns (bool) {
    return !isPropositionPowerEnough(governance, user, blockNumber);
  }

  /**
   * @dev Returns whether a user has enough Proposition Power to make a proposal.
   * @param governance Governance Contract
   * @param user Address of the user to be challenged.
   * @param blockNumber Block Number against which to make the challenge.
   * @return true if user has enough power
   **/
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
  
  /**
   * @dev Returns the minimum Proposition Power needed to create a proposition.
   * @param governance Governance Contract
   * @param blockNumber Blocknumber at which to evaluate
   * @return minimum Proposition Power needed
   **/
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
      div256(
        mul256(
          currentGovernanceStrategy.getTotalPropositionSupplyAt(blockNumber),
          PROPOSITION_THRESHOLD
        ),
        ONE_HUNDRED_WITH_PRECISION
      );
  }

  /**
   * @dev Returns whether a proposal passed or not
   * @param governance Governance Contract
   * @param proposalId Id of the proposal to set
   * @return true if proposal passed
   **/
  function isProposalPassed(IAaveGovernanceV2 governance, uint256 proposalId)
    external
    view
    override
    returns (bool)
  {
    return (isQuorumValid(governance, proposalId) &&
      isVoteDifferentialValid(governance, proposalId));
  }

  /**
   * @dev Calculates the minimum amount of Voting Power needed for a proposal to Pass
   * @param votingSupply Total number of oustanding voting tokens
   * @return voting power needed for a proposal to pass
   **/
  function getMinimumVotingPowerNeeded(uint256 votingSupply)
    public
    pure
    override
    returns (uint256)
  {
    return div256(mul256(votingSupply, MINIMUM_QUORUM), ONE_HUNDRED_WITH_PRECISION);
  }

  /**
   * @dev Check whether a proposal has reached quorum, ie has enough FOR-voting-power
   * Here quorum is not to understand as number of votes reached, but number of for-votes reached
   * @param governance Governance Contract
   * @param proposalId Id of the proposal to verify
   * @return voting power needed for a proposal to pass
   **/
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

  /**
   * @dev Check whether a proposal has enough extra FOR-votes than AGAINST-votes
   * FOR VOTES - AGAINST VOTES > VOTE_DIFFERENTIAL * voting supply
   * @param governance Governance Contract
   * @param proposalId Id of the proposal to verify
   * @return true if enough For-Votes
   **/
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

    return (div256(mul256(proposal.forVotes, ONE_HUNDRED_WITH_PRECISION), votingSupply) >
      add256(
        div256(mul256(proposal.againstVotes, ONE_HUNDRED_WITH_PRECISION), votingSupply),
        VOTE_DIFFERENTIAL
      ));
  }
}
