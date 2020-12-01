// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {ExecutorWithTimelock} from './ExecutorWithTimelock.sol';
import {ProposalValidator} from './ProposalValidator.sol';

/**
 * @title Time Locked, Validator, Executor Contract
 * @dev Contract 
 * - Validate Proposal creations/ cancellation
 * - Validate Vote Quorum and Vote success on proposal
 * - Queue, Execute, Cancel, successful proposals' transactions.
 * @author Aave
 **/
contract Executor is ExecutorWithTimelock, ProposalValidator {
  // delay = delay between queuing and execution
  constructor(address admin, uint256 delay) ExecutorWithTimelock(admin, delay) ProposalValidator() {}
}
