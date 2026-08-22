// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IEscrowCore} from "../../src/interfaces/IEscrowCore.sol"; // Optional interface reference if available

/**
 * @title MockEscrowCore
 * @dev Lightweight mock simulating EscrowCore state transitions, callbacks, and balances for unit tests.
 */
contract MockEscrowCore {
    enum Status {
        InProgress,
        Disputed,
        Completed,
        Resolved,
        Cancelled
    }

    struct Deal {
        address payer;
        address payee;
        uint256 totalBalance;
        uint256 totalMilestones;
        uint8 currentMilestone;
        Status status;
    }

    struct Milestone {
        string description;
        uint256 amount;
        bool isCompleted;
    }

    uint256 public dealCount;
    address public agreementRegistry;
    address public token;
    
    mapping(uint256 => Deal) public deals;
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;
    mapping(uint256 => bool) public payeeSynced;
    mapping(address => uint256) public pendingWithdrawals;

    event PayeeSyncedMock(uint256 indexed dealId, address indexed payee);
    event DealCreatedMock(uint256 indexed dealId, address indexed payer, uint256 totalBalance);

    constructor(address _agreementRegistry, address _token) {
        agreementRegistry = _agreementRegistry;
        token = _token;
    }

    // --- Core Interaction Stubs ---

    /// @notice Allows test scripts to configure artificial deals
    function setDeal(
        uint256 dealId,
        address payer,
        address payee,
        uint256 totalBalance,
        Status status
    ) external {
        deals[dealId] = Deal({
            payer: payer,
            payee: payee,
            totalBalance: totalBalance,
            totalMilestones: 1,
            currentMilestone: 0,
            status: status
        });
    }

    /// @notice Callback implementation expected by AgreementRegistry
    function syncPayeeFromRegistry(uint256 dealId) external {
        payeeSynced[dealId] = true;
        
        // Simulating payee retrieval from AgreementRegistry interface
        (bool success, bytes memory data) = agreementRegistry.staticcall(
            abi.encodeWithSignature("dealPayee(uint256)", dealId)
        );
        
        if (success && data.length > 0) {
            address payee = abi.decode(data, (address));
            deals[dealId].payee = payee;
            emit PayeeSyncedMock(dealId, payee);
        }
    }

    /// @notice Mock function to manually force pending withdrawal balances
    function setPendingWithdrawal(address user, uint256 amount) external {
        pendingWithdrawals[user] = amount;
    }

    // --- Mock View Getters ---

    function getDealTotalBalance(uint256 dealId) external view returns (uint256) {
        return deals[dealId].totalBalance;
    }

    function isDealInProgress(uint256 dealId) external view returns (bool) {
        return deals[dealId].status == Status.InProgress;
    }
}