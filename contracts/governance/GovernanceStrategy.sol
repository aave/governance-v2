// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma abicoder v2;

import {IGovernanceStrategy} from '../interfaces/IGovernanceStrategy.sol';
import {IERC20} from '../interfaces/IERC20.sol';
import {IDelegationAwareToken} from '../interfaces/IDelegationAwareToken.sol';

contract AaveGovernanceStrategy is IGovernanceStrategy {
  address public immutable AAVE;
  address public immutable STK_AAVE;

  constructor(address aave, address stkAave) {
    AAVE = aave;
    STK_AAVE = stkAave;
  }

  function getTotalPropositionSupplyAt(uint256 blockNumber) public view override returns (uint256) {
    // The AAVE locked in the stkAAVE is not taken into account, so the calculation is:
    //  aggregatedSupply = aaveSupply + stkAaveSupply - aaveLockedInStkAave
    // As aaveLockedInStkAave = stkAaveSupply => aggregatedSupply = aaveSupply + stkAaveSupply - stkAaveSupply = aaveSupply
    return IERC20(AAVE).totalSupplyAt(blockNumber);
  }

  function getTotalVotingSupplyAt(uint256 blockNumber) public view override returns (uint256) {
    return getTotalPropositionSupplyAt(blockNumber);
  }

  function getPropositionPowerAt(address user, uint256 blockNumber)
    public
    view
    override
    returns (uint256)
  {
    return
      getPowerByTypeAt(user, blockNumber, IDelegationAwareToken.DelegationType.PROPOSITION_POWER);
  }

  function getVotingPowerAt(address user, uint256 blockNumber)
    public
    view
    override
    returns (uint256)
  {
    return getPowerByTypeAt(user, blockNumber, IDelegationAwareToken.DelegationType.VOTING_POWER);
  }

  function getPowerByTypeAt(
    address user,
    uint256 blockNumber,
    IDelegationAwareToken.DelegationType powerType
  ) internal view returns (uint256) {
    return
      IDelegationAwareToken(AAVE).getPowerAtBlock(user, blockNumber, powerType) +
      IDelegationAwareToken(STK_AAVE).getPowerAtBlock(user, blockNumber, powerType);
  }
}
