// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDT
 * @notice Mock Tether ERC20 token with 6 decimals for local testing and testnets.
 */
contract MockUSDT is ERC20, Ownable {
    uint8 private immutable _decimals;

    /**
     * @param initialSupply Amount of tokens to mint to deployer (e.g. 1000000 for 1M tokens)
     */
    constructor(uint256 initialSupply) ERC20("Tether USD", "USDT") Ownable(msg.sender) {
        _decimals = 6; // Real USDT uses 6 decimals instead of standard 18
        _mint(msg.sender, initialSupply * (10 ** _decimals));
    }

    /**
     * @notice Overrides standard ERC20 decimals to match USDT's 6 decimals.
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Faucet function allowing anyone to mint test tokens for testing EscrowCore.
     * @param to Recipient address
     * @param amount Token amount without decimals (e.g. 100 = 100 USDT)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount * (10 ** _decimals));
    }
}