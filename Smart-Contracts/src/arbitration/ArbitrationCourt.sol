// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArbitrationRegister} from "../interfaces/IArbitrationRegister.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {IEscrowCore} from "../interfaces/IEscrowCore.sol";

/// @title ArbitrationCourt
/// @notice Manages dispute creation, commit-reveal arbiter voting, outcome resolution, and escrow settlement.
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
        string reason;
        bytes32 evidenceHashA;
        bytes32 evidenceHashB;
        CaseStatus status;
        address initiator;
        address respondent;
        address[] arbiters;
        uint256 createdAt;
        uint256 evidenceDeadline;
        uint256 commitDeadline;
        uint256 revealDeadline;
        VoteChoice winningChoice;
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

    uint256 public constant NUMBER_OF_ARBITERS = 3;
    uint256 public constant EVIDENCE_DURATION = 3 days;
    uint256 public constant COMMIT_DURATION = 2 days;
    uint256 public constant REVEAL_DURATION = 2 days;
    uint256 public constant ARBITER_FEE_PER_CASE = 50 * 1e6; // 50 USDT base reward per participating arbiter

    uint256 public caseCounter;
    mapping(uint256 => Case) public cases;
    // caseId => arbiterWallet => Vote Details
    mapping(uint256 => mapping(address => ArbiterVote)) public votes;
    // caseId => choice => vote count
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

    // --- Events ---

    event CaseCreated(
        uint256 indexed caseId,
        uint256 indexed dealId,
        address indexed initiator,
        address[] arbiters
    );
    event EvidenceSubmitted(uint256 indexed caseId, address indexed party, bytes32 evidenceHash);
    event VoteCommitted(uint256 indexed caseId, address indexed arbiter, bytes32 commitHash);
    event VoteRevealed(uint256 indexed caseId, address indexed arbiter, VoteChoice choice);
    event CaseDecided(uint256 indexed caseId, VoteChoice outcome);
    event CaseExecuted(uint256 indexed caseId, VoteChoice outcome);

    // --- Modifiers ---

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

    // --- 1. Dispute Creation ---

    /// @notice Opens a dispute for an active escrow deal and assigns randomly selected arbiters.
    function createCase(
        uint256 _dealId,
        string calldata _reason,
        bytes32 _evidenceHashA,
        bytes32 _evidenceHashB
    ) external returns (uint256 caseId) {
        caseId = ++caseCounter;
        Case storage c = cases[caseId];

        c.dealId = _dealId;
        c.reason = _reason;
        c.evidenceHashA = _evidenceHashA;
        c.evidenceHashB = _evidenceHashB;
        c.initiator = msg.sender;
        c.createdAt = block.timestamp;
        c.status = CaseStatus.EvidenceSubmission;
        c.evidenceDeadline = block.timestamp + EVIDENCE_DURATION;

        // Dynamic O(1) random assignment of unique arbiters
        for (uint256 i = 0; i < NUMBER_OF_ARBITERS; i++) {
            address selected = arbitrationRegister.assignRandomCase(caseId);
            c.arbiters.push(selected);
        }

        emit CaseCreated(caseId, _dealId, msg.sender, c.arbiters);
    }

    // --- 2. Evidence Phase ---

    /// @notice Submits evidence hash for a disputing party.
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

    /// @notice Transitions case from Evidence to Commit-Voting phase once deadline expires or evidence is ready.
    function startVotingPhase(uint256 _caseId) external inStatus(_caseId, CaseStatus.EvidenceSubmission) {
        Case storage c = cases[_caseId];
        if (block.timestamp <= c.evidenceDeadline && c.evidenceHashA != bytes32(0) && c.evidenceHashB != bytes32(0)) {
            // Can start early if both evidences provided
        } else if (block.timestamp <= c.evidenceDeadline) {
            revert DeadlineNotReached();
        }

        c.status = CaseStatus.Voting;
        c.commitDeadline = block.timestamp + COMMIT_DURATION;
    }

    // --- 3. Commit-Reveal Voting ---

    /// @notice Arbiters submit keccak256(abi.encodePacked(choice, salt)) hash during voting window.
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

    /// @notice Transitions case to Reveal phase after commit deadline.
    function startRevealPhase(uint256 _caseId) external inStatus(_caseId, CaseStatus.Voting) {
        Case storage c = cases[_caseId];
        if (block.timestamp <= c.commitDeadline) revert DeadlineNotReached();

        c.status = CaseStatus.Reveal;
        c.revealDeadline = block.timestamp + REVEAL_DURATION;
    }

    /// @notice Arbiters reveal their committed choice using their plain choice & secret salt.
    function revealVote(
        uint256 _caseId,
        VoteChoice _choice,
        bytes32 _salt
    ) external inStatus(_caseId, CaseStatus.Reveal) {
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

    // --- 4. Outcome Resolution & Settlement ---

    /// @notice Resolves vote tally, sets the winning decision, updates reputation, and slashes non-revealing arbiters.
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

        // Reward aligned arbiters / slash inactive or malicious arbiters
        for (uint256 i = 0; i < c.arbiters.length; i++) {
            address arb = c.arbiters[i];
            ArbiterVote memory v = votes[_caseId][arb];

            if (v.revealed && v.choice == outcome) {
                arbitrationRegister.updateReputation(arb, 10);
            } else if (!v.revealed) {
                // Slash arbiters who failed to reveal vote during dispute window
                arbitrationRegister.slash(arb, 20 * 1e6, address(this));
                arbitrationRegister.updateReputation(arb, -20);
            }
            
            // Notify registry case is completed for active capacity tracking
            arbitrationRegister.finishCase(arb);
        }

        emit CaseDecided(_caseId, outcome);
    }

    /// @notice Triggers execution on EscrowCore and updates case state to Executed.
    function executeCase(uint256 _caseId) external inStatus(_caseId, CaseStatus.Decided) nonReentrant {
        Case storage c = cases[_caseId];
        c.status = CaseStatus.Executed;

        // Execute settlement call on EscrowCore based on winning choice
        if (c.winningChoice == VoteChoice.ReleaseToBuyer) {
            escrowCore.resolveDispute(c.dealId, true, false);
        } else if (c.winningChoice == VoteChoice.RefundToSeller) {
            escrowCore.resolveDispute(c.dealId, false, false);
        } else if (c.winningChoice == VoteChoice.Split5050) {
            escrowCore.resolveDispute(c.dealId, false, true);
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