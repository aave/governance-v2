// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import {Ownable} from './Ownable.sol';
import {IVotingStrategy} from './IVotingStrategy.sol';
import {IPropositionStrategy} from './IPropositionStrategy.sol';
import {IExecutorWithTimelock} from './IExecutorWithTimelock.sol';
import {isContract, add256, sub256, getChainId} from './Helpers.sol';

// TODO review if cancelled state is needed
// TODO review if nonce is needed for vote with signature, in order to allow overriding of votes
// TODO review if it's important to validate that the creator doesn't have other proposals in parallel (on creation) If so, needed to recover the
//     mapping (address => uint) public latestProposalIds;
// TODO should validate the quorum and voting durations coming from the timelock on creation?
// TODO review if needed to NOT allow to override votes  (hasVote on Vote struct)
// TODO review if it's a problem to start proposals from id 0
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
    address payload;
    uint256 startBlock;
    uint256 endBlock;
    uint256 executionBlock;
    uint256 forVotes;
    uint256 againstVotes;
    bool executed;
    address strategy;
    bytes32 ipfsHash;
    mapping(address => Vote) votes;
  }

  enum ProposalState {Pending, Active, Failed, Succeeded, Queued, Expired, Executed}

  address private _governanceStrategy;
  uint256 private _propositionPowerThreshold; // In per thousand
  uint256 private _votingDelay; // blocks delta until the proposal will be opened for voting

  uint256 private _proposalsCount;
  mapping(uint256 => Proposal) private _proposals;

  bytes32 public constant DOMAIN_TYPEHASH = keccak256(
    'EIP712Domain(string name,uint256 chainId,address verifyingContract)'
  );
  bytes32 public constant VOTE_EMITTED_TYPEHASH = keccak256('VoteEmitted(uint256 id,bool option)');
  string public constant NAME = 'Aave Governance v2';

  constructor(
    address governanceStrategy,
    uint256 propositionPowerThreshold,
    uint256 votingDelay
  ) {
    _governanceStrategy = governanceStrategy;
    _propositionPowerThreshold = propositionPowerThreshold;
    _votingDelay = votingDelay;
  }

  function create(
    IExecutorWithTimelock executor,
    address payload,
    bytes32 ipfsHash
  ) public returns (uint256) {
    require(
      IPropositionStrategy(_governanceStrategy).getPropositionPower(msg.sender) >=
        _propositionPowerThreshold,
      'INVALID_PROPOSITION_POWER'
    );
    require(isContract(payload), 'INVALID_NON_CONTRACT_PAYLOAD');

    uint256 quorum = IExecutorWithTimelock(executor).getQuorum();
    uint256 votingDuration = IExecutorWithTimelock(executor).getVotingDuration();

    require(quorum != 0, 'INVALID_QUORUM');
    require(votingDuration != 0, 'INVALID_VOTING_DURATION');

    uint256 startBlock = add256(block.number, _votingDelay);
    uint256 endBlock = add256(startBlock, votingDuration);

    uint256 previousProposalsCount = _proposalsCount;

    Proposal storage newProposal = _proposals[previousProposalsCount];
    newProposal.id = previousProposalsCount;
    newProposal.creator = msg.sender;
    newProposal.executor = executor;
    newProposal.payload = payload;
    newProposal.startBlock = startBlock;
    newProposal.endBlock = endBlock;
    newProposal.strategy = _governanceStrategy;
    newProposal.ipfsHash = ipfsHash;
    _proposalsCount++;

    return newProposal.id;
  }

  function queue(uint256 proposalId) public {
    require(state(proposalId) == ProposalState.Succeeded, 'INVALID_STATE_FOR_QUEUE');
    Proposal storage proposal = _proposals[proposalId];
    uint256 executionBlock = add256(block.timestamp, proposal.executor.delay());
    _queueOrRevert(proposal.executor, proposal.payload, executionBlock);
    proposal.executionBlock = executionBlock;
  }

  function _queueOrRevert(
    IExecutorWithTimelock executor,
    address payload,
    uint256 executionBlock
  ) internal {
    require(!executor.queuedTransactions(keccak256(abi.encode(payload))), 'DUPLICATED_PAYLOAD');
    executor.queueTransaction(payload, executionBlock);
  }

  function execute(uint256 proposalId) public payable {
    require(state(proposalId) == ProposalState.Queued, 'ONLY_QUEUED_PROPOSALS');
    Proposal storage proposal = _proposals[proposalId];
    proposal.executed = true;
    proposal.executor.executeTransaction(proposal.payload, proposal.executionBlock);
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
    require(state(proposalId) == ProposalState.Active, 'VOTING_CLOSED');
    Proposal storage proposal = _proposals[proposalId];
    Vote storage vote = proposal.votes[voter];

    uint256 votingPower = IVotingStrategy(proposal.strategy).getVotingPower(
      voter,
      proposal.startBlock
    );

    if (support) {
      proposal.forVotes = add256(proposal.forVotes, votingPower);
    } else {
      proposal.againstVotes = add256(proposal.againstVotes, votingPower);
    }

    vote.support = support;
    vote.votingPower = uint248(votingPower); // TODO review, but should not be any problem with this cast
  }

  function setGovernanceStrategy(address governanceStrategy) public onlyOwner {
    _governanceStrategy = governanceStrategy;
  }

  function setPropositionPowerThreshold(uint256 propositionPowerThreshold) public onlyOwner {
    _propositionPowerThreshold = propositionPowerThreshold;
  }

  function setVotingDelay(uint256 votingDelay) public onlyOwner {
    _votingDelay = votingDelay;
  }

  function state(uint256 proposalId) public view returns (ProposalState) {
    require(_proposalsCount >= proposalId, 'INVALID_PROPOSAL_ID');
    Proposal storage proposal = _proposals[proposalId];
    if (block.number <= proposal.startBlock) {
      return ProposalState.Pending;
    } else if (block.number <= proposal.endBlock) {
      return ProposalState.Active;
    } else if (
      proposal.forVotes <= add256(proposal.againstVotes, proposal.executor.getVoteDifferential()) ||
      proposal.forVotes < proposal.executor.getQuorum()
    ) {
      return ProposalState.Failed;
    } else if (proposal.executionBlock == 0) {
      return ProposalState.Succeeded;
    } else if (proposal.executed) {
      return ProposalState.Executed;
    } else if (
      block.timestamp >= add256(proposal.executionBlock, proposal.executor.GRACE_PERIOD())
    ) {
      return ProposalState.Expired;
    } else {
      return ProposalState.Queued;
    }
  }
}
