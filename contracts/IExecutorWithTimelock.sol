// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

interface IExecutorWithTimelock {
  function getQuorum() external view returns (uint256);

  function getForVotesNeededForQuorum() external view returns (uint256);

  function getVotesDifferential() external view returns (uint256);

  function getForVotesNeededWithDifferential(uint256 against) external view returns (uint256);

  function getVotingDuration() external view returns (uint256);

  function getVoteDifferential() external view returns (uint256);

  function delay() external view returns (uint256);

  function GRACE_PERIOD() external view returns (uint256);

  function queuedTransactions(bytes32 hash) external view returns (bool);

  function queueTransaction(address payload, uint256 executionBlock) external returns (bytes32);

  function executeTransaction(address payload, uint256 executionBlock)
    external
    payable
    returns (bytes memory);

  function cancelTransaction(address payload, uint256 executionBlock) external;
}
