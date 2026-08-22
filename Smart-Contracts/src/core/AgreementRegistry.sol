// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";
import {IEscrowCore} from "../interfaces/IEscrowCore.sol";

/**
 * @title AgreementRegistry
 * @author Abinash Paudel
 * @notice Central source of truth for deal agreements.
 *         Payees submit their Document B terms, which the Payer can reject or accept.
 *         Acceptance automatically signs Document B on behalf of the Payer and
 *         triggers EscrowCore to lock in the Payee.
 */
contract AgreementRegistry is EIP712, Ownable {
    using ECDSA for bytes32;

    IIdentityRegister public immutable identityRegister;
    address public escrowCore;

    bytes32 private constant AGREEMENT_TYPEHASH = keccak256(
        "AgreementDoc(uint256 dealId,uint8 docIndex,bytes32 contentHash)"
    );

    uint8 public constant DOC_A = 0; // Payer's document
    uint8 public constant DOC_B = 1; // Payee's document

    struct AgreementDoc {
        bytes32 contentHash;
        bool payerSigned;
        bool payeeSigned;
        bool exists;
    }

    /// @notice dealId => docIndex (0 or 1) => AgreementDoc
    mapping(uint256 => mapping(uint8 => AgreementDoc)) private agreements;

    /// @notice dealId => payee candidate => Document B content hash
    mapping(uint256 => mapping(address => bytes32)) public candidateDocuments;

    /// @notice dealId => list of candidate payees who submitted Document B
    mapping(uint256 => address[]) private candidatePayees;

    /// @notice dealId => payer address (set when Document A is submitted)
    mapping(uint256 => address) public dealPayer;

    /// @notice dealId => payee address (set when Payer accepts a Payee agreement)
    mapping(uint256 => address) public dealPayee;

    event DocumentSubmitted(uint256 indexed dealId, uint8 indexed docIndex, address indexed submitter, bytes32 contentHash);
    event PayeeAgreementRejected(uint256 indexed dealId, address indexed candidatePayee);
    event PayeeAgreementAccepted(uint256 indexed dealId, address indexed selectedPayee, bytes32 contentHash);
    event DocumentSigned(uint256 indexed dealId, uint8 indexed docIndex, address indexed signer);
    event BothDocumentsSigned(uint256 indexed dealId);

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

    modifier onlyVerified() {
        if (!identityRegister.isVerified(msg.sender)) revert NotVerified();
        _;
    }

    modifier onlyPayer(uint256 dealId) {
        if (msg.sender != dealPayer[dealId]) revert NotPayer();
        _;
    }

    modifier onlyEscrowCore() {
        if (msg.sender != escrowCore) revert NotAuthorized();
        _;
    }

    constructor(address _identityRegister)
        Ownable(msg.sender)
        EIP712("Lexo AgreementRegistry", "1")
    {
        if (_identityRegister == address(0)) revert ZeroAddress();
        identityRegister = IIdentityRegister(_identityRegister);
    }

    /**
     * @notice Sets the EscrowCore address. Restricted to owner to prevent front-running.
     */
    function setEscrowCore(address _escrowCore) external onlyOwner {
        if (escrowCore != address(0)) revert EscrowCoreAlreadySet();
        if (_escrowCore == address(0)) revert ZeroAddress();
        escrowCore = _escrowCore;
    }

    /**
     * @notice Submits Document A (the payer's terms) for a deal.
     */
    function submitPayerDocument(uint256 dealId, bytes32 documentHash, address payer)
        external
        onlyEscrowCore
    {
        if (agreements[dealId][DOC_A].exists) revert DocumentAlreadyExists();
        if (dealPayer[dealId] != address(0)) revert PayerAlreadySet();

        agreements[dealId][DOC_A] = AgreementDoc({
            contentHash: documentHash,
            payerSigned: false,
            payeeSigned: false,
            exists: true
        });
        dealPayer[dealId] = payer; // Set deal payer to caller origin who initiated createDeal in EscrowCore

        emit DocumentSubmitted(dealId, DOC_A, payer, documentHash);
    }

    /**
     * @notice Allows a prospective payee to submit their Document B terms for a deal.
     */
    function submitPayeeDocument(uint256 dealId, bytes32 documentHash)
        external
        onlyVerified
    {
        if (!agreements[dealId][DOC_A].exists) revert DocumentDoesNotExist();
        if (dealPayee[dealId] != address(0)) revert PayeeAlreadySet();
        if (candidateDocuments[dealId][msg.sender] != bytes32(0)) revert AgreementAlreadySubmitted();

        candidateDocuments[dealId][msg.sender] = documentHash;
        candidatePayees[dealId].push(msg.sender);

        emit DocumentSubmitted(dealId, DOC_B, msg.sender, documentHash);
    }

    /**
     * @notice Payer accepts a Payee's Document B terms using an EIP-712 signature over Doc B.
     */
    function acceptPayeeAgreement(
        uint256 dealId,
        address candidatePayee,
        bytes calldata payerSignature
    ) external onlyPayer(dealId) {
        if (dealPayee[dealId] != address(0)) revert PayeeAlreadySet();

        bytes32 docHash = candidateDocuments[dealId][candidatePayee];
        if (docHash == bytes32(0)) revert DocumentNotFound();

        // 1. Verify Payer signature over Document B
        bytes32 structHash = keccak256(
            abi.encode(AGREEMENT_TYPEHASH, dealId, DOC_B, docHash)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        if (digest.recover(payerSignature) != msg.sender) revert InvalidSignature();

        // 2. Lock in Payee and initialize Document B with payerSigned = true
        dealPayee[dealId] = candidatePayee;
        agreements[dealId][DOC_B] = AgreementDoc({
            contentHash: docHash,
            payerSigned: true,
            payeeSigned: false,
            exists: true
        });

        emit PayeeAgreementAccepted(dealId, candidatePayee, docHash);
        emit DocumentSigned(dealId, DOC_B, msg.sender);

        if (haveBothSigned(dealId)) {
            emit BothDocumentsSigned(dealId);
        }

        if (escrowCore != address(0)) {
            IEscrowCore(escrowCore).syncPayeeFromRegistry(dealId);
        }
    }

    /**
     * @notice Allows the Payer to reject a candidate Payee's submitted Document B and cleans up candidate state.
     */
    function rejectPayeeAgreement(uint256 dealId, address candidatePayee)
        external
        onlyPayer(dealId)
    {
        if (candidateDocuments[dealId][candidatePayee] == bytes32(0)) revert DocumentNotFound();

        delete candidateDocuments[dealId][candidatePayee];

        address[] storage candidates = candidatePayees[dealId];
        uint256 len = candidates.length;
        for (uint256 i = 0; i < len; i++) {
            if (candidates[i] == candidatePayee) {
                candidates[i] = candidates[len - 1];
                candidates.pop();
                break;
            }
        }
        emit PayeeAgreementRejected(dealId, candidatePayee);
    }

    /**
     * @notice Signs a specific document (A or B) using EIP-712.
     */
    function signDocument(
        uint256 dealId,
        uint8 docIndex,
        bytes calldata signature
    ) external {
        AgreementDoc storage doc = agreements[dealId][docIndex];
        if (!doc.exists) revert DocumentDoesNotExist();

        address payer = dealPayer[dealId];
        address payee = dealPayee[dealId];

        bool isPayer = msg.sender == payer;
        bool isPayee = msg.sender == payee;
        if (!isPayer && !isPayee) revert NotPayerOrPayee();

        if (isPayer && doc.payerSigned) revert AlreadySigned();
        if (isPayee && doc.payeeSigned) revert AlreadySigned();

        bytes32 structHash = keccak256(
            abi.encode(AGREEMENT_TYPEHASH, dealId, docIndex, doc.contentHash)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        if (digest.recover(signature) != msg.sender) revert InvalidSignature();

        if (isPayer) {
            doc.payerSigned = true;
        } else {
            doc.payeeSigned = true;
        }

        emit DocumentSigned(dealId, docIndex, msg.sender);

        if (haveBothSigned(dealId)) {
            emit BothDocumentsSigned(dealId);
        }
    }

    /**
     * @notice Gate check verifying both parties have fully signed both documents.
     */
    function haveBothSigned(uint256 dealId) public view returns (bool) {
        AgreementDoc storage docA = agreements[dealId][DOC_A];
        AgreementDoc storage docB = agreements[dealId][DOC_B];

        return dealPayee[dealId] != address(0)
            && docA.exists
            && docA.payerSigned
            && docA.payeeSigned
            && docB.exists
            && docB.payerSigned
            && docB.payeeSigned;
    }

    function getCandidatePayees(uint256 dealId) external view returns (address[] memory) {
        return candidatePayees[dealId];
    }

    function getDocumentStatus(uint256 dealId, uint8 docIndex)
        external
        view
        returns (
            bytes32 contentHash,
            bool payerSigned,
            bool payeeSigned,
            bool exists
        )
    {
        AgreementDoc storage doc = agreements[dealId][docIndex];
        return (doc.contentHash, doc.payerSigned, doc.payeeSigned, doc.exists);
    }

    function getSigningDigest(uint256 dealId, uint8 docIndex)
        external
        view
        returns (bytes32)
    {
        AgreementDoc storage doc = agreements[dealId][docIndex];
        if (!doc.exists) revert DocumentDoesNotExist();

        bytes32 structHash = keccak256(
            abi.encode(AGREEMENT_TYPEHASH, dealId, docIndex, doc.contentHash)
        );
        return _hashTypedDataV4(structHash);
    }

    function getCandidateSigningDigest(uint256 dealId, address candidatePayee)
        external
        view
        returns (bytes32)
    {
        bytes32 docHash = candidateDocuments[dealId][candidatePayee];
        if (docHash == bytes32(0)) revert DocumentNotFound();

        bytes32 structHash = keccak256(
            abi.encode(AGREEMENT_TYPEHASH, dealId, DOC_B, docHash)
        );
        return _hashTypedDataV4(structHash);
    }

    function getDocumentHashByDeal(uint256 dealId) external view returns (bytes32 docAHash, bytes32 docBHash) {
        docAHash = agreements[dealId][DOC_A].contentHash;
        docBHash = agreements[dealId][DOC_B].contentHash;
    }
}