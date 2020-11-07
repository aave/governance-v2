FROM ethereum/solc:0.7.4 as build-deps

FROM node:14
COPY --from=build-deps /usr/bin/solc /usr/bin/solc
