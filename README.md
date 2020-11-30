# Aave Governance v2

## Architecture

![governance-v2-architecture](./gov-v2-architecture.png)

## Setup

The repository uses Docker Compose to manage sensitive keys and load the configuration. Prior any action like test or deploy, you must run `docker-compose up` to start the `contracts-env` container, and then connect to the container console via `docker-compose exec contracts-env bash`.

Follow the next steps to setup the repository:

- Install `docker` and `docker-compose`
- Create an enviroment file named `.env` and fill the next enviroment variables

```
# Mnemonic, only first address will be used
MNEMONIC=""

# Add Alchemy or Infura provider keys, alchemy takes preference at the config level
ALCHEMY_KEY=""
INFURA_KEY=""

# Your access token from Gitlab, with the api scope enabled, to install @aave-tech/aave-token package from Gitlab Package Registry. Check this guide to get one https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html
GITLAB_ACCESS_TOKEN=""

# Optional Etherscan key, for automatize the verification of the contracts at Etherscan
ETHERSCAN_KEY=""

# Optional, if you plan to use Tenderly scripts
TENDERLY_PROJECT=""
TENDERLY_USERNAME=""

```

## Test

For running the test suite, run:

```
docker-compose run contracts-env npm run test
```

For running coverage, run:

```
docker-compose run contracts-env npm run coverage
```

## Mainnet deployment flow
