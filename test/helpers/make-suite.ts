import {evmRevert, evmSnapshot, DRE} from '../../helpers/misc-utils';
import {Signer} from 'ethers';
import chai from 'chai';
// @ts-ignore
import {solidity} from 'ethereum-waffle';
import {tEthereumAddress} from '../../helpers/types';
import {AaveGovernanceV2} from '../../types/AaveGovernanceV2';
import {GovernanceStrategy} from '../../types/GovernanceStrategy';
import {AaveTokenV2} from '../../types/AaveTokenV2';
import {Executor} from '../../types/Executor';
import {getEthersSigners} from '../../helpers/contracts-helpers';
import {
  getAaveGovernanceV2,
  getAaveV2Mocked,
  getExecutor,
  getExecutorMock,
  getGovernanceStrategy,
} from '../../helpers/contracts-getters';

chai.use(solidity);

export interface SignerWithAddress {
  signer: Signer;
  address: tEthereumAddress;
}
export interface TestEnv {
  deployer: SignerWithAddress;
  minter: SignerWithAddress;
  users: SignerWithAddress[];
  aave: AaveTokenV2;
  gov: AaveGovernanceV2;
  strategy: GovernanceStrategy;
  executor: Executor;
}

let buidlerevmSnapshotId: string = '0x1';
const setBuidlerevmSnapshotId = (id: string) => {
  if (DRE.network.name === 'hardhat') {
    buidlerevmSnapshotId = id;
  }
};

const testEnv: TestEnv = {
  deployer: {} as SignerWithAddress,
  minter: {} as SignerWithAddress,
  users: [] as SignerWithAddress[],
  aave: {} as AaveTokenV2,
  gov: {} as AaveGovernanceV2,
  strategy: {} as GovernanceStrategy,
  executor: {} as Executor,
} as TestEnv;

export async function initializeMakeSuite() {
  const [_deployer, _minter, ...restSigners] = await getEthersSigners();
  const deployer: SignerWithAddress = {
    address: await _deployer.getAddress(),
    signer: _deployer,
  };
  const minter: SignerWithAddress = {
    address: await _minter.getAddress(),
    signer: _minter,
  };

  testEnv.users = await Promise.all(
    restSigners.map(async (signer) => ({
      signer,
      address: await signer.getAddress(),
    }))
  );

  testEnv.deployer = deployer;
  testEnv.minter = minter;
  testEnv.aave = await getAaveV2Mocked();
  testEnv.gov = await getAaveGovernanceV2();
  testEnv.strategy = await getGovernanceStrategy();
  testEnv.executor = await getExecutorMock();
}

export function makeSuite(name: string, tests: (testEnv: TestEnv) => void) {
  describe(name, () => {
    before(async () => {
      setBuidlerevmSnapshotId(await evmSnapshot());
    });
    tests(testEnv);
    after(async () => {
      await evmRevert(buidlerevmSnapshotId);
    });
  });
}
