// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// import {Test} from "forge-std/Test.sol";
// import {IdentityRegister} from "../../src/core/IdentityRegister.sol";
// import {ICoreAgreement} from "../../src/interfaces/ICoreAgreement.sol";

// contract MockCoreAgreement is ICoreAgreement {
//     mapping(address => bool) public signed;

//     function signAgreement(address user, bool status) external {
//         signed[user] = status;
//     }

//     function hasSignedAgreement(address user) external view returns (bool) {
//         return signed[user];
//     }
// }

// contract IdentityRegisterTest is Test {
//     IdentityRegister public registry;
//     MockCoreAgreement public coreAgreement;

//     uint256 internal verifierPk = 0xA11CE;
//     address internal verifier;

//     uint256 internal user1Pk = 0xB0B;
//     address internal user1;

//     uint256 internal user2Pk = 0xC0C;
//     address internal user2;

//     address internal owner;
//     address internal attacker;

//     bytes32 internal constant TEST_ID_HASH = keccak256("PASSPORT_NEPAL_12345");
//     bytes32 internal constant SECOND_ID_HASH = keccak256("PASSPORT_NEPAL_67890");

//     // Events re-declared for vm.expectEmit
//     event VerifierChanged(address indexed newVerifier);
//     event WalletLinked(bytes32 indexed hash, address indexed wallet, bool isRoot);
//     event WalletRemoved(bytes32 indexed hash, address indexed wallet);
//     event Verified(bytes32 indexed hash);
//     event Unverified(bytes32 indexed hash);
//     event IdentityRestricted(bytes32 indexed hash, bool isRestricted);
//     event RootWalletChanged(bytes32 indexed hash, address indexed newRootWallet);

//     function setUp() public {
//         owner = address(this);
//         verifier = vm.addr(verifierPk);
//         user1 = vm.addr(user1Pk);
//         user2 = vm.addr(user2Pk);
//         attacker = makeAddr("attacker");

//         coreAgreement = new MockCoreAgreement();
//         registry = new IdentityRegister(ICoreAgreement(address(coreAgreement)));

//         registry.addVerifier(verifier);
//         coreAgreement.setSigned(user1, true);
//         coreAgreement.setSigned(user2, true);
//     }

//     // --- HELPER FUNCTIONS ---

//     function _signAttestation(
//         uint256 signerPk,
//         address wallet,
//         bytes32 idHash,
//         uint256 deadline,
//         uint256 nonce
//     ) internal view returns (bytes memory) {
//         bytes32 digest = registry.getAttestationDigest(wallet, idHash, deadline, nonce);
//         (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
//         return abi.encodePacked(r, s, v);
//     }

//     function _registerWallet(address wallet, uint256 walletPk, bytes32 idHash) internal {
//         uint256 deadline = block.timestamp + 1 hours;
//         uint256 nonce = registry.nonces(wallet);
//         bytes memory sig = _signAttestation(verifierPk, wallet, idHash, deadline, nonce);

//         vm.prank(wallet);
//         registry.registerWithAttestation(idHash, deadline, sig);
//     }

//     // --- CONSTRUCTOR & VERIFIER MANAGEMENT ---

//     function test_Constructor_SetsCoreAgreementAndDomain() public view {
//         assertEq(address(registry.coreAgreement()), address(coreAgreement));
//         assertEq(registry.owner(), owner);
//     }

//     function test_AddVerifier_Success() public {
//         address newVerifier = makeAddr("newVerifier");
        
//         vm.expectEmit(true, false, false, false);
//         emit VerifierChanged(newVerifier);
        
//         registry.addVerifier(newVerifier);
//         assertEq(registry.verifier(), newVerifier);
//     }

//     function test_AddVerifier_RevertIf_ZeroAddress() public {
//         vm.expectRevert(IdentityRegister.InvalidVerifierAddress.selector);
//         registry.addVerifier(address(0));
//     }

//     function test_AddVerifier_RevertIf_NotOwner() public {
//         vm.prank(attacker);
//         vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
//         registry.addVerifier(makeAddr("newVerifier"));
//     }

//     // --- REGISTRATION FLOWS ---

//     function test_RegisterWithAttestation_RootWallet_Success() public {
//         uint256 deadline = block.timestamp + 1 hours;
//         bytes memory sig = _signAttestation(verifierPk, user1, TEST_ID_HASH, deadline, 0);

//         vm.expectEmit(true, false, false, false);
//         emit Verified(TEST_ID_HASH);
//         vm.expectEmit(true, true, false, true);
//         emit WalletLinked(TEST_ID_HASH, user1, true);

//         vm.prank(user1);
//         registry.registerWithAttestation(TEST_ID_HASH, deadline, sig);

//         assertTrue(registry.isVerified(user1));
//         assertEq(registry.getIdentityHashByWallet(user1), TEST_ID_HASH);
//         assertEq(registry.nonces(user1), 1);

//         (bool isVerifiedStatus, bool isRestrictedStatus, address root, address[] memory walletList) = registry.getIdentity(TEST_ID_HASH);
//         assertTrue(isVerifiedStatus);
//         assertFalse(isRestrictedStatus);
//         assertEq(root, user1);
//         assertEq(walletList.length, 1);
//         assertEq(walletList[0], user1);
//     }

//     function test_RegisterWithAttestation_SecondaryWallet_Success() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);

//         uint256 deadline = block.timestamp + 1 hours;
//         bytes memory sig = _signAttestation(verifierPk, user2, TEST_ID_HASH, deadline, 0);

//         vm.expectEmit(true, true, false, true);
//         emit WalletLinked(TEST_ID_HASH, user2, false);

//         vm.prank(user2);
//         registry.registerWithAttestation(TEST_ID_HASH, deadline, sig);

//         assertTrue(registry.isVerified(user2));
//         assertEq(registry.walletCount(TEST_ID_HASH), 2);
//         assertEq(registry.getWallets(TEST_ID_HASH)[1], user2);
//     }

//     function test_RegisterWithAttestation_RevertIf_ZeroIdentityHash() public {
//         uint256 deadline = block.timestamp + 1 hours;
//         bytes memory sig = _signAttestation(verifierPk, user1, bytes32(0), deadline, 0);

//         vm.prank(user1);
//         vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
//         registry.registerWithAttestation(bytes32(0), deadline, sig);
//     }

//     function test_RegisterWithAttestation_RevertIf_Expired() public {
//         uint256 deadline = block.timestamp - 1;
//         bytes memory sig = _signAttestation(verifierPk, user1, TEST_ID_HASH, deadline, 0);

//         vm.prank(user1);
//         vm.expectRevert(IdentityRegister.AttestationExpired.selector);
//         registry.registerWithAttestation(TEST_ID_HASH, deadline, sig);
//     }

//     function test_RegisterWithAttestation_RevertIf_Restricted() public {
//         vm.prank(verifier);
//         registry.restrict(TEST_ID_HASH);

//         uint256 deadline = block.timestamp + 1 hours;
//         bytes memory sig = _signAttestation(verifierPk, user1, TEST_ID_HASH, deadline, 0);

//         vm.prank(user1);
//         vm.expectRevert(IdentityRegister.IdentityIsRestricted.selector);
//         registry.registerWithAttestation(TEST_ID_HASH, deadline, sig);
//     }

//     function test_RegisterWithAttestation_RevertIf_WalletAlreadyLinked() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);

//         uint256 deadline = block.timestamp + 1 hours;
//         bytes memory sig = _signAttestation(verifierPk, user1, SECOND_ID_HASH, deadline, 1);

//         vm.prank(user1);
//         vm.expectRevert(IdentityRegister.WalletAlreadyLinked.selector);
//         registry.registerWithAttestation(SECOND_ID_HASH, deadline, sig);
//     }

//     function test_RegisterWithAttestation_RevertIf_InvalidSignature() public {
//         uint256 deadline = block.timestamp + 1 hours;
//         // Signed by user1 (attacker) instead of verifier
//         bytes memory badSig = _signAttestation(user1Pk, user1, TEST_ID_HASH, deadline, 0);

//         vm.prank(user1);
//         vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);
//         registry.registerWithAttestation(TEST_ID_HASH, deadline, badSig);
//     }

//     function test_RegisterWithAttestation_RevertIf_MaxWalletsReached() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);

//         uint256 deadline = block.timestamp + 1 hours;
//         for (uint160 i = 10; i < 14; i++) {
//             address wallet = address(i);
//             bytes memory sig = _signAttestation(verifierPk, wallet, TEST_ID_HASH, deadline, 0);
//             vm.prank(wallet);
//             registry.registerWithAttestation(TEST_ID_HASH, deadline, sig);
//         }

//         assertEq(registry.walletCount(TEST_ID_HASH), 5);

//         // Attempting to register the 6th wallet
//         address overflowWallet = address(99);
//         bytes memory sigOverflow = _signAttestation(verifierPk, overflowWallet, TEST_ID_HASH, deadline, 0);

//         vm.prank(overflowWallet);
//         vm.expectRevert(IdentityRegister.MaximumWalletCreated.selector);
//         registry.registerWithAttestation(TEST_ID_HASH, deadline, sigOverflow);
//     }

//     // --- ROOT WALLET MANAGEMENT ---

//     function test_ChangeRootWallet_ByOwner_Success() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);
//         _registerWallet(user2, user2Pk, TEST_ID_HASH);

//         vm.expectEmit(true, true, false, false);
//         emit RootWalletChanged(TEST_ID_HASH, user2);

//         vm.prank(user1);
//         registry.changeRootWallet(TEST_ID_HASH, user2);

//         (,, address root,) = registry.getIdentity(TEST_ID_HASH);
//         assertEq(root, user2);
//     }

//     function test_ChangeRootWallet_ByVerifier_Success() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);
//         _registerWallet(user2, user2Pk, TEST_ID_HASH);

//         vm.prank(verifier);
//         registry.changeRootWallet(TEST_ID_HASH, user2);

//         (,, address root,) = registry.getIdentity(TEST_ID_HASH);
//         assertEq(root, user2);
//     }

//     function test_ChangeRootWallet_RevertIf_NotAuthorized() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);
//         _registerWallet(user2, user2Pk, TEST_ID_HASH);

//         vm.prank(attacker);
//         vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);
//         registry.changeRootWallet(TEST_ID_HASH, user2);
//     }

//     function test_ChangeRootWallet_RevertIf_TargetNotLinked() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);

//         vm.prank(user1);
//         vm.expectRevert(IdentityRegister.WalletNotLinkedToIdentity.selector);
//         registry.changeRootWallet(TEST_ID_HASH, user2);
//     }

//     function test_ChangeRootWallet_RevertIf_ZeroHash() public {
//         vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
//         registry.changeRootWallet(bytes32(0), user1);
//     }

//     // --- REMOVE WALLET ---

//     function test_RemoveWallet_Success() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);
//         _registerWallet(user2, user2Pk, TEST_ID_HASH);

//         vm.expectEmit(true, true, false, false);
//         emit WalletRemoved(TEST_ID_HASH, user2);

//         vm.prank(user1);
//         registry.removeWallet(TEST_ID_HASH, user2);

//         assertEq(registry.walletCount(TEST_ID_HASH), 1);
//         assertEq(registry.getIdentityHashByWallet(user2), bytes32(0));
//         assertFalse(registry.isVerified(user2));
//     }

//     function test_RemoveWallet_RevertIf_DeletingRootWalletWithMultipleWallets() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);
//         _registerWallet(user2, user2Pk, TEST_ID_HASH);

//         vm.prank(user1);
//         vm.expectRevert(IdentityRegister.CannotDeleteRootWallet.selector);
//         registry.removeWallet(TEST_ID_HASH, user1);
//     }

//     function test_RemoveWallet_RevertIf_LastRemainingWallet() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);

//         vm.prank(user1);
//         vm.expectRevert(IdentityRegister.CannotRemoveLastWallet.selector);
//         registry.removeWallet(TEST_ID_HASH, user1);
//     }

//     function test_RemoveWallet_RevertIf_NotAuthorized() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);
//         _registerWallet(user2, user2Pk, TEST_ID_HASH);

//         vm.prank(attacker);
//         vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);
//         registry.removeWallet(TEST_ID_HASH, user2);
//     }

//     function test_RemoveWallet_RevertIf_ZeroHash() public {
//         vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
//         registry.removeWallet(bytes32(0), user1);
//     }

//     // --- UNVERIFY & RESTRICTIONS ---

//     function test_Unverify_PurgesIdentityState() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);
//         _registerWallet(user2, user2Pk, TEST_ID_HASH);

//         vm.expectEmit(true, false, false, false);
//         emit Unverified(TEST_ID_HASH);

//         vm.prank(verifier);
//         registry.unverify(TEST_ID_HASH);

//         assertEq(registry.getIdentityHashByWallet(user1), bytes32(0));
//         assertEq(registry.getIdentityHashByWallet(user2), bytes32(0));
//         assertFalse(registry.isVerified(user1));

//         (bool isVerifiedStatus,, address root, address[] memory wallets) = registry.getIdentity(TEST_ID_HASH);
//         assertFalse(isVerifiedStatus);
//         assertEq(root, address(0));
//         assertEq(wallets.length, 0);
//     }

//     function test_Unverify_RevertIf_NotVerifier() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);

//         vm.prank(attacker);
//         vm.expectRevert(IdentityRegister.NotVerifier.selector);
//         registry.unverify(TEST_ID_HASH);
//     }

//     function test_Unverify_RevertIf_IdentityHasNoWallets() public {
//         vm.prank(verifier);
//         vm.expectRevert(IdentityRegister.IdentityHasNoWallets.selector);
//         registry.unverify(TEST_ID_HASH);
//     }

//     function test_Unverify_RevertIf_ZeroHash() public {
//         vm.prank(verifier);
//         vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
//         registry.unverify(bytes32(0));
//     }

//     function test_RestrictAndUnrestrict_Flow() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);

//         // Restrict
//         vm.expectEmit(true, false, false, true);
//         emit IdentityRestricted(TEST_ID_HASH, true);

//         vm.prank(verifier);
//         registry.restrict(TEST_ID_HASH);

//         assertTrue(registry.restricted(TEST_ID_HASH));
//         assertFalse(registry.isVerified(user1)); // Verification check must fail while restricted

//         // Unrestrict
//         vm.expectEmit(true, false, false, true);
//         emit IdentityRestricted(TEST_ID_HASH, false);

//         vm.prank(verifier);
//         registry.unrestrict(TEST_ID_HASH);

//         assertFalse(registry.restricted(TEST_ID_HASH));
//         assertTrue(registry.isVerified(user1));
//     }

//     function test_BanSurvivesUnverify() public {
//         _registerWallet(user1, user1Pk, TEST_ID_HASH);

//         vm.prank(verifier);
//         registry.restrict(TEST_ID_HASH);

//         vm.prank(verifier);
//         registry.unverify(TEST_ID_HASH);

//         // Identity is purged, but restriction remains
//         assertTrue(registry.restricted(TEST_ID_HASH));

//         // Attempting to re-register under the same banned hash fails
//         uint256 deadline = block.timestamp + 1 hours;
//         bytes memory sig = _signAttestation(verifierPk, user2, TEST_ID_HASH, deadline, 0);

//         vm.prank(user2);
//         vm.expectRevert(IdentityRegister.IdentityIsRestricted.selector);
//         registry.registerWithAttestation(TEST_ID_HASH, deadline, sig);
//     }

//     function test_Restrict_RevertIf_NotVerifier() public {
//         vm.prank(attacker);
//         vm.expectRevert(IdentityRegister.NotVerifier.selector);
//         registry.restrict(TEST_ID_HASH);
//     }

//     function test_Restrict_RevertIf_ZeroHash() public {
//         vm.prank(verifier);
//         vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
//         registry.restrict(bytes32(0));
//     }

//     function test_Unrestrict_RevertIf_ZeroHash() public {
//         vm.prank(verifier);
//         vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
//         registry.unrestrict(bytes32(0));
//     }
// }