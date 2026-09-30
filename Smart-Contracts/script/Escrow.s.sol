// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {EscrowCore} from "../src/core/EscrowCore.sol"; // Adjust path to match your file structure

contract DeployEscrowCore is Script {
    function run() external returns (EscrowCore escrowCore) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying EscrowCore with account:", deployer);

        // Retrieve dependencies from environment variables or configure target network addresses
        address tokenAddress = vm.envAddress("TOKEN_ADDRESS");
        address identityRegister = vm.envAddress("IDENTITY_REGISTER_ADDRESS");
        address agreementRegistry = vm.envAddress("AGREEMENT_REGISTRY_ADDRESS");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer); // Defaults to deployer if unset

        vm.startBroadcast(deployerPrivateKey);

        escrowCore = new EscrowCore(
            tokenAddress,
            identityRegister,
            agreementRegistry,
            feeRecipient
        );

        // Optional: Set arbitration court if specified in environment
        address arbiterAddress = vm.envOr("ARBITER_ADDRESS", address(0));
        if (arbiterAddress != address(0)) {
            escrowCore.addArbitrator(arbiterAddress);
            console.log("Arbitration Court registered at:", arbiterAddress);
        }

        vm.stopBroadcast();

        console.log("EscrowCore deployed to:", address(escrowCore));
        console.log("Fee Recipient set to:", feeRecipient);
    }
}