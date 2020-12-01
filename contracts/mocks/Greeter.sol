pragma solidity 0.7.5;
pragma abicoder v2;

contract Greeter {
  event Created(address contractAddress);

  constructor() {
    emit Created(address(this));
  }

  function hello() external view returns (string memory) {
    return "Hello";
  }
}