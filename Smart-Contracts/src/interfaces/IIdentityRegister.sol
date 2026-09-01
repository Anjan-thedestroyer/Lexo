// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IIdentityRegister {
    enum VerificationStatus {
        None,
        Approved
    }

    struct Identity {
        bool verified;
        address rootWallet;
        address[] wallets;
        VerificationStatus status;
    }

    // Events
    event VerifierChanged(address indexed newVerifier);
    event IdentityRegistered(bytes32 indexed identityHash, address indexed rootWallet);
    event WalletLinked(bytes32 indexed identityHash, address indexed wallet, bool isRoot);
    event WalletRemoved(bytes32 indexed identityHash, address indexed wallet);
    event Unverified(bytes32 indexed identityHash);
    event IdentityRestricted(bytes32 indexed identityHash, bool isRestricted);
    event RootWalletChanged(bytes32 indexed identityHash, address indexed newRootWallet);

    // Admin & Core Functions
    function setVerifier(address _verifierAddress) external;
    
    function registerIdentityWithAttestation(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function linkWalletWithAttestation(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function unverify(bytes32 identityHash) external;
    function restrict(bytes32 identityHash) external;
    function unrestrict(bytes32 identityHash) external;
    function removeWallet(bytes32 identityHash, address wallet) external;
    function changeRootWallet(bytes32 identityHash, address newRootWallet) external;

    // View Functions
    function verifier() external view returns (address);
    function coreAgreement() external view returns (address);
    function MAX_WALLETS() external view returns (uint256);
    function walletToIdentity(address wallet) external view returns (bytes32);
    function restricted(bytes32 identityHash) external view returns (bool);
    function nonces(address wallet) external view returns (uint256);

    function getRegisterIdentityDigest(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    ) external view returns (bytes32);

    function getLinkWalletDigest(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    ) external view returns (bytes32);

    function getIdentity(bytes32 identityHash)
        external
        view
        returns (
            bool isVerifiedStatus,
            bool isRestrictedStatus,
            address root,
            address[] memory walletList,
            VerificationStatus status
        );

    function getIdentityHashByWallet(address wallet) external view returns (bytes32);
    function getWallets(bytes32 identityHash) external view returns (address[] memory);
    function isVerified(address wallet) external view returns (bool);
}