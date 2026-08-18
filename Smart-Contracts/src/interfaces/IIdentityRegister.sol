// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IIdentityRegister
 * @notice Interface for the IdentityRegister contract.
 */
interface IIdentityRegister {
    // --- Structs ---

    struct Identity {
        bool verified;
        address rootWallet;
        address[] wallets;
    }

    // --- Events ---

    event VerifierChanged(address indexed newVerifier);
    event WalletLinked(bytes32 indexed hash, address indexed wallet, bool isRoot);
    event WalletRemoved(bytes32 indexed hash, address indexed wallet);
    event Verified(bytes32 indexed hash);
    event Unverified(bytes32 indexed hash);
    event IdentityRestricted(bytes32 indexed hash, bool isRestricted);
    event RootWalletChanged(bytes32 indexed hash, address indexed newRootWallet);

    // --- Errors ---

    error NotVerifier();
    error NotAuthorizedIdentityOwner();
    error WalletAlreadyLinked();
    error WalletNotLinkedToIdentity();
    error MaximumWalletCreated();
    error CannotRemoveLastWallet();
    error CannotDeleteRootWallet();
    error IdentityIsRestricted();
    error IdentityNotVerified();
    error IdentityHasNoWallets();
    error AttestationExpired();
    error InvalidAttestationSigner();
    error InvalidVerifierAddress();
    error ZeroIdentityHash();
    error NotVerified();

    // --- State Variable Getters ---

    function verifier() external view returns (address);

    function coreAgreement() external view returns (address);

    function MAX_WALLET() external view returns (uint256);

    function walletToIdentity(address wallet) external view returns (bytes32);

    function restricted(bytes32 identityHash) external view returns (bool);

    function nonces(address wallet) external view returns (uint256);

    // --- External / State-Changing Functions ---

    function addVerifier(address _verifierAddress) external;

    function registerWithAttestation(
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function unverify(bytes32 identityHash) external;

    function restrict(bytes32 identityHash) external;

    function unrestrict(bytes32 identityHash) external;

    function removeWallet(bytes32 identityHash, address wallet) external;

    function changeRootWallet(bytes32 identityHash, address newRootWallet) external;

    // --- View Functions ---

    function getAttestationDigest(
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
            address[] memory walletList
        );

    function getIdentityHashByWallet(address wallet) external view returns (bytes32 identityHash);

    function getWallets(bytes32 identityHash) external view returns (address[] memory);

    function walletCount(bytes32 identityHash) external view returns (uint256);

    function isVerified(address wallet) external view returns (bool);
}