// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {EscrowCore} from "../src/core/EscrowCore.sol";
import {AgreementRegistry} from "../src/core/AgreementRegistry.sol";

contract DeployLexo is Script {
    function run()
        external
        returns (
            AgreementRegistry agreementRegistry,
            EscrowCore escrowCore
        )
    {
        // =====================================================
        // 1. LOAD DEPLOYMENT CONFIGURATION
        // =====================================================

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address tokenAddress = vm.envAddress("TOKEN_ADDRESS");
        address identityRegister = vm.envAddress("IDENTITY_REGISTER_ADDRESS");

        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        address arbiterAddress = vm.envOr("ARBITER_ADDRESS", address(0));

        require(tokenAddress != address(0), "Token is zero");
        require(identityRegister != address(0), "IdentityRegister is zero");
        require(feeRecipient != address(0), "Fee recipient is zero");

        console.log("====================================");
        console.log("Deploying Lexo contracts");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Token:", tokenAddress);
        console.log("IdentityRegister:", identityRegister);
        console.log("Fee recipient:", feeRecipient);
        console.log("====================================");

        vm.startBroadcast(deployerPrivateKey);

        // =====================================================
        // 2. DEPLOY A NEW AGREEMENT REGISTRY
        // =====================================================

        agreementRegistry = new AgreementRegistry(identityRegister);
        console.log("New AgreementRegistry:", address(agreementRegistry));

        // =====================================================
        // 3. DEPLOY ESCROW CORE WITH CORRECT ADDRESSES
        // =====================================================

        escrowCore = new EscrowCore(
            tokenAddress,
            identityRegister,
            address(agreementRegistry),
            feeRecipient
        );
        console.log("New EscrowCore:", address(escrowCore));

        // =====================================================
        // 4. CONFIGURE THE REGISTRY TO TRUST THIS ESCROW
        // =====================================================

        agreementRegistry.setEscrowCore(address(escrowCore));
        console.log("Registry configured for new EscrowCore");

        // =====================================================
        // 5. CONFIGURE ARBITER IF PROVIDED
        // =====================================================

        if (arbiterAddress != address(0)) {
            escrowCore.addArbitrator(arbiterAddress);
            console.log("Arbitrator configured:", arbiterAddress);
        } else {
            console.log("No ARBITER_ADDRESS provided; skipping arbiter setup");
        }

        vm.stopBroadcast();

        // =====================================================
        // 6. VERIFY DEPLOYMENT CONFIGURATION
        // =====================================================

        require(address(escrowCore.token()) == tokenAddress, "Token mismatch");
        require(address(escrowCore.identityRegister()) == identityRegister, "Escrow IdentityRegister mismatch");
        require(address(escrowCore.agreementRegistry()) == address(agreementRegistry), "Escrow registry mismatch");
        require(address(agreementRegistry.identityRegister()) == identityRegister, "Registry IdentityRegister mismatch");
        require(agreementRegistry.escrowCore() == address(escrowCore), "Registry EscrowCore mismatch");

        console.log("====================================");
        console.log("LEXO DEPLOYMENT SUCCESSFUL");
        console.log("AgreementRegistry:", address(agreementRegistry));
        console.log("EscrowCore:", address(escrowCore));
        console.log("All address checks passed");
        console.log("====================================");
    }
}