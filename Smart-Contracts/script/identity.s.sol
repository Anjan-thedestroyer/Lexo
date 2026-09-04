// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IdentityRegister} from "../src/core/IdentityRegister.sol";
import {ICoreAgreement} from "../src/interfaces/ICoreAgreement.sol";

contract DeployIdentityRegister is Script {
    function run() external returns (IdentityRegister identityRegister) {
        // Fetch variables from .env
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address coreAgreement = vm.envAddress("CORE_AGREEMENT_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");

        address deployer = vm.addr(deployerPrivateKey);

        console2.log("==================================================");
        console2.log("Deploying IdentityRegister");
        console2.log("Deployer:", deployer);
        console2.log("CoreAgreement:", coreAgreement);
        console2.log("Verifier:", verifier);
        console2.log("==================================================");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Contract
        identityRegister = new IdentityRegister(ICoreAgreement(coreAgreement));

        // 2. Set Initial Verifier
        identityRegister.setVerifier(verifier);

        vm.stopBroadcast();

        console2.log(" IdentityRegister deployed to:", address(identityRegister));
    }
}