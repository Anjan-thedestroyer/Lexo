// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";

/**
 * @title AgreementRegistry
 * @author Abinash Paudel
 * @notice Stores and verifies two EIP-712 signed agreement documents per escrow deal.
 *         Both the payer and payee must sign BOTH documents before EscrowCore is
 *         allowed to accept funding for that deal.
 *
 * @dev Design rationale — why one contract, not two:
 *      Two separately deployed contracts per deal would require EscrowCore to accept
 *      arbitrary external addresses, with no guarantee those addresses are legitimate
 *      Lexo agreement contracts rather than spoofed ones. One trusted registry address
 *      (set once, referenced by EscrowCore) is simpler, cheaper, and safer.
 *
 *      Document structure:
 *        - Document A is written by the payer (their terms, obligations, milestone
 *          descriptions, any conditions they impose on the payee).
 *        - Document B is written by the payee (their terms, deliverable commitments,
 *          any conditions they impose on the payer).
 *        - BOTH parties must sign BOTH documents — this prevents one party from
 *          ignoring the other's terms.
 *
 *      EIP-712 is used for all signatures so that the user's wallet shows a
 *      human-readable prompt (not a blind hex blob) before signing. The typehash
 *      binds together the deal ID, the document index (A=0 or B=1), and the
 *      keccak256 hash of the document text, so a signature is invalidated if any
 *      of those three things changes.
 *
 *      EscrowCore calls `haveBothSigned(dealId)` as a gate before accepting funding.
 *      This is a live view call — there is no push/notification from this contract
 *      to EscrowCore. Stale-state risk is zero because the check happens at the exact
 *      moment of the funding transaction, not earlier.
 */
contract AgreementRegistry is EIP712 {
    using ECDSA for bytes32;

    /// @notice The identity registry — only verified, unrestricted wallets may
    ///         submit or sign agreements.
    IIdentityRegister public immutable identityRegister;

    /// @notice EscrowCore's address — the only contract allowed to call
    ///         `haveBothSigned` in a gas-efficient way. View functions are
    ///         actually callable by anyone (Solidity visibility), but we store
    ///         this for documentation clarity and potential future gating.
    address public escrowCore;

    /// @dev EIP-712 typehash for a single agreement document signature.
    ///      Binds: dealId, docIndex (0=A payer's doc, 1=B payee's doc),
    ///      and the keccak256 of the document content.
    bytes32 private constant AGREEMENT_TYPEHASH = keccak256(
        "AgreementDoc(uint256 dealId,uint8 docIndex,bytes32 contentHash)"
    );

    /// @notice Index constants for document A and document B.
    uint8 public constant DOC_A = 0; // payer's document
    uint8 public constant DOC_B = 1; // payee's document

    /// @notice One agreement document: its content hash and the two required signatures.
    struct AgreementDoc {
        bytes32 contentHash;    // keccak256 of the raw document text
        bool payerSigned;       // payer has signed this document
        bool payeeSigned;       // payee has signed this document
        bool exists;            // guard against acting on uninitialised structs
    }

    /// @notice dealId => docIndex (0 or 1) => AgreementDoc.
    mapping(uint256 => mapping(uint8 => AgreementDoc)) private agreements;

    /// @notice dealId => payer address (set when Document A is submitted).
    mapping(uint256 => address) public dealPayer;

    /// @notice dealId => payee address (set when Document B is submitted).
    mapping(uint256 => address) public dealPayee;

    event DocumentSubmitted(uint256 indexed dealId, uint8 indexed docIndex, address indexed submitter, bytes32 contentHash);
    event DocumentSigned(uint256 indexed dealId, uint8 indexed docIndex, address indexed signer);
    event BothDocumentsSigned(uint256 indexed dealId);

    error NotVerified();
    error DocumentAlreadyExists();
    error DocumentDoesNotExist();
    error AlreadySigned();
    error InvalidSignature();
    error NotPayerOrPayee();
    error PayerAlreadySet();
    error PayeeAlreadySet();
    error EscrowCoreAlreadySet();
    error NotEscrowCore();

    modifier onlyVerified() {
        if (!identityRegister.isVerified(msg.sender)) revert NotVerified();
        _;
    }

    constructor(address _identityRegister)
        EIP712("Lexo AgreementRegistry", "1")
    {
        identityRegister = IIdentityRegister(_identityRegister);
    }

    /**
     * @notice Sets the EscrowCore address. One-time call — cannot be changed after
     *         being set, to prevent the registry being re-pointed at a malicious escrow.
     * @dev Called by the deployer script immediately after EscrowCore is deployed.
     * @param _escrowCore The deployed EscrowCore contract address.
     */
    function setEscrowCore(address _escrowCore) external {
        if (escrowCore != address(0)) revert EscrowCoreAlreadySet();
        escrowCore = _escrowCore;
    }

    /**
     * @notice Submits Document A (the payer's terms) for a deal.
     * @dev Caller becomes the payer for this deal. Cannot be called twice for the
     *      same dealId. The document is not signed by submission — the payer must
     *      separately call `signDocument` to sign it (and also sign Document B
     *      when the payee submits it).
     * @param dealId The escrow deal this agreement belongs to.
     * @param documentText The raw plaintext of the payer's agreement terms.
     */
    function submitPayerDocument(uint256 dealId, string calldata documentText)
        external
        onlyVerified
    {
        if (agreements[dealId][DOC_A].exists) revert DocumentAlreadyExists();
        if (dealPayer[dealId] != address(0)) revert PayerAlreadySet();

        bytes32 contentHash = keccak256(bytes(documentText));
        agreements[dealId][DOC_A] = AgreementDoc({
            contentHash: contentHash,
            payerSigned: false,
            payeeSigned: false,
            exists: true
        });
        dealPayer[dealId] = msg.sender;

        emit DocumentSubmitted(dealId, DOC_A, msg.sender, contentHash);
    }

    /**
     * @notice Submits Document B (the payee's terms) for a deal.
     * @dev Caller becomes the payee for this deal. Document A must already exist
     *      (the payer must submit their document first) so both parties are known
     *      before the payee sets their terms.
     * @param dealId The escrow deal this agreement belongs to.
     * @param documentText The raw plaintext of the payee's agreement terms.
     */
    function submitPayeeDocument(uint256 dealId, string calldata documentText)
        external
        onlyVerified
    {
        if (!agreements[dealId][DOC_A].exists) revert DocumentDoesNotExist();
        if (agreements[dealId][DOC_B].exists) revert DocumentAlreadyExists();
        if (dealPayee[dealId] != address(0)) revert PayeeAlreadySet();

        bytes32 contentHash = keccak256(bytes(documentText));
        agreements[dealId][DOC_B] = AgreementDoc({
            contentHash: contentHash,
            payerSigned: false,
            payeeSigned: false,
            exists: true
        });
        dealPayee[dealId] = msg.sender;

        emit DocumentSubmitted(dealId, DOC_B, msg.sender, contentHash);
    }

    /**
     * @notice Signs a specific document (A or B) for a given deal using an
     *         EIP-712 signature generated off-chain by the caller's wallet.
     * @dev The signature must be over (dealId, docIndex, contentHash) — any
     *      change to the document content invalidates prior signatures. The
     *      caller must be either the payer or the payee for this deal.
     * @param dealId The deal whose document is being signed.
     * @param docIndex Which document to sign: DOC_A (0) or DOC_B (1).
     * @param signature The EIP-712 signature from the caller's wallet.
     */
    function signDocument(
        uint256 dealId,
        uint8 docIndex,
        bytes calldata signature
    ) external onlyVerified {
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
     * @notice Returns true if and only if both parties have signed both documents.
     * @dev This is the function EscrowCore calls as a gate before accepting
     *      funding. It is a pure view — no state changes, no gas cost beyond
     *      the SLOAD calls. Both documents must exist AND both must have
     *      payerSigned == true AND payeeSigned == true.
     * @param dealId The deal to check.
     * @return True if both documents are fully signed by both parties.
     */
    function haveBothSigned(uint256 dealId) public view returns (bool) {
        AgreementDoc storage docA = agreements[dealId][DOC_A];
        AgreementDoc storage docB = agreements[dealId][DOC_B];

        return docA.exists
            && docA.payerSigned
            && docA.payeeSigned
            && docB.exists
            && docB.payerSigned
            && docB.payeeSigned;
    }

    /**
     * @notice Returns the full signing status for a specific document.
     * @param dealId The deal to query.
     * @param docIndex Which document: DOC_A (0) or DOC_B (1).
     * @return contentHash The keccak256 hash of the document text.
     * @return payerSigned Whether the payer has signed this document.
     * @return payeeSigned Whether the payee has signed this document.
     * @return exists Whether the document has been submitted at all.
     */
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

    /**
     * @notice Returns the EIP-712 digest that a signer must produce a signature
     *         over for a given document — lets the backend/frontend verify a
     *         signature will recover correctly before asking the user to sign.
     * @param dealId The deal.
     * @param docIndex Which document: DOC_A (0) or DOC_B (1).
     * @return The EIP-712 typed-data digest to be signed.
     */
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
}
