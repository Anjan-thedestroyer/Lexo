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
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS_DENOMINATOR = 10_000;

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

        // --- Cross-Contract Wire-Ups ---
        escrowCore.addArbitrator(address(arbitrationCourt));

        // Allow ArbitrationCourt to transfer funds during dispute execution
        vm.prank(address(escrowCore));
        token.approve(address(arbitrationCourt), type(uint256).max);

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

        vm.startPrank(payer);
        token.approve(address(escrowCore), totalAmount);
        _createEscrow(desc, amounts, payees, DOC_A_HASH);

        uint8 docA = agreementRegistry.DOC_A();
        bytes32 docADigest = agreementRegistry.getSigningDigest(DEAL_ID, docA);
        bytes memory payerDocASig = _signDigest(payerPrivateKey, docADigest);
        agreementRegistry.signDocument(DEAL_ID, docA, payerDocASig);

        (, bool payerSigned,,) = agreementRegistry.getDocumentStatus(DEAL_ID, docA);
        assertTrue(payerSigned, "Payer failed to sign Document A");
        vm.stopPrank();

        vm.startPrank(payee);
        agreementRegistry.submitPayeeDocument(DEAL_ID, DOC_B_HASH);
        vm.stopPrank();

        vm.startPrank(payer);
        bytes32 docBDigest = agreementRegistry.getCandidateSigningDigest(DEAL_ID, payee);
        bytes memory payerDocBSig = _signDigest(payerPrivateKey, docBDigest);
        agreementRegistry.acceptPayeeAgreement(DEAL_ID, payee, payerDocBSig);

        assertEq(agreementRegistry.dealPayee(DEAL_ID), payee, "Payee address mismatch");
        (, bool docBPayerSigned,, bool docBExists) = agreementRegistry.getDocumentStatus(DEAL_ID, agreementRegistry.DOC_B());
        assertTrue(docBExists, "Document B should exist");
        assertTrue(docBPayerSigned, "Payer should have signed Document B");
        vm.stopPrank();

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
        uint256 prevBal = token.balanceOf(payee);
        uint256 remainingBal = escrowCore.pendingWithdrawals(payee);
        uint256 fee = (remainingBal * FEE_BPS) / BPS_DENOMINATOR;
        escrowCore.withdraw();
        uint256 currBal = token.balanceOf(payee);
        vm.stopPrank();
        
        assertEq(currBal, prevBal + (remainingBal - fee), "s");
    }

    function test_FullWorkflow_Conflict_happy() public {
        address arbiter2 = address(0x304);
        address arbiter3 = address(0x305);
        bytes32 arbiter2Identity = keccak256("ARBITER2_ID");
        bytes32 arbiter3Identity = keccak256("ARBITER3_ID");

        vm.prank(arbiter2);
        coreAgreement.signAgreement();
        _registerIdentity(arbiter2, arbiter2Identity);

        vm.prank(arbiter3);
        coreAgreement.signAgreement();
        _registerIdentity(arbiter3, arbiter3Identity);

        token.mint(arbiter, STAKE_AMOUNT);
        token.mint(arbiter2, STAKE_AMOUNT);
        token.mint(arbiter3, STAKE_AMOUNT);

        vm.startPrank(arbiter);
        token.approve(address(arbitratorRegistry), STAKE_AMOUNT);
        arbitratorRegistry.addArbitrator(STAKE_AMOUNT);
        vm.stopPrank();

        vm.startPrank(arbiter2);
        token.approve(address(arbitratorRegistry), STAKE_AMOUNT);
        arbitratorRegistry.addArbitrator(STAKE_AMOUNT);
        vm.stopPrank();

        vm.startPrank(arbiter3);
        token.approve(address(arbitratorRegistry), STAKE_AMOUNT);
        arbitratorRegistry.addArbitrator(STAKE_AMOUNT);
        vm.stopPrank();

        arbitratorRegistry.setArbitrationCourt(address(arbitrationCourt));

        string[] memory desc = new string[](1);
        desc[0] = "Single Milestone Project";
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = ESCROW_AMOUNT;

        address[] memory payees = new address[](1);
        payees[0] = payee;

        vm.startPrank(payer);
        token.approve(address(escrowCore), ESCROW_AMOUNT);
        uint256 dealId = _createEscrow(desc, amounts, payees, DOC_A_HASH);

        uint8 docA = agreementRegistry.DOC_A();
        bytes32 docADigest = agreementRegistry.getSigningDigest(dealId, docA);
        bytes memory payerDocASig = _signDigest(payerPrivateKey, docADigest);
        agreementRegistry.signDocument(dealId, docA, payerDocASig);
        vm.stopPrank();

        vm.startPrank(payee);
        agreementRegistry.submitPayeeDocument(dealId, DOC_B_HASH);
        vm.stopPrank();

        vm.startPrank(payer);
        bytes32 docBDigest = agreementRegistry.getCandidateSigningDigest(dealId, payee);
        bytes memory payerDocBSig = _signDigest(payerPrivateKey, docBDigest);
        agreementRegistry.acceptPayeeAgreement(dealId, payee, payerDocBSig);
        vm.stopPrank();

        vm.startPrank(payee);
        bytes32 docACompleteDigest = agreementRegistry.getSigningDigest(dealId, docA);
        bytes memory payeeDocASig = _signDigest(payeePrivateKey, docACompleteDigest);
        agreementRegistry.signDocument(dealId, docA, payeeDocASig);

        bytes32 docBCompleteDigest = agreementRegistry.getSigningDigest(dealId, agreementRegistry.DOC_B());
        bytes memory payeeDocBSig = _signDigest(payeePrivateKey, docBCompleteDigest);
        agreementRegistry.signDocument(dealId, agreementRegistry.DOC_B(), payeeDocBSig);
        vm.stopPrank();

        uint256 courtBalanceBefore = token.balanceOf(address(arbitrationCourt));

        vm.prank(payer);
        escrowCore.raiseDispute(dealId, "Deliverable incomplete");

        // Single Fee: 1% Arbitration Fee (10 USDT) transferred to ArbitrationCourt
        uint256 arbitrationFee = ESCROW_AMOUNT / 100; // 10 USDT
        uint256 expectedEscrowBalance = ESCROW_AMOUNT - arbitrationFee; // 990 USDT

        assertEq(
            escrowCore.getDealTotalBalance(dealId),
            expectedEscrowBalance,
            "Deal balance in EscrowCore should be 990 USDT after 1% arbitration fee deduction"
        );
        assertEq(
            token.balanceOf(address(arbitrationCourt)) - courtBalanceBefore,
            arbitrationFee,
            "Arbitration court should receive exactly 10 USDT (1% fee)"
        );

        uint256 caseId = 1;

        address[] memory assignedArbiters = arbitrationCourt.getCaseArbiters(caseId);
        assertEq(assignedArbiters.length, 3, "Should have 3 assigned arbiters");

        for (uint256 i = 0; i < assignedArbiters.length; i++) {
            vm.prank(assignedArbiters[i]);
            arbitrationCourt.castVote(caseId, ArbitrationCourt.VoteChoice.Split5050);
        }

        vm.warp(block.timestamp + arbitrationCourt.VOTING_DURATION() + 1 seconds);

        arbitrationCourt.resolveCase(caseId);

        (,,,,,, ArbitrationCourt.CaseStatus status,,,,, ArbitrationCourt.VoteChoice winningChoice,,) = arbitrationCourt.cases(caseId);
        assertEq(uint8(status), uint8(ArbitrationCourt.CaseStatus.Decided), "Case should be Decided");
        assertEq(uint8(winningChoice), uint8(ArbitrationCourt.VoteChoice.Split5050), "Winning choice should be Split5050");

        vm.warp(block.timestamp + arbitrationCourt.EXECUTION_DELAY() + 1 seconds);

        uint256 payerBalanceBefore = token.balanceOf(payer);
        uint256 payeeBalanceBefore = token.balanceOf(payee);

        arbitrationCourt.executeCase(caseId);

        // 50/50 Split of remaining 990 USDT pool in EscrowCore = 495 USDT each gross
        uint256 expectedPayerGross = expectedEscrowBalance / 2; // 495 USDT
        uint256 expectedPayeeGross = expectedEscrowBalance - expectedPayerGross; // 495 USDT

        // EscrowCore applies protocolFeeBps (100 BPS = 1%) during resolveDispute
        uint256 protocolFeePayer = (expectedPayerGross * escrowCore.protocolFeeBps()) / BPS_DENOMINATOR; // 4.95 USDT
        uint256 protocolFeePayee = (expectedPayeeGross * escrowCore.protocolFeeBps()) / BPS_DENOMINATOR; // 4.95 USDT

        uint256 expectedPayerPending = expectedPayerGross - protocolFeePayer; // 490.05 USDT
        uint256 expectedPayeePending = expectedPayeeGross - protocolFeePayee; // 490.05 USDT

        assertEq(
            escrowCore.pendingWithdrawals(payer),
            expectedPayerPending,
            "Payer pending withdrawal should be 490.05 USDT"
        );
        assertEq(
            escrowCore.pendingWithdrawals(payee),
            expectedPayeePending,
            "Payee pending withdrawal should be 490.05 USDT"
        );

        vm.prank(payer);
        escrowCore.withdraw();

        vm.prank(payee);
        escrowCore.withdraw();

        // EscrowCore.withdraw() applies FEE_BPS (30 BPS = 0.3%) withdrawal fee
        uint256 payerWithdrawalFee = (expectedPayerPending * escrowCore.FEE_BPS()) / BPS_DENOMINATOR;
        uint256 payeeWithdrawalFee = (expectedPayeePending * escrowCore.FEE_BPS()) / BPS_DENOMINATOR;

        uint256 expectedPayerNet = expectedPayerPending - payerWithdrawalFee;
        uint256 expectedPayeeNet = expectedPayeePending - payeeWithdrawalFee;

        assertEq(token.balanceOf(payer), payerBalanceBefore + expectedPayerNet, "Payer receives net refund after withdrawal fee");
        assertEq(token.balanceOf(payee), payeeBalanceBefore + expectedPayeeNet, "Payee receives net payout after withdrawal fee");
    }

    function _createEscrow(
        string[] memory _description,
        uint256[] memory _amount,
        address[] memory _invitedPayees,
        bytes32 _documentHash
    ) internal returns (uint256 dealId) {
        return escrowCore.createDeal(_description, _amount, _invitedPayees, _documentHash);
    }

    function _signAttestation(
        uint256 pKey,
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    ) internal view returns (bytes memory) {
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

    function _signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}