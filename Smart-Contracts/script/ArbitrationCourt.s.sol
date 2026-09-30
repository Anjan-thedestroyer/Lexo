// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ArbitrationCourt} from "../src/arbitration/ArbitrationCourt.sol";

contract DeployArbitrationCourt is Script {
    function run() external returns (ArbitrationCourt court) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address token = vm.envAddress("TOKEN_ADDRESS");
        address identityRegister = vm.envAddress("IDENTITY_REGISTER_ADDRESS");
        address arbiterRegistry = vm.envAddress("ARBITER_REGISTRY_ADDRESS");
        address escrowCore = vm.envAddress("ESCROW_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        court = new ArbitrationCourt(
            token,
            identityRegister,
            arbiterRegistry,
            escrowCore
        );

        vm.stopBroadcast();

        console.log("ArbitrationCourt deployed to:", address(court));
    }
}