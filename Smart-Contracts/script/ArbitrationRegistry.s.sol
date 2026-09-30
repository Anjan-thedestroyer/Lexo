// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ArbitratorRegistry} from "../src/arbitration/ArbitratorRegistry.sol"; // Path to your contract

contract DeployArbitratorRegistry is Script {
    function run() external returns (ArbitratorRegistry registry) {
        // Retrieve private key from .env
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Broadcast transactions to the blockchain using the deployer account
        vm.startBroadcast(deployerPrivateKey);

        // Optional parameters if your constructor expects them (e.g., initial staking token or owner)
        // address stakingToken = vm.envAddress("STAKING_TOKEN_ADDRESS");
        address token = vm.envAddress("TOKEN_ADDRESS");
        address identity = vm.envAddress("IDENTITY_REGISTER_ADDRESS");
        registry = new ArbitratorRegistry(identity, token);

        vm.stopBroadcast();

        console.log("ArbitratorRegistry deployed to:", address(registry));
    }
}