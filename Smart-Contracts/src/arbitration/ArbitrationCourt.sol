// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArbitrationRegister} from "../interfaces/IArbitrationRegister.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {IEscrowCore} from "../interfaces/IEscrowCore.sol";

/// @title ArbitrationCourt
/// @notice Dispute engine with immediate voting on primary evidence and 7-day delayed execution.
contract ArbitrationCourt is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum CaseStatus {
        Created,
        Voting,
        Decided,
        Executed,
        Cancelled
    }

    enum VoteChoice {
        None,
        ReleaseToBuyer,
        RefundToSeller,
        Split5050
    }

    struct Case {
        uint256 dealId;
        uint256 parentCaseId;
        string reason;
        bytes32 docAHash;
        bytes32 docBHash;
        uint256 arbitrationFee;
        CaseStatus status;
        address initiator;
        address[] arbiters;
        uint256 createdAt;
        uint256 votingDeadline;
        uint256 decidedAt;
        VoteChoice winningChoice;
        bool isAppeal;
        bool appealTriggered;
    }

    struct ArbiterVote {
        VoteChoice choice;
        bool hasVoted;
    }

    // --- State Variables ---

    IERC20 public immutable token;
    IIdentityRegister public immutable identityRegister;
    IArbitrationRegister public immutable arbitrationRegister;
    IEscrowCore public immutable escrowCore;

    uint256 public constant INITIAL_ARBITERS = 3;
    uint256 public constant ADDITIONAL_APPEAL_ARBITERS = 2;
    uint256 public constant VOTING_DURATION = 3 days;
    uint256 public constant EXECUTION_DELAY = 7 days;

    uint256 public caseCounter;
    mapping(uint256 => Case) public cases;
    mapping(uint256 => mapping(address => ArbiterVote)) public votes;
    mapping(uint256 => mapping(VoteChoice => uint256)) public voteCounts;

    // --- Custom Errors ---

    error InvalidAddress();
    error Unauthorized();
    error InvalidStatus(CaseStatus current, CaseStatus required);
    error DeadlineNotReached();
    error DeadlinePassed();
    error AlreadyVoted();
    error InvalidChoice();
    error NotAssignedArbiter();
    error TieVoteUnresolved();
    error ExecutionDelayActive();
    error AlreadyAppealed();

    // --- Events ---

    event CaseCreated(
        uint256 indexed caseId,
        uint256 indexed dealId,
        address indexed initiator,
        bytes32 docAHash,
        bytes32 docBHash,
        address[] arbiters
    );
    event CaseRecreated(uint256 indexed newCaseId, uint256 indexed parentCaseId, address[] arbiters);
    event VoteCast(uint256 indexed caseId, address indexed arbiter, VoteChoice choice);
    event CaseDecided(uint256 indexed caseId, VoteChoice outcome, uint256 executionUnlockTime);
    event CaseExecuted(uint256 indexed caseId, VoteChoice outcome);
    event PreviousArbitersPenalized(
        uint256 indexed parentCaseId, 
        uint256 indexed appealCaseId, 
        address indexed recipient, 
        uint256 totalCompensated
    );

    modifier inStatus(uint256 _caseId, CaseStatus _status) {
        if (cases[_caseId].status != _status) {
            revert InvalidStatus(cases[_caseId].status, _status);
        }
        _;
    }

    constructor(
        address _token,
        address _identityRegister,
        address _arbiterRegistry,
        address _escrowCore
    ) {
        if (_token == address(0) || _identityRegister == address(0) || _arbiterRegistry == address(0) || _escrowCore == address(0)) {
            revert InvalidAddress();
        }
        token = IERC20(_token);
        identityRegister = IIdentityRegister(_identityRegister);
        arbitrationRegister = IArbitrationRegister(_arbiterRegistry);
        escrowCore = IEscrowCore(_escrowCore);
    }

    // --- 1. Dispute Creation & Appeal ---

    function createCase(
        uint256 _dealId,
        string calldata _reason,
        bytes32 _docAHash,
        bytes32 _docBHash,
        uint256 _arbitrationFee
    ) external returns (uint256 caseId) {
        if (_docAHash == bytes32(0) || _docBHash == bytes32(0)) revert InvalidAddress();

        if (_arbitrationFee > 0) {
            token.safeTransferFrom(msg.sender, address(this), _arbitrationFee);
        }

        caseId = ++caseCounter;
        Case storage c = cases[caseId];

        c.dealId = _dealId;
        c.reason = _reason;
        c.docAHash = _docAHash;
        c.docBHash = _docBHash;
        c.initiator = msg.sender;
        c.arbitrationFee = _arbitrationFee;
        c.createdAt = block.timestamp;
        c.status = CaseStatus.Voting;
        c.votingDeadline = block.timestamp + VOTING_DURATION;

        for (uint256 i = 0; i < INITIAL_ARBITERS; i++) {
            address selected = arbitrationRegister.assignRandomCase(caseId);
            c.arbiters.push(selected);
        }

        emit CaseCreated(caseId, _dealId, msg.sender, _docAHash, _docBHash, c.arbiters);
    }

    function recreateCase(
        uint256 _parentCaseId,
        string calldata _appealReason,
        uint256 _arbitrationFee
    ) external returns (uint256 newCaseId) {
        Case storage parent = cases[_parentCaseId];

        if (parent.status != CaseStatus.Decided) revert InvalidStatus(parent.status, CaseStatus.Decided);
        if (parent.appealTriggered) revert AlreadyAppealed();
        if (block.timestamp >= parent.decidedAt + EXECUTION_DELAY) revert DeadlinePassed();

        if (_arbitrationFee > 0) {
            token.safeTransferFrom(msg.sender, address(this), _arbitrationFee);
        }

        parent.appealTriggered = true;

        newCaseId = ++caseCounter;
        Case storage appeal = cases[newCaseId];

        appeal.dealId = parent.dealId;
        appeal.parentCaseId = _parentCaseId;
        appeal.docAHash = parent.docAHash;
        appeal.docBHash = parent.docBHash;
        appeal.reason = _appealReason;
        appeal.initiator = msg.sender;
        appeal.arbitrationFee = _arbitrationFee;
        appeal.createdAt = block.timestamp;
        appeal.isAppeal = true;
        appeal.status = CaseStatus.Voting;
        appeal.votingDeadline = block.timestamp + VOTING_DURATION;

        for (uint256 i = 0; i < parent.arbiters.length; i++) {
            address prevArb = parent.arbiters[i];
            appeal.arbiters.push(prevArb);
            arbitrationRegister.assignCase(prevArb);
        }

        for (uint256 i = 0; i < ADDITIONAL_APPEAL_ARBITERS; i++) {
            address selected = arbitrationRegister.assignRandomCase(newCaseId);
            appeal.arbiters.push(selected);
        }

        emit CaseRecreated(newCaseId, _parentCaseId, appeal.arbiters);
    }

    // --- 2. Voting ---

    function castVote(uint256 _caseId, VoteChoice _choice) external inStatus(_caseId, CaseStatus.Voting) {
        Case storage c = cases[_caseId];
        if (block.timestamp > c.votingDeadline) revert DeadlinePassed();
        if (_choice == VoteChoice.None) revert InvalidChoice();
        if (!_isArbiter(c.arbiters, msg.sender)) revert NotAssignedArbiter();

        ArbiterVote storage v = votes[_caseId][msg.sender];
        if (v.hasVoted) revert AlreadyVoted();

        v.choice = _choice;
        v.hasVoted = true;
        voteCounts[_caseId][_choice] += 1;

        emit VoteCast(_caseId, msg.sender, _choice);
    }

    // --- 3. Resolution ---

    function resolveCase(uint256 _caseId) external inStatus(_caseId, CaseStatus.Voting) nonReentrant {
        Case storage c = cases[_caseId];
        if (block.timestamp <= c.votingDeadline) revert DeadlineNotReached();

        uint256 releaseVotes = voteCounts[_caseId][VoteChoice.ReleaseToBuyer];
        uint256 refundVotes = voteCounts[_caseId][VoteChoice.RefundToSeller];
        uint256 splitVotes = voteCounts[_caseId][VoteChoice.Split5050];

        VoteChoice outcome = VoteChoice.None;

        if (releaseVotes > refundVotes && releaseVotes > splitVotes) {
            outcome = VoteChoice.ReleaseToBuyer;
        } else if (refundVotes > releaseVotes && refundVotes > splitVotes) {
            outcome = VoteChoice.RefundToSeller;
        } else if (splitVotes > releaseVotes && splitVotes > refundVotes) {
            outcome = VoteChoice.Split5050;
        } else {
            revert TieVoteUnresolved();
        }

        c.winningChoice = outcome;
        c.status = CaseStatus.Decided;
        c.decidedAt = block.timestamp;

        // Reward active correct arbiters / Slash inactive arbiters on current case
        for (uint256 i = 0; i < c.arbiters.length; i++) {
            address arb = c.arbiters[i];
            ArbiterVote memory v = votes[_caseId][arb];

            if (v.hasVoted && v.choice == outcome) {
                arbitrationRegister.updateReputation(arb, 10);
            } else if (!v.hasVoted) {
                // Slash inactive arbiters, sending slashed stake to contract address
                arbitrationRegister.slash(arb, 20 * 1e6, address(this));
                arbitrationRegister.updateReputation(arb, -20);
            }
            arbitrationRegister.finishCase(arb);
        }

        // Handle appeal resolution and slash incorrect previous arbiters
        if (c.isAppeal) {
            Case storage parent = cases[c.parentCaseId];

            // If appeal outcome differs from original ruling, penalize original arbiters
            if (c.winningChoice != parent.winningChoice) {
                uint256 slashAmountPerArbiter = 50 * 1e6;
                uint256 totalCompensated = 0;

                // Send slashed tokens directly to the appeal initiator as compensation
                address compensationRecipient = c.initiator;

                for (uint256 i = 0; i < parent.arbiters.length; i++) {
                    address prevArb = parent.arbiters[i];
                    
                    // Slash previous arbiter and send funds directly to appeal initiator
                    arbitrationRegister.slash(prevArb, slashAmountPerArbiter, compensationRecipient);
                    arbitrationRegister.updateReputation(prevArb, -30);

                    totalCompensated += slashAmountPerArbiter;
                }

                emit PreviousArbitersPenalized(c.parentCaseId, _caseId, compensationRecipient, totalCompensated);
            }
        }

        emit CaseDecided(_caseId, outcome, block.timestamp + EXECUTION_DELAY);
    }

    // --- 4. Execution ---

    function executeCase(uint256 _caseId) external inStatus(_caseId, CaseStatus.Decided) nonReentrant {
        Case storage c = cases[_caseId];

        if (c.appealTriggered) revert AlreadyAppealed();
        if (block.timestamp < c.decidedAt + EXECUTION_DELAY) revert ExecutionDelayActive();

        c.status = CaseStatus.Executed;

        uint256 totalBalance = escrowCore.getDealTotalBalance(c.dealId);
        uint256 payerAmount = 0;
        uint256 payeeAmount = 0;

        if (c.winningChoice == VoteChoice.ReleaseToBuyer) {
            payeeAmount = totalBalance;
        } else if (c.winningChoice == VoteChoice.RefundToSeller) {
            payerAmount = totalBalance;
        } else if (c.winningChoice == VoteChoice.Split5050) {
            payerAmount = totalBalance / 2;
            payeeAmount = totalBalance - payerAmount;
        }

        escrowCore.resolveDispute(c.dealId, payerAmount, payeeAmount);

        if (c.arbitrationFee > 0 && c.arbiters.length > 0) {
            uint256 perPerson = c.arbitrationFee / c.arbiters.length;

            for (uint256 i = 0; i < c.arbiters.length; i++) {
                address arb = c.arbiters[i];
                ArbiterVote memory v = votes[_caseId][arb];

                if (v.hasVoted && v.choice == c.winningChoice) {
                    token.safeTransfer(arb, perPerson);
                }
            }
        }

        emit CaseExecuted(_caseId, c.winningChoice);
    }

    // --- Helpers ---

    function _isArbiter(address[] memory _arbiters, address _target) internal pure returns (bool) {
        for (uint256 i = 0; i < _arbiters.length; i++) {
            if (_arbiters[i] == _target) return true;
        }
        return false;
    }

    function getCaseArbiters(uint256 _caseId) external view returns (address[] memory) {
        return cases[_caseId].arbiters;
    }
}