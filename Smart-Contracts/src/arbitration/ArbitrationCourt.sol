// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArbitrationRegister} from "../interfaces/IArbitrationRegister.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {IEscrowCore} from "../interfaces/IEscrowCore.sol";

/// @title ArbitrationCourt
/// @notice Dispute engine with direct single-step voting and 7-day delayed reward & escrow execution.
contract ArbitrationCourt is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum CaseStatus {
        Created,
        EvidenceSubmission,
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
        bytes32 agreementHash;
        string reason;
        bytes32 evidenceHashA;
        bytes32 evidenceHashB;
        uint256 rewardAmount;
        CaseStatus status;
        address initiator;
        address[] arbiters;
        uint256 createdAt;
        uint256 evidenceDeadline;
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
    uint256 public constant EVIDENCE_DURATION = 3 days;
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

    event CaseCreated(uint256 indexed caseId, uint256 indexed dealId, address indexed initiator, address[] arbiters);
    event CaseRecreated(uint256 indexed newCaseId, uint256 indexed parentCaseId, address[] arbiters);
    event EvidenceSubmitted(uint256 indexed caseId, address indexed party, bytes32 evidenceHash);
    event VoteCast(uint256 indexed caseId, address indexed arbiter, VoteChoice choice);
    event CaseDecided(uint256 indexed caseId, VoteChoice outcome, uint256 executionUnlockTime);
    event CaseExecuted(uint256 indexed caseId, VoteChoice outcome);
    event PreviousArbitersPenalized(uint256 indexed parentCaseId, uint256 indexed appealCaseId);

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

    /// @notice Opens a primary dispute and locks the arbiter reward pool in contract.
    function createCase(
        uint256 _dealId,
        bytes32 _agreementHash,
        string calldata _reason,
        uint256 rewardAmount
    ) external returns (uint256 caseId) {
        if (_agreementHash == bytes32(0)) revert InvalidAddress();

        // Lock total reward inside contract until execution window finishes
        if (rewardAmount > 0) {
            token.safeTransferFrom(msg.sender, address(this), rewardAmount);
        }

        caseId = ++caseCounter;
        Case storage c = cases[caseId];

        c.dealId = _dealId;
        c.agreementHash = _agreementHash;
        c.reason = _reason;
        c.initiator = msg.sender;
        c.rewardAmount = rewardAmount;
        c.createdAt = block.timestamp;
        c.status = CaseStatus.EvidenceSubmission;
        c.evidenceDeadline = block.timestamp + EVIDENCE_DURATION;

        for (uint256 i = 0; i < INITIAL_ARBITERS; i++) {
            address selected = arbitrationRegister.assignRandomCase(caseId);
            c.arbiters.push(selected);
        }

        emit CaseCreated(caseId, _dealId, msg.sender, c.arbiters);
    }

    /// @notice Recreates a case on appeal during the 7-day execution window.
    function recreateCase(uint256 _parentCaseId, string calldata _appealReason, uint256 rewardAmount) external returns (uint256 newCaseId) {
        Case storage parent = cases[_parentCaseId];

        if (parent.status != CaseStatus.Decided) revert InvalidStatus(parent.status, CaseStatus.Decided);
        if (parent.appealTriggered) revert AlreadyAppealed();
        if (block.timestamp >= parent.decidedAt + EXECUTION_DELAY) revert DeadlinePassed();

        if (rewardAmount > 0) {
            token.safeTransferFrom(msg.sender, address(this), rewardAmount);
        }

        parent.appealTriggered = true;

        newCaseId = ++caseCounter;
        Case storage appeal = cases[newCaseId];

        appeal.dealId = parent.dealId;
        appeal.parentCaseId = _parentCaseId;
        appeal.agreementHash = parent.agreementHash;
        appeal.reason = _appealReason;
        appeal.initiator = msg.sender;
        appeal.rewardAmount = rewardAmount;
        appeal.createdAt = block.timestamp;
        appeal.isAppeal = true;
        appeal.status = CaseStatus.EvidenceSubmission;
        appeal.evidenceDeadline = block.timestamp + EVIDENCE_DURATION;

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

    // --- 2. Evidence & Direct Voting ---

    function submitEvidence(uint256 _caseId, bytes32 _evidenceHash) external inStatus(_caseId, CaseStatus.EvidenceSubmission) {
        Case storage c = cases[_caseId];
        if (block.timestamp > c.evidenceDeadline) revert DeadlinePassed();

        if (c.evidenceHashA == bytes32(0)) {
            c.evidenceHashA = _evidenceHash;
        } else if (c.evidenceHashB == bytes32(0)) {
            c.evidenceHashB = _evidenceHash;
        }

        emit EvidenceSubmitted(_caseId, msg.sender, _evidenceHash);
    }

    function startVotingPhase(uint256 _caseId) external inStatus(_caseId, CaseStatus.EvidenceSubmission) {
        Case storage c = cases[_caseId];
        if (block.timestamp <= c.evidenceDeadline && (c.evidenceHashA == bytes32(0) || c.evidenceHashB == bytes32(0))) {
            revert DeadlineNotReached();
        }

        c.status = CaseStatus.Voting;
        c.votingDeadline = block.timestamp + VOTING_DURATION;
    }

    /// @notice Direct single-step voting replacing commit/reveal
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
        c.decidedAt = block.timestamp; // Triggers the 7-day cooldown

        // Penalize / reward reputations without sending payouts yet
        for (uint256 i = 0; i < c.arbiters.length; i++) {
            address arb = c.arbiters[i];
            ArbiterVote memory v = votes[_caseId][arb];

            if (v.hasVoted && v.choice == outcome) {
                arbitrationRegister.updateReputation(arb, 10);
            } else if (!v.hasVoted) {
                arbitrationRegister.slash(arb, 20 * 1e6, address(this));
                arbitrationRegister.updateReputation(arb, -20);
            }
            arbitrationRegister.finishCase(arb);
        }

        if (c.isAppeal) {
            Case storage parent = cases[c.parentCaseId];

            if (c.winningChoice != parent.winningChoice) {
                for (uint256 i = 0; i < parent.arbiters.length; i++) {
                    address prevArb = parent.arbiters[i];
                    arbitrationRegister.slash(prevArb, 50 * 1e6, address(this));
                    arbitrationRegister.updateReputation(prevArb, -30);
                }
                emit PreviousArbitersPenalized(c.parentCaseId, _caseId);
            }
        }

        emit CaseDecided(_caseId, outcome, block.timestamp + EXECUTION_DELAY);
    }

    // --- 4. Execution & Payout (After 7 Days) ---

    /// @notice Releases escrow deal funds and distributes arbiter rewards AFTER 7 full days pass.
    function executeCase(uint256 _caseId) external inStatus(_caseId, CaseStatus.Decided) nonReentrant {
        Case storage c = cases[_caseId];

        if (c.appealTriggered) revert AlreadyAppealed();
        if (block.timestamp < c.decidedAt + EXECUTION_DELAY) revert ExecutionDelayActive();

        c.status = CaseStatus.Executed;

        // 1. Settle EscrowCore deal funds
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

        // 2. Distribute locked arbiter rewards after 7 days
        if (c.rewardAmount > 0 && c.arbiters.length > 0) {
            uint256 perPerson = c.rewardAmount / c.arbiters.length;

            for (uint256 i = 0; i < c.arbiters.length; i++) {
                address arb = c.arbiters[i];
                ArbiterVote memory v = votes[_caseId][arb];

                // Reward only active voters who aligned with winning outcome
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