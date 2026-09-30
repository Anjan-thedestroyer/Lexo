// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IArbitrationCourt
 * @notice Interface for the ArbitrationCourt dispute resolution contract.
 */
interface IArbitrationCourt {
    // --- Enums ---

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

    // --- Structs ---

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

    // --- Events ---

    event CaseCreated(
        uint256 indexed caseId,
        uint256 indexed dealId,
        address indexed initiator,
        address[] arbiters
    );
    event CaseRecreated(
        uint256 indexed newCaseId,
        uint256 indexed parentCaseId,
        address[] arbiters
    );
    event EvidenceSubmitted(
        uint256 indexed caseId,
        address indexed party,
        bytes32 evidenceHash
    );
    event VoteCast(
        uint256 indexed caseId,
        address indexed arbiter,
        VoteChoice choice
    );
    event CaseDecided(
        uint256 indexed caseId,
        VoteChoice outcome,
        uint256 executionUnlockTime
    );
    event CaseExecuted(uint256 indexed caseId, VoteChoice outcome);
    event PreviousArbitersPenalized(
        uint256 indexed parentCaseId,
        uint256 indexed appealCaseId
    );

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

    // --- Immutable / Constants & State Variables ---

    function token() external view returns (address);

    function identityRegister() external view returns (address);

    function arbitrationRegister() external view returns (address);

    function escrowCore() external view returns (address);

    function INITIAL_ARBITERS() external view returns (uint256);

    function ADDITIONAL_APPEAL_ARBITERS() external view returns (uint256);

    function EVIDENCE_DURATION() external view returns (uint256);

    function VOTING_DURATION() external view returns (uint256);

    function EXECUTION_DELAY() external view returns (uint256);

    function caseCounter() external view returns (uint256);

    function cases(uint256 caseId)
        external
        view
        returns (
            uint256 dealId,
            uint256 parentCaseId,
            bytes32 agreementHash,
            string memory reason,
            bytes32 evidenceHashA,
            bytes32 evidenceHashB,
            uint256 rewardAmount,
            CaseStatus status,
            address initiator,
            uint256 createdAt,
            uint256 evidenceDeadline,
            uint256 votingDeadline,
            uint256 decidedAt,
            VoteChoice winningChoice,
            bool isAppeal,
            bool appealTriggered
        );

    function votes(uint256 caseId, address arbiter)
        external
        view
        returns (VoteChoice choice, bool hasVoted);

    function voteCounts(uint256 caseId, VoteChoice choice)
        external
        view
        returns (uint256 count);

    // --- External Functions ---

    function createCase(
        uint256 _dealId,
        string calldata _reason,
        bytes32 docAHash,
        bytes32 docBHash,
        uint256 rewardAmount
    ) external returns (uint256 caseId);

    function recreateCase(
        uint256 _parentCaseId,
        string calldata _appealReason,
        uint256 rewardAmount
    ) external returns (uint256 newCaseId);

    function submitEvidence(uint256 _caseId, bytes32 _evidenceHash) external;

    function startVotingPhase(uint256 _caseId) external;

    function castVote(uint256 _caseId, VoteChoice _choice) external;

    function resolveCase(uint256 _caseId) external;

    function executeCase(uint256 _caseId) external;

    // --- View Functions ---

    function getCaseArbiters(uint256 _caseId)
        external
        view
        returns (address[] memory);
}