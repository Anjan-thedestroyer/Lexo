// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";

/**
 * @title Lexo EscrowCore Prototype
 * @author Abinash Paudel
 * @notice Milestone-based ERC20 escrow engine with pull-over-push claims.
 */
contract EscrowCore is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IIdentityRegister public identityRegister;
    uint256 public constant MAX_MILESTONES = 15;
    uint256 public constant FEE = 3; // 0.3% fee in basis points

    // Custom Errors
    error LengthMismatch();
    error InvalidMilestoneCount();
    error InvalidTokenAddress();
    error NotAuthorized();
    error InvalidDealStatus();
    error NothingToWithdraw();
    error InsufficientBalance();
    error AllMilestonesCompleted();

    enum Status { Created, InProgress, Disputed, Completed, Canceled, Refunded }

    struct Deal {
        address payer;
        address payee;
        IERC20 token;
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

    // State Variables
    uint256 public dealCount;
    mapping(uint256 => Deal) public deals;
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;
    mapping(address => mapping(IERC20 => uint256)) public pendingWithdrawals;

    // Events
    event DealCreated(uint256 indexed dealId, address indexed payee, address indexed payer, address token, uint256 totalBalance);
    event MilestoneCompleted(uint256 indexed dealId, uint256 indexed milestoneId, uint256 amountReleased);
    event DealCompleted(uint256 indexed dealId);
    event DisputeRaised(address indexed raisor, uint256 indexed dealId, string reason);
    event DisputeResolved(uint256 indexed dealId, uint256 payerAmount, uint256 payeeAmount);
    event FundsWithdrawn(address indexed user, address indexed token, uint256 amount);
    event FeeCollected(address indexed withdrawnFrom, address indexed token, uint256 amount);

    constructor(address _identityRegister) Ownable(msg.sender) {
        identityRegister = IIdentityRegister(_identityRegister);
    }

    modifier onlyVerified() {
        require(identityRegister.isVerified(msg.sender), "Not a verified user");
        _;
    }

    /**
     * @notice Pull-pattern claim function for users to claim owed ERC20 tokens.
     */
    function withdraw(IERC20 _token) external onlyVerified nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender][_token];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender][_token] = 0;
        uint256 fee = (amount * FEE) / 10000; // Calculate fee (0.3%)
        _token.safeTransfer(msg.sender, amount - fee);
        _token.safeTransfer(owner(), fee); // Transfer fee to owner

        emit FundsWithdrawn(msg.sender, address(_token), amount - fee);
        emit FeeCollected(msg.sender, address(_token), fee);
    }

    /**
     * @notice Creates an escrow deal backed by ERC20 stablecoins.
     */
    function createDeal(
        address _payee,
        IERC20 _token,
        string[] memory _description,
        uint256[] memory _amount
    ) external payable onlyVerified nonReentrant {
        if (_description.length != _amount.length) revert LengthMismatch();
        if (_amount.length == 0 || _amount.length > MAX_MILESTONES) revert InvalidMilestoneCount();
        if (address(_token) == address(0)) revert InvalidTokenAddress();

        uint256 total = 0;
        for (uint256 i = 0; i < _amount.length; i++) {
            total += _amount[i];
        }

        dealCount++;
        deals[dealCount] = Deal({
            payer: msg.sender,
            payee: _payee,
            token: _token,
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

        // Pull tokens from payer into contract vault
        _token.safeTransferFrom(msg.sender, address(this), total);

        emit DealCreated(dealCount, _payee, msg.sender, address(_token), total);
    }

    /**
     * @notice Completes milestones strictly in sequential order.
     */
    function completeMilestone(uint256 _dealId) external onlyVerified nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.payer != msg.sender) revert NotAuthorized();
        if (deal.status != Status.InProgress) revert InvalidDealStatus();

        uint256 currentId = deal.currentMilestone;
        if (currentId >= deal.totalMilestones) revert AllMilestonesCompleted();

        Milestone storage milestone = milestones[_dealId][currentId];

        uint256 amount = milestone.amount;
        if (deal.totalBalance < amount) revert InsufficientBalance();

        // Effects
        milestone.isCompleted = true;
        deal.currentMilestone += 1;
        deal.totalBalance -= amount;

        // Credit Payee Ledger
        pendingWithdrawals[deal.payee][deal.token] += amount;

        emit MilestoneCompleted(_dealId, currentId, amount);

        // Auto-complete deal if final milestone reached
        if (deal.currentMilestone == deal.totalMilestones) {
            deal.status = Status.Completed;
            emit DealCompleted(_dealId);
        }
    }

    /**
     * @notice Allows arbitration/owner to resolve a dispute safely.
     */
    function resolveDispute(
        uint256 _dealId,
        uint256 _payerAmount,
        uint256 _payeeAmount
    ) external onlyOwner onlyVerified nonReentrant {
        Deal storage deal = deals[_dealId];
        if (deal.status != Status.Disputed) revert InvalidDealStatus();
        if (_payerAmount + _payeeAmount != deal.totalBalance) revert LengthMismatch();

        deal.totalBalance = 0;
        deal.status = Status.Refunded;

        if (_payerAmount > 0) {
            pendingWithdrawals[deal.payer][deal.token] += _payerAmount;
        }
        if (_payeeAmount > 0) {
            pendingWithdrawals[deal.payee][deal.token] += _payeeAmount;
        }

        emit DisputeResolved(_dealId, _payerAmount, _payeeAmount);
    }
}