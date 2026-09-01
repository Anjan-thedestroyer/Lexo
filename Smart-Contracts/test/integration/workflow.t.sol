// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CoreAgreement} from "../../src/core/CoreAgreement.sol";
import {IdentityRegister} from "../../src/core/IdentityRegister.sol";
import {AgreementRegistry} from "../../src/core/AgreementRegistry.sol";
import {EscrowCore} from "../../src/core/EscrowCore.sol";
import {ArbitratorRegistry} from "../../src/arbitration/ArbitratorRegistry.sol";
import {ArbitrationCourt} from "../../src/arbitration/ArbitrationCourt.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ICoreAgreement} from "../../src/interfaces/ICoreAgreement.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";

contract WorkflowIntegrationTest is Test {
    MockUSDT public token;
    CoreAgreement public coreAgreement;
    IdentityRegister public identityRegister;
    AgreementRegistry public agreementRegistry;
    EscrowCore public escrowCore;
    ArbitratorRegistry public arbitratorRegistry;
    ArbitrationCourt public arbitrationCourt;

    uint256 internal verifierPrivateKey = 0xA11CE;
    address public verifierAddress;

    uint256 internal payerPrivateKey = 0xB0B;
    uint256 internal payeePrivateKey = 0xCAFE;

    address public client = address(0x101);
    address public payer;
    address public payee;
    address public provider = address(0x202);
    address public arbiter = address(0x303);
    address public feeRecipient = address(0x404);

    bytes32 public clientIdentity = keccak256("CLIENT_ID");
    bytes32 public payerIdentity = keccak256("PAYER_ID");
    bytes32 public payeeIdentity = keccak256("PAYEE_ID");
    bytes32 public providerIdentity = keccak256("PROVIDER_ID");
    bytes32 public arbiterIdentity = keccak256("ARBITER_ID");
    bytes32 public constant AGREEMENT_HASH = keccak256("TERMS_V1");

    // Matches IdentityRegister.sol EXACTLY
    bytes32 private constant REGISTER_IDENTITY_TYPEHASH = keccak256(
        "RegisterIdentity(address wallet,bytes32 identityHash,uint256 nonce,uint256 deadline)"
    );

    uint256 public constant STAKE_AMOUNT = 500 * 1e6;
    uint256 public constant ESCROW_AMOUNT = 1_000 * 1e6;

    uint256 public constant DEAL_ID = 1;
    bytes32 public constant DOC_A_HASH = keccak256("DOC_A_TERMS");
    bytes32 public constant DOC_B_HASH = keccak256("DOC_B_TERMS");

    function setUp() public {
        payer = vm.addr(payerPrivateKey);
        payee = vm.addr(payeePrivateKey);

        token = new MockUSDT(100_000_000);

        coreAgreement = new CoreAgreement(AGREEMENT_HASH);

        identityRegister = new IdentityRegister(
            ICoreAgreement(address(coreAgreement))
        );

        agreementRegistry = new AgreementRegistry(
            address(identityRegister)
        );

        escrowCore = new EscrowCore(
            address(token),
            address(identityRegister),
            address(agreementRegistry),
            feeRecipient
        );

        arbitratorRegistry = new ArbitratorRegistry(
            address(identityRegister),
            token
        );

        arbitrationCourt = new ArbitrationCourt(
            address(token),
            address(identityRegister),
            address(arbitratorRegistry),
            address(escrowCore)
        );

        verifierAddress = vm.addr(verifierPrivateKey);
        identityRegister.setVerifier(verifierAddress);

        agreementRegistry.setEscrowCore(address(escrowCore));

        vm.prank(client);
        coreAgreement.signAgreement();

        vm.prank(provider);
        coreAgreement.signAgreement();

        vm.prank(arbiter);
        coreAgreement.signAgreement();

        vm.prank(payer);
        coreAgreement.signAgreement();

        vm.prank(payee);
        coreAgreement.signAgreement();

        // Register identities via verifier attestations
        _registerIdentity(client, clientIdentity);
        _registerIdentity(provider, providerIdentity);
        _registerIdentity(arbiter, arbiterIdentity);
        _registerIdentity(payer, payerIdentity);
        _registerIdentity(payee, payeeIdentity);

        token.mint(client, 10_000 * 1e6);
        token.mint(provider, 10_000 * 1e6);
        token.mint(arbiter, 10_000 * 1e6);
        token.mint(payer, 10_0000 * 1e6);
    }

    function test_FullWorkflow_createEscrowAndCompleteFull_happy() public {
        string[] memory desc = new string[](2);
        desc[0] = "Milestone 1";
        desc[1] = "Milestone 2";
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 300 * 1e6;
        amounts[1] = 700 * 1e6;

        address[] memory payees = new address[](1);
        payees[0] = payee;

        uint256 totalAmount = 1_000 * 1e6;

        // 1. Create escrow as payer
        vm.startPrank(payer);
        token.approve(address(escrowCore), totalAmount);
        _createEscrow(desc, amounts, payees, DOC_A_HASH);

        // 2. Sign Document A as Payer using AgreementRegistry EIP-712 Digest
        uint8 docA = agreementRegistry.DOC_A();
        bytes32 docADigest = agreementRegistry.getSigningDigest(DEAL_ID, docA);
        bytes memory payerDocASig = _signDigest(payerPrivateKey, docADigest);
        agreementRegistry.signDocument(DEAL_ID, docA, payerDocASig);

        (, bool payerSigned,,) = agreementRegistry.getDocumentStatus(DEAL_ID, docA);
        assertTrue(payerSigned, "Payer failed to sign Document A");
        vm.stopPrank();

        // 3. Payee submits Document B terms
        vm.startPrank(payee);
        agreementRegistry.submitPayeeDocument(DEAL_ID, DOC_B_HASH);
        vm.stopPrank();

        // 4. Payer accepts Payee's Document B via EIP-712 Candidate Digest
        vm.startPrank(payer);
        bytes32 docBDigest = agreementRegistry.getCandidateSigningDigest(DEAL_ID, payee);
        bytes memory payerDocBSig = _signDigest(payerPrivateKey, docBDigest);
        agreementRegistry.acceptPayeeAgreement(DEAL_ID, payee, payerDocBSig);

        assertEq(agreementRegistry.dealPayee(DEAL_ID), payee, "Payee address mismatch");
        (, bool docBPayerSigned,, bool docBExists) = agreementRegistry.getDocumentStatus(DEAL_ID, agreementRegistry.DOC_B());
        assertTrue(docBExists, "Document B should exist");
        assertTrue(docBPayerSigned, "Payer should have signed Document B");
        vm.stopPrank();

        // 5. Payee signs Document A and Document B using AgreementRegistry Digests
        vm.startPrank(payee);
        bytes32 docACompleteDigest = agreementRegistry.getSigningDigest(DEAL_ID, docA);
        bytes memory payeeDocASig = _signDigest(payeePrivateKey, docACompleteDigest);
        agreementRegistry.signDocument(DEAL_ID, docA, payeeDocASig);

        bytes32 docBCompleteDigest = agreementRegistry.getSigningDigest(DEAL_ID, agreementRegistry.DOC_B());
        bytes memory payeeDocBSig = _signDigest(payeePrivateKey, docBCompleteDigest);
        agreementRegistry.signDocument(DEAL_ID, agreementRegistry.DOC_B(), payeeDocBSig);

        assertTrue(agreementRegistry.haveBothSigned(DEAL_ID), "Both documents must be signed by both parties");
        vm.stopPrank();

        vm.startPrank(payer);
        escrowCore.approveAndReleaseMilestone(DEAL_ID);
        escrowCore.approveAndReleaseMilestone(DEAL_ID);
        vm.stopPrank();
        
        vm.startPrank(payee);
        escrowCore.withdraw();
        vm.stopPrank();

    }

    function _createEscrow(
        string[] memory _description,
        uint256[] memory _amount,
        address[] memory _invitedPayees,
        bytes32 _documentHash
    ) internal returns (uint256 dealId) {
        return escrowCore.createDeal(_description, _amount, _invitedPayees, _documentHash);
    }

    /// @dev Helper strictly for IdentityRegister off-chain verifier attestations
    function _signAttestation(
        uint256 pKey,
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    ) internal view returns (bytes memory) {
        // Encodes in exact order: wallet, identityHash, nonce, deadline
        bytes32 structHash = keccak256(
            abi.encode(REGISTER_IDENTITY_TYPEHASH, wallet, identityHash, nonce, deadline)
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Lexo IdentityRegister")),
                keccak256(bytes("1")),
                block.chainid,
                address(identityRegister)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _registerIdentity(
        address wallet,
        bytes32 identityHash
    ) internal {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = identityRegister.nonces(wallet);

        bytes memory signature = _signAttestation(
            verifierPrivateKey,
            wallet,
            identityHash,
            deadline,
            nonce
        );

        vm.prank(wallet);
        identityRegister.registerIdentityWithAttestation(
            wallet,
            identityHash,
            deadline,
            signature
        );
    }

    /// @dev Raw ECDSA signature helper for pre-computed EIP-712 digests
    function _signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}