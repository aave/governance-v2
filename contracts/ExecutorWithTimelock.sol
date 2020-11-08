// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import {SafeMath} from './SafeMath.sol';
import {IPayload} from './IPayload.sol';
import {IExecutorWithTimelock} from './IExecutorWithTimelock.sol';

// TODO add events
contract ExecutorWithTimelock is IExecutorWithTimelock {
  using SafeMath for uint256;

  uint256 public constant override GRACE_PERIOD = 14 days;
  uint256 public constant override MINIMUM_DELAY = 1 days;
  uint256 public constant override MAXIMUM_DELAY = 30 days;
  uint256 public constant override VOTING_DURATION = 14 days;
  uint256 public constant override VOTE_DIFFERENTIAL = 500; // 5%

  address private _admin;
  address private _pendingAdmin;
  uint256 private _delay;

  mapping(bytes32 => bool) private _queuedTransactions;

  constructor(address admin, uint256 delay) {
    _validateDelay(delay);
    _admin = admin;
    _delay = delay;
  }

  modifier onlyAdmin() {
    require(msg.sender == _admin, 'ONLY_BY_ADMIN');
    _;
  }

  modifier onlyTimelock() {
    require(msg.sender == address(this), 'ONLY_BY_THIS_TIMELOCK');
    _;
  }

  modifier onlyPendingAdmin() {
    require(msg.sender == _pendingAdmin, 'ONLY_BY_PENDING_ADMIN');
    _;
  }

  function setDelay(uint256 delay) public onlyTimelock {
    _validateDelay(delay);
    _delay = delay;
  }

  function acceptAdmin() public onlyPendingAdmin {
    _admin = msg.sender;
    _pendingAdmin = address(0);
  }

  function setPendingAdmin(address pendingAdmin) public onlyTimelock {
    _pendingAdmin = pendingAdmin;
  }

  function queueTransaction(address payload, uint256 executionTime)
    public
    override
    onlyAdmin
    returns (bytes32)
  {
    require(executionTime >= block.timestamp.add(_delay), 'EXECUTION_TIME_UNDERESTIMATED');

    bytes32 hashId = keccak256(abi.encode(payload, executionTime));
    _queuedTransactions[hashId] = true;

    return hashId;
  }

  function cancelTransaction(address payload, uint256 executionTime) public override onlyAdmin {
    bytes32 hashId = keccak256(abi.encode(payload, executionTime));
    _queuedTransactions[hashId] = false;
  }

  function executeTransaction(address payload, uint256 executionTime)
    public
    payable
    override
    onlyAdmin
    returns (bytes memory)
  {
    bytes32 hashId = keccak256(abi.encode(payload, executionTime));
    require(_queuedTransactions[hashId], 'PAYLOAD_IS_NOT_QUEUED');
    require(block.timestamp >= executionTime, 'TIMELOCK_NOT_FINISHED');
    require(block.timestamp <= executionTime.add(GRACE_PERIOD), 'GRACE_PERIOD_FINISHED');

    _queuedTransactions[hashId] = false;

    // solium-disable-next-line security/no-call-value
    (bool success, bytes memory data) = payload.delegatecall(
      abi.encodeWithSelector(IPayload(payload).execute.selector)
    );
    require(success, 'FAILED_PAYLOAD_EXECUTION');

    return data;
  }

  function _validateDelay(uint256 delay) internal pure {
    require(delay >= MINIMUM_DELAY, 'DELAY_SHORTER_THAN_MINIMUM');
    require(delay <= MAXIMUM_DELAY, 'DELAY_LONGER_THAN_MAXIMUM');
  }

  function getQuorum() external view override returns (uint256) {
    return 300; // TODO replace, now 3%
  }

  function getForVotesNeededForQuorum() external view override returns (uint256) {
    return 0; // TODO
  }

  function getVotesDifferential() external view override returns (uint256) {
    return 0; // TODO
  }

  function getForVotesNeededWithDifferential(uint256 against)
    external
    view
    override
    returns (uint256)
  {
    return 0; // TODO
  }

  function getAdmin() external view override returns (address) {
    return _admin;
  }

  function getPendingAdmin() external view override returns (address) {
    return _pendingAdmin;
  }

  function getDelay() external view override returns (uint256) {
    return _delay;
  }

  function isPayloadQueued(bytes32 hashId) external view override returns (bool) {
    return _queuedTransactions[hashId];
  }
}
