// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ICoreAgreement} from "../interfaces/ICoreAgreement.sol";

/**
 * @title IdentityRegister
 * @author Abinash Paudel
 * @notice Privacy-focused identity registry powered by off-chain Verifier EIP-712 attestations.
 *
 * ARCHITECTURE:
 *  1. User undergoes off-chain compliance/ID checks (Rarimo, MRZ, RegTech).
 *  2. Verifier approves off-chain and signs an EIP-712 payload.
 *  3. User or backend submits the signed payload to the contract.
 *  4. Contract validates the signature against `verifier` and executes immediately (1 step).
 */
contract IdentityRegister is Ownable, EIP712 {
    using ECDSA for bytes32;

    // ============================================================
    // ENUMS & STRUCTS
    // ============================================================

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

    // ============================================================
    // STATE
    // ============================================================

    /// @notice Address trusted to issue identity and wallet authorization signatures.
    address public verifier;

    ICoreAgreement public coreAgreement;

    /// @notice Maximum wallets allowed under one identity.
    uint256 public constant MAX_WALLETS = 5;

    /// @notice identityHash => identity record
    mapping(bytes32 => Identity) private identities;

    /// @notice wallet => identityHash
    mapping(address => bytes32) public walletToIdentity;

    /// @notice identityHash => restricted/banned status
    mapping(bytes32 => bool) public restricted;

    /// @notice wallet => next EIP-712 nonce (prevents replay attacks)
    mapping(address => uint256) public nonces;

    // ============================================================
    // EIP-712 TYPEHASHES
    // ============================================================

    bytes32 private constant REGISTER_IDENTITY_TYPEHASH =
        keccak256(
            "RegisterIdentity(address wallet,bytes32 identityHash,uint256 nonce,uint256 deadline)"
        );

    bytes32 private constant LINK_WALLET_TYPEHASH =
        keccak256(
            "LinkWallet(address wallet,bytes32 identityHash,uint256 nonce,uint256 deadline)"
        );

    // ============================================================
    // EVENTS
    // ============================================================

    event VerifierChanged(address indexed newVerifier);
    event IdentityRegistered(bytes32 indexed identityHash, address indexed rootWallet);
    event WalletLinked(bytes32 indexed identityHash, address indexed wallet, bool isRoot);
    event WalletRemoved(bytes32 indexed identityHash, address indexed wallet);
    event Unverified(bytes32 indexed identityHash);
    event IdentityRestricted(bytes32 indexed identityHash, bool isRestricted);
    event RootWalletChanged(bytes32 indexed identityHash, address indexed newRootWallet);

    // ============================================================
    // ERRORS
    // ============================================================

    error NotVerifier();
    error NotAuthorizedIdentityOwner();
    error WalletAlreadyLinked();
    error WalletNotLinkedToIdentity();
    error MaximumWalletsReached();
    error CannotRemoveLastWallet();
    error CannotDeleteRootWallet();
    error IdentityIsRestricted();
    error IdentityNotVerified();
    error IdentityHasNoWallets();
    error AttestationExpired();
    error InvalidAttestationSigner();
    error InvalidVerifierAddress();
    error ZeroIdentityHash();
    error IdentityAlreadyExists();
    error InvalidWalletAddress();

    // ============================================================
    // MODIFIERS
    // ============================================================

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    modifier onlySignedAgreement() {
        if (!coreAgreement.hasSignedAgreement(msg.sender)) {
            revert NotAuthorizedIdentityOwner();
        }
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor(
        ICoreAgreement _coreAgreement
    ) Ownable(msg.sender) EIP712("Lexo IdentityRegister", "1") {
        coreAgreement = _coreAgreement;
    }

    // ============================================================
    // ADMIN FUNCTIONS
    // ============================================================

    function setVerifier(address _verifierAddress) external onlyOwner {
        if (_verifierAddress == address(0)) revert InvalidVerifierAddress();
        verifier = _verifierAddress;
        emit VerifierChanged(_verifierAddress);
    }

    // ============================================================
    // CORE REGISTRATION & LINKING (EIP-712 SIGNED BY VERIFIER)
    // ============================================================

    /**
     * @notice Registers a new identity using an off-chain verifier attestation.
     * @dev Executed by user or relayer; authorization strictly requires verifier signature.
     */
    function registerIdentityWithAttestation(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) onlySignedAgreement external {
        if (msg.sender != wallet) revert NotAuthorizedIdentityOwner();
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        if (block.timestamp > deadline) revert AttestationExpired();
        if (restricted[identityHash]) revert IdentityIsRestricted();
        if (walletToIdentity[wallet] != bytes32(0)) revert WalletAlreadyLinked();
        if (wallet == address(0)) revert InvalidWalletAddress();

        Identity storage id = identities[identityHash];
        if (id.verified || id.status == VerificationStatus.Approved) {
            revert IdentityAlreadyExists();
        }

        // Verify EIP-712 Signature
        uint256 nonce = nonces[wallet];
        bytes32 structHash = keccak256(
            abi.encode(
                REGISTER_IDENTITY_TYPEHASH,
                wallet,
                identityHash,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        if (digest.recover(signature) != verifier) {
            revert InvalidAttestationSigner();
        }

        // Increment nonce to invalidate used signature
        nonces[wallet] = nonce + 1;

        // Instantly approve and register identity
        id.verified = true;
        id.status = VerificationStatus.Approved;
        id.rootWallet = wallet;
        id.wallets.push(wallet);

        walletToIdentity[wallet] = identityHash;

        emit IdentityRegistered(identityHash, wallet);
        emit WalletLinked(identityHash, wallet, true);
    }

    /**
     * @notice Links an additional wallet to an existing approved identity.
     * @dev Requires verifier attestation over the target wallet and identity hash.
     */
    function linkWalletWithAttestation(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (msg.sender != wallet) revert NotAuthorizedIdentityOwner();
        if (wallet == address(0)) revert InvalidWalletAddress();
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        if (block.timestamp > deadline) revert AttestationExpired();
        if (restricted[identityHash]) revert IdentityIsRestricted();
        if (walletToIdentity[wallet] != bytes32(0)) revert WalletAlreadyLinked();

        Identity storage id = identities[identityHash];
        if (!id.verified || id.status != VerificationStatus.Approved) {
            revert IdentityNotVerified();
        }

        if (id.wallets.length >= MAX_WALLETS) {
            revert MaximumWalletsReached();
        }

        // Verify EIP-712 Signature
        uint256 nonce = nonces[wallet];
        bytes32 structHash = keccak256(
            abi.encode(
                LINK_WALLET_TYPEHASH,
                wallet,
                identityHash,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        if (digest.recover(signature) != verifier) {
            revert InvalidAttestationSigner();
        }

        nonces[wallet] = nonce + 1;

        id.wallets.push(wallet);
        walletToIdentity[wallet] = identityHash;

        emit WalletLinked(identityHash, wallet, false);
    }

    // ============================================================
    // VERIFIER / COMPLIANCE CONTROLS
    // ============================================================

    function unverify(bytes32 identityHash) external onlyVerifier {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();

        Identity storage id = identities[identityHash];
        uint256 length = id.wallets.length;
        if (length == 0) revert IdentityHasNoWallets();

        for (uint256 i = 0; i < length; ++i) {
            delete walletToIdentity[id.wallets[i]];
        }

        delete identities[identityHash];
        delete restricted[identityHash];
        emit Unverified(identityHash);
    }

    function restrict(bytes32 identityHash) external onlyVerifier {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        restricted[identityHash] = true;
        emit IdentityRestricted(identityHash, true);
    }

    function unrestrict(bytes32 identityHash) external onlyVerifier {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        restricted[identityHash] = false;
        emit IdentityRestricted(identityHash, false);
    }

    function removeWallet(bytes32 identityHash, address wallet) external onlyVerifier {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();

        Identity storage id = identities[identityHash];
        uint256 walletCounts = id.wallets.length;

        if (walletToIdentity[wallet] != identityHash) {
            revert WalletNotLinkedToIdentity();
        }

        if (id.rootWallet == wallet && walletCounts > 1) {
            revert CannotDeleteRootWallet();
        }

        if (walletCounts <= 1) revert CannotRemoveLastWallet();

        uint256 length = id.wallets.length;
        for (uint256 i = 0; i < length; ++i) {
            if (id.wallets[i] == wallet) {
                id.wallets[i] = id.wallets[length - 1];
                id.wallets.pop();
                break;
            }
        }

        delete walletToIdentity[wallet];
        emit WalletRemoved(identityHash, wallet);
    }

    function changeRootWallet(
    bytes32 identityHash,
    address newRootWallet
    ) external {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        if (newRootWallet == address(0)) revert InvalidWalletAddress();
        Identity storage id = identities[identityHash];

        // Identity must exist and be verified
        if (!id.verified || id.status != VerificationStatus.Approved) {
            revert IdentityNotVerified();
        }

        // Only the current root wallet can change the root wallet
        if (msg.sender != id.rootWallet) {
            revert NotAuthorizedIdentityOwner();
        }

        // New root wallet must already belong to this identity
        if (walletToIdentity[newRootWallet] != identityHash) {
            revert WalletNotLinkedToIdentity();
        }

        id.rootWallet = newRootWallet;

        emit RootWalletChanged(identityHash, newRootWallet);
    }

    // ============================================================
    // VIEW / HELPER FUNCTIONS
    // ============================================================

    function getRegisterIdentityDigest(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    )  external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                REGISTER_IDENTITY_TYPEHASH,
                wallet,
                identityHash,
                nonce,
                deadline
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function getLinkWalletDigest(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    )  external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                LINK_WALLET_TYPEHASH,
                wallet,
                identityHash,
                nonce,
                deadline
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function getIdentity(bytes32 identityHash)
        external
        view
        returns (
            bool isVerifiedStatus,
            bool isRestrictedStatus,
            address root,
            address[] memory walletList,
            VerificationStatus status
        )
    {
        Identity storage id = identities[identityHash];
        return (
            id.verified,
            restricted[identityHash],
            id.rootWallet,
            id.wallets,
            id.status
        );
    }

    function getIdentityHashByWallet(address wallet) external view returns (bytes32) {
        return walletToIdentity[wallet];
    }

    function getWallets(bytes32 identityHash) external view returns (address[] memory) {
        return identities[identityHash].wallets;
    }

    function isVerified(address wallet) external view returns (bool) {
        bytes32 idHash = walletToIdentity[wallet];
        if (idHash == bytes32(0)) return false;

        Identity storage id = identities[idHash];
        return (
            id.verified &&
            id.status == VerificationStatus.Approved &&
            !restricted[idHash]
        );
    }
}