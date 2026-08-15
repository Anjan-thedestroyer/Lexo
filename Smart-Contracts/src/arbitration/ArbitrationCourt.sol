// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArbitrationRegister} from "../interfaces/IArbitrationRegister.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {IEscrowCore} from "../interfaces/IEscrowCore.sol";

/// @title ArbitrationCourt
/// @notice Dispute engine supporting primary cases, appeal recreation (recase), arbiter penalization on overturned verdicts, and 7-day execution delays.
contract ArbitrationCourt is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum CaseStatus {
        Created,
        EvidenceSubmission,
        Voting,
        Reveal,
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
        uint256 parentCaseId; // 0 for primary cases, non-zero for appeal (recase)
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
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 decidedAt;
        VoteChoice winningChoice;
        bool isAppeal;
        bool appealTriggered;
    }

    struct ArbiterVote {
        bytes32 commitHash;
        VoteChoice choice;
        bool committed;
        bool revealed;
    }

    // --- State Variables ---

    IERC20 public immutable token;
    IIdentityRegister public immutable identityRegister;
    IArbitrationRegister public immutable arbitrationRegister;
    IEscrowCore public immutable escrowCore;

    uint256 public constant INITIAL_ARBITERS = 3;
    uint256 public constant ADDITIONAL_APPEAL_ARBITERS = 2;
    uint256 public constant EVIDENCE_DURATION = 3 days;
    uint256 public constant COMMIT_DURATION = 2 days;
    uint256 public constant REVEAL_DURATION = 2 days;
    uint256 public constant EXECUTION_DELAY = 7 days; // 7-day lock period before funds can be released

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
    error AlreadyCommitted();
    error AlreadyRevealed();
    error InvalidCommitment();
    error NotAssignedArbiter();
    error TieVoteUnresolved();
    error ExecutionDelayActive();
    error AlreadyAppealed();
    error InvalidParentCase();

    // --- Events ---

    event CaseCreated(uint256 indexed caseId, uint256 indexed dealId, address indexed initiator, address[] arbiters);
    event CaseRecreated(uint256 indexed newCaseId, uint256 indexed parentCaseId, address[] arbiters);
    event EvidenceSubmitted(uint256 indexed caseId, address indexed party, bytes32 evidenceHash);
    event VoteCommitted(uint256 indexed caseId, address indexed arbiter, bytes32 commitHash);
    event VoteRevealed(uint256 indexed caseId, address indexed arbiter, VoteChoice choice);
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

    // --- 1. Dispute Creation & Appeal (recreateCase) ---

    /// @notice Opens a primary dispute for an escrow deal.
    function createCase(
        uint256 _dealId,
        bytes32 _agreementHash,
        string calldata _reason,
        uint256 rewardAmount
    ) external returns (uint256 caseId) {
        if (_agreementHash == bytes32(0)) revert InvalidAddress();

        caseId = ++caseCounter;
        Case storage c = cases[caseId];

        c.dealId = _dealId;
        c.agreementHash = _agreementHash;
        c.reason = _reason;
        c.initiator = msg.sender;
        c.createdAt = block.timestamp;
        c.status = CaseStatus.EvidenceSubmission;
        c.evidenceDeadline = block.timestamp + EVIDENCE_DURATION;

        for (uint256 i = 0; i < INITIAL_ARBITERS; i++) {
            address selected = arbitrationRegister.assignRandomCase(caseId);
            c.arbiters.push(selected);
        }

        emit CaseCreated(caseId, _dealId, msg.sender, c.arbiters);
    }

    /// @notice Recreates a case on appeal during the 7-day execution window. Includes previous arbiters plus 2 new ones.
    function recreateCase(uint256 _parentCaseId, string calldata _appealReason) external returns (uint256 newCaseId) {
        Case storage parent = cases[_parentCaseId];
        
        if (parent.status != CaseStatus.Decided) revert InvalidStatus(parent.status, CaseStatus.Decided);
        if (parent.appealTriggered) revert AlreadyAppealed();
        if (block.timestamp >= parent.decidedAt + EXECUTION_DELAY) revert DeadlinePassed();

        parent.appealTriggered = true;

        newCaseId = ++caseCounter;
        Case storage appeal = cases[newCaseId];

        appeal.dealId = parent.dealId;
        appeal.parentCaseId = _parentCaseId;
        appeal.agreementHash = parent.agreementHash;
        appeal.reason = _appealReason;
        appeal.initiator = msg.sender;
        appeal.createdAt = block.timestamp;
        appeal.isAppeal = true;
        appeal.status = CaseStatus.EvidenceSubmission;
        appeal.evidenceDeadline = block.timestamp + EVIDENCE_DURATION;

        // 1. Copy all previous arbiters into the appeal panel
        for (uint256 i = 0; i < parent.arbiters.length; i++) {
            address prevArb = parent.arbiters[i];
            appeal.arbiters.push(prevArb);
            arbitrationRegister.assignCase(prevArb); // Track capacity in registry
        }

        // 2. Add 2 new random arbiters to expand panel to 5
        for (uint256 i = 0; i < ADDITIONAL_APPEAL_ARBITERS; i++) {
            address selected = arbitrationRegister.assignRandomCase(newCaseId);
            appeal.arbiters.push(selected);
        }

        emit CaseRecreated(newCaseId, _parentCaseId, appeal.arbiters);
    }

    // --- 2. Evidence & Commit-Reveal Voting ---

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
        c.commitDeadline = block.timestamp + COMMIT_DURATION;
    }

    function commitVote(uint256 _caseId, bytes32 _commitHash) external inStatus(_caseId, CaseStatus.Voting) {
        Case storage c = cases[_caseId];
        if (block.timestamp > c.commitDeadline) revert DeadlinePassed();
        if (!_isArbiter(c.arbiters, msg.sender)) revert NotAssignedArbiter();

        ArbiterVote storage v = votes[_caseId][msg.sender];
        if (v.committed) revert AlreadyCommitted();

        v.commitHash = _commitHash;
        v.committed = true;

        emit VoteCommitted(_caseId, msg.sender, _commitHash);
    }

    function startRevealPhase(uint256 _caseId) external inStatus(_caseId, CaseStatus.Voting) {
        Case storage c = cases[_caseId];
        if (block.timestamp <= c.commitDeadline) revert DeadlineNotReached();

        c.status = CaseStatus.Reveal;
        c.revealDeadline = block.timestamp + REVEAL_DURATION;
    }

    function revealVote(uint256 _caseId, VoteChoice _choice, bytes32 _salt) external inStatus(_caseId, CaseStatus.Reveal) {
        Case storage c = cases[_caseId];
        if (block.timestamp > c.revealDeadline) revert DeadlinePassed();
        if (_choice == VoteChoice.None) revert InvalidCommitment();

        ArbiterVote storage v = votes[_caseId][msg.sender];
        if (!v.committed) revert Unauthorized();
        if (v.revealed) revert AlreadyRevealed();

        bytes32 checkHash = keccak256(abi.encodePacked(_choice, _salt));
        if (checkHash != v.commitHash) revert InvalidCommitment();

        v.revealed = true;
        v.choice = _choice;
        voteCounts[_caseId][_choice] += 1;

        emit VoteRevealed(_caseId, msg.sender, _choice);
    }

    // --- 3. Resolution & Punishment Logic ---

    function resolveCase(uint256 _caseId) external inStatus(_caseId, CaseStatus.Reveal) nonReentrant {
        Case storage c = cases[_caseId];
        if (block.timestamp <= c.revealDeadline) revert DeadlineNotReached();

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
        c.decidedAt = block.timestamp; // Starts the mandatory 7-day cooldown

        // Update reputation & release case load for current arbiters
        for (uint256 i = 0; i < c.arbiters.length; i++) {
            address arb = c.arbiters[i];
            ArbiterVote memory v = votes[_caseId][arb];

            if (v.revealed && v.choice == outcome) {
                arbitrationRegister.updateReputation(arb, 10);
            } else if (!v.revealed) {
                arbitrationRegister.slash(arb, 20 * 1e6, address(this));
                arbitrationRegister.updateReputation(arb, -20);
            }
            arbitrationRegister.finishCase(arb);
        }

        // --- PUNISH PREVIOUS ARBITERS IF APPEAL OVERTURNS DECISION ---
        if (c.isAppeal) {
            Case storage parent = cases[c.parentCaseId];

            // If appeal outcome differs from parent outcome, slash previous panel
            if (c.winningChoice != parent.winningChoice) {
                for (uint256 i = 0; i < parent.arbiters.length; i++) {
                    address prevArb = parent.arbiters[i];
                    arbitrationRegister.slash(prevArb, 50 * 1e6, address(this)); // Slash 50 USDT penalty
                    arbitrationRegister.updateReputation(prevArb, -30);           // Heavy reputation deduction
                }
                emit PreviousArbitersPenalized(c.parentCaseId, _caseId);
            }
        }

        emit CaseDecided(_caseId, outcome, block.timestamp + EXECUTION_DELAY);
    }

    // --- 4. Execution After 7 Days ---

    /// @notice Executes settlement on EscrowCore after the 7-day delay expires.
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