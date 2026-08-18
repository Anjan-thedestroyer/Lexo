// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IArbitrationRegister
 * @notice Interface for the ArbitratorRegistry contract.
 */
interface IArbitrationRegister {
    // --- Structs ---

    struct Arbitrator {
        address wallet;
        uint256 stake;
        uint256 activeCases;
        uint256 reputation;
        uint256 unstakeRequestedAt;
        bool active;
        bool suspended;
    }

    // --- Events ---

    event ArbitratorAdded(bytes32 indexed identityHash, address indexed wallet, uint256 stake);
    event StakeIncreased(bytes32 indexed identityHash, address indexed wallet, uint256 addedAmount, uint256 newTotalStake);
    event UnstakeRequested(bytes32 indexed identityHash, address indexed wallet, uint256 timestamp);
    event UnstakeCompleted(bytes32 indexed identityHash, address indexed wallet, uint256 amountReturned);
    event Slashed(bytes32 indexed identityHash, address indexed wallet, uint256 amount, address indexed recipient);
    event ReputationUpdated(bytes32 indexed identityHash, uint256 newReputation);
    event CaseAssigned(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event CaseFinished(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event StatusChanged(bytes32 indexed identityHash, bool suspended, bool active);
    event WalletChanged(bytes32 indexed identityHash, address indexed oldWallet, address indexed newWallet);
    event ArbitratorSelected(uint256 indexed caseId, address indexed wallet, uint256 randomIndex, uint256 poolSize);

    // --- Custom Errors ---

    error Unauthorized();
    error UserNotVerified();
    error IdentityAlreadyRegistered();
    error NotRegistered();
    error NotEnoughStake();
    error InvalidAmount();
    error ActiveCasesPending();
    error UnstakeAlreadyRequested();
    error UnstakeNotRequested();
    error UnstakeCooldownActive();
    error NotEnoughEligibleArbitrators();

    // --- State Variable Getters ---

    function token() external view returns (address);

    function identityRegister() external view returns (address);

    function arbitrationCourt() external view returns (address);

    function MINIMUM_STAKE() external view returns (uint256);

    function UNSTAKE_COOL_DOWN() external view returns (uint256);

    function MAX_ACTIVE_CASES() external view returns (uint256);

    function arbitrators(bytes32 identityHash)
        external
        view
        returns (
            address wallet,
            uint256 stake,
            uint256 activeCases,
            uint256 reputation,
            uint256 unstakeRequestedAt,
            bool active,
            bool suspended
        );

    function arbitratorToIdentity(address wallet) external view returns (bytes32);

    function eligiblePool(uint256 index) external view returns (address);

    function arbitratorList(uint256 index) external view returns (address);

    function selectionNonce() external view returns (uint256);

    // --- External / State-Changing Functions ---

    function setArbitrationCourt(address _court) external;

    function addArbitrator(uint256 _stake) external;

    function changeWallet(address _toWallet) external;

    function increaseStake(uint256 _stake) external;

    function requestUnstake() external;

    function unstake() external;

    function slash(
        address _arbitratorWallet,
        uint256 _amount,
        address _recipient
    ) external;

    function reactivate() external;

    function updateReputation(address _arbitratorWallet, int256 _delta) external;

    function assignCase(address _arbitratorWallet) external;

    function finishCase(address _arbitratorWallet) external;

    function assignRandomCase(uint256 _caseId) external returns (address selected);

    // --- View Functions ---

    function isEligible(address _arbitratorWallet) external view returns (bool);

    function getEligiblePoolSize() external view returns (uint256);
}