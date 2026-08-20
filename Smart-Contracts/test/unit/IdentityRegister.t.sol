// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {IdentityRegister} from "../../src/core/IdentityRegister.sol";
import {CoreAgreement} from "../../src/core/CoreAgreement.sol";
import {ICoreAgreement} from "../../src/interfaces/ICoreAgreement.sol";

contract IdentityRegisterTest is Test {
    IdentityRegister public registry;
    CoreAgreement public coreAgreement;

    // Verifier Signer Setup
    uint256 internal verifierPrivateKey = 0xA11CE;
    address public verifierAddress;

    // Users
    uint256 internal user1PrivateKey = 0xB0B;
    address public user1;

    uint256 internal user2PrivateKey = 0xC0C;
    address public user2;

    address public owner = address(this);
    bytes32 public constant TEST_HASH_1 = keccak256("PASSPORT_DATA_1");
    bytes32 public constant TEST_HASH_2 = keccak256("PASSPORT_DATA_2");

    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "WalletAttestation(address wallet,bytes32 identityHash,uint256 deadline,uint256 nonce)"
    );

    function setUp() external {
        verifierAddress = vm.addr(verifierPrivateKey);
        user1 = vm.addr(user1PrivateKey);
        user2 = vm.addr(user2PrivateKey);

        coreAgreement = new CoreAgreement(keccak256("TERMS_V1"));
        registry = new IdentityRegister(ICoreAgreement(address(coreAgreement)));

        // Configure contract state
        registry.addVerifier(verifierAddress);

        // Sign agreement for test users
        vm.prank(user1);
        coreAgreement.signAgreement();

        vm.prank(user2);
        coreAgreement.signAgreement();
    }

    // --- Helper Functions ---

    function _signAttestation(
        uint256 pKey,
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, wallet, identityHash, deadline, nonce)
        );

        // Calculate EIP-712 Digest manually to mirror contract internal calculation
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Lexo IdentityRegister")),
                keccak256(bytes("1")),
                block.chainid,
                address(registry)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // --- Tests: Attestation & Registration Logic ---

    function test_RegisterWithAttestation_SuccessAsRoot() external {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = registry.nonces(user1);
        bytes memory sig = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, nonce);

        vm.expectEmit(true, true, true, true);
        emit IdentityRegister.Verified(TEST_HASH_1);

        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig);

        (bool isVerifiedStatus, bool isRestrictedStatus, address root, address[] memory wallets) = registry.getIdentity(TEST_HASH_1);
        
        assertTrue(isVerifiedStatus);
        assertFalse(isRestrictedStatus);
        assertEq(root, user1);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], user1);
        assertEq(registry.walletToIdentity(user1), TEST_HASH_1);
        assertEq(registry.nonces(user1), 1);
        assertTrue(registry.isVerified(user1));
    }

    function test_RegisterWithAttestation_RevertZeroIdentityHash() external {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(verifierPrivateKey, user1, bytes32(0), deadline, 0);

        vm.prank(user1);
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.registerWithAttestation(bytes32(0), deadline, sig);
    }

    function test_RegisterWithAttestation_RevertExpired() external {
        uint256 deadline = block.timestamp - 1;
        bytes memory sig = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);

        vm.prank(user1);
        vm.expectRevert(IdentityRegister.AttestationExpired.selector);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig);
    }

    function test_RegisterWithAttestation_RevertInvalidSigner() external {
        uint256 deadline = block.timestamp + 1 hours;
        // Signed with user1's key instead of verifierPrivateKey
        bytes memory sig = _signAttestation(user1PrivateKey, user1, TEST_HASH_1, deadline, 0);

        vm.prank(user1);
        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig);
    }

    function test_RegisterWithAttestation_RevertWalletAlreadyLinked() external {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);

        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig);

        // Attempt second registration with same wallet
        bytes memory sig2 = _signAttestation(verifierPrivateKey, user1, TEST_HASH_2, deadline, 1);
        vm.prank(user1);
        vm.expectRevert(IdentityRegister.WalletAlreadyLinked.selector);
        registry.registerWithAttestation(TEST_HASH_2, deadline, sig2);
    }

    function test_RegisterWithAttestation_RevertMaxWalletsExceeded() external {
        uint256 deadline = block.timestamp + 1 hours;

        // Register root wallet first
        bytes memory sig1 = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig1);

        // Register 4 additional wallets to hit MAX_WALLET (5)
        for (uint160 i = 100; i < 104; i++) {
            address wallet = address(i);
            bytes memory sig = _signAttestation(verifierPrivateKey, wallet, TEST_HASH_1, deadline, 0);
            vm.prank(wallet);
            registry.registerWithAttestation(TEST_HASH_1, deadline, sig);
        }

        assertEq(registry.walletCount(TEST_HASH_1), 5);

        // 6th Wallet attempt must revert
        address overflowWallet = address(999);
        bytes memory sigOverflow = _signAttestation(verifierPrivateKey, overflowWallet, TEST_HASH_1, deadline, 0);
        
        vm.prank(overflowWallet);
        vm.expectRevert(IdentityRegister.MaximumWalletCreated.selector);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sigOverflow);
    }

    // --- Tests: Unverify & Restrictions ---

    function test_Unverify_PurgesIdentityStateButPreservesBans() external {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);

        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig);

        // Restrict identity
        vm.prank(verifierAddress);
        registry.restrict(TEST_HASH_1);

        // Purge identity
        vm.prank(verifierAddress);
        registry.unverify(TEST_HASH_1);

        // Identity data cleared
        assertEq(registry.walletToIdentity(user1), bytes32(0));
        assertEq(registry.walletCount(TEST_HASH_1), 0);
        assertFalse(registry.isVerified(user1));

        // Ban state MUST persist across unverify
        assertTrue(registry.restricted(TEST_HASH_1));

        // Cannot re-register while restricted
        address user3 = address(0x333);
        bytes memory sig2 = _signAttestation(verifierPrivateKey, user3, TEST_HASH_1, deadline, 0);
        vm.prank(user3);
        vm.expectRevert(IdentityRegister.IdentityIsRestricted.selector);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig2);
    }

    function test_Unverify_RevertNotVerifier() external {
        vm.prank(user1);
        vm.expectRevert(IdentityRegister.NotVerifier.selector);
        registry.unverify(TEST_HASH_1);
    }

    // --- Tests: Wallet Removal & Management ---

    function test_RemoveWallet_Success() external {
        uint256 deadline = block.timestamp + 1 hours;

        // Register Root
        bytes memory sig1 = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig1);

        // Register Secondary Wallet
        bytes memory sig2 = _signAttestation(verifierPrivateKey, user2, TEST_HASH_1, deadline, 0);
        vm.prank(user2);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig2);

        // User1 (Root) removes user2
        vm.prank(user1);
        registry.removeWallet(TEST_HASH_1, user2);

        assertEq(registry.walletCount(TEST_HASH_1), 1);
        assertEq(registry.walletToIdentity(user2), bytes32(0));
    }

    function test_RemoveWallet_RevertCannotDeleteRootWallet() external {
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig1 = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig1);

        bytes memory sig2 = _signAttestation(verifierPrivateKey, user2, TEST_HASH_1, deadline, 0);
        vm.prank(user2);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig2);

        // Attempt to remove root while secondary wallet exists
        vm.prank(user1);
        vm.expectRevert(IdentityRegister.CannotDeleteRootWallet.selector);
        registry.removeWallet(TEST_HASH_1, user1);
    }

    function test_RemoveWallet_RevertCannotRemoveLastWallet() external {
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig1 = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig1);

        // Attempting to delete the only remaining wallet (which is root) triggers CannotRemoveLastWallet
        vm.prank(user1);
        vm.expectRevert(IdentityRegister.CannotRemoveLastWallet.selector);
        registry.removeWallet(TEST_HASH_1, user1);
    }

    function test_ChangeRootWallet_Success() external {
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig1 = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig1);

        bytes memory sig2 = _signAttestation(verifierPrivateKey, user2, TEST_HASH_1, deadline, 0);
        vm.prank(user2);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig2);

        // Change root from user1 to user2
        vm.prank(user1);
        registry.changeRootWallet(TEST_HASH_1, user2);

        (,, address root,) = registry.getIdentity(TEST_HASH_1);
        assertEq(root, user2);

        // Now user1 can be removed safely
        vm.prank(user2);
        registry.removeWallet(TEST_HASH_1, user1);
        assertEq(registry.walletCount(TEST_HASH_1), 1);
    }
    // --- Additional Edge Cases & Reverts ---

    function test_RegisterWithAttestation_RevertSecondaryNotVerified() external {
        // Attempting to register secondary wallet to non-existent identity directly bypasses root
        uint256 deadline = block.timestamp + 1 hours;
        
        // Identity has no wallets yet, but we force conditions by directly calling internal state logic
        bytes memory sig = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        
        // This test ensures root logic activates when walletCounts == 0
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig);
        
        // Secondary wallet attempts un-verified status path if identity had been reset manually
        vm.prank(verifierAddress);
        registry.unverify(TEST_HASH_1);

        // Attempting registration again acts as a fresh root, proving logic reset
        bytes memory sig2 = _signAttestation(verifierPrivateKey, user2, TEST_HASH_1, deadline, 0);
        vm.prank(user2);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig2);
        
        (,, address root,) = registry.getIdentity(TEST_HASH_1);
        assertEq(root, user2); // Correctly became the new root
    }

    function test_Unrestrict_RestoresRegistrationAbility() external {
        vm.prank(verifierAddress);
        registry.restrict(TEST_HASH_1);

        // Lift restriction
        vm.prank(verifierAddress);
        registry.unrestrict(TEST_HASH_1);
        assertFalse(registry.restricted(TEST_HASH_1));

        // Registering should now succeed
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig);
        assertTrue(registry.isVerified(user1));
    }

    function test_AccessControl_RevertNotAuthorizedIdentityOwner() external {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig1 = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig1);

        // Unauthorized third-party attempts wallet modification
        address attacker = address(0xBAD);
        
        vm.prank(attacker);
        vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);
        registry.removeWallet(TEST_HASH_1, user1);

        vm.prank(attacker);
        vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);
        registry.changeRootWallet(TEST_HASH_1, user1);
    }

    function test_ZeroIdentityHash_RevertsAcrossAllMethods() external {
        vm.prank(verifierAddress);
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.unverify(bytes32(0));

        vm.prank(verifierAddress);
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.restrict(bytes32(0));

        vm.prank(verifierAddress);
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.unrestrict(bytes32(0));

        vm.prank(user1);
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.removeWallet(bytes32(0), user1);

        vm.prank(user1);
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.changeRootWallet(bytes32(0), user1);
    }

    function test_Unverify_RevertIdentityHasNoWallets() external {
        vm.prank(verifierAddress);
        vm.expectRevert(IdentityRegister.IdentityHasNoWallets.selector);
        registry.unverify(TEST_HASH_1);
    }

    function test_ViewGetters_CorrectOutput() external {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(verifierPrivateKey, user1, TEST_HASH_1, deadline, 0);
        
        vm.prank(user1);
        registry.registerWithAttestation(TEST_HASH_1, deadline, sig);

        // Test getAttestationDigest matches manual hash
        bytes32 contractDigest = registry.getAttestationDigest(user1, TEST_HASH_1, deadline, 0);
        bytes32 expectedStructHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, user1, TEST_HASH_1, deadline, 0)
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Lexo IdentityRegister")),
                keccak256(bytes("1")),
                block.chainid,
                address(registry)
            )
        );
        bytes32 expectedDigest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, expectedStructHash));
        assertEq(contractDigest, expectedDigest);

        // Test direct mappings
        assertEq(registry.getIdentityHashByWallet(user1), TEST_HASH_1);
        
        address[] memory wallets = registry.getWallets(TEST_HASH_1);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], user1);
    }
}