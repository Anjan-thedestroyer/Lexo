// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {AgreementRegistry} from "../../src/core/AgreementRegistry.sol";
import {IIdentityRegister} from "../../src/interfaces/IIdentityRegister.sol";
import {MockEscrowCore} from "../mocks/MockEscrow.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";

/* ========================================================================= */
/*                              MOCK CONTRACTS                               */
/* ========================================================================= */

contract MockIdentityRegister is IIdentityRegister {
    mapping(address => bool) public verifiedUsers;

    function setVerified(address user, bool verified) external {
        verifiedUsers[user] = verified;
    }

    function isVerified(address wallet) external view override returns (bool) {
        return verifiedUsers[wallet];
    }

    function verifier() external pure override returns (address) { return address(0); }
    function coreAgreement() external pure override returns (address) { return address(0); }
    function MAX_WALLET() external pure override returns (uint256) { return 5; }
    function walletToIdentity(address) external pure override returns (bytes32) { return bytes32(0); }
    function restricted(bytes32) external pure override returns (bool) { return false; }
    function nonces(address) external pure override returns (uint256) { return 0; }

    function addVerifier(address) external override {}
    function registerWithAttestation(bytes32, uint256, bytes calldata) external override {}
    function unverify(bytes32) external override {}
    function restrict(bytes32) external override {}
    function unrestrict(bytes32) external override {}
    function removeWallet(bytes32, address) external override {}
    function changeRootWallet(bytes32, address) external override {}

    function getAttestationDigest(address, bytes32, uint256, uint256) external pure override returns (bytes32) {
        return bytes32(0);
    }

    function getIdentity(bytes32)
        external
        pure
        override
        returns (
            bool isVerifiedStatus,
            bool isRestrictedStatus,
            address root,
            address[] memory walletList
        )
    {
        address[] memory empty = new address[](0);
        return (false, false, address(0), empty);
    }

    function getIdentityHashByWallet(address) external pure override returns (bytes32) {
        return bytes32(0);
    }

    function getWallets(bytes32) external pure override returns (address[] memory) {
        return new address[](0);
    }

    function walletCount(bytes32) external pure override returns (uint256) {
        return 0;
    }
}

/* ========================================================================= */
/*                              TEST SUITE                                   */
/* ========================================================================= */

contract AgreementRegistryTest is Test {
    AgreementRegistry public registry;
    MockIdentityRegister public identityRegister;
    MockEscrowCore public escrowCore;

    uint256 internal payerPrivateKey = 0xA11CE;
    uint256 internal payeePrivateKey = 0xB0B;
    uint256 internal attackerPrivateKey = 0xBAD;

    address public payer;
    address public payee;
    address public attacker;

    uint256 public constant DEAL_ID = 1;
    bytes32 public constant DOC_A_HASH = keccak256("DOC_A_TERMS");
    bytes32 public constant DOC_B_HASH = keccak256("DOC_B_TERMS");

    event DocumentSubmitted(uint256 indexed dealId, uint8 indexed docIndex, address indexed submitter, bytes32 contentHash);
    event PayeeAgreementAccepted(uint256 indexed dealId, address indexed selectedPayee, bytes32 contentHash);
    event PayeeAgreementRejected(uint256 indexed dealId, address indexed candidatePayee);
    event DocumentSigned(uint256 indexed dealId, uint8 indexed docIndex, address indexed signer);
    event BothDocumentsSigned(uint256 indexed dealId);

    function setUp() public {
        payer = vm.addr(payerPrivateKey);
        payee = vm.addr(payeePrivateKey);
        attacker = vm.addr(attackerPrivateKey);

        identityRegister = new MockIdentityRegister();
        identityRegister.setVerified(payer, true);
        identityRegister.setVerified(payee, true);

        registry = new AgreementRegistry(address(identityRegister));

        escrowCore = new MockEscrowCore(address(registry), address(new MockUSDT(100_000_000)));
        registry.setEscrowCore(address(escrowCore));
    }

    function test_ConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(AgreementRegistry.ZeroAddress.selector);
        new AgreementRegistry(address(0));
    }

    function test_SetEscrowCore() public {
        AgreementRegistry newRegistry = new AgreementRegistry(address(identityRegister));
        newRegistry.setEscrowCore(address(escrowCore));
        assertEq(newRegistry.escrowCore(), address(escrowCore));
    }

    function test_SetEscrowCoreRevertsWhenAlreadySet() public {
        vm.expectRevert(AgreementRegistry.EscrowCoreAlreadySet.selector);
        registry.setEscrowCore(address(0x999));
    }

    function test_SetEscrowCoreRevertsOnNonOwner() public {
        AgreementRegistry newRegistry = new AgreementRegistry(address(identityRegister));
        vm.prank(attacker);
        vm.expectRevert();
        newRegistry.setEscrowCore(address(escrowCore));
    }

    function test_SubmitPayerDocument() public {        
        vm.prank(address(escrowCore));
        vm.expectEmit(true, true, true, true);
        emit DocumentSubmitted(DEAL_ID, registry.DOC_A(), payer, DOC_A_HASH);
        
        vm.prank(address(escrowCore));
        registry.submitPayerDocument(DEAL_ID, DOC_A_HASH, payer);

        assertEq(registry.dealPayer(DEAL_ID), payer);
        (bytes32 hash, bool payerSigned, bool payeeSigned, bool exists) = registry.getDocumentStatus(DEAL_ID, registry.DOC_A());
        assertEq(hash, DOC_A_HASH);
        assertFalse(payerSigned);
        assertFalse(payeeSigned);
        assertTrue(exists);
    }

    function test_SubmitPayerDocumentRevertsIfNotEscrowCore() public {
        vm.expectRevert(AgreementRegistry.NotAuthorized.selector);
        vm.prank(payer);
        registry.submitPayerDocument(DEAL_ID, DOC_A_HASH, payer);
    }

    function test_SubmitPayerDocumentRevertsIfAlreadyExists() public {
        _submitPayerDoc();

        vm.prank(address(escrowCore));
        vm.expectRevert(AgreementRegistry.DocumentAlreadyExists.selector);
        registry.submitPayerDocument(DEAL_ID, DOC_A_HASH, payer);
    }

    function test_SubmitPayeeDocument() public {
        _submitPayerDoc();

        vm.prank(payee);
        vm.expectEmit(true, true, true, true);
        emit DocumentSubmitted(DEAL_ID, registry.DOC_B(), payee, DOC_B_HASH);
        
        vm.prank(payee);
        registry.submitPayeeDocument(DEAL_ID, DOC_B_HASH);

        assertEq(registry.candidateDocuments(DEAL_ID, payee), DOC_B_HASH);
        assertEq(registry.getCandidatePayees(DEAL_ID)[0], payee);
    }

    function test_SubmitPayeeDocumentRevertsIfNotVerified() public {
        _submitPayerDoc();

        vm.prank(attacker);
        vm.expectRevert(AgreementRegistry.NotVerified.selector);
        registry.submitPayeeDocument(DEAL_ID, DOC_B_HASH);
    }

    function test_SubmitPayeeDocumentRevertsIfDocADoesNotExist() public {
        vm.prank(payee);
        vm.expectRevert(AgreementRegistry.DocumentDoesNotExist.selector);
        registry.submitPayeeDocument(DEAL_ID, DOC_B_HASH);
    }

    function test_SubmitPayeeDocumentRevertsIfAlreadySubmitted() public {
        _submitPayerDoc();

        vm.startPrank(payee);
        registry.submitPayeeDocument(DEAL_ID, DOC_B_HASH);

        vm.expectRevert(AgreementRegistry.AgreementAlreadySubmitted.selector);
        registry.submitPayeeDocument(DEAL_ID, DOC_B_HASH);
        vm.stopPrank();
    }

    function test_AcceptPayeeAgreement() public {
        _submitPayerAndPayeeDoc();

        bytes32 digest = registry.getCandidateSigningDigest(DEAL_ID, payee);
        bytes memory payerSig = _signDigest(payerPrivateKey, digest);

        vm.expectEmit(true, true, true, true);
        emit PayeeAgreementAccepted(DEAL_ID, payee, DOC_B_HASH);
        
        vm.prank(payer);
        registry.acceptPayeeAgreement(DEAL_ID, payee, payerSig);

        assertEq(registry.dealPayee(DEAL_ID), payee);
        (, bool payerSigned,, bool exists) = registry.getDocumentStatus(DEAL_ID, registry.DOC_B());
        assertTrue(payerSigned);
        assertTrue(exists);
    }

    function test_AcceptPayeeAgreementRevertsIfInvalidSignature() public {
        _submitPayerAndPayeeDoc();

        bytes32 digest = registry.getCandidateSigningDigest(DEAL_ID, payee);
        bytes memory invalidSig = _signDigest(payeePrivateKey, digest);

        vm.prank(payer);
        vm.expectRevert(AgreementRegistry.InvalidSignature.selector);
        registry.acceptPayeeAgreement(DEAL_ID, payee, invalidSig);
    }

    function test_RejectPayeeAgreement() public {
        _submitPayerAndPayeeDoc();

        vm.expectEmit(true, true, true, true);
        emit PayeeAgreementRejected(DEAL_ID, payee);

        vm.prank(payer);
        registry.rejectPayeeAgreement(DEAL_ID, payee);

        assertEq(registry.candidateDocuments(DEAL_ID, payee), bytes32(0));
        assertEq(registry.getCandidatePayees(DEAL_ID).length, 0);
    }

    function test_FullSigningFlowAndBothSignedState() public {
    _submitPayerAndPayeeDoc();

    uint8 docA = registry.DOC_A();
    uint8 docB = registry.DOC_B();

    // 1. Payer accepts candidate Doc B
    bytes32 docBDigest = registry.getCandidateSigningDigest(DEAL_ID, payee);
    bytes memory payerDocBSig = _signDigest(payerPrivateKey, docBDigest);
    
    vm.prank(payer);
    registry.acceptPayeeAgreement(DEAL_ID, payee, payerDocBSig);

    // 2. Payer signs Doc A
    bytes32 docADigest = registry.getSigningDigest(DEAL_ID, docA);
    bytes memory payerDocASig = _signDigest(payerPrivateKey, docADigest);
    
    vm.prank(payer); // Now correctly attaches to signDocument
    registry.signDocument(DEAL_ID, docA, payerDocASig);

    // 3. Payee signs Doc A
    bytes memory payeeDocASig = _signDigest(payeePrivateKey, docADigest);
    
    vm.prank(payee);
    registry.signDocument(DEAL_ID, docA, payeeDocASig);

    assertFalse(registry.haveBothSigned(DEAL_ID));

    // 4. Payee signs Doc B -> triggers BothDocumentsSigned
    bytes32 docBFinalDigest = registry.getSigningDigest(DEAL_ID, docB);
    bytes memory payeeDocBSig = _signDigest(payeePrivateKey, docBFinalDigest);

    vm.expectEmit(true, true, true, true);
    emit BothDocumentsSigned(DEAL_ID);

    vm.prank(payee);
    registry.signDocument(DEAL_ID, docB, payeeDocBSig);

    assertTrue(registry.haveBothSigned(DEAL_ID));
}

    function _submitPayerDoc() internal {
        vm.prank(address(escrowCore));
        registry.submitPayerDocument(DEAL_ID, DOC_A_HASH, payer);
    }

    function _submitPayerAndPayeeDoc() internal {
        _submitPayerDoc();
        vm.prank(payee);
        registry.submitPayeeDocument(DEAL_ID, DOC_B_HASH);
    }

    function _signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}