// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IAgreementRegistry
 * @notice Interface for the AgreementRegistry contract.
 */
interface IAgreementRegistry {
    // --- Structs ---

    struct AgreementDoc {
        bytes32 contentHash;
        bool payerSigned;
        bool payeeSigned;
        bool exists;
    }

    // --- Events ---

    event DocumentSubmitted(
        uint256 indexed dealId,
        uint8 indexed docIndex,
        address indexed submitter,
        bytes32 contentHash
    );
    event PayeeAgreementRejected(
        uint256 indexed dealId,
        address indexed candidatePayee
    );
    event PayeeAgreementAccepted(
        uint256 indexed dealId,
        address indexed selectedPayee,
        bytes32 contentHash
    );
    event DocumentSigned(
        uint256 indexed dealId,
        uint8 indexed docIndex,
        address indexed signer
    );
    event BothDocumentsSigned(uint256 indexed dealId);

    // --- Errors ---

    error NotVerified();
    error NotAuthorized();
    error DocumentAlreadyExists();
    error DocumentDoesNotExist();
    error AlreadySigned();
    error InvalidSignature();
    error NotPayerOrPayee();
    error PayerAlreadySet();
    error PayeeAlreadySet();
    error EscrowCoreAlreadySet();
    error NotPayer();
    error DocumentNotFound();
    error AgreementAlreadySubmitted();
    error ZeroAddress();

    // --- State Variable Getters ---

    function identityRegister() external view returns (address);

    function escrowCore() external view returns (address);

    function DOC_A() external view returns (uint8);

    function DOC_B() external view returns (uint8);

    function candidateDocuments(
        uint256 dealId,
        address candidate
    ) external view returns (bytes32);

    function dealPayer(uint256 dealId) external view returns (address);

    function dealPayee(uint256 dealId) external view returns (address);

    // --- External / State-Changing Functions ---

    function setEscrowCore(address _escrowCore) external;

    function submitPayerDocument(
        uint256 dealId,
        bytes32 documentHash,
        address payer
    ) external;

    function submitPayeeDocument(
        uint256 dealId,
        bytes32 documentHash
    ) external;

    function acceptPayeeAgreement(
        uint256 dealId,
        address candidatePayee,
        bytes calldata payerSignature
    ) external;

    function rejectPayeeAgreement(
        uint256 dealId,
        address candidatePayee
    ) external;

    function signDocument(
        uint256 dealId,
        uint8 docIndex,
        bytes calldata signature
    ) external;

    // --- View / Pure Functions ---

    function haveBothSigned(uint256 dealId) external view returns (bool);

    function getCandidatePayees(
        uint256 dealId
    ) external view returns (address[] memory);

    function getDocumentStatus(
        uint256 dealId,
        uint8 docIndex
    ) external view returns (
        bytes32 contentHash,
        bool payerSigned,
        bool payeeSigned,
        bool exists
    );

    function getSigningDigest(
        uint256 dealId,
        uint8 docIndex
    ) external view returns (bytes32);

    function getCandidateSigningDigest(
        uint256 dealId,
        address candidatePayee
    ) external view returns (bytes32);

    function getDocumentHashByDeal(
        uint256 dealId
    ) external view returns (bytes32 docAHash, bytes32 docBHash);
}