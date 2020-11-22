// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {IExecutorWithTimelock} from './IExecutorWithTimelock.sol';
import {add256} from './Helpers.sol';

// TODO add events
contract ExecutorWithTimelock is IExecutorWithTimelock {
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

  function queueTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 executionTime,
    bool withDelegatecall
  ) public override onlyAdmin returns (bytes32) {
    require(executionTime >= add256(block.timestamp, _delay), 'EXECUTION_TIME_UNDERESTIMATED');

    bytes32 actionHash = keccak256(
      abi.encode(target, value, signature, data, executionTime, withDelegatecall)
    );
    _queuedTransactions[actionHash] = true;

    return actionHash;
  }

  function cancelTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 executionTime,
    bool withDelegatecall
  ) public override onlyAdmin {
    bytes32 actionHash = keccak256(
      abi.encode(target, value, signature, data, executionTime, withDelegatecall)
    );
    _queuedTransactions[actionHash] = false;
  }

  function executeTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 executionTime,
    bool withDelegatecall
  ) public payable override onlyAdmin returns (bytes memory) {
    bytes32 actionHash = keccak256(
      abi.encode(target, value, signature, data, executionTime, withDelegatecall)
    );
    require(_queuedTransactions[actionHash], 'ACTION_NOT_QUEUED');
    require(block.timestamp >= executionTime, 'TIMELOCK_NOT_FINISHED');
    require(block.timestamp <= add256(executionTime, GRACE_PERIOD), 'GRACE_PERIOD_FINISHED');

    _queuedTransactions[actionHash] = false;

    bytes memory callData;

    if (bytes(signature).length == 0) {
      callData = data;
    } else {
      callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
    }

    bool success;
    bytes memory resultData;
    if (withDelegatecall) {
      // solium-disable-next-line security/no-call-value
      (success, resultData) = target.delegatecall(callData);
    } else {
      // solium-disable-next-line security/no-call-value
      (success, resultData) = target.call{value: value}(callData);
    }

    require(success, 'FAILED_ACTION_EXECUTION');

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

  function isActionQueued(bytes32 actionHash) external view override returns (bool) {
    return _queuedTransactions[actionHash];
  }
}
