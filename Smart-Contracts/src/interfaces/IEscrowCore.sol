// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IEscrowCore
 * @notice Interface for the EscrowCore contract.
 */
interface IEscrowCore {
    // --- Enums ---

    enum Status {
        InProgress,
        Disputed,
        Completed,
        Resolved,
        Cancelled
    }

    // --- Structs ---

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

    struct Dispute {
        uint256 dealId;
        address raisor;
        string reason;
    }

    // --- Events ---

    event DealCreated(
        uint256 indexed dealId,
        address indexed payer,
        uint256 totalBalance
    );
    event MilestoneReleased(
        uint256 indexed dealId,
        uint256 indexed milestoneId,
        uint256 amountReleased
    );
    event DealCompleted(uint256 indexed dealId);
    event DisputeRaised(
        address indexed raisor,
        uint256 indexed dealId,
        string reason,
        uint256 caseId,
        uint256 arbitrationFee
    );
    event DisputeResolved(
        uint256 indexed dealId,
        uint256 payerAmount,
        uint256 payeeAmount
    );
    event FundsWithdrawn(address indexed user, uint256 amount);
    event FeeCollected(address indexed withdrawnFrom, uint256 feeAmount);
    event PayeeSynced(uint256 indexed dealId, address indexed payee);
    event DealCancelled(uint256 indexed dealId, address indexed cancelledBy);
    event FeeRecipientUpdated(
        address indexed oldRecipient,
        address indexed newRecipient
    );
    event DisputeReRaised(
        address indexed raisor,
        uint256 indexed dealId,
        string reason,
        uint256 caseId
    );

    // --- Errors ---

    error LengthMismatch();
    error InvalidMilestoneCount();
    error InvalidAddress();
    error NotAuthorized();
    error InvalidDealStatus();
    error NothingToWithdraw();
    error InsufficientBalance();
    error AllMilestonesCompleted();
    error PayeeNotVerified();
    error UserNotVerified();
    error ArbiterRequired();
    error PayeeAlreadyAssigned();
    error PayeeNotSelected();
    error InvalidDealId();
    error InvalidSignature();
    error SignatureExpired();
    error AgreementsNotSigned();

    // --- State Variable Getters ---

    function token() external view returns (address);

    function identityRegister() external view returns (address);

    function arbiter() external view returns (address);

    function agreementRegistry() external view returns (address);

    function feeRecipient() external view returns (address);

    function MAX_MILESTONES() external view returns (uint256);

    function FEE_BPS() external view returns (uint256);

    function BPS_DENOMINATOR() external view returns (uint256);

    function CANCEL_DEAL_TYPEHASH() external view returns (bytes32);

    function dealCount() external view returns (uint256);

    function deals(uint256 dealId)
        external
        view
        returns (
            address payer,
            address payee,
            uint256 totalBalance,
            uint256 totalMilestones,
            uint8 currentMilestone,
            Status status
        );

    function milestones(uint256 dealId, uint256 milestoneId)
        external
        view
        returns (
            string memory description,
            uint256 amount,
            bool isCompleted
        );

    function pendingWithdrawals(address user) external view returns (uint256);

    function disputeLogs(uint256 dealId)
        external
        view
        returns (
            uint256 dealIdOut,
            address raisor,
            string memory reason
        );

    function nonces(address user) external view returns (uint256);

    function invitedPayees(
        uint256 dealId,
        uint256 index
    ) external view returns (address);

    // --- External / State-Changing Functions ---

    function setFeeRecipient(address _newFeeRecipient) external;

    function withdraw() external;

    function createDeal(
        string[] memory _description,
        uint256[] memory _amount,
        address[] memory _invitedPayees,
        bytes32 _documentHash
    ) external;

    function syncPayeeFromRegistry(uint256 _dealId) external;

    function approveAndReleaseMilestone(uint256 _dealId) external;

    function raiseDispute(
        uint256 _dealId,
        string calldata _reason
    ) external;

    function reRaiseDispute(
        uint256 _dealId,
        string calldata _reason,
        uint256 _caseId
    ) external;

    function resolveDispute(
        uint256 _dealId,
        uint256 _payerAmount,
        uint256 _payeeAmount
    ) external;

    function cancelDeal(
        uint256 _dealId,
        uint256 _deadline,
        bytes calldata _payerSignature,
        bytes calldata _payeeSignature
    ) external;

    // --- View Functions ---

    function getInvitedPayees(
        uint256 _dealId
    ) external view returns (address[] memory);

    function getInvitedDeals(
        address _payee
    ) external view returns (uint256[] memory);

    function getPayerDeals(
        address _payer
    ) external view returns (uint256[] memory);

    function getPayeeDeals(
        address _payee
    ) external view returns (uint256[] memory);

    function getDealTotalBalance(uint256 _dealId) external view returns (uint256);
}