// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {CoreAgreement} from "../../src/core/CoreAgreement.sol";

contract CoreAgreementTest is Test {
    CoreAgreement public coreAgreement;

    bytes32 public constant VALID_AGREEMENT_HASH = keccak256("TERMS_AND_CONDITIONS_V1");
    address public user1 = vm.addr(0x1111);
    address public user2 = vm.addr(0x2222);

    event AgreementSigned(address indexed user, uint256 indexed timestamp);

    function setUp() external {
        // Warp to a non-zero timestamp for realistic testing
        vm.warp(1_700_000_000);
        coreAgreement = new CoreAgreement(VALID_AGREEMENT_HASH);
    }

    // --- Constructor Tests ---

    function test_Constructor_SetsStateCorrectly() external view {
        assertEq(coreAgreement.agreementHash(), VALID_AGREEMENT_HASH);
        assertEq(coreAgreement.publishedAt(), 1_700_000_000);
    }

    function test_Constructor_RevertInvalidAgreementHash() external {
        vm.expectRevert(CoreAgreement.InvalidAgreementHash.selector);
        new CoreAgreement(bytes32(0));
    }

    // --- Core Logic Tests ---

    function test_SignAgreement_Success() external {
        uint256 expectedTimestamp = 1_700_000_100;
        vm.warp(expectedTimestamp);

        // Expect the exact event emission
        vm.expectEmit(true, true, false, true);
        emit AgreementSigned(user1, expectedTimestamp);

        // Sign agreement as user1
        vm.prank(user1);
        coreAgreement.signAgreement();

        // Verify state updates
        assertEq(coreAgreement.signedAt(user1), expectedTimestamp);
        assertTrue(coreAgreement.hasSignedAgreement(user1));
    }

    function test_SignAgreement_RevertAlreadySigned() external {
        // First signing attempt
        vm.prank(user1);
        coreAgreement.signAgreement();

        // Fast-forward time and attempt double signing
        vm.warp(block.timestamp + 100);

        vm.prank(user1);
        vm.expectRevert(CoreAgreement.AlreadySigned.selector);
        coreAgreement.signAgreement();
    }

    // --- View Function Tests ---

    function test_HasSignedAgreement_ReturnsFalseForUnsignedUser() external view {
        assertFalse(coreAgreement.hasSignedAgreement(user2));
        assertEq(coreAgreement.signedAt(user2), 0);
    }

    function test_MultipleUsersCanSignIndependently() external {
        uint256 t1 = 1_700_000_100;
        uint256 t2 = 1_700_000_200;

        // User 1 signs at t1
        vm.warp(t1);
        vm.prank(user1);
        coreAgreement.signAgreement();

        // User 2 signs at t2
        vm.warp(t2);
        vm.prank(user2);
        coreAgreement.signAgreement();

        // Assert independent state persistence
        assertEq(coreAgreement.signedAt(user1), t1);
        assertEq(coreAgreement.signedAt(user2), t2);
        assertTrue(coreAgreement.hasSignedAgreement(user1));
        assertTrue(coreAgreement.hasSignedAgreement(user2));
    }
}