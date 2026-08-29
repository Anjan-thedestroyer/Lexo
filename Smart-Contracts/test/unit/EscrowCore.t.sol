// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test, console} from "forge-std/Test.sol";
import {EscrowCore} from "../../src/core/EscrowCore.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockIdentityRegister} from "../mocks/MockIdentity.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface IAgreementRegistryMock {
    function submitPayerDocument(uint256 dealId, bytes32 docHash, address payer) external;
    function dealPayee(uint256 dealId) external view returns (address);
    function haveBothSigned(uint256 dealId) external view returns (bool);
    function getDocumentHashByDeal(uint256 dealId) external view returns (bytes32, bytes32);
}
interface IArbitrationCourtMock {
    function createCase(uint256 dealId, string calldata reason, bytes32 docA, bytes32 docB, uint256 fee) external returns (uint256);
    function recreateCase(uint256 caseId, string calldata reason, uint256 fee) external returns (uint256);
}

// Minimal Mocks for external dependencies
contract MockAgreementRegistry is IAgreementRegistryMock {
    mapping(uint256 => address) public dealPayeeMap;
    mapping(uint256 => bool) public bothSignedMap;
    mapping(uint256 => bytes32) public docAMap;
    mapping(uint256 => bytes32) public docBMap;

    function submitPayerDocument(uint256 dealId, bytes32 docHash, address) external override {
        docAMap[dealId] = docHash;
    }

    function setPayee(uint256 dealId, address payee) external {
        dealPayeeMap[dealId] = payee;
    }

    function setBothSigned(uint256 dealId, bool signed) external {
        bothSignedMap[dealId] = signed;
    }

    function setDocHashes(uint256 dealId, bytes32 docA, bytes32 docB) external {
        docAMap[dealId] = docA;
        docBMap[dealId] = docB;
    }

    function dealPayee(uint256 dealId) external view override returns (address) {
        return dealPayeeMap[dealId];
    }

    function haveBothSigned(uint256 dealId) external view override returns (bool) {
        return bothSignedMap[dealId];
    }

    function getDocumentHashByDeal(uint256 dealId) external view override returns (bytes32, bytes32) {
        return (docAMap[dealId], docBMap[dealId]);
    }
}

contract MockArbitrationCourt is IArbitrationCourtMock {
    uint256 public nextCaseId = 1;

    function createCase(uint256, string calldata, bytes32, bytes32, uint256) external override returns (uint256) {
        return nextCaseId++;
    }

    function recreateCase(uint256, string calldata, uint256) external override returns (uint256) {
        return nextCaseId++;
    }
}

contract EscrowCoreTest is Test {
    EscrowCore public escrow;

    MockUSDT public token;
    MockIdentityRegister public identityRegister;
    MockAgreementRegistry public agreementRegistry;
    MockArbitrationCourt public arbiter;

    // Test Keys and Addresses
    uint256 internal payerPrivateKey = 0xA11CE;
    uint256 internal payeePrivateKey = 0xB0B;

    address public payer;
    address public payee;
    address public feeRecipient = address(0xFE3);
    address public unverifiedUser = address(0x999);

    // EIP-712 Domain Separator constants
    bytes32 public constant CANCEL_DEAL_TYPEHASH =
        keccak256("CancelDeal(uint256 dealId,uint256 nonce,uint256 deadline)");

    function setUp() public {
        payer = vm.addr(payerPrivateKey);
        payee = vm.addr(payeePrivateKey);

        // 1. Deploy dependencies
        token = new MockUSDT(100_000_000);
        identityRegister = new MockIdentityRegister();
        agreementRegistry = new MockAgreementRegistry();
        arbiter = new MockArbitrationCourt();

        // 2. Deploy EscrowCore target
        escrow = new EscrowCore(
            address(token),
            address(identityRegister),
            address(agreementRegistry),
            feeRecipient
        );

        // 3. Configure state
        escrow.addArbitrator(address(arbiter));

        // 4. Verify users in identity register
        identityRegister.setVerified(payer, true);
        identityRegister.setVerified(payee, true);

        // 5. Fund payer with USDT and approve EscrowCore
        token.mint(payer, 10_000 * 1e6);
        vm.prank(payer);
        token.approve(address(escrow), type(uint256).max);
    }

    // ==========================================
    // INITIALIZATION & CONFIGURATION TESTS
    // ==========================================

    function test_Constructor_Success() public view {
        assertEq(address(escrow.token()), address(token));
        assertEq(address(escrow.identityRegister()), address(identityRegister));
        assertEq(address(escrow.agreementRegistry()), address(agreementRegistry));
        assertEq(escrow.feeRecipient(), feeRecipient);
    }

    function test_RevertWhen_ZeroAddressInConstructor() public {
        vm.expectRevert(EscrowCore.InvalidAddress.selector);
        new EscrowCore(address(0), address(identityRegister), address(agreementRegistry), feeRecipient);

        vm.expectRevert(EscrowCore.InvalidAddress.selector);
        new EscrowCore(address(token), address(0), address(agreementRegistry), feeRecipient);

        vm.expectRevert(EscrowCore.InvalidAddress.selector);
        new EscrowCore(address(token), address(identityRegister), address(0), feeRecipient);

        vm.expectRevert(EscrowCore.InvalidAddress.selector);
        new EscrowCore(address(token), address(identityRegister), address(agreementRegistry), address(0));
    }

    function test_SetFeeRecipient_Success() public {
        address newFeeRecipient = address(0x888);
        escrow.setFeeRecipient(newFeeRecipient);
        assertEq(escrow.feeRecipient(), newFeeRecipient);
    }

    function test_RevertWhen_SetFeeRecipientZeroAddress() public {
        vm.expectRevert(EscrowCore.InvalidAddress.selector);
        escrow.setFeeRecipient(address(0));
    }

    // ==========================================
    // CREATE DEAL TESTS
    // ==========================================

    function test_CreateDeal_Success() public {
        string[] memory descs = new string[](2);
        descs[0] = "Milestone 1";
        descs[1] = "Milestone 2";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 300 * 1e6;
        amounts[1] = 700 * 1e6;

        address[] memory payees = new address[](1);
        payees[0] = payee;

        vm.prank(payer);
        escrow.createDeal(descs, amounts, payees, keccak256("DOC_A"));

        assertEq(escrow.dealCount(), 1);
        assertEq(token.balanceOf(address(escrow)), 1_000 * 1e6);

        (address dealPayer, address dealPayee, uint256 totalBalance, uint256 totalMilestones, uint8 currentMilestone, EscrowCore.Status status) = escrow.deals(1);
        
        assertEq(dealPayer, payer);
        assertEq(dealPayee, address(0));
        assertEq(totalBalance, 1_000 * 1e6);
        assertEq(totalMilestones, 2);
        assertEq(currentMilestone, 0);
        assertTrue(status == EscrowCore.Status.InProgress);
    }

    function test_RevertWhen_UnverifiedUserCreatesDeal() public {
        string[] memory descs = new string[](1);
        descs[0] = "M1";
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * 1e6;

        vm.prank(unverifiedUser);
        vm.expectRevert(EscrowCore.UserNotVerified.selector);
        escrow.createDeal(descs, amounts, new address[](0), keccak256("DOC"));
    }

    function test_RevertWhen_MilestoneLengthMismatch() public {
        string[] memory descs = new string[](2);
        uint256[] memory amounts = new uint256[](1);

        vm.prank(payer);
        vm.expectRevert(EscrowCore.LengthMismatch.selector);
        escrow.createDeal(descs, amounts, new address[](0), keccak256("DOC"));
    }

    // ==========================================
    // SYNC PAYEE & MILESTONE RELEASE TESTS
    // ==========================================

    function test_SyncPayeeFromRegistry_Success() public {
        _createStandardDeal();

        agreementRegistry.setPayee(1, payee);

        vm.prank(address(agreementRegistry));
        escrow.syncPayeeFromRegistry(1);

        (, address dealPayee,,,,) = escrow.deals(1);
        assertEq(dealPayee, payee);
    }

    function test_ApproveAndReleaseMilestone_Success() public {
        _createStandardDealAndSyncPayee();
        agreementRegistry.setBothSigned(1, true);

        vm.prank(payer);
        escrow.approveAndReleaseMilestone(1);

        assertEq(escrow.pendingWithdrawals(payee), 400 * 1e6);

        (,,, uint256 totalMilestones, uint8 currentMilestone,) = escrow.deals(1);
        assertEq(currentMilestone, 1);

        // Release second milestone to complete deal
        vm.prank(payer);
        escrow.approveAndReleaseMilestone(1);

        (,,,,, EscrowCore.Status status) = escrow.deals(1);
        assertTrue(status == EscrowCore.Status.Completed);
    }

    // ==========================================
    // WITHDRAWAL TESTS (WITH FEE DEDUCTION)
    // ==========================================

    function test_Withdraw_SuccessWithFee() public {
        _createStandardDealAndSyncPayee();
        agreementRegistry.setBothSigned(1, true);

        // Release 400 USDT milestone
        vm.prank(payer);
        escrow.approveAndReleaseMilestone(1);

        uint256 payeeBalanceBefore = token.balanceOf(payee);
        uint256 feeRecipientBefore = token.balanceOf(feeRecipient);

        vm.prank(payee);
        escrow.withdraw();

        // 0.3% FEE_BPS = 400 * 0.003 = 1.2 USDT (1_200_000)
        uint256 expectedFee = (400 * 1e6 * 30) / 10_000;
        uint256 expectedNet = (400 * 1e6) - expectedFee;

        assertEq(token.balanceOf(payee), payeeBalanceBefore + expectedNet);
        assertEq(token.balanceOf(feeRecipient), feeRecipientBefore + expectedFee);
        assertEq(escrow.pendingWithdrawals(payee), 0);
    }

    function test_RevertWhen_WithdrawWithZeroBalance() public {
        vm.prank(payee);
        vm.expectRevert(EscrowCore.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    // ==========================================
    // DISPUTE & RESOLUTION TESTS
    // ==========================================

    function test_RaiseDispute_Success() public {
        _createStandardDealAndSyncPayee();

        uint256 arbiterBalanceBefore = token.balanceOf(address(arbiter));

        vm.prank(payer);
        escrow.raiseDispute(1, "Quality issues");

        (,,,,, EscrowCore.Status status) = escrow.deals(1);
        assertTrue(status == EscrowCore.Status.Disputed);

        // Total balance = 1000 USDT -> 1% arbitration fee = 10 USDT
        assertEq(token.balanceOf(address(arbiter)), arbiterBalanceBefore + 10 * 1e6);
        assertEq(escrow.getDealTotalBalance(1), 990 * 1e6);
    }

    function test_ResolveDispute_Success() public {
        _createStandardDealAndSyncPayee();

        vm.prank(payer);
        escrow.raiseDispute(1, "Defective Work");

        // Remaining balance = 990 USDT
        vm.prank(address(arbiter));
        escrow.resolveDispute(1, 500 * 1e6, 490 * 1e6);

        (,,,,, EscrowCore.Status status) = escrow.deals(1);
        assertTrue(status == EscrowCore.Status.Resolved);
        assertEq(escrow.pendingWithdrawals(payer), 500 * 1e6);
        assertEq(escrow.pendingWithdrawals(payee), 490 * 1e6);
    }

    function test_RevertWhen_ResolveDisputeCalledByNonArbiter() public {
        _createStandardDealAndSyncPayee();

        vm.prank(payer);
        escrow.raiseDispute(1, "Defective Work");

        vm.prank(payer);
        vm.expectRevert(EscrowCore.ArbiterRequired.selector);
        escrow.resolveDispute(1, 500 * 1e6, 490 * 1e6);
    }

    // ==========================================
    // CANCEL DEAL TESTS (EIP-712 SIGNATURES)
    // ==========================================

    function test_CancelDeal_SingleUnassignedPayer_Success() public {
        _createStandardDeal(); // Payee not assigned yet

        uint256 payerBalanceBefore = token.balanceOf(payer);

        vm.prank(payer);
        escrow.cancelDeal(1, block.timestamp + 1 hours, "", "");

        (,,,,, EscrowCore.Status status) = escrow.deals(1);
        assertTrue(status == EscrowCore.Status.Cancelled);

        // Funds moved to pending withdrawals
        assertEq(escrow.pendingWithdrawals(payer), 1_000 * 1e6);

        vm.prank(payer);
        escrow.withdraw();
        assertGt(token.balanceOf(payer), payerBalanceBefore);
    }

    function test_CancelDeal_WithBothSignatures_Success() public {
        _createStandardDealAndSyncPayee();

        uint256 deadline = block.timestamp + 1 hours;
        uint256 payerNonce = escrow.nonces(payer);
        uint256 payeeNonce = escrow.nonces(payee);

        bytes32 payerStructHash = keccak256(
            abi.encode(CANCEL_DEAL_TYPEHASH, 1, payerNonce, deadline)
        );
        bytes32 payeeStructHash = keccak256(
            abi.encode(CANCEL_DEAL_TYPEHASH, 1, payeeNonce, deadline)
        );

        bytes32 domainSeparator = _buildDomainSeparator();

        bytes32 payerDigest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, payerStructHash)
        );
        bytes32 payeeDigest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, payeeStructHash)
        );

        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(payerPrivateKey, payerDigest);
        bytes memory payerSig = abi.encodePacked(r1, s1, v1);

        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(payeePrivateKey, payeeDigest);
        bytes memory payeeSig = abi.encodePacked(r2, s2, v2);

        vm.prank(payer);
        escrow.cancelDeal(1, deadline, payerSig, payeeSig);

        (,,,,, EscrowCore.Status status) = escrow.deals(1);
        assertTrue(status == EscrowCore.Status.Cancelled);
        assertEq(escrow.nonces(payer), payerNonce + 1);
        assertEq(escrow.nonces(payee), payeeNonce + 1);
    }

    // ==========================================
    // INTERNAL HELPERS
    // ==========================================

    function _createStandardDeal() internal {
        string[] memory descs = new string[](2);
        descs[0] = "Design Phase";
        descs[1] = "Build Phase";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 400 * 1e6;
        amounts[1] = 600 * 1e6;

        address[] memory payees = new address[](1);
        payees[0] = payee;

        vm.prank(payer);
        escrow.createDeal(descs, amounts, payees, keccak256("DOC_A_HASH"));
    }

    function _createStandardDealAndSyncPayee() internal {
        _createStandardDeal();
        agreementRegistry.setPayee(1, payee);

        vm.prank(address(agreementRegistry));
        escrow.syncPayeeFromRegistry(1);
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Lexo EscrowCore")),
                keccak256(bytes("1")),
                block.chainid,
                address(escrow)
            )
        );
    }
    function test_RevertWhen_CreateDealExceedsMaxMilestones() public {
        string[] memory descs = new string[](16);
        uint256[] memory amounts = new uint256[](16);
        for (uint256 i = 0; i < 16; i++) {
            descs[i] = "M";
            amounts[i] = 10 * 1e6;
        }

        vm.prank(payer);
        vm.expectRevert(EscrowCore.InvalidMilestoneCount.selector);
        escrow.createDeal(descs, amounts, new address[](0), keccak256("DOC"));
    }

    function test_RevertWhen_ApproveAndReleaseUnsignedAgreements() public {
        _createStandardDealAndSyncPayee();
        agreementRegistry.setBothSigned(1, false);

        vm.prank(payer);
        vm.expectRevert(EscrowCore.AgreementsNotSigned.selector);
        escrow.approveAndReleaseMilestone(1);
    }

    function test_RevertWhen_CancelDealSignatureExpired() public {
        _createStandardDealAndSyncPayee();

        uint256 expiredDeadline = block.timestamp - 1 seconds;

        vm.prank(payer);
        vm.expectRevert(EscrowCore.SignatureExpired.selector);
        escrow.cancelDeal(1, expiredDeadline, "", "");
    }

    function test_RevertWhen_CancelDealInvalidPayerSignature() public {
        _createStandardDealAndSyncPayee();

        uint256 deadline = block.timestamp + 1 hours;
        uint256 payerNonce = escrow.nonces(payer);
        uint256 payeeNonce = escrow.nonces(payee);

        bytes32 payerStructHash = keccak256(abi.encode(CANCEL_DEAL_TYPEHASH, 1, payerNonce, deadline));
        bytes32 payeeStructHash = keccak256(abi.encode(CANCEL_DEAL_TYPEHASH, 1, payeeNonce, deadline));

        bytes32 domainSeparator = _buildDomainSeparator();

        bytes32 payerDigest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, payerStructHash));
        bytes32 payeeDigest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, payeeStructHash));

        // Sign with UNVERIFIED user key instead of payer key
        uint256 attackerKey = 0xBAD;
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(attackerKey, payerDigest);
        bytes memory invalidPayerSig = abi.encodePacked(r1, s1, v1);

        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(payeePrivateKey, payeeDigest);
        bytes memory payeeSig = abi.encodePacked(r2, s2, v2);

        vm.prank(payer);
        vm.expectRevert(EscrowCore.InvalidSignature.selector);
        escrow.cancelDeal(1, deadline, invalidPayerSig, payeeSig);
    }

    function test_RevertWhen_ResolveDisputeAmountMismatch() public {
        _createStandardDealAndSyncPayee();

        vm.prank(payer);
        escrow.raiseDispute(1, "Quality issues"); // Remaining balance: 990 USDT

        // Try to resolve with incorrect total sum (500 + 500 = 1000 != 990)
        vm.prank(address(arbiter));
        vm.expectRevert(EscrowCore.LengthMismatch.selector);
        escrow.resolveDispute(1, 500 * 1e6, 500 * 1e6);
    }

    function test_ReRaiseDispute_Success() public {
        _createStandardDealAndSyncPayee();

        vm.prank(payer);
        escrow.raiseDispute(1, "Initial issue"); // Balance drops from 1000 -> 990 USDT

        vm.prank(payer);
        escrow.reRaiseDispute(1, "Appeal issue", 1); // Fee = 990 / 100 = 9.9 USDT -> Balance becomes 980.1 USDT

        assertEq(escrow.getDealTotalBalance(1), 980.1 * 1e6);
    }

    function test_Fuzz_CreateDealAndRelease(uint256 amount1, uint256 amount2) public {
        // Bound amounts between 1 USDT and 1,000,000 USDT
        amount1 = bound(amount1, 1e6, 1_000_000 * 1e6);
        amount2 = bound(amount2, 1e6, 1_000_000 * 1e6);

        string[] memory descs = new string[](2);
        descs[0] = "M1"; descs[1] = "M2";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount1; amounts[1] = amount2;

        address[] memory payees = new address[](1);
        payees[0] = payee;

        token.mint(payer, amount1 + amount2);
        vm.prank(payer);
        token.approve(address(escrow), amount1 + amount2);

        vm.prank(payer);
        escrow.createDeal(descs, amounts, payees, keccak256("DOC"));

        agreementRegistry.setPayee(1, payee);
        vm.prank(address(agreementRegistry));
        escrow.syncPayeeFromRegistry(1);

        agreementRegistry.setBothSigned(1, true);

        vm.prank(payer);
        escrow.approveAndReleaseMilestone(1);

        assertEq(escrow.pendingWithdrawals(payee), amount1);
    }
}