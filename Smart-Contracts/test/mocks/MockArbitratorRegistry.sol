// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArbitrationRegister} from "../../src/interfaces/IArbitrationRegister.sol";

/**
 * @title MockArbitratorRegistry
 * @dev Mock contract for testing arbitration courts or systems dependent on ArbitratorRegistry.
 */
contract MockArbitratorRegistry is IArbitrationRegister {
    address public override token;
    address public override identityRegister;
    address public override arbitrationCourt;

    // Custom test toggles
    mapping(address => bool) private _mockEligibility;
    mapping(address => uint256) public mockActiveCases;
    mapping(address => uint256) public mockReputation;
    mapping(address => uint256) public mockStake;

    address[] public mockEligiblePool;
    address public forcedRandomSelection;
    
    constructor(address _identityRegister, address _token) {
        identityRegister = _identityRegister;
        token = _token;
    }

    // --- Test Configuration Helpers ---

    function setMockEligibility(address wallet, bool eligible) external {
        _mockEligibility[wallet] = eligible;
    }

    function setMockEligiblePool(address[] calldata pool) external {
        mockEligiblePool = pool;
    }

    function setForcedRandomSelection(address arbitrator) external {
        forcedRandomSelection = arbitrator;
    }

    function setMockStake(address wallet, uint256 stakeAmount) external {
        mockStake[wallet] = stakeAmount;
    }

    // --- Interface Implementations ---

    function setArbitrationCourt(address _court) external override {
        arbitrationCourt = _court;
    }

    function isEligible(address _arbitratorWallet) external view override returns (bool) {
        return _mockEligibility[_arbitratorWallet];
    }

    function getEligiblePoolSize() external view override returns (uint256) {
        return mockEligiblePool.length;
    }

    function assignRandomCase(uint256 _caseId) external override returns (address selected) {
        if (mockEligiblePool.length == 0 && forcedRandomSelection == address(0)) {
            revert NotEnoughEligibleArbitrators();
        }

        selected = forcedRandomSelection != address(0) ? forcedRandomSelection : mockEligiblePool[0];
        mockActiveCases[selected] += 1;

        emit CaseAssigned(bytes32(0), selected, mockActiveCases[selected]);
        emit ArbitratorSelected(_caseId, selected, 0, mockEligiblePool.length);
    }

    function assignCase(address _arbitratorWallet) external override {
        mockActiveCases[_arbitratorWallet] += 1;
        emit CaseAssigned(bytes32(0), _arbitratorWallet, mockActiveCases[_arbitratorWallet]);
    }

    function finishCase(address _arbitratorWallet) external override {
        if (mockActiveCases[_arbitratorWallet] > 0) {
            mockActiveCases[_arbitratorWallet] -= 1;
        }
        emit CaseFinished(bytes32(0), _arbitratorWallet, mockActiveCases[_arbitratorWallet]);
    }

    function slash(address _arbitratorWallet, uint256 _amount, address _recipient) external override {
        if (_amount > mockStake[_arbitratorWallet]) {
            revert SlashAmountExceedsStake(_amount, mockStake[_arbitratorWallet]);
        }
        mockStake[_arbitratorWallet] -= _amount;
        emit Slashed(bytes32(0), _arbitratorWallet, _amount, _recipient);
    }

    function updateReputation(address _arbitratorWallet, int256 _delta) external override {
        if (_delta < 0) {
            uint256 penalty = uint256(-_delta);
            mockReputation[_arbitratorWallet] = mockReputation[_arbitratorWallet] > penalty 
                ? mockReputation[_arbitratorWallet] - penalty 
                : 0;
        } else {
            mockReputation[_arbitratorWallet] += uint256(_delta);
        }
        emit ReputationUpdated(bytes32(0), mockReputation[_arbitratorWallet]);
    }

    // --- Empty Stubs for Non-Court User Methods ---

    function addArbitrator(uint256 _stake) external override {}
    function changeWallet(address _toWallet) external override {}
    function increaseStake(uint256 _stake) external override {}
    function requestUnstake() external override {}
    function unstake() external override {}
    function reactivate() external override {}
}