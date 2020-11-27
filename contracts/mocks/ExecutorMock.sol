// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {ExecutorWithTimelockMock} from './ExecutorWithTimelockMock.sol';
import {VoteValidatorMock} from './VoteValidatorMock.sol';

contract ExecutorMock is ExecutorWithTimelockMock, VoteValidatorMock {
  constructor(address admin, uint256 delay) ExecutorWithTimelockMock(admin, delay) VoteValidatorMock() {}
}
