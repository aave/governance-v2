// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {Ownable} from './Ownable.sol';
import {IVotingStrategy} from './IVotingStrategy.sol';
import {IExecutorWithTimelock} from './IExecutorWithTimelock.sol';
import {IVoteValidator} from './IVoteValidator.sol';
import {IGovernanceStrategy} from './IGovernanceStrategy.sol';
import {IAaveGovernanceV2} from './IAaveGovernanceV2.sol';
import {isContract, add256, sub256, getChainId} from './Helpers.sol';

contract AaveGovernanceV2 is Ownable, IAaveGovernanceV2 {
  /// @dev With logic for validation of proposition and voting
  address private _governanceStrategy;
  uint256 private _votingDelay;

  uint256 private _proposalsCount;
  mapping(uint256 => Proposal) private _proposals;
  mapping(address => bool) private _whitelistedExecutors;

  address private _guardian;

  bytes32 public constant DOMAIN_TYPEHASH = keccak256(
    'EIP712Domain(string name,uint256 chainId,address verifyingContract)'
  );
  bytes32 public constant VOTE_EMITTED_TYPEHASH = keccak256('VoteEmitted(uint256 id,bool support)');
  string public constant NAME = 'Aave Governance v2';

  modifier onlyGuardian() {
    require(msg.sender == _guardian, 'ONLY_BY_GUARDIAN');
    _;
  }

  constructor(
    address governanceStrategy,
    uint256 votingDelay,
    address guardian,
    address[] memory executors
  ) {
    _setGovernanceStrategy(governanceStrategy);
    _setVotingDelay(votingDelay);
    _guardian = guardian;

    whitelistExecutors(executors);
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
  ) external override returns (uint256) {
    require(targets.length != 0, 'INVALID_EMPTY_TARGETS');
    require(
      targets.length == values.length &&
        targets.length == signatures.length &&
        targets.length == calldatas.length,
      'INCONSISTENT_PARAMS_LENGTH'
    );
    require(_whitelistedExecutors[address(executor)], 'EXECUTOR_NOT_WHITELISTED');

    IGovernanceStrategy(_governanceStrategy).validateCreatorOfProposal(
      msg.sender,
      block.number - 1
    );

    CreateVars memory vars;

    vars.startBlock = add256(block.number, _votingDelay);
    vars.endBlock = add256(vars.startBlock, IVoteValidator(address(executor)).VOTING_DURATION());

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

    emit ProposalCreated(
      vars.previousProposalsCount,
      msg.sender,
      executor,
      targets,
      values,
      signatures,
      calldatas,
      withDelegatecalls,
      vars.startBlock,
      vars.endBlock,
      _governanceStrategy,
      ipfsHash
    );

    return newProposal.id;
  }

  function cancel(uint256 proposalId) external override {
    ProposalState state = getProposalState(proposalId);
    require(
      msg.sender == _guardian ||
        (state != ProposalState.Executed && state != ProposalState.Canceled),
      'ONLY_BEFORE_EXECUTED'
    );

    Proposal storage proposal = _proposals[proposalId];
    require(
      !IGovernanceStrategy(_governanceStrategy).isPropositionPowerEnough(
        proposal.creator,
        block.number - 1
      ),
      'CREATOR_ABOVE_THRESHOLD'
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

    emit ProposalCanceled(proposalId);
  }

  function queue(uint256 proposalId) external override {
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

    emit ProposalQueued(proposalId, executionTime, msg.sender);
  }

  function execute(uint256 proposalId) external payable override {
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
    emit ProposalExecuted(proposalId, msg.sender);
  }

  function submitVote(uint256 proposalId, bool support) external override {
    return _submitVote(msg.sender, proposalId, support);
  }

  function submitVoteBySignature(
    uint256 proposalId,
    bool support,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external override {
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

  function setGovernanceStrategy(address governanceStrategy) external override onlyOwner {
    _setGovernanceStrategy(governanceStrategy);
  }

  function setVotingDelay(uint256 votingDelay) external override onlyOwner {
    _setVotingDelay(votingDelay);
  }

  function whitelistExecutors(address[] memory executors) public override onlyOwner {
    for (uint256 i = 0; i < executors.length; i++) {
      _whitelistExecutor(executors[i]);
    }
  }

  function blacklistExecutors(address[] memory executors) public override onlyOwner {
    for (uint256 i = 0; i < executors.length; i++) {
      _blacklistExecutor(executors[i]);
    }
  }

  function __abdicate() external override onlyGuardian {
    _guardian = address(0);
  }

  function getGovernanceStrategy() external view override returns (address) {
    return _governanceStrategy;
  }

  function getVotingDelay() external view override returns (uint256) {
    return _votingDelay;
  }

  function isExecutorWhitelisted(address executor) external view override returns (bool) {
    return _whitelistedExecutors[executor];
  }

  function getGuardian() external view override returns (address) {
    return _guardian;
  }

  function getProposalsCount() external view override returns (uint256) {
    return _proposalsCount;
  }

  function getProposalById(uint256 proposalId)
    external
    view
    override
    returns (ProposalWithoutVotes memory)
  {
    Proposal storage proposal = _proposals[proposalId];
    ProposalWithoutVotes memory proposalWithoutVotes = ProposalWithoutVotes({
      id: proposal.id,
      creator: proposal.creator,
      executor: proposal.executor,
      targets: proposal.targets,
      values: proposal.values,
      signatures: proposal.signatures,
      calldatas: proposal.calldatas,
      withDelegatecalls: proposal.withDelegatecalls,
      startBlock: proposal.startBlock,
      endBlock: proposal.endBlock,
      executionTime: proposal.executionTime,
      forVotes: proposal.forVotes,
      againstVotes: proposal.againstVotes,
      executed: proposal.executed,
      canceled: proposal.canceled,
      strategy: proposal.strategy,
      ipfsHash: proposal.ipfsHash
    });

    return proposalWithoutVotes;
  }

  function getVoteOnProposal(uint256 proposalId, address voter)
    external
    view
    override
    returns (Vote memory)
  {
    return _proposals[proposalId].votes[voter];
  }

  function getProposalState(uint256 proposalId) public view override returns (ProposalState) {
    require(_proposalsCount >= proposalId, 'INVALID_PROPOSAL_ID');
    Proposal storage proposal = _proposals[proposalId];
    if (proposal.canceled) {
      return ProposalState.Canceled;
    } else if (block.number <= proposal.startBlock) {
      return ProposalState.Pending;
    } else if (block.number <= proposal.endBlock) {
      return ProposalState.Active;
    } else if (!IVoteValidator(address(proposal.executor)).isProposalPassed(this, proposalId)) {
      return ProposalState.Failed;
    } else if (proposal.executionTime == 0) {
      return ProposalState.Succeeded;
    } else if (proposal.executed) {
      return ProposalState.Executed;
    } else if (proposal.executor.isProposalOverGracePeriod(this, proposalId)) {
      return ProposalState.Expired;
    } else {
      return ProposalState.Queued;
    }
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

    emit VoteEmitted(proposalId, voter, support, votingPower);
  }

  function _setGovernanceStrategy(address governanceStrategy) internal {
    require(
      IGovernanceStrategy(governanceStrategy).getTotalPropositionSupplyAt(block.number) > 0 &&
        IGovernanceStrategy(governanceStrategy).getTotalVotingSupplyAt(block.number) > 0 &&
        IGovernanceStrategy(governanceStrategy).getMinimumPropositionPowerNeeded(block.number) > 0,
      'INVALID_STRATEGY'
    );

    _governanceStrategy = governanceStrategy;

    emit GovernanceStrategyChanged(governanceStrategy, msg.sender);
  }

  function _setVotingDelay(uint256 votingDelay) internal {
    require(votingDelay > 0, 'INVALID_ZERO_DELAY');
    _votingDelay = votingDelay;

    emit VotingDelayChanged(votingDelay, msg.sender);
  }

  function _whitelistExecutor(address executor) internal {
    _whitelistedExecutors[executor] = true;
    emit ExecutorWhitelisted(executor);
  }

  function _blacklistExecutor(address executor) internal {
    _whitelistedExecutors[executor] = false;
    emit ExecutorBlacklisted(executor);
  }
}
