// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

interface IExecutorWithTimelock {
  function getQuorum() external view returns (uint256);

  function getForVotesNeededForQuorum() external view returns (uint256);

  function getVotesDifferential() external view returns (uint256);

  function getForVotesNeededWithDifferential(uint256 against) external view returns (uint256);

  function getAdmin() external view returns (address);

  function getPendingAdmin() external view returns (address);

  function getDelay() external view returns (uint256);

  function isPayloadQueued(bytes32 hashId) external view returns (bool);

  function GRACE_PERIOD() external view returns (uint256);

  function VOTING_DURATION() external view returns (uint256);

  function VOTE_DIFFERENTIAL() external view returns (uint256);

  function MINIMUM_DELAY() external view returns (uint256);

  function MAXIMUM_DELAY() external view returns (uint256);

  function queueTransaction(address payload, uint256 executionTime) external returns (bytes32);

  function executeTransaction(address payload, uint256 executionTime)
    external
    payable
    returns (bytes memory);

  function cancelTransaction(address payload, uint256 executionTime) external;
}
