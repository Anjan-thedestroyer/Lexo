// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {EscrowCore} from "../src/core/Escrow.sol";
import {IdentityRegister} from "../src/core/IdentityRegister.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";


contract EscrowTest is Test {
    EscrowCore public escrow;
    IdentityRegister registry;
    MockUSDT token;
    uint256 verifierPk = 0xA11CE;
    address verifierAddr;

    address walletA = address(0x1001);
    address walletB = address(0x1002);
    address walletC = address(0x1003);
    address stranger = address(0x9999);

    bytes32 hash1 = keccak256("passport-pubkey-1+pepper");
    bytes32 hash2 = keccak256("passport-pubkey-2+pepper");


    event DealCreated(uint256 indexed dealId, address indexed payee, address indexed payer, uint256 totalBalance);
    event DealCanceled(uint256 indexed dealId, address indexed payer, uint256 amountRefunded);
    event MilestoneCompleted(uint256 indexed dealId, uint256 indexed milestoneId, uint256 amountReleased);
    event DealCompleted(uint256 indexed dealId, address indexed payee, address indexed payer, uint256 totalBalance);
    event DisputeRaised(address indexed raisor, uint256 indexed dealId, string reason);

    address payer = address(123);
    address payee = address(456);
    address none  = address(891);

/*==================================================== */

    function setUp() public {
        token = new MockUSDT(1_000_000);
        registry = new IdentityRegister(); // test contract is owner
        verifierAddr = vm.addr(verifierPk);
        registry.addVerifier(verifierAddr);
        escrow = new EscrowCore(address(registry));
        vm.deal(payer, 15 ether);
    }

    function _createDefaultDeal() internal { 
        string[] memory descriptions = new string[](2);
        descriptions[0] = "Plan";
        descriptions[1] = "Code";
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 1 ether;
        vm.startPrank(payer);
        escrow.createDeal{value: 2 ether}(payee,token,descriptions,amounts);
        vm.stopPrank();
        }

    /* =============================================================
                            HAPPY PATH TESTS
       ============================================================= */

    function test_CreateDeal() public {
        vm.prank(payer);

        string[] memory descriptions = new string[](2);
        descriptions[0] = "Plan";
        descriptions[1] = "Code";
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 1 ether;

        vm.expectEmit(true, true, true, true);
        emit DealCreated(1, payee, payer, 2 ether);

        escrow.createDeal{value: 2 ether}(payee, descriptions, amounts);

        assertEq(escrow.dealCount(), 1);

        (address p, address w, uint256 bal, uint256 tm, uint8 cm, EscrowCore.Status status) = escrow.deals(1);
        assertEq(p, payer);
        assertEq(w, payee);
        assertEq(tm, 2);
        assertEq(cm, 0);
        assertEq(bal, 2 ether);
        assertTrue(status == EscrowCore.Status.InProgress);
    }

    function test_completeMilestone() public {
        _createDefaultDeal();

        uint256 dealId = 1;
        uint256 milestoneId = 0;

        vm.startPrank(payer);
        vm.expectEmit(true, true, false, true);
        emit MilestoneCompleted(dealId, milestoneId, 1 ether);

        escrow.completeMilestone(dealId, milestoneId);

        (,, uint256 totalBalance,, uint256 currentMilestone,) = escrow.deals(dealId);
        assertEq(currentMilestone, 1);
        assertEq(totalBalance, 1 ether);

        vm.stopPrank();
    }

    function test_completeDeal() public {
        _createDefaultDeal();

        uint256 dealId = 1;

        vm.startPrank(payer);
        escrow.completeMilestone(dealId, 0);
        escrow.completeMilestone(dealId, 1);

        vm.expectEmit(true, true, true, true);
        emit DealCompleted(dealId, payee, payer, 0 ether);

        escrow.completeDeal(dealId);
        vm.stopPrank();

        (,, uint256 totalBalance,,, EscrowCore.Status status) = escrow.deals(dealId);
        assertEq(totalBalance, 0);
        assertTrue(status == EscrowCore.Status.Completed);
    }

    function test_raiseDispute() public {
        _createDefaultDeal();

        uint256 dealId = 1;
        string memory reason = "Payer is not marking my completed task even though it's done";

        vm.startPrank(payee);
        vm.expectEmit(true, true, false, true);
        emit DisputeRaised(payee, dealId, reason);

        escrow.raisedDispute(dealId, reason);
        vm.stopPrank();

        (,,,,, EscrowCore.Status status) = escrow.deals(dealId);
        assertTrue(status == EscrowCore.Status.Disputed);
    }

    function test_cancelDeal() public {
        _createDefaultDeal();

        uint256 dealId = 1;

        vm.startPrank(payee);
        vm.expectEmit(true, true, false, true);
        emit DealCanceled(dealId, payer, 2 ether);

        escrow.cancelDeal(dealId);
        vm.stopPrank();

        (,, uint256 totalBalance,,, EscrowCore.Status status) = escrow.deals(dealId);
        assertEq(totalBalance, 0);
        assertTrue(status == EscrowCore.Status.Canceled);
    }

    function test_ResolveDisputeSplitsCorrectly() public {
        _createDefaultDeal();

        vm.prank(payee);
        escrow.raisedDispute(1, "issue");
        uint256 payerBefore = escrow.pendingWithdrawals(payer);
        uint256 payeeBefore = escrow.pendingWithdrawals(payee);  

        escrow.resolveDispute(1, 1 ether, 1 ether);

        assertEq(escrow.pendingWithdrawals(payer), payerBefore + 1 ether);
        assertEq(escrow.pendingWithdrawals(payee), payeeBefore + 1 ether);
    }

    function test_ResolveDisputeUnevenSplit() public {
        _createDefaultDeal();

        vm.prank(payer);
        escrow.raisedDispute(1, "split it");

        uint256 payerBefore = escrow.pendingWithdrawals(payer);
        uint256 payeeBefore = escrow.pendingWithdrawals(payee);

        escrow.resolveDispute(1, 1.5 ether, 0.5 ether);

        assertEq(escrow.pendingWithdrawals(payer), payerBefore + 1.5 ether);
        assertEq(escrow.pendingWithdrawals(payee), payeeBefore + 0.5 ether);
    }

    function test_MilestoneTransfersETHToWithdraw() public {
        _createDefaultDeal();

        uint256 before = escrow.pendingWithdrawals(payee);

        vm.prank(payer);
        escrow.completeMilestone(1, 0);

        assertEq(escrow.pendingWithdrawals(payee), before + 1 ether);
    }

    function test_completeDealTransfersRemainingETH() public {
        _createDefaultDeal();

        uint256 before = payee.balance;

        vm.startPrank(payer);
        escrow.completeMilestone(1, 0);
        escrow.completeMilestone(1, 1);
        escrow.completeDeal(1);
        vm.stopPrank();
        vm.prank(payee);
        escrow.withdraw();
        assertEq(payee.balance, before + 2 ether);
    }

    function test_ContractBalanceMatchesDealBalance() public {
        _createDefaultDeal();
        assertEq(address(escrow).balance, 2 ether);

        vm.prank(payer);
        escrow.completeMilestone(1, 0);
        assertEq(escrow.pendingWithdrawals(payee), 1 ether);

        vm.prank(payer);
        escrow.completeMilestone(1, 1);
        vm.prank(payee);
        escrow.withdraw();
        assertEq(address(escrow).balance, 0);
    }

    /* =============================================================
                            REVERT TESTS
       ============================================================= */

    function test_RevertIf_MilestoneMismatch() public {
        string[] memory descriptions = new string[](2);
        descriptions[0] = "Plan";
        descriptions[1] = "Code";
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;

        vm.startPrank(payer);
        vm.expectRevert();
        escrow.createDeal{value: 2 ether}(payee, descriptions, amounts);
        vm.stopPrank();
    }

    function test_RevertIf_MilestoneNonPayer() public {
        _createDefaultDeal();

        vm.startPrank(none);
        vm.expectRevert();
        escrow.completeMilestone(1, 0);
        vm.stopPrank();
    }

    function test_RevertIf_MilestonePayee() public {
        _createDefaultDeal();

        vm.startPrank(payee);
        vm.expectRevert();
        escrow.completeMilestone(1, 0);
        vm.stopPrank();
    }

    function test_RevertIf_cancelDealUnauthorized() public {
        _createDefaultDeal();

        vm.startPrank(none);
        vm.expectRevert();
        escrow.cancelDeal(1);
        vm.stopPrank();
    }

    function test_RevertIf_RaiseDisputeCompletedDeal() public {
        _createDefaultDeal();

        vm.startPrank(payer);
        escrow.completeMilestone(1, 0);
        escrow.completeMilestone(1, 1);
        escrow.completeDeal(1);

        vm.expectRevert("Deal should be in Progress state");
        escrow.raisedDispute(1, "after service missing");
        vm.stopPrank();
    }

    function test_RevertIf_CannotCompleteAfterDispute() public {
        _createDefaultDeal();

        vm.startPrank(payer);
        escrow.completeMilestone(1, 0);
        escrow.completeMilestone(1, 1);
        escrow.raisedDispute(1, "issue");

        vm.expectRevert("Deal not active");
        escrow.completeDeal(1);
        vm.stopPrank();
    }

    function test_RevertIf_ResolveMathMismatch() public {
        _createDefaultDeal();

        vm.prank(payee);
        escrow.raisedDispute(1, "issue");

        vm.expectRevert("Math mismatch");
        escrow.resolveDispute(1, 1 ether, 0);
    }

    function test_RevertIf_CancelDuringDispute() public {
        _createDefaultDeal();

        vm.prank(payee);
        escrow.raisedDispute(1, "Locked!");

        vm.prank(payer);
        vm.expectRevert("Only cancelable during InProgress state");
        escrow.cancelDeal(1);
    }

    function test_RevertIf_ArrayLengthsMismatch() public {
        string[] memory desc = new string[](1);
        desc[0] = "Plan";
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 1 ether;
        vm.prank(payer);
        vm.expectRevert();
        escrow.createDeal{value: 2 ether}(payee, desc, amounts);
    }

    function test_RevertIf_ResolveWithoutDispute() public {
        _createDefaultDeal();

        vm.expectRevert("Not in dispute");
        escrow.resolveDispute(1, 1 ether, 1 ether);
    }

    function test_RevertIf_ResolveDisputeWithoutAdmin() public {
        _createDefaultDeal();

        vm.prank(payee);
        escrow.raisedDispute(1, "issue");

        vm.prank(payee);
        vm.expectRevert();
        escrow.resolveDispute(1, 1 ether, 1 ether);
    }

    /* =============================================================
                            FUZZ TESTS
       ============================================================= */

    function testFuzz_CreateDeal(uint256 amt1, uint256 amt2) public {
        vm.assume(amt1 > 0 && amt1 < 100 ether);
        vm.assume(amt2 > 0 && amt2 < 100 ether);

        uint256 total = amt1 + amt2;

        string[] memory description = new string[](2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amt1;
        amounts[1] = amt2;

        vm.deal(payer, total);
        vm.prank(payer);
        escrow.createDeal{value: total}(payee, description, amounts);

        assertEq(address(escrow).balance, total);
    }

    function testFuzz_MilestoneCompleted(uint256 amt1, uint256 amt2) public {
        vm.assume(amt1 > 0 && amt1 < 100 ether);
        vm.assume(amt2 > 0 && amt2 < 100 ether);
        uint256 total = amt1 + amt2;

        string[] memory _description = new string[](2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amt1;
        amounts[1] = amt2;

        vm.deal(payer, total);
        vm.prank(payer);
        escrow.createDeal{value: total}(payee, _description, amounts);

        vm.prank(payer);
        escrow.completeMilestone(1, 0);

        assertEq(escrow.pendingWithdrawals(payee), amt1, "Payee withdrawal balance incorrect");

        vm.prank(payee);
        uint256 payeeBalBefore = payee.balance;
        escrow.withdraw();

        assertEq(payee.balance,payeeBalBefore+ amt1, "Payee wallet balance incorrect after withdrawal");
        assertEq(escrow.pendingWithdrawals(payee), 0, "Pending withdrawal not cleared");
}

    /* =============================================================
                            INVARIANTS
       ============================================================= */

    function invariant_ContractBalanceMatchedDeals() public view {
        uint256 total;
        uint256 count = escrow.dealCount();

        for (uint256 i = 1; i <= count; i++) {
            (,, uint256 bal,,,) = escrow.deals(i);
            total += bal;
        }

        assertEq(address(escrow).balance, total);
    }
}
