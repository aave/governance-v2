// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {ExecutorWithTimelock} from './ExecutorWithTimelock.sol';
import {VoteValidator} from './VoteValidator.sol';

contract Executor is ExecutorWithTimelock, VoteValidator {
  constructor(address admin, uint256 delay) ExecutorWithTimelock(admin, delay) VoteValidator() {}
}
