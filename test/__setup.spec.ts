import rawBRE from 'hardhat';
import {initializeMakeSuite} from './helpers/make-suite';

before(async () => {
  console.log('-> Deploying test environment...');
  await rawBRE.run('migrate:dev');
  await initializeMakeSuite();
  console.log('\n***************');
  console.log('Setup and snapshot finished');
  console.log('***************\n');
});
