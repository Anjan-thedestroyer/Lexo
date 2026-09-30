// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol"; // Adjust path to match your contract location

contract DeployMockUSDT is Script {
    function run() external returns (MockUSDT usdt) {
        // Read private key from environment variable or active sender
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying MockUSDT with account:", deployer);

        uint256 initialSupply = 2_000_000; // Mint 2,000,000 USDT to msg.sender

        vm.startBroadcast(deployerPrivateKey);
        usdt = new MockUSDT(initialSupply);
        vm.stopBroadcast();

        console.log("MockUSDT deployed to:", address(usdt));
        console.log("Deployer balance:", usdt.balanceOf(deployer) / 10**usdt.decimals(), "USDT");
    }
}