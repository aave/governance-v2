// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import {IExecutorWithTimelock} from './IExecutorWithTimelock.sol';

interface IAaveGovernanceV2 {
  enum ProposalState {Pending, Canceled, Active, Failed, Succeeded, Queued, Expired, Executed}

  struct Vote {
    bool support;
    uint248 votingPower;
  }

  struct Proposal {
    uint256 id;
    address creator;
    IExecutorWithTimelock executor;
    address[] targets;
    uint256[] values;
    string[] signatures;
    bytes[] calldatas;
    bool[] withDelegatecalls;
    uint256 startBlock;
    uint256 endBlock;
    uint256 executionTime;
    uint256 forVotes;
    uint256 againstVotes;
    bool executed;
    bool canceled;
    address strategy;
    bytes32 ipfsHash;
    mapping(address => Vote) votes;
  }

  struct ProposalWithoutVotes {
    uint256 id;
    address creator;
    IExecutorWithTimelock executor;
    address[] targets;
    uint256[] values;
    string[] signatures;
    bytes[] calldatas;
    bool[] withDelegatecalls;
    uint256 startBlock;
    uint256 endBlock;
    uint256 executionTime;
    uint256 forVotes;
    uint256 againstVotes;
    bool executed;
    bool canceled;
    address strategy;
    bytes32 ipfsHash;
  }

  event ProposalCreated(
    uint256 id,
    address indexed creator,
    IExecutorWithTimelock indexed executor,
    address[] targets,
    uint256[] values,
    string[] signatures,
    bytes[] calldatas,
    bool[] withDelegatecalls,
    uint256 startBlock,
    uint256 endBlock,
    address strategy,
    bytes32 ipfsHash
  );

  event ProposalCanceled(uint256 id);

  event ProposalQueued(uint256 id, uint256 executionTime, address indexed initiatorQueueing);

  event ProposalExecuted(uint256 id, address indexed initiatorExecution);

  event VoteEmitted(uint256 id, address indexed voter, bool support, uint256 votingPower);

  event GovernanceStrategyChanged(address indexed newStrategy, address indexed initiatorChange);

  event VotingDelayChanged(uint256 newVotingDelay, address indexed initiatorChange);

  function create(
    IExecutorWithTimelock executor,
    address[] memory targets,
    uint256[] memory values,
    string[] memory signatures,
    bytes[] memory calldatas,
    bool[] memory withDelegatecalls,
    bytes32 ipfsHash
  ) external returns (uint256);

  function cancel(uint256 proposalId) external;

  function queue(uint256 proposalId) external;

  function execute(uint256 proposalId) external payable;

  function submitVote(uint256 proposalId, bool support) external;

  function submitVoteBySignature(
    uint256 proposalId,
    bool support,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external;

  function setGovernanceStrategy(address governanceStrategy) external;

  function setVotingDelay(uint256 votingDelay) external;

  function getGovernanceStrategy() external view returns (address);

  function getVotingDelay() external view returns (uint256);

  function getProposalsCount() external view returns (uint256);

  function getProposalById(uint256 proposalId) external view returns (ProposalWithoutVotes memory);

  function getVoteOnProposal(uint256 proposalId, address voter) external view returns (Vote memory);

  function getProposalState(uint256 proposalId) external view returns (ProposalState);
}
