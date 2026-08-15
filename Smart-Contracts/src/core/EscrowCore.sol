// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {IArbitrationCourt} from "../interfaces/IArbitrationCourt.sol";
import {IAgreementRegistry} from "../interfaces/IAgreement.sol";

/**
 * @title Lexo EscrowCore
 * @author Abinash Paudel
 * @notice Milestone-based escrow engine integrated directly with AgreementRegistry.
 */
contract EscrowCore is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice Hardcoded token instance
    IERC20 public immutable token;

    IIdentityRegister public identityRegister;
    IArbitrationCourt public arbiter;
    IAgreementRegistry public agreementRegistry;

    /// @notice Dedicated treasury address for collecting fees
    address public feeRecipient;

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
    error PayeeNotSelected();
    error InvalidDealId();
    error InvalidSignature();
    error SignatureExpired();
    error AgreementsNotSigned();

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
    mapping(address => uint256[]) private _invitedDeals;
    mapping(address => uint256[]) private _payerDeals;
    mapping(address => uint256[]) private _payeeDeals;

    // Events
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
        uint256 caseId
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

    modifier onlyVerified() {
        if (!identityRegister.isVerified(msg.sender)) revert UserNotVerified();
        _;
    }

    modifier onlyAgreementRegistry() {
        if (msg.sender != address(agreementRegistry)) revert NotAuthorized();
        _;
    }

    constructor(
        address _token,
        address _identityRegister,
        address _arbiter,
        address _agreementRegistry,
        address _feeRecipient
    ) Ownable(msg.sender) EIP712("Lexo EscrowCore", "1") {
        if (
            _token == address(0) ||
            _identityRegister == address(0) ||
            _arbiter == address(0) ||
            _agreementRegistry == address(0) ||
            _feeRecipient == address(0)
        ) {
            revert InvalidAddress();
        }
        token = IERC20(_token);
        identityRegister = IIdentityRegister(_identityRegister);
        arbiter = IArbitrationCourt(_arbiter);
        agreementRegistry = IAgreementRegistry(_agreementRegistry);
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Allows the contract owner to update the treasury fee recipient address.
     */
    function setFeeRecipient(address _newFeeRecipient) external onlyOwner {
        if (_newFeeRecipient == address(0)) revert InvalidAddress();
        emit FeeRecipientUpdated(feeRecipient, _newFeeRecipient);
        feeRecipient = _newFeeRecipient;
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
            token.safeTransfer(feeRecipient, fee);
            emit FeeCollected(msg.sender, fee);
        }

        emit FundsWithdrawn(msg.sender, netAmount);
    }

    /**
     * @notice Creates an escrow deal backed by ERC20 token, submits Document A, and signs it.
     */
    function createDeal(
        string[] memory _description,
        uint256[] memory _amount,
        address[] memory _invitedPayees,
        bytes32 _documentHash
    ) external onlyVerified nonReentrant {
        uint256 len = _amount.length;
        if (_description.length != len) revert LengthMismatch();
        if (len == 0 || len > MAX_MILESTONES) revert InvalidMilestoneCount();

        uint256 total = 0;
        for (uint256 i = 0; i < len; i++) {
            total += _amount[i];
        }

        dealCount++;
        uint256 currentDealId = dealCount;

        deals[currentDealId] = Deal({
            payer: msg.sender,
            payee: address(0),
            totalBalance: total,
            totalMilestones: len,
            currentMilestone: 0,
            status: Status.InProgress
        });

        _payerDeals[msg.sender].push(currentDealId);

        for (uint256 i = 0; i < len; i++) {
            milestones[currentDealId][i] = Milestone({
                description: _description[i],
                amount: _amount[i],
                isCompleted: false
            });
        }

        uint256 payeesLen = _invitedPayees.length;
        if (payeesLen > 0) {
            invitedPayees[currentDealId] = _invitedPayees;
            for (uint256 i = 0; i < payeesLen; i++) {
                _invitedDeals[_invitedPayees[i]].push(currentDealId);
            }
        }

        token.safeTransferFrom(msg.sender, address(this), total);
        agreementRegistry.submitPayerDocument(currentDealId, _documentHash);

        emit DealCreated(currentDealId, msg.sender, total);
    }

    /**
     * @notice Callback called by AgreementRegistry when Payer accepts a candidate Payee's Document B.
     */
    function syncPayeeFromRegistry(
        uint256 _dealId
    ) external onlyAgreementRegistry {
        Deal storage deal = deals[_dealId];
        if (deal.status != Status.InProgress) revert InvalidDealStatus();
        if (deal.payee != address(0)) revert PayeeAlreadyAssigned();

        address selectedPayee = agreementRegistry.dealPayee(_dealId);
        if (selectedPayee == address(0)) revert PayeeNotSelected();

        if (!identityRegister.isVerified(selectedPayee))
            revert PayeeNotVerified();

        deal.payee = selectedPayee;
        _payeeDeals[selectedPayee].push(_dealId);

        emit PayeeSynced(_dealId, selectedPayee);
    }

    function getInvitedPayees(
        uint256 _dealId
    ) external view returns (address[] memory) {
        return invitedPayees[_dealId];
    }

    function getInvitedDeals(
        address _payee
    ) external view returns (uint256[] memory) {
        return _invitedDeals[_payee];
    }

    function getPayerDeals(
        address _payer
    ) external view returns (uint256[] memory) {
        return _payerDeals[_payer];
    }

    function getPayeeDeals(
        address _payee
    ) external view returns (uint256[] memory) {
        return _payeeDeals[_payee];
    }

    /**
     * @notice Payer approves current milestone -> releases funds once both parties have signed both documents.
     */
    function approveAndReleaseMilestone(
        uint256 _dealId
    ) external onlyVerified nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.payer != msg.sender) revert NotAuthorized();
        if (deal.status != Status.InProgress) revert InvalidDealStatus();
        if (!agreementRegistry.haveBothSigned(_dealId))
            revert AgreementsNotSigned();

        uint256 currentId = deal.currentMilestone;
        if (currentId >= deal.totalMilestones) revert AllMilestonesCompleted();

        Milestone storage milestone = milestones[_dealId][currentId];
        uint256 amount = milestone.amount;

        if (deal.totalBalance < amount) revert InsufficientBalance();

        milestone.isCompleted = true;
        deal.currentMilestone += 1;
        deal.totalBalance -= amount;

        pendingWithdrawals[deal.payee] += amount;

        emit MilestoneReleased(_dealId, currentId, amount);

        if (deal.currentMilestone == deal.totalMilestones) {
            deal.status = Status.Completed;
            emit DealCompleted(_dealId);
        }
    }

    /**
     * @notice Raises a dispute if an issue arises between payer and payee.
     */
    function raiseDispute(
        uint256 _dealId,
        string calldata _reason
    ) external onlyVerified {
        Deal storage deal = deals[_dealId];
        if (deal.payee != msg.sender && deal.payer != msg.sender)
            revert NotAuthorized();
        if (deal.status != Status.InProgress) revert InvalidDealStatus();
        (bytes32 docAHash, bytes32 docBHash) = agreementRegistry.getDocumentHashByDeal(_dealId);
        deal.status = Status.Disputed;
        disputeLogs[_dealId] = Dispute({
            dealId: _dealId,
            raisor: msg.sender,
            reason: _reason
        });
        uint256 caseId = arbiter.createCase(_dealId, _reason, docAHash, docBHash);

        emit DisputeRaised(msg.sender, _dealId, _reason, caseId);
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
        if (_payerAmount + _payeeAmount != deal.totalBalance)
            revert LengthMismatch();

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
            if (deal.payer != msg.sender) revert NotAuthorized();
        } else {
            if (block.timestamp > _deadline) revert SignatureExpired();

            bytes32 payerStructHash = keccak256(
                abi.encode(
                    CANCEL_DEAL_TYPEHASH,
                    _dealId,
                    nonces[deal.payer],
                    _deadline
                )
            );
            bytes32 payerTypedHash = _hashTypedDataV4(payerStructHash);
            address recoveredPayer = ECDSA.recover(
                payerTypedHash,
                _payerSignature
            );
            if (recoveredPayer != deal.payer) revert InvalidSignature();

            bytes32 payeeStructHash = keccak256(
                abi.encode(
                    CANCEL_DEAL_TYPEHASH,
                    _dealId,
                    nonces[deal.payee],
                    _deadline
                )
            );
            bytes32 payeeTypedHash = _hashTypedDataV4(payeeStructHash);
            address recoveredPayee = ECDSA.recover(
                payeeTypedHash,
                _payeeSignature
            );
            if (recoveredPayee != deal.payee) revert InvalidSignature();

            nonces[deal.payer]++;
            nonces[deal.payee]++;
        }

        deal.status = Status.Cancelled;

        if (deal.totalBalance > 0) {
            pendingWithdrawals[deal.payer] += deal.totalBalance;
            deal.totalBalance = 0;
        }

        emit DealCancelled(_dealId, msg.sender);
    }
}