// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import {Ownable} from './Ownable.sol';
import {IVotingStrategy} from './IVotingStrategy.sol';
import {IPropositionStrategy} from './IPropositionStrategy.sol';
import {IExecutorWithTimelock} from './IExecutorWithTimelock.sol';
import {isContract, add256, sub256, getChainId} from './Helpers.sol';

// TODO review if it's important to validate that the creator doesn't have other proposals in parallel (on creation) If so, needed to recover the
//     mapping (address => uint) public latestProposalIds;
// TODO add getters
// TODO add events
contract AaveGovernanceV2 is Ownable {
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

  enum ProposalState {Pending, Canceled, Active, Failed, Succeeded, Queued, Expired, Executed}

  address private _governanceStrategy;
  uint256 private _votingDelay;

  uint256 private _proposalsCount;
  mapping(uint256 => Proposal) private _proposals;

  bytes32 public constant DOMAIN_TYPEHASH = keccak256(
    'EIP712Domain(string name,uint256 chainId,address verifyingContract)'
  );
  bytes32 public constant VOTE_EMITTED_TYPEHASH = keccak256('VoteEmitted(uint256 id,bool option)');
  string public constant NAME = 'Aave Governance v2';

  constructor(address governanceStrategy, uint256 votingDelay) {
    _setGovernanceStrategy(governanceStrategy);
    _setVotingDelay(votingDelay);
  }

  struct CreateVars {
    uint256 startBlock;
    uint256 endBlock;
    uint256 previousProposalsCount;
  }

  function create(
    IExecutorWithTimelock executor,
    address[] memory targets,
    uint256[] memory values,
    string[] memory signatures,
    bytes[] memory calldatas,
    bool[] memory withDelegatecalls,
    bytes32 ipfsHash
  ) public returns (uint256) {
    require(targets.length != 0, 'INVALID_EMPTY_TARGETS');
    require(
      targets.length == values.length &&
        targets.length == signatures.length &&
        targets.length == calldatas.length,
      'INCONSISTENT_PARAMS_LENGTH'
    );
    require(
      IPropositionStrategy(_governanceStrategy).getPropositionPowerAt(
        msg.sender,
        block.number - 1
      ) >= IPropositionStrategy(_governanceStrategy).getPropositionPowerNeeded(),
      'INVALID_PROPOSITION_POWER'
    );

    CreateVars memory vars;

    vars.startBlock = add256(block.number, _votingDelay);
    vars.endBlock = add256(vars.startBlock, IExecutorWithTimelock(executor).VOTING_DURATION());

    vars.previousProposalsCount = _proposalsCount;

    Proposal storage newProposal = _proposals[vars.previousProposalsCount];
    newProposal.id = vars.previousProposalsCount;
    newProposal.creator = msg.sender;
    newProposal.executor = executor;
    newProposal.targets = targets;
    newProposal.values = values;
    newProposal.signatures = signatures;
    newProposal.calldatas = calldatas;
    newProposal.withDelegatecalls = withDelegatecalls;
    newProposal.startBlock = vars.startBlock;
    newProposal.endBlock = vars.endBlock;
    newProposal.strategy = _governanceStrategy;
    newProposal.ipfsHash = ipfsHash;
    _proposalsCount++;

    return newProposal.id;
  }

  function cancel(uint256 proposalId) public {
    ProposalState state = getProposalState(proposalId);
    require(
      state != ProposalState.Executed && state != ProposalState.Canceled,
      'ONLY_BEFORE_EXECUTED'
    );

    Proposal storage proposal = _proposals[proposalId];
    require(
      IPropositionStrategy(_governanceStrategy).getPropositionPowerAt(
        proposal.creator,
        block.number - 1
      ) < IPropositionStrategy(_governanceStrategy).getPropositionPowerNeeded(),
      'CREATOR_BELOW_THRESHOLD'
    );
    proposal.canceled = true;
    for (uint256 i = 0; i < proposal.targets.length; i++) {
      proposal.executor.cancelTransaction(
        proposal.targets[i],
        proposal.values[i],
        proposal.signatures[i],
        proposal.calldatas[i],
        proposal.executionTime,
        proposal.withDelegatecalls[i]
      );
    }
  }

  function queue(uint256 proposalId) public {
    require(getProposalState(proposalId) == ProposalState.Succeeded, 'INVALID_STATE_FOR_QUEUE');
    Proposal storage proposal = _proposals[proposalId];
    uint256 executionTime = add256(block.timestamp, proposal.executor.getDelay());
    for (uint256 i = 0; i < proposal.targets.length; i++) {
      _queueOrRevert(
        proposal.executor,
        proposal.targets[i],
        proposal.values[i],
        proposal.signatures[i],
        proposal.calldatas[i],
        executionTime,
        proposal.withDelegatecalls[i]
      );
    }
    proposal.executionTime = executionTime;
  }

  function _queueOrRevert(
    IExecutorWithTimelock executor,
    address target,
    uint256 value,
    string memory signature,
    bytes memory callData,
    uint256 executionTime,
    bool withDelegatecall
  ) internal {
    require(
      !executor.isActionQueued(
        keccak256(abi.encode(target, value, signature, callData, executionTime, withDelegatecall))
      ),
      'DUPLICATED_ACTION'
    );
    executor.queueTransaction(target, value, signature, callData, executionTime, withDelegatecall);
  }

  function execute(uint256 proposalId) public payable {
    require(getProposalState(proposalId) == ProposalState.Queued, 'ONLY_QUEUED_PROPOSALS');
    Proposal storage proposal = _proposals[proposalId];
    proposal.executed = true;
    for (uint256 i = 0; i < proposal.targets.length; i++) {
      proposal.executor.executeTransaction{value: proposal.values[i]}(
        proposal.targets[i],
        proposal.values[i],
        proposal.signatures[i],
        proposal.calldatas[i],
        proposal.executionTime,
        proposal.withDelegatecalls[i]
      );
    }
  }

  function submitVote(uint256 proposalId, bool support) public {
    return _submitVote(msg.sender, proposalId, support);
  }

  function submitVoteBySignature(
    uint256 proposalId,
    bool support,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) public {
    bytes32 digest = keccak256(
      abi.encodePacked(
        '\x19\x01',
        keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(NAME)), getChainId(), address(this))),
        keccak256(abi.encode(VOTE_EMITTED_TYPEHASH, proposalId, support))
      )
    );
    address signer = ecrecover(digest, v, r, s);
    require(signer != address(0), 'INVALID_SIGNATURE');
    return _submitVote(signer, proposalId, support);
  }

  function _submitVote(
    address voter,
    uint256 proposalId,
    bool support
  ) internal {
    require(getProposalState(proposalId) == ProposalState.Active, 'VOTING_CLOSED');
    Proposal storage proposal = _proposals[proposalId];
    Vote storage vote = proposal.votes[voter];

    require(vote.votingPower == 0, 'VOTE_ALREADY_SUBMITTED');

    uint256 votingPower = IVotingStrategy(proposal.strategy).getVotingPowerAt(
      voter,
      proposal.startBlock
    );

    if (support) {
      proposal.forVotes = add256(proposal.forVotes, votingPower);
    } else {
      proposal.againstVotes = add256(proposal.againstVotes, votingPower);
    }

    vote.support = support;
    vote.votingPower = uint248(votingPower);
  }

  function setGovernanceStrategy(address governanceStrategy) public onlyOwner {
    _setGovernanceStrategy(governanceStrategy);
  }

  function _setGovernanceStrategy(address governanceStrategy) internal {
    require(isContract(governanceStrategy), 'STRATEGY_NEEDS_TO_BE_CONTRACT');
    _governanceStrategy = governanceStrategy;
  }

  function setVotingDelay(uint256 votingDelay) public onlyOwner {
    _setVotingDelay(votingDelay);
  }

  function _setVotingDelay(uint256 votingDelay) internal {
    require(votingDelay > 0, 'INVALID_ZERO_DELAY');
    _votingDelay = votingDelay;
  }

  function getProposalState(uint256 proposalId) public view returns (ProposalState) {
    require(_proposalsCount >= proposalId, 'INVALID_PROPOSAL_ID');
    Proposal storage proposal = _proposals[proposalId];
    if (proposal.canceled) {
      return ProposalState.Canceled;
    } else if (block.number <= proposal.startBlock) {
      return ProposalState.Pending;
    } else if (block.number <= proposal.endBlock) {
      return ProposalState.Active;
    } else if (
      proposal.forVotes <=
      proposal.executor.getForVotesNeededWithDifferential(proposal.againstVotes) ||
      proposal.forVotes < proposal.executor.getForVotesNeededForQuorum()
    ) {
      return ProposalState.Failed;
    } else if (proposal.executionTime == 0) {
      return ProposalState.Succeeded;
    } else if (proposal.executed) {
      return ProposalState.Executed;
    } else if (
      block.timestamp >= add256(proposal.executionTime, proposal.executor.GRACE_PERIOD())
    ) {
      return ProposalState.Expired;
    } else {
      return ProposalState.Queued;
    }
  }
}
