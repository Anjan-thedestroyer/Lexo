// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IIdentityRegister} from "../../src/interfaces/IIdentityRegister.sol";

contract MockIdentityRegister is IIdentityRegister {
    address public override verifier;
    address public override coreAgreement;

    mapping(address => bytes32) private _walletToIdentity;
    mapping(bytes32 => bool) private _restricted;
    mapping(address => uint256) private _nonces;

    struct MockIdentityData {
        bool verified;
        address root;
        address[] wallets;
        IIdentityRegister.VerificationStatus status;
    }

    mapping(bytes32 => MockIdentityData) private _identities;

    // --- Mock Helpers for Unit Tests ---

    function mockSetVerified(address wallet, bytes32 identityHash, bool status) external {
        _walletToIdentity[wallet] = identityHash;
        MockIdentityData storage id = _identities[identityHash];
        id.verified = status;
        id.status = status ? IIdentityRegister.VerificationStatus.Approved : IIdentityRegister.VerificationStatus.None;
        if (id.root == address(0)) {
            id.root = wallet;
            id.wallets.push(wallet);
        }
    }

    function mockSetRestricted(bytes32 identityHash, bool isRestricted) external {
        _restricted[identityHash] = isRestricted;
    }

    // --- State View Overrides ---

    function walletToIdentity(address wallet) external view override returns (bytes32) {
        return _walletToIdentity[wallet];
    }

    function restricted(bytes32 identityHash) external view override returns (bool) {
        return _restricted[identityHash];
    }

    function nonces(address wallet) external view override returns (uint256) {
        return _nonces[wallet];
    }

    function MAX_WALLETS() external pure override returns (uint256) {
        return 5;
    }

    // --- State Mutating Functions ---

    function setVerifier(address _verifierAddress) external override {
        verifier = _verifierAddress;
        emit VerifierChanged(_verifierAddress);
    }

    function registerIdentityWithAttestation(
        address wallet,
        bytes32 identityHash,
        uint256,
        bytes calldata
    ) external override {
        _walletToIdentity[wallet] = identityHash;
        MockIdentityData storage id = _identities[identityHash];
        id.verified = true;
        id.status = IIdentityRegister.VerificationStatus.Approved;
        id.root = wallet;
        id.wallets.push(wallet);
        _nonces[wallet]++;

        emit IdentityRegistered(identityHash, wallet);
        emit WalletLinked(identityHash, wallet, true);
    }

    function linkWalletWithAttestation(
        address wallet,
        bytes32 identityHash,
        uint256,
        bytes calldata
    ) external override {
        _walletToIdentity[wallet] = identityHash;
        _identities[identityHash].wallets.push(wallet);
        _nonces[wallet]++;

        emit WalletLinked(identityHash, wallet, false);
    }

    function unverify(bytes32 identityHash) external override {
        delete _identities[identityHash];
        delete _restricted[identityHash];
        emit Unverified(identityHash);
    }

    function restrict(bytes32 identityHash) external override {
        _restricted[identityHash] = true;
        emit IdentityRestricted(identityHash, true);
    }

    function unrestrict(bytes32 identityHash) external override {
        _restricted[identityHash] = false;
        emit IdentityRestricted(identityHash, false);
    }

    function removeWallet(bytes32 identityHash, address wallet) external override {
        delete _walletToIdentity[wallet];
        emit WalletRemoved(identityHash, wallet);
    }

    function changeRootWallet(bytes32 identityHash, address newRootWallet) external override {
        _identities[identityHash].root = newRootWallet;
        emit RootWalletChanged(identityHash, newRootWallet);
    }

    // --- Digest Generators ---

    function getRegisterIdentityDigest(
        address,
        bytes32,
        uint256,
        uint256
    ) external pure override returns (bytes32) {
        return keccak256("MOCK_REGISTER_DIGEST");
    }

    function getLinkWalletDigest(
        address,
        bytes32,
        uint256,
        uint256
    ) external pure override returns (bytes32) {
        return keccak256("MOCK_LINK_DIGEST");
    }

    // --- Complex Getters ---

    function getIdentity(bytes32 identityHash)
        external
        view
        override
        returns (
            bool isVerifiedStatus,
            bool isRestrictedStatus,
            address root,
            address[] memory walletList,
            IIdentityRegister.VerificationStatus status
        )
    {
        MockIdentityData storage id = _identities[identityHash];
        return (
            id.verified,
            _restricted[identityHash],
            id.root,
            id.wallets,
            id.status
        );
    }

    function getIdentityHashByWallet(address wallet) external view override returns (bytes32) {
        return _walletToIdentity[wallet];
    }

    function getWallets(bytes32 identityHash) external view override returns (address[] memory) {
        return _identities[identityHash].wallets;
    }

    function isVerified(address wallet) external view override returns (bool) {
        bytes32 idHash = _walletToIdentity[wallet];
        if (idHash == bytes32(0)) return false;
        MockIdentityData storage id = _identities[idHash];
        return id.verified && id.status == IIdentityRegister.VerificationStatus.Approved && !_restricted[idHash];
    }
}