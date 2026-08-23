// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {ArbitratorRegistry} from "../../src/arbitration/ArbitratorRegistry.sol";
import {IIdentityRegister} from "../../src/interfaces/IIdentityRegister.sol";
import {MockIdentityRegister} from "../mocks/MockIdentity.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ArbitratorRegistryTest is Test {
    ArbitratorRegistry public registry;
    MockUSDT public token;
    MockIdentityRegister public identityRegister;

    address public owner = address(this);
    address public court = address(0x111);
    address public arb1 = address(0x222);
    address public arb2 = address(0x333);
    address public arb3 = address(0x444);
    address public unverifiedUser = address(0x555);

    bytes32 public id1;
    bytes32 public id2;
    bytes32 public id3;

    uint256 public constant MIN_STAKE = 500 * 1e6;
    uint256 public constant COOL_DOWN = 7 days;

    function setUp() public {
        // Deploy existing Mocks
        token = new MockUSDT(1_000_000); // Mints 1M USDT to deployer
        identityRegister = new MockIdentityRegister();

        // Deploy Registry
        registry = new ArbitratorRegistry(
            address(identityRegister),
            IERC20(address(token))
        );
        registry.setArbitrationCourt(court);

        // Verify users via MockIdentityRegister
        identityRegister.setVerified(arb1, true);
        identityRegister.setVerified(arb2, true);
        identityRegister.setVerified(arb3, true);

        // Extract auto-generated identity hashes from MockIdentityRegister
        id1 = identityRegister.getIdentityHashByWallet(arb1);
        id2 = identityRegister.getIdentityHashByWallet(arb2);
        id3 = identityRegister.getIdentityHashByWallet(arb3);

        // Mint 10,000 USDT to test arbitrators
        token.mint(arb1, 10_000);
        token.mint(arb2, 10_000);
        token.mint(arb3, 10_000);

        // Approve Registry for staking
        vm.prank(arb1);
        token.approve(address(registry), type(uint256).max);

        vm.prank(arb2);
        token.approve(address(registry), type(uint256).max);

        vm.prank(arb3);
        token.approve(address(registry), type(uint256).max);
    }

    // --- Helper Functions ---

    function _register(address _arb, uint256 _stake) internal {
        vm.prank(_arb);
        registry.addArbitrator(_stake);
    }

    // --- 1. Registration Tests ---

    function test_AddArbitrator_Success() public {
        _register(arb1, MIN_STAKE);

        (
            address wallet,
            uint64 unstakeReq,
            bool active,
            bool suspended,
            uint256 stake,
            uint256 activeCases,
            uint256 reputation
        ) = registry.arbitrators(id1);

        assertEq(wallet, arb1);
        assertEq(stake, MIN_STAKE);
        assertEq(reputation, 100);
        assertEq(unstakeReq, 0);
        assertTrue(active);
        assertFalse(suspended);
        assertEq(registry.arbitratorToIdentity(arb1), id1);
        assertTrue(registry.isEligible(arb1));
        assertEq(registry.getEligiblePoolSize(), 1);
    }

    function test_AddArbitrator_RevertsIf_NotVerified() public {
        token.mint(unverifiedUser, 1_000);

        vm.prank(unverifiedUser);
        token.approve(address(registry), MIN_STAKE);

        vm.prank(unverifiedUser);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.UserNotVerified.selector,
                unverifiedUser
            )
        );
        registry.addArbitrator(MIN_STAKE);
    }

    function test_AddArbitrator_RevertsIf_Owner() public {
        identityRegister.setVerified(owner, true);
        token.approve(address(registry), MIN_STAKE);

        vm.expectRevert(
            abi.encodeWithSelector(ArbitratorRegistry.CallerIsOwner.selector)
        );
        registry.addArbitrator(MIN_STAKE);
    }

    function test_AddArbitrator_RevertsIf_InsufficientStake() public {
        uint256 lowStake = MIN_STAKE - 1;

        vm.prank(arb1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.InsufficientStake.selector,
                lowStake,
                MIN_STAKE
            )
        );
        registry.addArbitrator(lowStake);
    }

    function test_AddArbitrator_RevertsIf_AlreadyRegistered() public {
        _register(arb1, MIN_STAKE);

        vm.prank(arb1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.IdentityAlreadyRegistered.selector,
                id1,
                arb1
            )
        );
        registry.addArbitrator(MIN_STAKE);
    }

    // --- 2. Change Wallet Tests ---

    function test_ChangeWallet_Success() public {
        _register(arb1, MIN_STAKE);

        address newWallet = address(0x888);
        identityRegister.setCustomIdentity(newWallet, id1);

        vm.prank(arb1);
        registry.changeWallet(newWallet);

        assertEq(registry.arbitratorToIdentity(arb1), bytes32(0));
        assertEq(registry.arbitratorToIdentity(newWallet), id1);
        assertFalse(registry.isEligible(arb1));
        assertTrue(registry.isEligible(newWallet));
    }

    function test_ChangeWallet_RevertsIf_InvalidTargetWallet() public {
        _register(arb1, MIN_STAKE);

        vm.prank(arb1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.InvalidTargetWallet.selector,
                address(0)
            )
        );
        registry.changeWallet(address(0));
    }

    function test_ChangeWallet_RevertsIf_IdentityMismatch() public {
        _register(arb1, MIN_STAKE);

        address newWallet = address(0x888);
        identityRegister.setVerified(newWallet, true);

        bytes32 newId = identityRegister.getIdentityHashByWallet(newWallet);

        vm.prank(arb1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.IdentityMismatch.selector,
                id1,
                newId
            )
        );
        registry.changeWallet(newWallet);
    }

    // --- 3. Stake Management ---

    function test_IncreaseStake_Success() public {
        _register(arb1, MIN_STAKE);

        vm.prank(arb1);
        registry.increaseStake(200 * 1e6);

        (, , , , uint256 stake, , ) = registry.arbitrators(id1);
        assertEq(stake, MIN_STAKE + 200 * 1e6);
    }

    function test_IncreaseStake_RevertsIf_ZeroAmount() public {
        _register(arb1, MIN_STAKE);

        vm.prank(arb1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.ZeroAmountProvided.selector
            )
        );
        registry.increaseStake(0);
    }

    // --- 4. Unstaking Cycle ---

    function test_Unstake_Lifecycle_Success() public {
        _register(arb1, MIN_STAKE);

        vm.prank(arb1);
        registry.requestUnstake();

        assertFalse(registry.isEligible(arb1));
        assertEq(registry.getEligiblePoolSize(), 0);

        vm.warp(block.timestamp + COOL_DOWN + 1);

        uint256 balanceBefore = token.balanceOf(arb1);

        vm.prank(arb1);
        registry.unstake();

        assertEq(token.balanceOf(arb1), balanceBefore + MIN_STAKE);
        assertEq(registry.arbitratorToIdentity(arb1), bytes32(0));
    }

    function test_Unstake_RevertsIf_CooldownActive() public {
        _register(arb1, MIN_STAKE);
        
        vm.prank(arb1);
        registry.requestUnstake();
        
        uint64 requestedAt = uint64(block.timestamp);
        uint64 readyAt = requestedAt + uint64(COOL_DOWN);

        vm.warp(readyAt - 1 seconds);

        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.UnstakeCooldownActive.selector,
                requestedAt,
                readyAt
            )
        );

        vm.prank(arb1);
        registry.unstake();
    }

    // --- 5. Slashing & Court Operations ---

    function test_Slash_Success_And_Suspension() public {
        _register(arb1, MIN_STAKE);

        uint256 slashAmount = 100 * 1e6;
        address recipient = address(0x999);

        vm.prank(court);
        registry.slash(arb1, slashAmount, recipient);

        (
            ,
            ,
            ,
            bool suspended,
            uint256 stake,
            ,
            uint256 reputation
        ) = registry.arbitrators(id1);

        assertEq(stake, MIN_STAKE - slashAmount);
        assertEq(reputation, 90);
        assertTrue(suspended);
        assertFalse(registry.isEligible(arb1));
        assertEq(token.balanceOf(recipient), slashAmount);
    }

    function test_Slash_RevertsIf_ExceedsStake() public {
        _register(arb1, MIN_STAKE);

        vm.prank(court);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.SlashAmountExceedsStake.selector,
                MIN_STAKE + 1,
                MIN_STAKE
            )
        );
        registry.slash(arb1, MIN_STAKE + 1, address(0x999));
    }

    function test_Slash_RevertsIf_NotCourt() public {
        _register(arb1, MIN_STAKE);

        vm.prank(arb2);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.CallerNotCourt.selector,
                arb2,
                court
            )
        );
        registry.slash(arb1, 50 * 1e6, address(0x999));
    }

    function test_Reactivate_Success() public {
        _register(arb1, MIN_STAKE);

        vm.prank(court);
        registry.slash(arb1, 100 * 1e6, address(0x999));
        assertFalse(registry.isEligible(arb1));

        vm.prank(arb1);
        registry.increaseStake(100 * 1e6);

        vm.prank(arb1);
        registry.reactivate();

        assertTrue(registry.isEligible(arb1));
    }

    // --- 6. Random Selection Engine ---

    function test_AssignRandomCase_Success() public {
        _register(arb1, MIN_STAKE);
        _register(arb2, MIN_STAKE);
        _register(arb3, MIN_STAKE);

        assertEq(registry.getEligiblePoolSize(), 3);

        vm.prank(court);
        address selected = registry.assignRandomCase(101);

        assertTrue(selected == arb1 || selected == arb2 || selected == arb3);

        (, , , , , uint256 activeCases, ) = registry.arbitrators(
            registry.arbitratorToIdentity(selected)
        );
        assertEq(activeCases, 1);
    }

    function test_AssignRandomCase_RevertsIf_PoolEmpty() public {
        vm.prank(court);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArbitratorRegistry.NotEnoughEligibleArbitrators.selector
            )
        );
        registry.assignRandomCase(101);
    }

    function test_AssignRandomCase_RemovesFromPool_WhenMaxCasesReached() public {
        _register(arb1, MIN_STAKE);

        vm.startPrank(court);
        registry.assignCase(arb1);
        registry.assignCase(arb1);
        assertTrue(registry.isEligible(arb1));

        registry.assignCase(arb1);
        assertFalse(registry.isEligible(arb1));
        assertEq(registry.getEligiblePoolSize(), 0);
        vm.stopPrank();
    }
}