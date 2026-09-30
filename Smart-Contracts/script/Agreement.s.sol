// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {AgreementRegistry} from "../src/core/AgreementRegistry.sol";

contract DeployAgreementRegistry is Script {
    function run() external returns (AgreementRegistry registry) {
        address identityRegister = vm.envAddress("IDENTITY_REGISTER_ADDRESS");

        vm.startBroadcast();
        registry = new AgreementRegistry(identityRegister);
        vm.stopBroadcast();

        console2.log("AgreementRegistry deployed to:", address(registry));
        console2.log("IdentityRegister linked:", address(registry.identityRegister()));
    }
}