// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ArbitratorRegistry} from "../../src/Future-Expansions/ArbitratorRegistry.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockIdentityRegister} from "../mocks/MockIdentity.sol";

contract ArbitratorRegistryTest is Test {
    ArbitratorRegistry public registry;
    MockUSDT public token;
    MockIdentityRegister public identityRegister;

    address public owner = address(this);
    address public court = makeAddr("court");
    address public arbiter1 = makeAddr("arbiter1");
    address public arbiter2 = makeAddr("arbiter2");
    address public arbiter3 = makeAddr("arbiter3");
    address public recipient = makeAddr("recipient");

    bytes32 public idHash1 = keccak256("identity-arbiter1");
    bytes32 public idHash2 = keccak256("identity-arbiter2");
    bytes32 public idHash3 = keccak256("identity-arbiter3");

    uint256 public constant MIN_STAKE = 500 * 1e6; // 500 USDT

    event ArbitratorAdded(bytes32 indexed identityHash, address indexed wallet, uint256 stake);
    event StakeIncreased(bytes32 indexed identityHash, address indexed wallet, uint256 addedAmount, uint256 newTotalStake);
    event UnstakeRequested(bytes32 indexed identityHash, address indexed wallet, uint64 timestamp);
    event UnstakeCompleted(bytes32 indexed identityHash, address indexed wallet, uint256 amountReturned);
    event Slashed(bytes32 indexed identityHash, address indexed wallet, uint256 amount, address indexed recipient);
    event ReputationUpdated(bytes32 indexed identityHash, uint256 newReputation);
    event CaseAssigned(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event CaseFinished(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);

    function setUp() public {
        token = new MockUSDT(10_000_000);
        identityRegister = new MockIdentityRegister();

        registry = new ArbitratorRegistry(address(identityRegister), address(token));
        registry.setArbitrationCourt(court);

        // Setup verified identities
        identityRegister.mockSetVerified(arbiter1, idHash1, true);
        identityRegister.mockSetVerified(arbiter2, idHash2, true);
        identityRegister.mockSetVerified(arbiter3, idHash3, true);

        // Fund arbiters
        token.mint(arbiter1, 10_000 * 1e6);
        token.mint(arbiter2, 10_000 * 1e6);
        token.mint(arbiter3, 10_000 * 1e6);

        vm.prank(arbiter1);
        token.approve(address(registry), type(uint256).max);

        vm.prank(arbiter2);
        token.approve(address(registry), type(uint256).max);

        vm.prank(arbiter3);
        token.approve(address(registry), type(uint256).max);
    }

    // ==========================================
    // INITIALIZATION & SETTERS
    // ==========================================

    function test_InitialState() public view {
        assertEq(address(registry.token()), address(token));
        assertEq(address(registry.identityRegister()), address(identityRegister));
        assertEq(registry.arbitrationCourt(), court);
        assertEq(registry.getEligiblePoolSize(), 0);
    }

    function test_SetArbitrationCourt() public {
        address newCourt = makeAddr("newCourt");
        registry.setArbitrationCourt(newCourt);
        assertEq(registry.arbitrationCourt(), newCourt);
    }

    // ==========================================
    // ADD ARBITRATOR
    // ==========================================

    function test_AddArbitrator_Success() public {
        vm.prank(arbiter1);
        vm.expectEmit(true, true, false, true);
        emit ArbitratorAdded(idHash1, arbiter1, MIN_STAKE);
        registry.addArbitrator(MIN_STAKE);

        assertEq(registry.getEligiblePoolSize(), 1);
        assertTrue(registry.isEligible(arbiter1));
        assertEq(token.balanceOf(address(registry)), MIN_STAKE);

        (address w, , bool active, bool suspended, uint256 stake, uint256 cases, uint256 rep) = registry.arbitrators(idHash1);
        assertEq(w, arbiter1);
        assertTrue(active);
        assertFalse(suspended);
        assertEq(stake, MIN_STAKE);
        assertEq(cases, 0);
        assertEq(rep, 100);
    }

    function test_RevertWhen_AddArbitratorCallerIsOwner() public {
        identityRegister.mockSetVerified(owner, keccak256("owner-id"), true);
        token.mint(owner, 1000 * 1e6);
        token.approve(address(registry), 1000 * 1e6);

        vm.expectRevert(ArbitratorRegistry.CallerIsOwner.selector);
        registry.addArbitrator(MIN_STAKE);
    }

    function test_RevertWhen_AddArbitratorInsufficientStake() public {
        vm.prank(arbiter1);
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.InsufficientStake.selector, 100 * 1e6, MIN_STAKE));
        registry.addArbitrator(100 * 1e6);
    }

    function test_RevertWhen_AddArbitratorNotVerified() public {
        address unverified = makeAddr("unverified");
        token.mint(unverified, 1000 * 1e6);
        vm.prank(unverified);
        token.approve(address(registry), 1000 * 1e6);

        vm.prank(unverified);
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.UserNotVerified.selector, unverified));
        registry.addArbitrator(MIN_STAKE);
    }

    function test_RevertWhen_AddArbitratorAlreadyRegistered() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(arbiter1);
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.IdentityAlreadyRegistered.selector, idHash1, arbiter1));
        registry.addArbitrator(MIN_STAKE);
    }

    // ==========================================
    // INCREASE STAKE
    // ==========================================

    function test_IncreaseStake_Success() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(arbiter1);
        vm.expectEmit(true, true, false, true);
        emit StakeIncreased(idHash1, arbiter1, 200 * 1e6, 700 * 1e6);
        registry.increaseStake(200 * 1e6);

        (, , , , uint256 stake, , ) = registry.arbitrators(idHash1);
        assertEq(stake, 700 * 1e6);
        assertEq(token.balanceOf(address(registry)), 700 * 1e6);
    }

    function test_RevertWhen_IncreaseStakeZero() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(arbiter1);
        vm.expectRevert(ArbitratorRegistry.ZeroAmountProvided.selector);
        registry.increaseStake(0);
    }

    function test_RevertWhen_IncreaseStakeNotRegistered() public {
        vm.prank(arbiter1);
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.ArbitratorNotRegistered.selector, arbiter1));
        registry.increaseStake(100 * 1e6);
    }

    // ==========================================
    // UNSTAKE FLOW
    // ==========================================

    function test_RequestUnstakeAndUnstake_Success() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);
        assertTrue(registry.isEligible(arbiter1));

        vm.prank(arbiter1);
        vm.expectEmit(true, true, false, true);
        emit UnstakeRequested(idHash1, arbiter1, uint64(block.timestamp));
        registry.requestUnstake();

        // Should be removed from eligible pool immediately upon unstake request
        assertFalse(registry.isEligible(arbiter1));
        assertEq(registry.getEligiblePoolSize(), 0);

        // Attempting to unstake before cooldown fails
        vm.prank(arbiter1);
        vm.expectRevert();
        registry.unstake();

        // Fast forward 7 days
        vm.warp(block.timestamp + registry.UNSTAKE_COOL_DOWN() + 1 seconds);

        uint256 balanceBefore = token.balanceOf(arbiter1);

        vm.prank(arbiter1);
        vm.expectEmit(true, true, false, true);
        emit UnstakeCompleted(idHash1, arbiter1, MIN_STAKE);
        registry.unstake();

        assertEq(token.balanceOf(arbiter1), balanceBefore + MIN_STAKE);
        assertEq(token.balanceOf(address(registry)), 0);
    }

    function test_RevertWhen_UnstakeNotRequested() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(arbiter1);
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.UnstakeNotRequested.selector, arbiter1));
        registry.unstake();
    }

    // ==========================================
    // COURT ACTIONS: SLASHING & REPUTATION
    // ==========================================

    function test_Slash_Success() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        uint256 slashAmount = 100 * 1e6;
        uint256 recipientBalBefore = token.balanceOf(recipient);

        vm.prank(court);
        vm.expectEmit(true, true, false, true);
        emit Slashed(idHash1, arbiter1, slashAmount, recipient);
        registry.slash(arbiter1, slashAmount, recipient);

        assertEq(token.balanceOf(recipient), recipientBalBefore + slashAmount);

        (, , , bool suspended, uint256 stake, , uint256 rep) = registry.arbitrators(idHash1);
        assertEq(stake, MIN_STAKE - slashAmount);
        assertTrue(suspended); // because stake fell below MIN_STAKE
        assertFalse(registry.isEligible(arbiter1));
        assertEq(rep, 90); // 100 - (100 / 10) = 90
    }

    function test_RevertWhen_SlashNonCourt() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(arbiter1);
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.CallerNotCourt.selector, arbiter1, court));
        registry.slash(arbiter1, 100 * 1e6, recipient);
    }

    function test_RevertWhen_SlashAmountExceedsStake() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(court);
        vm.expectRevert(abi.encodeWithSelector(ArbitratorRegistry.SlashAmountExceedsStake.selector, MIN_STAKE + 1, MIN_STAKE));
        registry.slash(arbiter1, MIN_STAKE + 1, recipient);
    }

    function test_UpdateReputation_Success() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(court);
        registry.updateReputation(arbiter1, 15);

        (, , , , , , uint256 rep) = registry.arbitrators(idHash1);
        assertEq(rep, 115);

        vm.prank(court);
        registry.updateReputation(arbiter1, -30);

        (, , , , , , rep) = registry.arbitrators(idHash1);
        assertEq(rep, 85);
    }

    // ==========================================
    // ARBITER CASE ASSIGNMENT & CONCLUSION
    // ==========================================

    function test_AssignRandomArbiters_Success() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);
        vm.prank(arbiter2);
        registry.addArbitrator(MIN_STAKE);
        vm.prank(arbiter3);
        registry.addArbitrator(MIN_STAKE);

        assertEq(registry.getEligiblePoolSize(), 3);

        vm.prank(court);
        address[] memory picked = registry.assignRandomArbiters(1, 2);

        assertEq(picked.length, 2);
        assertTrue(picked[0] != picked[1]);
        assertTrue(registry.isAssignedToCase(1, picked[0]));
        assertTrue(registry.isAssignedToCase(1, picked[1]));
    }

    function test_RevertWhen_AssignRandomArbitersNotEnoughPool() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(court);
        vm.expectRevert(ArbitratorRegistry.NotEnoughEligibleArbitrators.selector);
        registry.assignRandomArbiters(1, 2);
    }

    function test_FinishCase_DecrementsActiveCases() public {
        vm.prank(arbiter1);
        registry.addArbitrator(MIN_STAKE);

        vm.prank(court);
        registry.assignCase(arbiter1);

        (, , , , , uint256 casesBefore, ) = registry.arbitrators(idHash1);
        assertEq(casesBefore, 1);

        vm.prank(court);
        vm.expectEmit(true, true, false, true);
        emit CaseFinished(idHash1, arbiter1, 0);
        registry.finishCase(arbiter1);

        (, , , , , uint256 casesAfter, ) = registry.arbitrators(idHash1);
        assertEq(casesAfter, 0);
    }
}
