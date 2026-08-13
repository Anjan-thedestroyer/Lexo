// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {IArbitrationCourt} from "../interfaces/IArbitrationCourt.sol";
import {IAgreementRegistry} from "../interfaces/IAgreement.sol";

/**
 * @title Lexo EscrowCore
 * @author Abinash Paudel
 * @notice Milestone-based escrow engine with per-milestone instant releases and EIP-712 cooperative cancellations.
 */
contract EscrowCore is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice Hardcoded token instance
    IERC20 public immutable token;

    IIdentityRegister public identityRegister;
    IArbitrationCourt public arbiter;
    IAgreementRegistry public agreementRegistry;

    uint256 public constant MAX_MILESTONES = 15;
    uint256 public constant FEE_BPS = 30; // 0.3% fee in basis points (30 / 10_000)
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice EIP-712 Typehash for Cancellation including deadline
    bytes32 public constant CANCEL_DEAL_TYPEHASH =
        keccak256("CancelDeal(uint256 dealId,uint256 nonce,uint256 deadline)");

    // Custom Errors
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
    error InvalidDealId();
    error InvalidSignature();
    error SignatureExpired();

    enum Status { InProgress, Disputed, Completed, Resolved, Cancelled }

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

    // State Variables
    uint256 public dealCount;
    mapping(uint256 => Deal) public deals;
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(uint256 => Dispute) public disputeLogs;
    mapping(address => uint256) public nonces;
    mapping(uint256 => address[]) public invitedPayees;

    // Events
    event DealCreated(uint256 indexed dealId, address indexed payer, uint256 totalBalance);
    event MilestoneReleased(uint256 indexed dealId, uint256 indexed milestoneId, uint256 amountReleased);
    event DealCompleted(uint256 indexed dealId);
    event DisputeRaised(address indexed raisor, uint256 indexed dealId, string reason);
    event DisputeResolved(uint256 indexed dealId, uint256 payerAmount, uint256 payeeAmount);
    event FundsWithdrawn(address indexed user, uint256 amount);
    event FeeCollected(address indexed withdrawnFrom, uint256 amount);
    event PayeeJoined(uint256 indexed dealId, address indexed payee);
    event DealCancelled(uint256 indexed dealId, address indexed cancelledBy);
    
    constructor(
        address _token,
        address _identityRegister,
        address _arbiter,
        address _coreAgreement
    ) Ownable(msg.sender) EIP712("Lexo EscrowCore", "1") {
        if (_token == address(0) || _identityRegister == address(0) || _arbiter == address(0) || _coreAgreement == address(0)) {
            revert InvalidAddress();
        }
        token = IERC20(_token);
        identityRegister = IIdentityRegister(_identityRegister);
        arbiter = IArbitrationCourt(_arbiter);
        agreementRegistry = IAgreementRegistry(_coreAgreement);
    }

    modifier onlyVerified() {
        if (!identityRegister.isVerified(msg.sender)) revert UserNotVerified();
        _;
    }

    /**
     * @notice Pull-pattern claim function for users to claim owed tokens.
     */
    function withdraw() external onlyVerified nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;

        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;

        token.safeTransfer(msg.sender, netAmount);

        if (fee > 0) {
            token.safeTransfer(owner(), fee);
            emit FeeCollected(msg.sender, fee);
        }

        emit FundsWithdrawn(msg.sender, netAmount);
    }

    /**
     * @notice Creates an escrow deal backed by ERC20 token.
     */
    function createDeal(
        string[] memory _description,
        uint256[] memory _amount,
        address[] memory _invitedPayees,
        bytes32  _documentHash,
        bytes calldata _payerSignature
    ) external onlyVerified nonReentrant {
        if (_description.length != _amount.length) revert LengthMismatch();
        if (_amount.length == 0 || _amount.length > MAX_MILESTONES) revert InvalidMilestoneCount();

        uint256 total = 0;
        for (uint256 i = 0; i < _amount.length; i++) {
            total += _amount[i];
        }

        dealCount++;
        deals[dealCount] = Deal({
            payer: msg.sender,
            payee: address(0),
            totalBalance: total,
            totalMilestones: _amount.length,
            currentMilestone: 0,
            status: Status.InProgress
        });

        for (uint256 i = 0; i < _amount.length; i++) {
            milestones[dealCount][i] = Milestone({
                description: _description[i],
                amount: _amount[i],
                isCompleted: false
            });
        }
        if(_invitedPayees.length > 0) {
            invitedPayees[dealCount] = _invitedPayees;
        }

        token.safeTransferFrom(msg.sender, address(this), total);

        agreementRegistry.submitPayerDocument(dealCount, _documentHash);

        emit DealCreated(dealCount, msg.sender, total);

    }

    /**
     * @notice Allows a verified payee to join an open deal.
     */
    function joinDeal(uint256 _dealId) external onlyVerified {
        Deal storage deal = deals[_dealId];

        if (deal.payer == msg.sender) revert InvalidAddress();
        if (deal.payee != address(0)) revert PayeeAlreadyAssigned();
        if (deal.status != Status.InProgress) revert InvalidDealStatus();

        deal.payee = msg.sender;

        emit PayeeJoined(_dealId, msg.sender);
    }

    function getInvitedPayees(uint256 _dealId) external view returns (address[] memory) {
        return invitedPayees[_dealId];
    }

    function acceptInvitation(uint256 _dealId) external onlyVerified{
        
        Deal storage deal = deals[_dealId];

        if (deal.payer == msg.sender) revert InvalidAddress();
        if (deal.payee != address(0)) revert PayeeAlreadyAssigned();
        if (deal.status != Status.InProgress) revert InvalidDealStatus();

        // Check if the sender is in the invited payees list
        address[] storage invited = invitedPayees[_dealId];
        bool isInvited = false;
        for (uint256 i = 0; i < invited.length; i++) {
            if (invited[i] == msg.sender) {
                isInvited = true;
                break;
            }
        }
        if (!isInvited) revert NotAuthorized();

        deal.payee = msg.sender;

        emit PayeeJoined(_dealId, msg.sender);
    }

    /**
     * @notice Payer approves current milestone -> immediately releases milestone funds to payee.
     */
    function approveAndReleaseMilestone(uint256 _dealId) external onlyVerified nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.payer != msg.sender) revert NotAuthorized();
        if (deal.status != Status.InProgress) revert InvalidDealStatus();

        uint256 currentId = deal.currentMilestone;
        if (currentId >= deal.totalMilestones) revert AllMilestonesCompleted();

        Milestone storage milestone = milestones[_dealId][currentId];
        uint256 amount = milestone.amount;

        if (deal.totalBalance < amount) revert InsufficientBalance();

        // Update State
        milestone.isCompleted = true;
        deal.currentMilestone += 1;
        deal.totalBalance -= amount;

        // Credit Payee's withdrawable balance immediately for THIS milestone
        pendingWithdrawals[deal.payee] += amount;

        emit MilestoneReleased(_dealId, currentId, amount);

        // Finalize deal when the last milestone is approved
        if (deal.currentMilestone == deal.totalMilestones) {
            deal.status = Status.Completed;
            emit DealCompleted(_dealId);
        }
    }

    /**
     * @notice Raises a dispute if an issue arises between payer and payee.
     */
    function raiseDispute(uint256 _dealId, string calldata _reason) external onlyVerified {
        Deal storage deal = deals[_dealId];
        if (deal.payee != msg.sender && deal.payer != msg.sender) revert NotAuthorized();
        if (deal.status != Status.InProgress) revert InvalidDealStatus();

        deal.status = Status.Disputed;
        disputeLogs[_dealId] = Dispute({
            dealId: _dealId,
            raisor: msg.sender,
            reason: _reason
        });
        arbiter.createCase(_dealId, _reason);

        emit DisputeRaised(msg.sender, _dealId, _reason);
    }

    /**
     * @notice Allows arbitration court to resolve a dispute on the REMAINING balance.
     */
    function resolveDispute(
        uint256 _dealId,
        uint256 _payerAmount,
        uint256 _payeeAmount
    ) external nonReentrant {
        if (msg.sender != address(arbiter)) revert ArbiterRequired();
        Deal storage deal = deals[_dealId];
        if (deal.status != Status.Disputed) revert InvalidDealStatus();
        if (_payerAmount + _payeeAmount != deal.totalBalance) revert LengthMismatch();

        deal.totalBalance = 0;
        deal.status = Status.Resolved;

        if (_payerAmount > 0) {
            pendingWithdrawals[deal.payer] += _payerAmount;
        }
        if (_payeeAmount > 0) {
            pendingWithdrawals[deal.payee] += _payeeAmount;
        }

        emit DisputeResolved(_dealId, _payerAmount, _payeeAmount);
    }

    /**
     * @notice Cancels a deal.
     * @dev Unilateral cancellation by payer if payee has not joined yet.
     *      Requires off-chain EIP-712 signatures from BOTH payer and payee if payee has joined.
     */
    function cancelDeal(
        uint256 _dealId,
        uint256 _deadline,
        bytes calldata _payerSignature,
        bytes calldata _payeeSignature
    ) external onlyVerified nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.status != Status.InProgress) revert InvalidDealStatus();

        if (deal.payee == address(0)) {
            // Unilateral cancellation by payer before payee joins
            if (deal.payer != msg.sender) revert NotAuthorized();
        } else {
            // Check signature expiry
            if (block.timestamp > _deadline) revert SignatureExpired();

            // 1. Verify Payer Signature
            bytes32 payerStructHash = keccak256(
                abi.encode(CANCEL_DEAL_TYPEHASH, _dealId, nonces[deal.payer], _deadline)
            );
            bytes32 payerTypedHash = _hashTypedDataV4(payerStructHash);
            address recoveredPayer = ECDSA.recover(payerTypedHash, _payerSignature);
            if (recoveredPayer != deal.payer) revert InvalidSignature();

            // 2. Verify Payee Signature
            bytes32 payeeStructHash = keccak256(
                abi.encode(CANCEL_DEAL_TYPEHASH, _dealId, nonces[deal.payee], _deadline)
            );
            bytes32 payeeTypedHash = _hashTypedDataV4(payeeStructHash);
            address recoveredPayee = ECDSA.recover(payeeTypedHash, _payeeSignature);
            if (recoveredPayee != deal.payee) revert InvalidSignature();

            // 3. Increment nonces to consume signatures
            nonces[deal.payer]++;
            nonces[deal.payee]++;
        }

        // 4. Update deal state
        deal.status = Status.Cancelled;

        // Refund remaining unreleased balance to payer
        if (deal.totalBalance > 0) {
            pendingWithdrawals[deal.payer] += deal.totalBalance;
            deal.totalBalance = 0;
        }

        emit DealCancelled(_dealId, msg.sender);
    }
}