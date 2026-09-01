// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

// Target Contract
import {ArbitrationCourt} from "../../src/arbitration/ArbitrationCourt.sol";
import {IIdentityRegister} from "../../src/interfaces/IIdentityRegister.sol";
import {IArbitrationRegister} from "../../src/interfaces/IArbitrationRegister.sol";
import {IEscrowCore} from "../../src/interfaces/IEscrowCore.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockIdentityRegister} from "../mocks/MockIdentity.sol";
import {MockArbitratorRegistry} from "../mocks/MockArbitratorRegistry.sol";
import {MockEscrowCore} from "../mocks/MockEscrow.sol";

contract ArbitrationCourtTest is Test {
    ArbitrationCourt public court;

    MockUSDT public usdt;
    MockIdentityRegister public identityRegister;
    MockArbitratorRegistry public arbitrationRegister;
    MockEscrowCore public escrowCore;

    // Test Signers
    address public initiator = address(0x1);
    address public buyer = address(0x2);
    address public seller = address(0x3);

    address public arbiter1 = address(0x10);
    address public arbiter2 = address(0x20);
    address public arbiter3 = address(0x30);
    address public arbiter4 = address(0x40);
    address public arbiter5 = address(0x50);

    // Test Constants
    bytes32 public constant DOC_A = keccak256("DOC_A_HASH");
    bytes32 public constant DOC_B = keccak256("DOC_B_HASH");
    uint256 public constant ARB_FEE = 300 * 1e6; // 300 USDT (6 decimals)
    uint256 public constant DEAL_ID = 101;
    uint256 public constant DEAL_BALANCE = 1_000 * 1e6; // 1,000 USDT

    // Events mirrored from ArbitrationCourt for assertion
    event CaseCreated(
        uint256 indexed caseId,
        uint256 indexed dealId,
        address indexed initiator,
        bytes32 docAHash,
        bytes32 docBHash,
        address[] arbiters
    );
    event VoteCast(uint256 indexed caseId, address indexed arbiter, ArbitrationCourt.VoteChoice choice);
    event CaseDecided(uint256 indexed caseId, ArbitrationCourt.VoteChoice outcome, uint256 executionUnlockTime);
    event CaseExecuted(uint256 indexed caseId, ArbitrationCourt.VoteChoice outcome);

    function setUp() public {
        // 1. Deploy Mocks
        usdt = new MockUSDT(100_000_000);
        identityRegister = new MockIdentityRegister();
        arbitrationRegister = new MockArbitratorRegistry(address(identityRegister), address(usdt));
        escrowCore = new MockEscrowCore(address(0), address(usdt));

        // 2. Deploy ArbitrationCourt Target
        court = new ArbitrationCourt(
            address(usdt),
            address(identityRegister),
            address(arbitrationRegister),
            address(escrowCore)
        );

        // Link court back to mock register
        arbitrationRegister.setArbitrationCourt(address(court));

        // 3. Register standard arbiters pool in mock register
        address[] memory pool = new address[](5);
        pool[0] = arbiter1;
        pool[1] = arbiter2;
        pool[2] = arbiter3;
        pool[3] = arbiter4;
        pool[4] = arbiter5;
        arbitrationRegister.setMockEligiblePool(pool);

       identityRegister.mockSetVerified(initiator, keccak256(abi.encodePacked(initiator)), true);
       identityRegister.mockSetVerified(buyer, keccak256(abi.encodePacked(buyer)), true);
       identityRegister.mockSetVerified(seller, keccak256(abi.encodePacked(seller)), true);

        // 5. Fund initiator and grant USDT approvals
        usdt.mint(initiator, 10_000 * 1e6);
        vm.prank(initiator);
        usdt.approve(address(court), type(uint256).max);

        // 6. Setup Escrow Mock deal state
        escrowCore.setDeal(
            DEAL_ID,
            buyer,
            seller,
            DEAL_BALANCE,
            MockEscrowCore.Status.InProgress
        );
    }

    // ==========================================
    // CONSTRUCTOR & INITIALIZATION
    // ==========================================

    function test_Constructor_Success() public view {
        assertEq(address(court.token()), address(usdt));
        assertEq(address(court.identityRegister()), address(identityRegister));
        assertEq(address(court.arbitrationRegister()), address(arbitrationRegister));
        assertEq(address(court.escrowCore()), address(escrowCore));
    }

    function test_RevertWhen_ZeroAddressInConstructor() public {
        vm.expectRevert(ArbitrationCourt.InvalidAddress.selector);
        new ArbitrationCourt(address(0), address(identityRegister), address(arbitrationRegister), address(escrowCore));

        vm.expectRevert(ArbitrationCourt.InvalidAddress.selector);
        new ArbitrationCourt(address(usdt), address(0), address(arbitrationRegister), address(escrowCore));

        vm.expectRevert(ArbitrationCourt.InvalidAddress.selector);
        new ArbitrationCourt(address(usdt), address(identityRegister), address(0), address(escrowCore));

        vm.expectRevert(ArbitrationCourt.InvalidAddress.selector);
        new ArbitrationCourt(address(usdt), address(identityRegister), address(arbitrationRegister), address(0));
    }

    // ==========================================
    // CASE CREATION
    // ==========================================

    function test_CreateCase_Success() public {
        uint256 initBalanceBefore = usdt.balanceOf(initiator);

        vm.prank(initiator);
        uint256 caseId = court.createCase(DEAL_ID, "Product not delivered", DOC_A, DOC_B, ARB_FEE);

        assertEq(caseId, 1);
        assertEq(usdt.balanceOf(address(court)), ARB_FEE);
        assertEq(usdt.balanceOf(initiator), initBalanceBefore - ARB_FEE);

        address[] memory assignedArbs = court.getCaseArbiters(caseId);
        assertEq(assignedArbs.length, 3);
        assertEq(assignedArbs[0], arbiter1);
        assertEq(assignedArbs[1], arbiter2);
        assertEq(assignedArbs[2], arbiter3);

        (
            uint256 dealId,
            uint256 parentCaseId,
            string memory reason,
            bytes32 docA,
            bytes32 docB,
            uint256 fee,
            ArbitrationCourt.CaseStatus status,
            address init,
            uint256 createdAt,
            uint256 deadline,
            ,
            ,
            ,

        ) = court.cases(caseId);

        assertEq(dealId, DEAL_ID);
        assertEq(parentCaseId, 0);
        assertEq(reason, "Product not delivered");
        assertEq(docA, DOC_A);
        assertEq(docB, DOC_B);
        assertEq(fee, ARB_FEE);
        assertEq(uint8(status), uint8(ArbitrationCourt.CaseStatus.Voting));
        assertEq(init, initiator);
        assertEq(createdAt, block.timestamp);
        assertEq(deadline, block.timestamp + 3 days);
    }

    function test_RevertWhen_DocAHashZero() public {
        vm.prank(initiator);
        vm.expectRevert(ArbitrationCourt.InvalidAddress.selector);
        court.createCase(DEAL_ID, "No doc A", bytes32(0), DOC_B, ARB_FEE);
    }

    function test_RevertWhen_DocBHashZero() public {
        vm.prank(initiator);
        vm.expectRevert(ArbitrationCourt.InvalidAddress.selector);
        court.createCase(DEAL_ID, "No doc B", DOC_A, bytes32(0), ARB_FEE);
    }

    // ==========================================
    // VOTING MECHANICS
    // ==========================================

    function test_CastVote_Success() public {
        uint256 caseId = _createStandardCase();

        vm.prank(arbiter1);
        vm.expectEmit(true, true, false, true);
        emit VoteCast(caseId, arbiter1, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
        (, bool hasVoted) = court.votes(caseId, arbiter1);
        assertEq(court.voteCounts(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer), 1);
        assertTrue(hasVoted);
    }

    function test_RevertWhen_VoteChoiceIsNone() public {
        uint256 caseId = _createStandardCase();

        vm.prank(arbiter1);
        vm.expectRevert(ArbitrationCourt.InvalidChoice.selector);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.None);
    }

    function test_RevertWhen_UnassignedArbiterVotes() public {
        uint256 caseId = _createStandardCase();

        vm.prank(address(0x999));
        vm.expectRevert(ArbitrationCourt.NotAssignedArbiter.selector);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
    }

    function test_RevertWhen_ArbiterVotesTwice() public {
        uint256 caseId = _createStandardCase();

        vm.prank(arbiter1);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);

        vm.prank(arbiter1);
        vm.expectRevert(ArbitrationCourt.AlreadyVoted.selector);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.RefundToSeller);
    }

    function test_RevertWhen_VotingAfterDeadline() public {
        uint256 caseId = _createStandardCase();

        vm.warp(block.timestamp + 3 days + 1 seconds);

        vm.prank(arbiter1);
        vm.expectRevert(ArbitrationCourt.DeadlinePassed.selector);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
    }

    // ==========================================
    // RESOLUTION
    // ==========================================

    function test_ResolveCase_MajorityDecision() public {
        uint256 caseId = _createStandardCase();

        vm.prank(arbiter1);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
        vm.prank(arbiter2);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
        vm.prank(arbiter3);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.RefundToSeller);

        vm.warp(block.timestamp + 3 days + 1 seconds);

        vm.expectEmit(true, false, false, true);
        emit CaseDecided(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer, block.timestamp + 7 days);
        court.resolveCase(caseId);

        (, , , , , , ArbitrationCourt.CaseStatus status, , , , , ArbitrationCourt.VoteChoice winningChoice, , ) = court.cases(caseId);
        assertEq(uint8(status), uint8(ArbitrationCourt.CaseStatus.Decided));
        assertEq(uint8(winningChoice), uint8(ArbitrationCourt.VoteChoice.ReleaseToBuyer));

        // Majority voters gain reputation
        assertEq(arbitrationRegister.mockReputation(arbiter1), 10);
        assertEq(arbitrationRegister.mockReputation(arbiter2), 10);
        assertEq(arbitrationRegister.mockReputation(arbiter3), 0);
    }

    function test_RevertWhen_ResolvingBeforeDeadline() public {
        uint256 caseId = _createStandardCase();

        vm.expectRevert(ArbitrationCourt.DeadlineNotReached.selector);
        court.resolveCase(caseId);
    }

    function test_RevertWhen_ResolvingWithTie() public {
        uint256 caseId = _createStandardCase();

        vm.prank(arbiter1);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
        vm.prank(arbiter2);
        court.castVote(caseId, ArbitrationCourt.VoteChoice.RefundToSeller);

        vm.warp(block.timestamp + 3 days + 1 seconds);

        vm.expectRevert(ArbitrationCourt.TieVoteUnresolved.selector);
        court.resolveCase(caseId);
    }

    // ==========================================
    // EXECUTION
    // ==========================================

    function test_ExecuteCase_ReleaseToBuyer_Success() public {
        uint256 caseId = _resolveStandardCase(ArbitrationCourt.VoteChoice.ReleaseToBuyer);

        // Fast forward 7 days past delay
        vm.warp(block.timestamp + 7 days + 1 seconds);

        uint256 arb1UsdtBefore = usdt.balanceOf(arbiter1);
        uint256 arb2UsdtBefore = usdt.balanceOf(arbiter2);

        vm.expectEmit(true, false, false, true);
        emit CaseExecuted(caseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
        court.executeCase(caseId);

        // Assert escrow balance remains queried properly
        assertEq(escrowCore.getDealTotalBalance(DEAL_ID), DEAL_BALANCE);

        // Assert fee distributions (300 USDT / 3 winning arbiters = 100 USDT each)
        assertEq(usdt.balanceOf(arbiter1), arb1UsdtBefore + 100 * 1e6);
        assertEq(usdt.balanceOf(arbiter2), arb2UsdtBefore + 100 * 1e6);
    }

    function test_ExecuteCase_RefundToSeller_Success() public {
        uint256 caseId = _resolveStandardCase(ArbitrationCourt.VoteChoice.RefundToSeller);

        vm.warp(block.timestamp + 7 days + 1 seconds);

        court.executeCase(caseId);

        assertEq(escrowCore.getDealTotalBalance(DEAL_ID), DEAL_BALANCE);
    }

    function test_RevertWhen_ExecutingBeforeDelayExpires() public {
        uint256 caseId = _resolveStandardCase(ArbitrationCourt.VoteChoice.ReleaseToBuyer);

        // Advance to day 6 (before 7 day requirement)
        vm.warp(block.timestamp + 6 days);

        vm.expectRevert(ArbitrationCourt.ExecutionDelayActive.selector);
        court.executeCase(caseId);
    }

    // ==========================================
    // APPEALS & RECREATION
    // ==========================================

    function test_RecreateCase_AppealReversesVerdictAndPenalizesOriginalArbiters() public {
        // Step 1: Initial Case wrongly voted RefundToSeller by original panel
        uint256 parentCaseId = _resolveStandardCase(ArbitrationCourt.VoteChoice.RefundToSeller);

        // Step 2: Initiator appeals within delay period
        vm.prank(initiator);
        uint256 appealCaseId = court.recreateCase(parentCaseId, "Faulty ruling", ARB_FEE);

        address[] memory appealArbs = court.getCaseArbiters(appealCaseId);
        assertEq(appealArbs.length, 5); // Expanded panel

        // Step 3: Appeal panel unanimously votes ReleaseToBuyer
        for (uint256 i = 0; i < appealArbs.length; i++) {
            vm.prank(appealArbs[i]);
            court.castVote(appealCaseId, ArbitrationCourt.VoteChoice.ReleaseToBuyer);
        }

        vm.warp(block.timestamp + 3 days + 1 seconds);
        court.resolveCase(appealCaseId);

        // Step 4: Verify original incorrect arbiters slashed
        assertEq(arbitrationRegister.mockStake(arbiter1), 950 * 1e6);
        assertEq(arbitrationRegister.mockStake(arbiter2), 950 * 1e6);
        assertEq(arbitrationRegister.mockReputation(arbiter1), 0);
        assertEq(arbitrationRegister.mockReputation(arbiter2), 0);
    }

    function test_RevertWhen_ExecutingCaseWithActiveAppeal() public {
        uint256 parentCaseId = _resolveStandardCase(ArbitrationCourt.VoteChoice.RefundToSeller);

        vm.prank(initiator);
        court.recreateCase(parentCaseId, "Appeal active", ARB_FEE);

        vm.warp(block.timestamp + 7 days + 1 seconds);

        vm.expectRevert(ArbitrationCourt.AlreadyAppealed.selector);
        court.executeCase(parentCaseId);
    }

    // ==========================================
    // HELPER FUNCTIONS
    // ==========================================

    function _createStandardCase() internal returns (uint256) {
        vm.prank(initiator);
        return court.createCase(DEAL_ID, "Standard Dispute Reason", DOC_A, DOC_B, ARB_FEE);
    }

    function _resolveStandardCase(ArbitrationCourt.VoteChoice winningChoice) internal returns (uint256 caseId) {
        caseId = _createStandardCase();

        vm.prank(arbiter1);
        court.castVote(caseId, winningChoice);
        vm.prank(arbiter2);
        court.castVote(caseId, winningChoice);
        vm.prank(arbiter3);
        court.castVote(
            caseId,
            winningChoice == ArbitrationCourt.VoteChoice.ReleaseToBuyer
                ? ArbitrationCourt.VoteChoice.RefundToSeller
                : ArbitrationCourt.VoteChoice.ReleaseToBuyer
        );

        vm.warp(block.timestamp + 3 days + 1 seconds);
        court.resolveCase(caseId);
    }
}