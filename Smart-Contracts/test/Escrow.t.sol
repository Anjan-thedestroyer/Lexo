// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

import {EscrowCore} from "../src/core/EscrowCore.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";

// Mock Identity Register Interface for unit testing
contract MockIdentityRegister {
    mapping(address => bool) public verified;

    function setVerified(address user, bool status) external {
        verified[user] = status;
    }

    function isVerified(address user) external view returns (bool) {
        return verified[user];
    }
}

contract EscrowTest is Test {
    EscrowCore public escrow;
    MockIdentityRegister public registry;
    MockUSDT public token;

    address public owner;
    address public payer = address(0x123);
    address public payee = address(0x456);
    address public stranger = address(0x999);

    // Matching Events from EscrowCore
    event DealCreated(uint256 indexed dealId, address indexed payee, address indexed payer, address token, uint256 totalBalance);
    event MilestoneCompleted(uint256 indexed dealId, uint256 indexed milestoneId, uint256 amountReleased);
    event DealCompleted(uint256 indexed dealId);
    event DisputeRaised(address indexed raisor, uint256 indexed dealId, string reason);
    event DisputeResolved(uint256 indexed dealId, uint256 payerAmount, uint256 payeeAmount);
    event FundsWithdrawn(address indexed user, address indexed token, uint256 amount);
    event FeeCollected(address indexed withdrawnFrom, address indexed token, uint256 amount);

    function setUp() public {
        owner = address(this);
        
        // 1. Deploy Mocks and Escrow
        token = new MockUSDT(1_000_000);
        registry = new MockIdentityRegister();
        escrow = new EscrowCore(address(registry));

        // 2. Mark test participants as verified
        registry.setVerified(payer, true);
        registry.setVerified(payee, true);
        registry.setVerified(owner, true);
        registry.setVerified(stranger, false);

        // 3. Fund Payer with USDT Tokens
        token.mint(payer, 10_000); // Mints 10,000 USDT (with 6 decimals handled by MockUSDT)
    }

    function _createDefaultDeal() internal returns (uint256) {
        string[] memory descriptions = new string[](2);
        descriptions[0] = "Plan";
        descriptions[1] = "Code";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000 * 10**6; // 1000 USDT
        amounts[1] = 1_000 * 10**6; // 1000 USDT

        vm.startPrank(payer);
        token.approve(address(escrow), 2_000 * 10**6);
        escrow.createDeal(payee, token, descriptions, amounts);
        vm.stopPrank();

        return escrow.dealCount();
    }

    /* =============================================================
                            HAPPY PATH TESTS
       ============================================================= */

    function test_CreateDeal() public {
        string[] memory descriptions = new string[](2);
        descriptions[0] = "Plan";
        descriptions[1] = "Code";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000 * 10**6;
        amounts[1] = 1_000 * 10**6;

        vm.startPrank(payer);
        token.approve(address(escrow), 2_000 * 10**6);

        vm.expectEmit(true, true, true, true);
        emit DealCreated(1, payee, payer, address(token), 2_000 * 10**6);

        escrow.createDeal(payee, token, descriptions, amounts);
        vm.stopPrank();

        assertEq(escrow.dealCount(), 1);

        (
            address p,
            address w,
            ,
            uint256 bal,
            uint256 tm,
            uint8 cm,
            EscrowCore.Status status
        ) = escrow.deals(1);

        assertEq(p, payer);
        assertEq(w, payee);
        assertEq(bal, 2_000 * 10**6);
        assertEq(tm, 2);
        assertEq(cm, 0);
        assertTrue(status == EscrowCore.Status.InProgress);
    }

    function test_CompleteMilestoneAndAutoFinish() public {
        uint256 dealId = _createDefaultDeal();

        vm.startPrank(payer);
        
        // Milestone 0
        vm.expectEmit(true, true, false, true);
        emit MilestoneCompleted(dealId, 0, 1_000 * 10**6);
        escrow.completeMilestone(dealId);

        // Milestone 1 (Final milestone trigger deal completion)
        vm.expectEmit(true, false, false, false);
        emit DealCompleted(dealId);
        escrow.completeMilestone(dealId);

        vm.stopPrank();

        (,,, uint256 totalBalance,, uint8 currentMilestone, EscrowCore.Status status) = escrow.deals(dealId);
        assertEq(currentMilestone, 2);
        assertEq(totalBalance, 0);
        assertTrue(status == EscrowCore.Status.Completed);
        assertEq(escrow.pendingWithdrawals(payee, token), 2_000 * 10**6);
    }

    function test_WithdrawWithFeeDeduction() public {
        uint256 dealId = _createDefaultDeal();

        vm.prank(payer);
        escrow.completeMilestone(dealId); // Credit 1000 USDT to payee

        uint256 totalOwed = 1_000 * 10**6;
        uint256 expectedFee = (totalOwed * 3) / 10000; // 0.3% fee = 3 USDT
        uint256 expectedUserPayout = totalOwed - expectedFee;

        uint256 payeeBalanceBefore = token.balanceOf(payee);
        uint256 ownerBalanceBefore = token.balanceOf(owner);

        vm.prank(payee);
        vm.expectEmit(true, true, false, true);
        emit FundsWithdrawn(payee, address(token), expectedUserPayout);
        escrow.withdraw(token);

        assertEq(token.balanceOf(payee), payeeBalanceBefore + expectedUserPayout);
        assertEq(token.balanceOf(owner), ownerBalanceBefore + expectedFee);
        assertEq(escrow.pendingWithdrawals(payee, token), 0);
    }

    function test_ResolveDisputeSplitsCorrectly() public {
    uint256 dealId = _createDefaultDeal();

    // 1. Raise dispute properly via contract function
    vm.prank(payer);
    escrow.raiseDispute(dealId, "Work incomplete");

    uint256 payerAmount = 1_200 * 10**6;
    uint256 payeeAmount = 800 * 10**6;

    // 2. Resolve dispute as owner
    vm.prank(owner);
    vm.expectEmit(true, false, false, true);
    emit DisputeResolved(dealId, payerAmount, payeeAmount);
    escrow.resolveDispute(dealId, payerAmount, payeeAmount);

    assertEq(escrow.pendingWithdrawals(payer, token), payerAmount);
    assertEq(escrow.pendingWithdrawals(payee, token), payeeAmount);
   }

    /* =============================================================
                            REVERT TESTS
       ============================================================= */

    function test_RevertIf_UnverifiedUserCalls() public {
        vm.startPrank(stranger);
        vm.expectRevert("Not a verified user");
        escrow.withdraw(token);
        vm.stopPrank();
    }

    function test_RevertIf_MilestoneNonPayer() public {
        uint256 dealId = _createDefaultDeal();

        vm.prank(payee);
        vm.expectRevert(EscrowCore.NotAuthorized.selector);
        escrow.completeMilestone(dealId);
    }

    function test_RevertIf_CreateDealLengthMismatch() public {
        string[] memory desc = new string[](1);
        desc[0] = "Plan";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000 * 10**6;
        amounts[1] = 1_000 * 10**6;

        vm.startPrank(payer);
        token.approve(address(escrow), 2_000 * 10**6);

        vm.expectRevert(EscrowCore.LengthMismatch.selector);
        escrow.createDeal(payee, token, desc, amounts);
        vm.stopPrank();
    }

    function test_RevertIf_NothingToWithdraw() public {
        vm.prank(payee);
        vm.expectRevert(EscrowCore.NothingToWithdraw.selector);
        escrow.withdraw(token);
    }

    function test_RevertIf_ResolveWithoutDisputeState() public {
        uint256 dealId = _createDefaultDeal();

        vm.prank(owner);
        vm.expectRevert(EscrowCore.InvalidDealStatus.selector);
        escrow.resolveDispute(dealId, 1_000 * 10**6, 1_000 * 10**6);
    }

    /* =============================================================
                            FUZZ TESTS
       ============================================================= */

    function testFuzz_CreateAndCompleteMilestone(uint256 amt1, uint256 amt2) public {
        vm.assume(amt1 > 1_000000 && amt1 < 1_000_000 * 10**6);
        vm.assume(amt2 > 1_000000 && amt2 < 1_000_000 * 10**6);

        uint256 total = amt1 + amt2;

        string[] memory descriptions = new string[](2);
        descriptions[0] = "M1";
        descriptions[1] = "M2";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amt1;
        amounts[1] = amt2;

        token.mint(payer, total);

        vm.startPrank(payer);
        token.approve(address(escrow), total);
        escrow.createDeal(payee, token, descriptions, amounts);
        
        escrow.completeMilestone(1);
        vm.stopPrank();

        assertEq(escrow.pendingWithdrawals(payee, token), amt1);
    }

    /* =============================================================
                            INVARIANTS
       ============================================================= */

    function invariant_ContractBalanceMatchesPendingAndDeals() public view {
        uint256 totalDealBalance;
        uint256 count = escrow.dealCount();

        for (uint256 i = 1; i <= count; i++) {
            (,,, uint256 bal,,,) = escrow.deals(i);
            totalDealBalance += bal;
        }

        uint256 pendingPayer = escrow.pendingWithdrawals(payer, token);
        uint256 pendingPayee = escrow.pendingWithdrawals(payee, token);

        assertEq(token.balanceOf(address(escrow)), totalDealBalance + pendingPayer + pendingPayee);
    }
}