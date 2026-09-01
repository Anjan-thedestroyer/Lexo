// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IdentityRegister} from "../../src/core/IdentityRegister.sol";
import {ICoreAgreement} from "../../src/interfaces/ICoreAgreement.sol";

contract IdentityRegisterTest is Test {
    IdentityRegister public identityRegister;

    // ============================================================
    // TEST ACCOUNTS
    // ============================================================

    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant VERIFIER_PK = 0xB0B;
    uint256 internal constant USER_PK = 0xCAFE;
    uint256 internal constant WALLET2_PK = 0xCAFE2;
    uint256 internal constant WALLET3_PK = 0xCAFE3;
    uint256 internal constant WALLET4_PK = 0xCAFE4;
    uint256 internal constant WALLET5_PK = 0xCAFE5;
    uint256 internal constant ATTACKER_PK = 0xBAD;

    address internal owner;
    address internal verifier;
    address internal user;
    address internal wallet2;
    address internal wallet3;
    address internal wallet4;
    address internal wallet5;
    address internal attacker;

    // Dummy CoreAgreement address.
    address internal coreAgreement;

    // ============================================================
    // CONSTANTS
    // ============================================================

    bytes32 internal constant REGISTER_IDENTITY_TYPEHASH =
        keccak256(
            "RegisterIdentity(address wallet,bytes32 identityHash,uint256 nonce,uint256 deadline)"
        );

    bytes32 internal constant LINK_WALLET_TYPEHASH =
        keccak256(
            "LinkWallet(address wallet,bytes32 identityHash,uint256 nonce,uint256 deadline)"
        );

    // ============================================================
    // SETUP
    // ============================================================

    function setUp() public {
        owner = vm.addr(OWNER_PK);
        verifier = vm.addr(VERIFIER_PK);
        user = vm.addr(USER_PK);
        wallet2 = vm.addr(WALLET2_PK);
        wallet3 = vm.addr(WALLET3_PK);
        wallet4 = vm.addr(WALLET4_PK);
        wallet5 = vm.addr(WALLET5_PK);
        attacker = vm.addr(ATTACKER_PK);

        coreAgreement = makeAddr("CoreAgreement");

        vm.startPrank(owner);

        identityRegister = new IdentityRegister(ICoreAgreement(coreAgreement));

        identityRegister.setVerifier(verifier);

        vm.stopPrank();
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function _identityHash(
        string memory value
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(value));
    }

    function _allowSignedAgreement(address wallet) internal {
        vm.mockCall(
            coreAgreement,
            abi.encodeWithSelector(
                ICoreAgreement.hasSignedAgreement.selector,
                wallet
            ),
            abi.encode(true)
        );
    }

    function _denySignedAgreement(address wallet) internal {
        vm.mockCall(
            coreAgreement,
            abi.encodeWithSelector(
                ICoreAgreement.hasSignedAgreement.selector,
                wallet
            ),
            abi.encode(false)
        );
    }

    function _registerDigest(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    ) internal view returns (bytes32) {
        return
            identityRegister.getRegisterIdentityDigest(
                wallet,
                identityHash,
                deadline,
                nonce
            );
    }

    function _linkDigest(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    ) internal view returns (bytes32) {
        return
            identityRegister.getLinkWalletDigest(
                wallet,
                identityHash,
                deadline,
                nonce
            );
    }

    function _sign(
        uint256 privateKey,
        bytes32 digest
    ) internal returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);

        signature = abi.encodePacked(r, s, v);
    }

    function _signRegistration(
        address wallet,
        bytes32 identityHash,
        uint256 deadline
    ) internal returns (bytes memory signature) {
        uint256 nonce = identityRegister.nonces(wallet);

        bytes32 digest = _registerDigest(wallet, identityHash, deadline, nonce);

        return _sign(VERIFIER_PK, digest);
    }

    function _signWalletLink(
        address wallet,
        bytes32 identityHash,
        uint256 deadline
    ) internal returns (bytes memory signature) {
        uint256 nonce = identityRegister.nonces(wallet);

        bytes32 digest = _linkDigest(wallet, identityHash, deadline, nonce);

        return _sign(VERIFIER_PK, digest);
    }

    function _registerUser(bytes32 identityHash) internal {
        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.prank(user);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );
    }

    function _linkWallet(address wallet, bytes32 identityHash) internal {
        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signWalletLink(
            wallet,
            identityHash,
            deadline
        );

        vm.prank(wallet);

        identityRegister.linkWalletWithAttestation(
            wallet,
            identityHash,
            deadline,
            signature
        );
    }

    // ============================================================
    // CONSTRUCTOR / INITIAL STATE
    // ============================================================

    function test_ConstructorSetsCoreAgreement() public {
        assertEq(address(identityRegister.coreAgreement()), coreAgreement);
    }

    function test_ConstructorSetsOwner() public {
        assertEq(identityRegister.owner(), owner);
    }

    function test_InitialVerifierIsZeroBeforeSet() public {
        vm.prank(owner);

        IdentityRegister fresh = new IdentityRegister(
            ICoreAgreement(coreAgreement)
        );

        assertEq(fresh.verifier(), address(0));
    }

    function test_MaxWalletsIsFive() public {
        assertEq(identityRegister.MAX_WALLETS(), 5);
    }

    // ============================================================
    // VERIFIER ADMIN
    // ============================================================

    function test_SetVerifier() public {
        address newVerifier = makeAddr("NewVerifier");

        vm.expectEmit(true, false, false, true);
        emit IdentityRegister.VerifierChanged(newVerifier);

        vm.prank(owner);
        identityRegister.setVerifier(newVerifier);

        assertEq(identityRegister.verifier(), newVerifier);
    }

    function test_SetVerifierRevertsForNonOwner() public {
        address newVerifier = makeAddr("NewVerifier");

        vm.prank(attacker);

        vm.expectRevert(
            abi.encodeWithSignature(
                "OwnableUnauthorizedAccount(address)",
                attacker
            )
        );

        identityRegister.setVerifier(newVerifier);
    }

    function test_SetVerifierRevertsForZeroAddress() public {
        vm.prank(owner);

        vm.expectRevert(IdentityRegister.InvalidVerifierAddress.selector);

        identityRegister.setVerifier(address(0));
    }

    // ============================================================
    // DIGEST HELPERS
    // ============================================================

    function test_RegisterDigestMatchesExpectedStructure() public {
        bytes32 identityHash = _identityHash("identity-1");
        uint256 deadline = block.timestamp + 1 days;
        uint256 nonce = 0;

        bytes32 expectedStructHash = keccak256(
            abi.encode(
                REGISTER_IDENTITY_TYPEHASH,
                user,
                identityHash,
                nonce,
                deadline
            )
        );

        bytes32 expectedDigest = _hashTypedDataV4Local(expectedStructHash);

        bytes32 contractDigest = identityRegister.getRegisterIdentityDigest(
            user,
            identityHash,
            deadline,
            nonce
        );

        assertEq(contractDigest, expectedDigest);
    }

    function test_LinkDigestMatchesExpectedStructure() public {
        bytes32 identityHash = _identityHash("identity-1");
        uint256 deadline = block.timestamp + 1 days;
        uint256 nonce = 0;

        bytes32 expectedStructHash = keccak256(
            abi.encode(
                LINK_WALLET_TYPEHASH,
                wallet2,
                identityHash,
                nonce,
                deadline
            )
        );

        bytes32 expectedDigest = _hashTypedDataV4Local(expectedStructHash);

        bytes32 contractDigest = identityRegister.getLinkWalletDigest(
            wallet2,
            identityHash,
            deadline,
            nonce
        );

        assertEq(contractDigest, expectedDigest);
    }

    function _hashTypedDataV4Local(
        bytes32 structHash
    ) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Lexo IdentityRegister")),
                keccak256(bytes("1")),
                block.chainid,
                address(identityRegister)
            )
        );

        return
            keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, structHash)
            );
    }

    // ============================================================
    // REGISTER IDENTITY - SUCCESS
    // ============================================================

    function test_RegisterIdentitySuccessfully() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.expectEmit(true, true, false, true);
        emit IdentityRegister.IdentityRegistered(identityHash, user);

        vm.expectEmit(true, true, false, true);
        emit IdentityRegister.WalletLinked(identityHash, user, true);

        vm.prank(user);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );

        (
            bool verified,
            bool restricted,
            address root,
            address[] memory wallets,
            IdentityRegister.VerificationStatus status
        ) = identityRegister.getIdentity(identityHash);

        assertTrue(verified);
        assertFalse(restricted);
        assertEq(root, user);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], user);
        assertEq(
            uint256(status),
            uint256(IdentityRegister.VerificationStatus.Approved)
        );

        assertEq(identityRegister.walletToIdentity(user), identityHash);

        assertTrue(identityRegister.isVerified(user));
    }

    function test_RegisterIdentityIncrementsNonce() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        assertEq(identityRegister.nonces(user), 1);
    }

    // ============================================================
    // REGISTER IDENTITY - AUTHORIZATION
    // ============================================================

    function test_RegisterRevertsWithoutSignedAgreement() public {
        bytes32 identityHash = _identityHash("identity-1");

        _denySignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.prank(user);

        vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );
    }

    function test_RegisterRevertsWhenCallerIsNotWallet() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(attacker);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.prank(attacker);

        vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );
    }

    // ============================================================
    // REGISTER IDENTITY - VALIDATION
    // ============================================================

    function test_RegisterRevertsWithZeroIdentityHash() public {
        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(user, bytes32(0), deadline);

        vm.prank(user);

        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            bytes32(0),
            deadline,
            signature
        );
    }

    function test_RegisterRevertsWithZeroWallet() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(address(0));

        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = _registerDigest(address(0), identityHash, deadline, 0);

        bytes memory signature = _sign(VERIFIER_PK, digest);

        vm.prank(address(0));

        vm.expectRevert(IdentityRegister.InvalidWalletAddress.selector);

        identityRegister.registerIdentityWithAttestation(
            address(0),
            identityHash,
            deadline,
            signature
        );
    }

    function test_RegisterRevertsWhenExpired() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp - 1;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.prank(user);

        vm.expectRevert(IdentityRegister.AttestationExpired.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );
    }

    function test_RegisterRevertsWithInvalidSignature() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = _registerDigest(user, identityHash, deadline, 0);

        // Attacker signs instead of verifier.
        bytes memory maliciousSignature = _sign(ATTACKER_PK, digest);

        vm.prank(user);

        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            maliciousSignature
        );
    }

    function test_RegisterRevertsIfSignatureForDifferentWallet() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            wallet2,
            identityHash,
            deadline
        );

        vm.prank(user);

        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );
    }

    function test_RegisterRevertsIfSignatureForDifferentIdentity() public {
        bytes32 identityHash = _identityHash("identity-1");
        bytes32 differentHash = _identityHash("identity-2");

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            user,
            differentHash,
            deadline
        );

        vm.prank(user);

        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );
    }

    function test_RegisterRevertsIfSignatureDeadlineIsDifferent() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(user);

        uint256 signedDeadline = block.timestamp + 1 days;
        uint256 submittedDeadline = block.timestamp + 2 days;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            signedDeadline
        );

        vm.prank(user);

        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            submittedDeadline,
            signature
        );
    }

    // ============================================================
    // REGISTER IDENTITY - REPLAY
    // ============================================================

    function test_RegisterSignatureCannotBeReplayed() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.prank(user);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );

        // First registration increments nonce.
        assertEq(identityRegister.nonces(user), 1);

        // Signature was created with nonce 0.
        // Reusing it therefore cannot pass signature verification.
        bytes32 secondIdentityHash = _identityHash("identity-2");

        vm.prank(user);

        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            secondIdentityHash,
            deadline,
            signature
        );
    }

    function test_RegisterRevertsIfIdentityAlreadyExists() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        // A fresh valid signature for the same identity.
        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            attacker,
            identityHash,
            deadline
        );

        _allowSignedAgreement(attacker);

        // Because the identity already exists, it should fail
        // before signature verification.
        vm.prank(attacker);

        vm.expectRevert(IdentityRegister.IdentityAlreadyExists.selector);

        identityRegister.registerIdentityWithAttestation(
            attacker,
            identityHash,
            deadline,
            signature
        );
    }

    function test_RegisterRevertsIfWalletAlreadyLinked() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        // The wallet already maps to an identity.
        bytes32 secondIdentityHash = _identityHash("identity-2");

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            user,
            secondIdentityHash,
            deadline
        );

        vm.prank(user);

        vm.expectRevert(IdentityRegister.WalletAlreadyLinked.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            secondIdentityHash,
            deadline,
            signature
        );
    }

    // ============================================================
    // RESTRICT / UNRESTRICT
    // ============================================================

    function test_VerifierCanRestrictIdentity() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.expectEmit(true, false, false, true);
        emit IdentityRegister.IdentityRestricted(identityHash, true);

        vm.prank(verifier);

        identityRegister.restrict(identityHash);

        assertTrue(identityRegister.restricted(identityHash));

        assertFalse(identityRegister.isVerified(user));
    }

    function test_VerifierCanUnrestrictIdentity() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(verifier);
        identityRegister.restrict(identityHash);

        assertFalse(identityRegister.isVerified(user));

        vm.expectEmit(true, false, false, true);
        emit IdentityRegister.IdentityRestricted(identityHash, false);

        vm.prank(verifier);
        identityRegister.unrestrict(identityHash);

        assertFalse(identityRegister.restricted(identityHash));

        assertTrue(identityRegister.isVerified(user));
    }

    function test_RestrictRevertsForNonVerifier() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(attacker);

        vm.expectRevert(IdentityRegister.NotVerifier.selector);

        identityRegister.restrict(identityHash);
    }

    function test_UnrestrictRevertsForNonVerifier() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(attacker);

        vm.expectRevert(IdentityRegister.NotVerifier.selector);

        identityRegister.unrestrict(identityHash);
    }

    function test_RestrictRevertsForZeroIdentityHash() public {
        vm.prank(verifier);

        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);

        identityRegister.restrict(bytes32(0));
    }

    function test_UnrestrictRevertsForZeroIdentityHash() public {
        vm.prank(verifier);

        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);

        identityRegister.unrestrict(bytes32(0));
    }

    function test_RestrictedIdentityCannotRegister() public {
        bytes32 identityHash = _identityHash("identity-1");

        vm.prank(verifier);
        identityRegister.restrict(identityHash);

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.prank(user);

        vm.expectRevert(IdentityRegister.IdentityIsRestricted.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );
    }

    // ============================================================
    // WALLET LINKING
    // ============================================================

    function test_LinkWalletSuccessfully() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signWalletLink(
            wallet2,
            identityHash,
            deadline
        );

        vm.expectEmit(true, true, false, true);
        emit IdentityRegister.WalletLinked(identityHash, wallet2, false);

        vm.prank(wallet2);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            identityHash,
            deadline,
            signature
        );

        assertEq(identityRegister.walletToIdentity(wallet2), identityHash);

        assertEq(identityRegister.nonces(wallet2), 1);

        address[] memory wallets = identityRegister.getWallets(identityHash);

        assertEq(wallets.length, 2);
        assertEq(wallets[0], user);
        assertEq(wallets[1], wallet2);
    }

    function test_LinkWalletRevertsIfNotVerified() public {
        bytes32 identityHash = _identityHash("not-registered");

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signWalletLink(
            wallet2,
            identityHash,
            deadline
        );

        vm.prank(wallet2);

        vm.expectRevert(IdentityRegister.IdentityNotVerified.selector);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            identityHash,
            deadline,
            signature
        );
    }

    function test_LinkWalletRevertsIfRestricted() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(verifier);
        identityRegister.restrict(identityHash);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signWalletLink(
            wallet2,
            identityHash,
            deadline
        );

        vm.prank(wallet2);

        vm.expectRevert(IdentityRegister.IdentityIsRestricted.selector);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            identityHash,
            deadline,
            signature
        );
    }

    function test_LinkWalletRevertsIfExpired() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        uint256 deadline = block.timestamp - 1;

        bytes memory signature = _signWalletLink(
            wallet2,
            identityHash,
            deadline
        );

        vm.prank(wallet2);

        vm.expectRevert(IdentityRegister.AttestationExpired.selector);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            identityHash,
            deadline,
            signature
        );
    }

    function test_LinkWalletRevertsWithInvalidSignature() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        uint256 deadline = block.timestamp + 1 days;

        uint256 nonce = identityRegister.nonces(wallet2);

        bytes32 digest = _linkDigest(wallet2, identityHash, deadline, nonce);

        bytes memory signature = _sign(ATTACKER_PK, digest);

        vm.prank(wallet2);

        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            identityHash,
            deadline,
            signature
        );
    }

    function test_LinkWalletRevertsIfCallerIsNotWallet() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signWalletLink(
            wallet2,
            identityHash,
            deadline
        );

        vm.prank(attacker);

        vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            identityHash,
            deadline,
            signature
        );
    }

    function test_LinkWalletRevertsForZeroWallet() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = _linkDigest(address(0), identityHash, deadline, 0);

        bytes memory signature = _sign(VERIFIER_PK, digest);

        vm.prank(address(0));

        vm.expectRevert(IdentityRegister.InvalidWalletAddress.selector);

        identityRegister.linkWalletWithAttestation(
            address(0),
            identityHash,
            deadline,
            signature
        );
    }

    function test_LinkWalletRevertsForZeroIdentityHash() public {
        _registerUser(_identityHash("identity-1"));

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signWalletLink(wallet2, bytes32(0), deadline);

        vm.prank(wallet2);

        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            bytes32(0),
            deadline,
            signature
        );
    }

    function test_LinkWalletRevertsIfAlreadyLinked() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        _linkWallet(wallet2, identityHash);

        bytes32 secondIdentity = _identityHash("identity-2");

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signWalletLink(
            wallet2,
            secondIdentity,
            deadline
        );

        vm.prank(wallet2);

        vm.expectRevert(IdentityRegister.WalletAlreadyLinked.selector);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            secondIdentity,
            deadline,
            signature
        );
    }

    function test_LinkWalletSignatureCannotBeReplayed() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signWalletLink(
            wallet2,
            identityHash,
            deadline
        );

        vm.prank(wallet2);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            identityHash,
            deadline,
            signature
        );

        assertEq(identityRegister.nonces(wallet2), 1);

        // Wallet is already linked, but more importantly the signature
        // was signed with nonce 0 while the contract now expects nonce 1.
        //
        // Create another identity and try to reuse the old signature.
        bytes32 anotherIdentity = _identityHash("identity-2");

        vm.prank(wallet2);

        vm.expectRevert(IdentityRegister.WalletAlreadyLinked.selector);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            anotherIdentity,
            deadline,
            signature
        );
    }

    // ============================================================
    // MAXIMUM WALLET LIMIT
    // ============================================================

    function test_MaximumFiveWallets() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        _linkWallet(wallet2, identityHash);
        _linkWallet(wallet3, identityHash);
        _linkWallet(wallet4, identityHash);
        _linkWallet(wallet5, identityHash);

        address[] memory wallets = identityRegister.getWallets(identityHash);

        assertEq(wallets.length, 5);
    }

    function test_SixthWalletReverts() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        _linkWallet(wallet2, identityHash);
        _linkWallet(wallet3, identityHash);
        _linkWallet(wallet4, identityHash);
        _linkWallet(wallet5, identityHash);

        address wallet6 = makeAddr("Wallet6");

        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = _linkDigest(
            wallet6,
            identityHash,
            deadline,
            identityRegister.nonces(wallet6)
        );

        bytes memory signature = _sign(VERIFIER_PK, digest);

        vm.prank(wallet6);

        vm.expectRevert(IdentityRegister.MaximumWalletsReached.selector);

        identityRegister.linkWalletWithAttestation(
            wallet6,
            identityHash,
            deadline,
            signature
        );
    }

    // ============================================================
    // UNVERIFY
    // ============================================================

    function test_VerifierCanUnverify() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);
        _linkWallet(wallet2, identityHash);

        vm.expectEmit(true, false, false, true);
        emit IdentityRegister.Unverified(identityHash);

        vm.prank(verifier);

        identityRegister.unverify(identityHash);

        (
            bool verified,
            bool restricted,
            address root,
            address[] memory wallets,
            IdentityRegister.VerificationStatus status
        ) = identityRegister.getIdentity(identityHash);

        assertFalse(verified);
        assertFalse(restricted);
        assertEq(root, address(0));
        assertEq(wallets.length, 0);
        assertEq(
            uint256(status),
            uint256(IdentityRegister.VerificationStatus.None)
        );

        assertEq(identityRegister.walletToIdentity(user), bytes32(0));

        assertEq(identityRegister.walletToIdentity(wallet2), bytes32(0));

        assertFalse(identityRegister.isVerified(user));
        assertFalse(identityRegister.isVerified(wallet2));
    }

    function test_UnverifyRevertsForNonVerifier() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(attacker);

        vm.expectRevert(IdentityRegister.NotVerifier.selector);

        identityRegister.unverify(identityHash);
    }

    function test_UnverifyRevertsForZeroHash() public {
        vm.prank(verifier);

        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);

        identityRegister.unverify(bytes32(0));
    }

    function test_UnverifyRevertsForIdentityWithNoWallets() public {
        bytes32 identityHash = _identityHash("empty");

        vm.prank(verifier);

        vm.expectRevert(IdentityRegister.IdentityHasNoWallets.selector);

        identityRegister.unverify(identityHash);
    }

    function test_CanRegisterAgainAfterUnverify() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(verifier);
        identityRegister.unverify(identityHash);

        // walletToIdentity was deleted by unverify.
        assertEq(identityRegister.walletToIdentity(user), bytes32(0));

        // Re-register.
        bytes32 newIdentityHash = _identityHash("identity-2");

        _registerUser(newIdentityHash);

        assertEq(identityRegister.walletToIdentity(user), newIdentityHash);

        assertTrue(identityRegister.isVerified(user));
    }

    // ============================================================
    // REMOVE WALLET
    // ============================================================

    function test_VerifierCanRemoveNonRootWallet() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);
        _linkWallet(wallet2, identityHash);

        vm.expectEmit(true, true, false, true);
        emit IdentityRegister.WalletRemoved(identityHash, wallet2);

        vm.prank(verifier);

        identityRegister.removeWallet(identityHash, wallet2);

        assertEq(identityRegister.walletToIdentity(wallet2), bytes32(0));

        address[] memory wallets = identityRegister.getWallets(identityHash);

        assertEq(wallets.length, 1);
        assertEq(wallets[0], user);
    }

    function test_RemoveWalletRevertsForNonVerifier() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);
        _linkWallet(wallet2, identityHash);

        vm.prank(attacker);

        vm.expectRevert(IdentityRegister.NotVerifier.selector);

        identityRegister.removeWallet(identityHash, wallet2);
    }

    function test_RemoveWalletRevertsForZeroHash() public {
        vm.prank(verifier);

        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);

        identityRegister.removeWallet(bytes32(0), wallet2);
    }

    function test_RemoveWalletRevertsIfWalletNotLinked() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(verifier);

        vm.expectRevert(IdentityRegister.WalletNotLinkedToIdentity.selector);

        identityRegister.removeWallet(identityHash, wallet2);
    }

    function test_RemoveWalletRevertsIfOnlyWallet() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(verifier);

        vm.expectRevert(IdentityRegister.CannotRemoveLastWallet.selector);

        identityRegister.removeWallet(identityHash, user);
    }

    function test_RemoveRootWalletRevertsWhenMultipleWalletsExist() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);
        _linkWallet(wallet2, identityHash);

        vm.prank(verifier);

        vm.expectRevert(IdentityRegister.CannotDeleteRootWallet.selector);

        identityRegister.removeWallet(identityHash, user);
    }

    function test_RemoveWalletUsesSwapAndPop() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);
        _linkWallet(wallet2, identityHash);
        _linkWallet(wallet3, identityHash);

        vm.prank(verifier);

        identityRegister.removeWallet(identityHash, wallet2);

        address[] memory wallets = identityRegister.getWallets(identityHash);

        assertEq(wallets.length, 2);

        // swap-and-pop means wallet3 replaces wallet2.
        assertEq(wallets[0], user);
        assertEq(wallets[1], wallet3);

        assertEq(identityRegister.walletToIdentity(wallet2), bytes32(0));

        assertEq(identityRegister.walletToIdentity(wallet3), identityHash);
    }

    // ============================================================
    // ROOT WALLET
    // ============================================================

    function test_RootWalletCanBeChanged() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);
        _linkWallet(wallet2, identityHash);

        vm.expectEmit(true, true, false, true);
        emit IdentityRegister.RootWalletChanged(identityHash, wallet2);

        vm.prank(user);

        identityRegister.changeRootWallet(identityHash, wallet2);

        (, , address root, , ) = identityRegister.getIdentity(identityHash);

        assertEq(root, wallet2);
    }

    function test_ChangeRootWalletRevertsForNonRoot() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);
        _linkWallet(wallet2, identityHash);

        vm.prank(wallet2);

        vm.expectRevert(IdentityRegister.NotAuthorizedIdentityOwner.selector);

        identityRegister.changeRootWallet(identityHash, wallet2);
    }

    function test_ChangeRootWalletRevertsIfIdentityNotVerified() public {
        bytes32 identityHash = _identityHash("identity-1");

        vm.prank(user);

        vm.expectRevert(IdentityRegister.IdentityNotVerified.selector);

        identityRegister.changeRootWallet(identityHash, user);
    }

    function test_ChangeRootWalletRevertsForZeroHash() public {
        vm.prank(user);

        vm.expectRevert(IdentityRegister.ZeroIdentityHash.selector);

        identityRegister.changeRootWallet(bytes32(0), wallet2);
    }

    function test_ChangeRootWalletRevertsForZeroAddress() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(user);

        vm.expectRevert(IdentityRegister.InvalidWalletAddress.selector);

        identityRegister.changeRootWallet(identityHash, address(0));
    }

    function test_ChangeRootWalletRevertsIfWalletNotBelongingToIdentity()
        public
    {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.prank(user);

        vm.expectRevert(IdentityRegister.WalletNotLinkedToIdentity.selector);

        identityRegister.changeRootWallet(identityHash, wallet2);
    }

    function test_NewRootMustAlreadyBeLinked() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        _linkWallet(wallet2, identityHash);

        vm.prank(user);

        identityRegister.changeRootWallet(identityHash, wallet2);

        (, , address root, , ) = identityRegister.getIdentity(identityHash);

        assertEq(root, wallet2);

        // Old root is still a member of the identity.
        assertEq(identityRegister.walletToIdentity(user), identityHash);
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    function test_GetIdentityHashByWallet() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        assertEq(identityRegister.getIdentityHashByWallet(user), identityHash);
    }

    function test_GetIdentityHashByUnknownWalletReturnsZero() public {
        assertEq(
            identityRegister.getIdentityHashByWallet(attacker),
            bytes32(0)
        );
    }

    function test_GetWalletsReturnsEmptyForUnknownIdentity() public {
        address[] memory wallets = identityRegister.getWallets(
            _identityHash("unknown")
        );

        assertEq(wallets.length, 0);
    }

    function test_IsVerifiedReturnsFalseForUnknownWallet() public {
        assertFalse(identityRegister.isVerified(attacker));
    }

    function test_IsVerifiedReturnsFalseWhenRestricted() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        assertTrue(identityRegister.isVerified(user));

        vm.prank(verifier);
        identityRegister.restrict(identityHash);

        assertFalse(identityRegister.isVerified(user));
    }

    function test_IsVerifiedReturnsTrueAfterUnrestrict() public {
        bytes32 identityHash = _identityHash("identity-1");

        _registerUser(identityHash);

        vm.startPrank(verifier);

        identityRegister.restrict(identityHash);
        identityRegister.unrestrict(identityHash);

        vm.stopPrank();

        assertTrue(identityRegister.isVerified(user));
    }

    // ============================================================
    // MULTIPLE IDENTITIES / WALLETS
    // ============================================================

    function test_DifferentWalletsCanHaveDifferentIdentities() public {
        bytes32 identity1 = _identityHash("identity-1");
        bytes32 identity2 = _identityHash("identity-2");

        _registerUser(identity1);

        _allowSignedAgreement(wallet2);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            wallet2,
            identity2,
            deadline
        );

        vm.prank(wallet2);

        identityRegister.registerIdentityWithAttestation(
            wallet2,
            identity2,
            deadline,
            signature
        );

        assertEq(identityRegister.walletToIdentity(user), identity1);

        assertEq(identityRegister.walletToIdentity(wallet2), identity2);

        assertTrue(identityRegister.isVerified(user));

        assertTrue(identityRegister.isVerified(wallet2));
    }

    // ============================================================
    // DEADLINE BOUNDARY
    // ============================================================

    function test_RegistrationSucceedsExactlyAtDeadline() public {
        bytes32 identityHash = _identityHash("identity-boundary");

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.prank(user);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );

        assertTrue(identityRegister.isVerified(user));
    }

    function test_LinkSucceedsExactlyAtDeadline() public {
        bytes32 identityHash = _identityHash("identity-boundary");

        _registerUser(identityHash);

        uint256 deadline = block.timestamp;

        bytes memory signature = _signWalletLink(
            wallet2,
            identityHash,
            deadline
        );

        vm.prank(wallet2);

        identityRegister.linkWalletWithAttestation(
            wallet2,
            identityHash,
            deadline,
            signature
        );

        assertEq(identityRegister.walletToIdentity(wallet2), identityHash);
    }

    // ============================================================
    // NONCE IS PER WALLET
    // ============================================================

    function test_NonceIsIndependentPerWallet() public {
        bytes32 identity1 = _identityHash("identity-1");
        bytes32 identity2 = _identityHash("identity-2");

        _registerUser(identity1);

        _allowSignedAgreement(wallet2);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory signature = _signRegistration(
            wallet2,
            identity2,
            deadline
        );

        vm.prank(wallet2);

        identityRegister.registerIdentityWithAttestation(
            wallet2,
            identity2,
            deadline,
            signature
        );

        assertEq(identityRegister.nonces(user), 1);
        assertEq(identityRegister.nonces(wallet2), 1);
    }

    // ============================================================
    // VERIFIER KEY ROTATION
    // ============================================================

    function test_OldVerifierSignatureFailsAfterVerifierChange() public {
        bytes32 identityHash = _identityHash("identity-1");

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + 1 days;

        bytes memory oldSignature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        address newVerifier = makeAddr("NewVerifier");

        vm.prank(owner);
        identityRegister.setVerifier(newVerifier);

        vm.prank(user);

        vm.expectRevert(IdentityRegister.InvalidAttestationSigner.selector);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            oldSignature
        );
    }

    // ============================================================
    // FUZZ TESTS
    // ============================================================

    function testFuzz_RegistrationNonceIncrements(uint256 futureTime) public {
        futureTime = bound(futureTime, 1, 365 days);

        bytes32 identityHash = keccak256(
            abi.encodePacked("identity", futureTime)
        );

        _allowSignedAgreement(user);

        uint256 deadline = block.timestamp + futureTime;

        bytes memory signature = _signRegistration(
            user,
            identityHash,
            deadline
        );

        vm.prank(user);

        identityRegister.registerIdentityWithAttestation(
            user,
            identityHash,
            deadline,
            signature
        );

        assertEq(identityRegister.nonces(user), 1);
    }

    function testFuzz_DigestChangesWithNonce(
        uint256 nonce1,
        uint256 nonce2
    ) public view {
        vm.assume(nonce1 != nonce2);

        bytes32 identityHash = _identityHash("identity");

        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest1 = identityRegister.getRegisterIdentityDigest(
            user,
            identityHash,
            deadline,
            nonce1
        );

        bytes32 digest2 = identityRegister.getRegisterIdentityDigest(
            user,
            identityHash,
            deadline,
            nonce2
        );

        assertTrue(digest1 != digest2);
    }

    function testFuzz_DigestChangesWithDeadline(
        uint256 deadline1,
        uint256 deadline2
    ) public view {
        vm.assume(deadline1 != deadline2);

        bytes32 identityHash = _identityHash("identity");

        bytes32 digest1 = identityRegister.getRegisterIdentityDigest(
            user,
            identityHash,
            deadline1,
            0
        );

        bytes32 digest2 = identityRegister.getRegisterIdentityDigest(
            user,
            identityHash,
            deadline2,
            0
        );

        assertTrue(digest1 != digest2);
    }
}
