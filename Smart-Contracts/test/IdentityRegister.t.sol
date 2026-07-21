// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IdentityRegister} from "../src/core/IdentityRegister.sol";

contract IdentityRegisterTest is Test {
    IdentityRegister registry;

    uint256 verifierPk = 0xA11CE;
    address verifierAddr;

    address walletA = address(0x1001);
    address walletB = address(0x1002);
    address walletC = address(0x1003);
    address stranger = address(0x9999);

    bytes32 hash1 = keccak256("passport-pubkey-1+pepper");
    bytes32 hash2 = keccak256("passport-pubkey-2+pepper");

    function setUp() public {
        registry = new IdentityRegister(); // test contract is owner
        verifierAddr = vm.addr(verifierPk);
        registry.addVerifier(verifierAddr);
    }

    function _sign(address wallet, bytes32 identityHash, uint256 deadline, uint256 nonce, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = registry.getAttestationDigest(wallet, identityHash, deadline, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _registerWallet(address wallet, bytes32 identityHash, uint256 pk) internal {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = registry.nonces(wallet);
        bytes memory sig = _sign(wallet, identityHash, deadline, nonce, pk);
        vm.prank(wallet);
        registry.registerWithAttestation(identityHash, deadline, sig);
    }

    // --- addVerifier ---

    function test_AddVerifier_RevertsOnZeroAddress() public {
        vm.expectRevert(IdentityRegister.InvalidVerifierAddress.selector);
        registry.addVerifier(address(0));
    }

    function test_AddVerifier_RevertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.addVerifier(address(0xBEEF));
    }

    // --- zero-hash guard (the fix) ---

    function test_RegisterWithAttestation_RevertsOnZeroIdentityHash() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletA, bytes32(0), deadline, 0, verifierPk);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.registerWithAttestation(bytes32(0), deadline, sig);
    }

  

    function test_Restrict_RevertsOnZeroIdentityHash() public {
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.restrict(bytes32(0));
    }

    function test_RemoveWallet_RevertsOnZeroIdentityHash() public {
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.removeWallet(bytes32(0), walletA);
    }

    function test_ChangeRootWallet_RevertsOnZeroIdentityHash() public {
        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);
        registry.changeRootWallet(bytes32(0), walletA);
    }

    // --- happy path ---

    function test_RegisterFirstWallet_BecomesRoot() public {
        _registerWallet(walletA, hash1, verifierPk);

        assertEq(registry.walletToIdentity(walletA), hash1);
        assertEq(registry.walletCount(hash1), 1);
        assertTrue(registry.isVerified(walletA));

        (bool verified, bool restricted, address root, address[] memory wallets) = registry.getIdentity(hash1);
        assertTrue(verified);
        assertFalse(restricted);
        assertEq(root, walletA);
        assertEq(wallets.length, 1);
    }

    function test_RegisterSecondWallet_UnderSameIdentity() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        assertEq(registry.walletCount(hash1), 2);
        address[] memory wallets = registry.getWallets(hash1);
        assertEq(wallets[0], walletA);
        assertEq(wallets[1], walletB);
    }

    // --- replay protection ---

    function test_RevertsOnReplayedAttestation_SameIdentity() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletA, hash1, deadline, 0, verifierPk);

        vm.prank(walletA);
        registry.registerWithAttestation(hash1, deadline, sig);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.WalletAlreadyLinked.selector);
        registry.registerWithAttestation(hash1, deadline, sig);
    }

    function test_RevertsOnStaleNonceSignature_AgainstDifferentIdentity() public {
        _registerWallet(walletA, hash1, verifierPk);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory staleSig = _sign(walletA, hash2, deadline, 0, verifierPk);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.WalletAlreadyLinked.selector);
        registry.registerWithAttestation(hash2, deadline, staleSig);
    }

    function test_RevertsOnExpiredAttestation() public {
        uint256 deadline = block.timestamp;
        bytes memory sig = _sign(walletA, hash1, deadline, 0, verifierPk);

        vm.warp(block.timestamp + 1);
        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.AttestationExpired.selector);
        registry.registerWithAttestation(hash1, deadline, sig);
    }

    function test_RevertsOnWrongSigner() public {
        uint256 wrongPk = 0xBEEF;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletA, hash1, deadline, 0, wrongPk);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);
        registry.registerWithAttestation(hash1, deadline, sig);
    }

    function test_RevertsIfWalletAlreadyLinkedElsewhere() public {
        _registerWallet(walletA, hash1, verifierPk);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletA, hash2, deadline, 1, verifierPk);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.WalletAlreadyLinked.selector);
        registry.registerWithAttestation(hash2, deadline, sig);
    }

    // --- MAX_WALLET cap ---

    function test_RevertsAtMaxWalletCap() public {
        address[5] memory wallets = [
            address(0x2001), address(0x2002), address(0x2003), address(0x2004), address(0x2005)
        ];
        for (uint256 i = 0; i < 5; i++) {
            _registerWallet(wallets[i], hash1, verifierPk);
        }
        assertEq(registry.walletCount(hash1), 5);

        address sixth = address(0x2006);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(sixth, hash1, deadline, 0, verifierPk);

        vm.prank(sixth);
        vm.expectRevert(IdentityRegister.MaximumWalletCreated.selector);
        registry.registerWithAttestation(hash1, deadline, sig);
    }

    // --- restriction / ban propagation ---

    function test_BanPropagatesToAllWallets() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        assertTrue(registry.isVerified(walletA));
        assertTrue(registry.isVerified(walletB));

        registry.restrict(hash1);

        assertFalse(registry.isVerified(walletA));
        assertFalse(registry.isVerified(walletB));
    }

    function test_RestrictedIdentity_CannotRegisterNewWallets() public {
        _registerWallet(walletA, hash1, verifierPk);
        registry.restrict(hash1);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletC, hash1, deadline, 0, verifierPk);

        vm.prank(walletC);
        vm.expectRevert(IdentityRegister.IdentityIsRestricted.selector);
        registry.registerWithAttestation(hash1, deadline, sig);
    }

    function test_RestrictionSurvivesUnverify() public {
        _registerWallet(walletA, hash1, verifierPk);
        registry.restrict(hash1);
        registry.unverify(hash1);

        assertTrue(registry.restricted(hash1));

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletA, hash1, deadline, registry.nonces(walletA), verifierPk);
        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.IdentityIsRestricted.selector);
        registry.registerWithAttestation(hash1, deadline, sig);
    }

    function test_Unrestrict_AllowsRegistrationAgain() public {
        registry.restrict(hash1);
        registry.unrestrict(hash1);

        _registerWallet(walletA, hash1, verifierPk);
        assertTrue(registry.isVerified(walletA));
    }

    // --- unverify: hard purge ---

    function test_Unverify_RevertsIfNoWallets() public {
        vm.expectRevert(IdentityRegister.IdentityHasNoWallets.selector);
        registry.unverify(hash1);
    }

    function test_Unverify_PurgesAllWalletsAndIdentityRecord() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        registry.unverify(hash1);

        assertEq(registry.walletCount(hash1), 0);
        assertEq(registry.walletToIdentity(walletA), bytes32(0));
        assertEq(registry.walletToIdentity(walletB), bytes32(0));
        assertFalse(registry.isVerified(walletA));
        assertFalse(registry.isVerified(walletB));

        (bool verified,,,) = registry.getIdentity(hash1);
        assertFalse(verified);
    }

    function test_UnverifiedIdentity_FreshRegistrationBecomesNewRoot() public {
        _registerWallet(walletA, hash1, verifierPk);
        registry.unverify(hash1);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = registry.nonces(walletA);
        bytes memory sig = _sign(walletA, hash1, deadline, nonce, verifierPk);
        vm.prank(walletA);
        registry.registerWithAttestation(hash1, deadline, sig);

        assertEq(registry.walletCount(hash1), 1);
        (,, address root,) = registry.getIdentity(hash1);
        assertEq(root, walletA);
    }

    // --- removeWallet ---

    function test_RemoveWallet_CannotRemoveLastOne() public {
        _registerWallet(walletA, hash1, verifierPk);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.CannotRemoveLastWallet.selector);
        registry.removeWallet(hash1, walletA);
    }

    function test_RemoveWallet_Succeeds_NonRoot() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        vm.prank(walletA);
        registry.removeWallet(hash1, walletB);

        assertEq(registry.walletCount(hash1), 1);
        assertFalse(registry.isVerified(walletB));
    }

    function test_RemoveWallet_RevertsOnRootWallet_WhenOthersRemain() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.CannotDeleteRootWallet.selector);
        registry.removeWallet(hash1, walletA);
    }

    function test_RemoveWallet_RootAsLastWallet_HitsLastWalletErrorInstead() public {
        _registerWallet(walletA, hash1, verifierPk);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.CannotRemoveLastWallet.selector);
        registry.removeWallet(hash1, walletA);
    }

    function test_RemoveWallet_RevertsIfNotAuthorized() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        vm.prank(stranger);
        vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);
        registry.removeWallet(hash1, walletB);
    }

    function test_RemoveWallet_VerifierCanAlwaysAct() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        vm.prank(verifierAddr);
        registry.removeWallet(hash1, walletB);

        assertEq(registry.walletCount(hash1), 1);
    }

    // --- changeRootWallet ---

    function test_ChangeRootWallet_Succeeds() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        vm.prank(walletA);
        registry.changeRootWallet(hash1, walletB);

        (,, address root,) = registry.getIdentity(hash1);
        assertEq(root, walletB);
    }

    function test_ChangeRootWallet_RevertsIfNewRootNotLinked() public {
        _registerWallet(walletA, hash1, verifierPk);

        vm.prank(walletA);
        vm.expectRevert(IdentityRegister.WalletNotLinkedToIdentity.selector);
        registry.changeRootWallet(hash1, stranger);
    }

    function test_ChangeRootWallet_AllowsRemovingOldRootAfterward() public {
        _registerWallet(walletA, hash1, verifierPk);
        _registerWallet(walletB, hash1, verifierPk);

        vm.prank(walletA);
        registry.changeRootWallet(hash1, walletB);

        vm.prank(walletB);
        registry.removeWallet(hash1, walletA);

        assertEq(registry.walletCount(hash1), 1);
        assertFalse(registry.isVerified(walletA));
    }

    // --- unregistered wallets ---

    function test_UnregisteredWallet_IsNotVerified() public view {
        assertFalse(registry.isVerified(stranger));
    }

    function test_WalletCount_ZeroForNeverRegisteredHash() public view {
        assertEq(registry.walletCount(hash1), 0);
    }
}
