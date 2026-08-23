// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title MockArbitratorRegistry
 * @dev Standalone mock contract for testing arbitration courts or systems dependent on ArbitratorRegistry.
 */
contract MockArbitratorRegistry {
    address public token;
    address public identityRegister;
    address public arbitrationCourt;

    error CallerNotCourt(address caller, address expectedCourt);
    error CallerIsOwner();
    error UserNotVerified(address wallet);
    error IdentityAlreadyRegistered(bytes32 identityHash, address existingWallet);
    error WalletAlreadyInUse(address wallet);
    error ArbitratorNotRegistered(address wallet);
    error InsufficientStake(uint256 provided, uint256 required);
    error SlashAmountExceedsStake(uint256 attemptedSlash, uint256 currentStake);
    error ZeroAmountProvided();
    error ActiveCasesPending(address wallet, uint256 activeCases);
    error UnstakeAlreadyRequested(address wallet, uint64 requestedAt);
    error UnstakeNotRequested(address wallet);
    error UnstakeCooldownActive(uint64 requestedAt, uint64 readyAt);
    error NotEnoughEligibleArbitrators();
    error WalletMismatch(address wallet, address recordedWallet);
    error InvalidTargetWallet(address targetWallet);
    error IdentityMismatch(bytes32 sourceIdentity, bytes32 targetIdentity);

    event ArbitratorAdded(bytes32 indexed identityHash, address indexed wallet, uint256 stake);
    event StakeIncreased(bytes32 indexed identityHash, address indexed wallet, uint256 addedAmount, uint256 newTotalStake);
    event UnstakeRequested(bytes32 indexed identityHash, address indexed wallet, uint64 timestamp);
    event UnstakeCompleted(bytes32 indexed identityHash, address indexed wallet, uint256 amountReturned);
    event Slashed(bytes32 indexed identityHash, address indexed wallet, uint256 amount, address indexed recipient);
    event ReputationUpdated(bytes32 indexed identityHash, uint256 newReputation);
    event CaseAssigned(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event CaseFinished(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event StatusChanged(bytes32 indexed identityHash, bool suspended, bool active);
    event WalletChanged(bytes32 indexed identityHash, address indexed oldWallet, address indexed newWallet);
    event ArbitratorSelected(uint256 indexed caseId, address indexed wallet, uint256 randomIndex, uint256 poolSize);

    // Test state tracking & helpers
    mapping(address => bool) private _mockEligibility;
    mapping(address => uint256) public mockActiveCases;
    mapping(address => uint256) public mockReputation;
    mapping(address => uint256) public mockStake;

    address[] public mockEligiblePool;
    uint256 private _selectionIndex;
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
        _selectionIndex = 0;

        // Auto-assign default stake to prevent accidental slash reverts
        for (uint256 i = 0; i < pool.length; i++) {
            if (mockStake[pool[i]] == 0) {
                mockStake[pool[i]] = 1_000 * 1e6;
            }
            _mockEligibility[pool[i]] = true;
        }
    }

    function setForcedRandomSelection(address arbitrator) external {
        forcedRandomSelection = arbitrator;
    }

    function setMockStake(address wallet, uint256 stakeAmount) external {
        mockStake[wallet] = stakeAmount;
    }

    // --- Mock Implementation Methods ---

    function setArbitrationCourt(address _court) external {
        arbitrationCourt = _court;
    }

    function isEligible(address _arbitratorWallet) external view returns (bool) {
        return _mockEligibility[_arbitratorWallet];
    }

    function getEligiblePoolSize() external view returns (uint256) {
        return mockEligiblePool.length;
    }

    function assignRandomCase(uint256 _caseId) external returns (address selected) {
        if (mockEligiblePool.length == 0 && forcedRandomSelection == address(0)) {
            revert NotEnoughEligibleArbitrators();
        }

        if (forcedRandomSelection != address(0)) {
            selected = forcedRandomSelection;
        } else {
            selected = mockEligiblePool[_selectionIndex % mockEligiblePool.length];
            _selectionIndex++;
        }

        mockActiveCases[selected] += 1;

        emit CaseAssigned(bytes32(0), selected, mockActiveCases[selected]);
        emit ArbitratorSelected(_caseId, selected, _selectionIndex - 1, mockEligiblePool.length);
    }

    function assignCase(address _arbitratorWallet) external {
        mockActiveCases[_arbitratorWallet] += 1;
        emit CaseAssigned(bytes32(0), _arbitratorWallet, mockActiveCases[_arbitratorWallet]);
    }

    function finishCase(address _arbitratorWallet) external {
        if (mockActiveCases[_arbitratorWallet] > 0) {
            mockActiveCases[_arbitratorWallet] -= 1;
        }
        emit CaseFinished(bytes32(0), _arbitratorWallet, mockActiveCases[_arbitratorWallet]);
    }

    function slash(address _arbitratorWallet, uint256 _amount, address _recipient) external {
        if (_amount > mockStake[_arbitratorWallet]) {
            revert SlashAmountExceedsStake(_amount, mockStake[_arbitratorWallet]);
        }
        mockStake[_arbitratorWallet] -= _amount;
        emit Slashed(bytes32(0), _arbitratorWallet, _amount, _recipient);
    }

    function updateReputation(address _arbitratorWallet, int256 _delta) external {
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

    function addArbitrator(uint256 _stake) external {}
    function changeWallet(address _toWallet) external {}
    function increaseStake(uint256 _stake) external {}
    function requestUnstake() external {}
    function unstake() external {}
    function reactivate() external {}
}