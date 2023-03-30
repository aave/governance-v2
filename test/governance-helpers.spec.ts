import { expect, use } from 'chai';
import { solidity } from 'ethereum-waffle';
import { BigNumber } from 'ethers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { DRE } from '../helpers/misc-utils';
import { buildDelegateByTypeParams, buildDelegateParams } from './helpers/delegation';
import { calculateUserTotalPowers, setTokenBalance } from './helpers/gov-utils';
import { deployGovernance, makeSuite, TestEnv } from './helpers/make-suite';
import { getSignatureFromTypedData } from './helpers/permit';

enum DelegationType {
  VOTING_POWER = 0,
  PROPOSITION_POWER,
}

use(solidity);

makeSuite('Aave Governance V2 Helpers tests', deployGovernance, (testEnv: TestEnv) => {
  const expiry = MAX_UINT_AMOUNT;
  const USER1_AAVE_BALANCE = BigNumber.from(1000);
  const USER1_STKAAVE_BALANCE = BigNumber.from(2000);
  const USER2_AAVE_BALANCE = BigNumber.from(3000);
  const USER2_STKAAVE_BALANCE = BigNumber.from(4000);

  beforeEach(async () => {
    const {
      users: [user1, user2],
    } = testEnv;

    await setTokenBalance(user1, USER1_AAVE_BALANCE, testEnv.aave, testEnv);
    await setTokenBalance(user1, USER1_STKAAVE_BALANCE, testEnv.stkAave, testEnv);

    await setTokenBalance(user2, USER2_AAVE_BALANCE, testEnv.aave, testEnv);
    await setTokenBalance(user2, USER2_STKAAVE_BALANCE, testEnv.stkAave, testEnv);
  });

  describe('Testing delegateTokensBySig function', () => {
    it('should revert with INCONSISTENT_PARAMS_LENGTH if length of tokens is different than params', async () => {
      const {
        govHelper,
        aave,
        users: [user1],
      } = testEnv;
      await expect(
        govHelper.connect(user1.signer).delegateTokensBySig([aave.address], [])
      ).to.revertedWith('INCONSISTENT_PARAMS_LENGTH');
    });
    it('should delegate both VOTING and PROPOSITION power from both AAVE and stkAAVE', async () => {
      const { chainId } = await DRE.ethers.provider.getNetwork();
      const {
        govHelper,
        aave,
        stkAave,
        users: [user1, user2],
      } = testEnv;
      const user1PrivateKey = require('../test-wallets.js').accounts[2].secretKey;

      // building aave signature
      const aaveNonce = (await aave.connect(user1.signer)._nonces(user1.address)).toString();
      const aaveTypedData = buildDelegateParams(
        chainId,
        aave.address,
        await aave.connect(user1.signer).name(),
        user2.address,
        aaveNonce,
        expiry
      );
      const { v, r, s } = getSignatureFromTypedData(user1PrivateKey, aaveTypedData);
      const aaveParams = {
        delegatee: user2.address,
        nonce: aaveNonce,
        expiry,
        v,
        r,
        s,
      };

      // building stkAave signature
      const stkAaveNonce = (await stkAave.connect(user1.signer)._nonces(user1.address)).toString();
      const stkAaveTypedData = buildDelegateParams(
        chainId,
        stkAave.address,
        await stkAave.connect(user1.signer).name(),
        user2.address,
        stkAaveNonce,
        expiry
      );
      const { v: v1, r: r1, s: s1 } = getSignatureFromTypedData(user1PrivateKey, stkAaveTypedData);
      const stkAaveParams = {
        delegatee: user2.address,
        nonce: stkAaveNonce,
        expiry,
        v: v1,
        r: r1,
        s: s1,
      };

      const user2Powers = await calculateUserTotalPowers(
        user2,
        [aave.address, stkAave.address],
        testEnv
      );

      expect(
        await govHelper
          .connect(user1.signer)
          .delegateTokensBySig([aave.address, stkAave.address], [aaveParams, stkAaveParams])
      );

      const user2NewPowers = await calculateUserTotalPowers(
        user2,
        [aave.address, stkAave.address],
        testEnv
      );

      expect(user2NewPowers.propositionPower).to.eq(
        user2Powers.propositionPower.add(USER1_AAVE_BALANCE).add(USER1_STKAAVE_BALANCE)
      );
      expect(user2NewPowers.votingPower).to.eq(
        user2Powers.votingPower.add(USER1_AAVE_BALANCE).add(USER1_STKAAVE_BALANCE)
      );
    });
  });

  describe('Testing delegateTokensByTypeBySig function', () => {
    it('should revert with INCONSISTENT_PARAMS_LENGTH if length of tokens is different than params', async () => {
      const {
        govHelper,
        aave,
        users: [user1],
      } = testEnv;
      await expect(
        govHelper.connect(user1.signer).delegateTokensByTypeBySig([aave.address], [])
      ).to.revertedWith('INCONSISTENT_PARAMS_LENGTH');
    });
    it('should delegate VOTING power from both AAVE and stkAAVE', async () => {
      const { chainId } = await DRE.ethers.provider.getNetwork();
      const {
        govHelper,
        aave,
        stkAave,
        users: [user1, user2],
      } = testEnv;
      const user1PrivateKey = require('../test-wallets.js').accounts[2].secretKey;

      const powerType = DelegationType.VOTING_POWER;

      // building aave signature
      const aaveNonce = (await aave.connect(user1.signer)._nonces(user1.address)).toString();
      const aaveTypedData = buildDelegateByTypeParams(
        chainId,
        aave.address,
        await aave.connect(user1.signer).name(),
        user2.address,
        powerType.toString(),
        aaveNonce,
        expiry
      );
      const { v, r, s } = getSignatureFromTypedData(user1PrivateKey, aaveTypedData);
      const aaveParams = {
        delegatee: user2.address,
        delegationType: powerType,
        nonce: aaveNonce,
        expiry,
        v,
        r,
        s,
      };

      // building stkAave signature
      const stkAaveNonce = (await stkAave.connect(user1.signer)._nonces(user1.address)).toString();
      const stkAaveTypedData = buildDelegateByTypeParams(
        chainId,
        stkAave.address,
        await stkAave.connect(user1.signer).name(),
        user2.address,
        powerType.toString(),
        stkAaveNonce,
        expiry
      );
      const { v: v1, r: r1, s: s1 } = getSignatureFromTypedData(user1PrivateKey, stkAaveTypedData);
      const stkAaveParams = {
        delegatee: user2.address,
        delegationType: powerType,
        nonce: stkAaveNonce,
        expiry,
        v: v1,
        r: r1,
        s: s1,
      };
      const user2Powers = await calculateUserTotalPowers(
        user2,
        [aave.address, stkAave.address],
        testEnv
      );

      expect(
        await govHelper
          .connect(user1.signer)
          .delegateTokensByTypeBySig([aave.address, stkAave.address], [aaveParams, stkAaveParams])
      );

      const user2NewPowers = await calculateUserTotalPowers(
        user2,
        [aave.address, stkAave.address],
        testEnv
      );

      expect(user2NewPowers.propositionPower).to.eq(user2Powers.propositionPower);
      expect(user2NewPowers.votingPower).to.eq(
        user2Powers.votingPower.add(USER1_AAVE_BALANCE).add(USER1_STKAAVE_BALANCE)
      );
    });

    it('should delegate PROPOSITION power from both AAVE and stkAAVE', async () => {
      const { chainId } = await DRE.ethers.provider.getNetwork();
      const {
        govHelper,
        aave,
        stkAave,
        users: [user1, user2],
      } = testEnv;
      const user1PrivateKey = require('../test-wallets.js').accounts[2].secretKey;

      const powerType = DelegationType.PROPOSITION_POWER;

      // building aave signature
      const aaveNonce = (await aave.connect(user1.signer)._nonces(user1.address)).toString();
      const aaveTypedData = buildDelegateByTypeParams(
        chainId,
        aave.address,
        await aave.connect(user1.signer).name(),
        user2.address,
        powerType.toString(),
        aaveNonce,
        expiry
      );
      const { v, r, s } = getSignatureFromTypedData(user1PrivateKey, aaveTypedData);
      const aaveParams = {
        delegatee: user2.address,
        delegationType: powerType,
        nonce: aaveNonce,
        expiry,
        v,
        r,
        s,
      };

      // building stkAave signature

      const stkAaveNonce = (await stkAave.connect(user1.signer)._nonces(user1.address)).toString();
      const stkAaveTypedData = buildDelegateByTypeParams(
        chainId,
        stkAave.address,
        await stkAave.connect(user1.signer).name(),
        user2.address,
        powerType.toString(),
        stkAaveNonce,
        expiry
      );
      const { v: v1, r: r1, s: s1 } = getSignatureFromTypedData(user1PrivateKey, stkAaveTypedData);
      const stkAaveParams = {
        delegatee: user2.address,
        delegationType: powerType,
        nonce: stkAaveNonce,
        expiry,
        v: v1,
        r: r1,
        s: s1,
      };

      const user2Powers = await calculateUserTotalPowers(
        user2,
        [aave.address, stkAave.address],
        testEnv
      );

      expect(
        await govHelper
          .connect(user1.signer)
          .delegateTokensByTypeBySig([aave.address, stkAave.address], [aaveParams, stkAaveParams])
      );

      const user2NewPowers = await calculateUserTotalPowers(
        user2,
        [aave.address, stkAave.address],
        testEnv
      );

      expect(user2NewPowers.votingPower).to.eq(user2Powers.votingPower);
      expect(user2NewPowers.propositionPower).to.eq(
        user2Powers.propositionPower.add(USER1_AAVE_BALANCE).add(USER1_STKAAVE_BALANCE)
      );
    });
  });
});
