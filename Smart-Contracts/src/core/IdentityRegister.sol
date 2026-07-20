// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title IdentityRegister
 * @author Abinash Paudel
 * @notice Privacy-focused identity registry mapping a passport-derived identity hash
 *         to multiple authorized Web3 wallets via EIP-712 backend attestations.
 */
contract IdentityRegister is Ownable, EIP712 {
    using ECDSA for bytes32;

    /// @notice Address whose signature is trusted to attest wallet-identity links.
    address public verifier;

    /// @notice Maximum number of wallets allowed under a single identity.
    uint256 public constant MAX_WALLET = 5;

    struct Identity {
        bool verified;          // Slot 0 (1 byte)
        address rootWallet;     // Slot 0 (20 bytes) -> Total 21/32 bytes
        address[] wallets;      // Slot 1 (Array pointer)
    }

    /// @notice identityHash => Identity record
    mapping(bytes32 => Identity) private identities;

    /// @notice wallet => identityHash it belongs to (bytes32(0) if unlinked).
    mapping(address => bytes32) public walletToIdentity;

    /// @notice Independent mapping so restrictions survive unverify/re-registration cycles.
    mapping(bytes32 => bool) public restricted;

    /// @notice Per-wallet nonce for attestation replay protection.
    mapping(address => uint256) public nonces;

    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "WalletAttestation(address wallet,bytes32 identityHash,uint256 deadline,uint256 nonce)"
    );

    event VerifierChanged(address indexed newVerifier);
    event WalletLinked(bytes32 indexed hash, address indexed wallet, bool isRoot);
    event WalletRemoved(bytes32 indexed hash, address indexed wallet);
    event Verified(bytes32 indexed hash);
    event Unverified(bytes32 indexed hash);
    event IdentityRestricted(bytes32 indexed hash, bool isRestricted);
    event RootWalletChanged(bytes32 indexed hash, address indexed newRootWallet);

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
    error ZeroIdentityHash(); // Guard against sentinel-value state collisions


    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    constructor() Ownable(msg.sender) EIP712("Lexo IdentityRegister", "1") {}

    /// @notice Updates the trusted attestation-signing address.
    function addVerifier(address _verifierAddress) external onlyOwner {
        if (_verifierAddress == address(0)) revert InvalidVerifierAddress();
        verifier = _verifierAddress;
        emit VerifierChanged(_verifierAddress);
    }

    /**
     * @notice Registers the CALLER's wallet under an identity hash using a signed EIP-712 attestation.
     */
    function registerWithAttestation(
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // Enforce non-zero hash to protect sentinel value integrity
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        if (block.timestamp > deadline) revert AttestationExpired();
        if (restricted[identityHash]) revert IdentityIsRestricted();
        if (walletToIdentity[msg.sender] != bytes32(0)) revert WalletAlreadyLinked();

        Identity storage id = identities[identityHash];
        uint256 walletCounts = id.wallets.length;

        uint256 nonce = nonces[msg.sender];
        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, msg.sender, identityHash, deadline, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        if (digest.recover(signature) != verifier) revert InvalidAttestationSigner();

        nonces[msg.sender] = nonce + 1;

        bool isRoot = walletCounts == 0;

        if (isRoot) {
            id.verified = true;
            id.rootWallet = msg.sender;
            emit Verified(identityHash);
        } else {
            if (!id.verified) revert IdentityNotVerified();
            if (walletCounts >= MAX_WALLET) revert MaximumWalletCreated();
        }

        id.wallets.push(msg.sender);
        walletToIdentity[msg.sender] = identityHash;

        emit WalletLinked(identityHash, msg.sender, isRoot);
    }

    function getAttestationDigest(
        address wallet,
        bytes32 identityHash,
        uint256 deadline,
        uint256 nonce
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, wallet, identityHash, deadline, nonce)
        );
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Purges wallet mappings for an identity hash.
     */
    function unverify(bytes32 identityHash) external onlyVerifier {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        Identity storage id = identities[identityHash];
        uint256 len = id.wallets.length;
        
        if (len == 0) revert IdentityHasNoWallets();

        for (uint256 i = 0; i < len; ++i) {
            delete walletToIdentity[id.wallets[i]];
        }

        for (uint256 i = 0; i < len; ++i) {
            id.wallets.pop();
        }

        delete identities[identityHash];
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

    /**
     * @notice Removes a wallet from an identity profile.
     */
    function removeWallet(bytes32 identityHash, address wallet) external {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        Identity storage id = identities[identityHash];
        uint256 walletCounts = id.wallets.length;

        bool callerIsOwner = walletToIdentity[msg.sender] == identityHash && id.verified;
        if (!callerIsOwner && msg.sender != verifier) revert NotAuthorizedIdentityOwner();
        if (walletToIdentity[wallet] != identityHash) revert WalletNotLinkedToIdentity();
        if (id.rootWallet == wallet && walletCounts > 1) revert CannotDeleteRootWallet();


        if (walletCounts <= 1) revert CannotRemoveLastWallet();
        uint256 length = id.wallets.length;

        for (uint256 i; i < length; ++i) {
            if (id.wallets[i] == wallet) {
                id.wallets[i] = id.wallets[length - 1];
                id.wallets.pop();
                break;
            }
        }

        delete walletToIdentity[wallet];
        emit WalletRemoved(identityHash, wallet);
    }

    function changeRootWallet(bytes32 identityHash, address newRootWallet) external {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        Identity storage id = identities[identityHash];

        bool callerIsOwner = walletToIdentity[msg.sender] == identityHash && id.verified;
        if (!callerIsOwner && msg.sender != verifier) revert NotAuthorizedIdentityOwner();
        if (walletToIdentity[newRootWallet] != identityHash) revert WalletNotLinkedToIdentity();

        id.rootWallet = newRootWallet;
        emit RootWalletChanged(identityHash, newRootWallet);
    }

    /// @notice Returns full Identity struct metadata.
    function getIdentity(bytes32 identityHash) external view returns (bool isVerifiedStatus, bool isRestrictedStatus, address root, address[] memory walletList) {
        Identity storage id = identities[identityHash];
        return (id.verified, restricted[identityHash], id.rootWallet, id.wallets);
    }

    function getWallets(bytes32 identityHash) external view returns (address[] memory) {
        return identities[identityHash].wallets;
    }

    function walletCount(bytes32 identityHash) external view returns (uint256) {
        return identities[identityHash].wallets.length;
    }

    function isVerified(address wallet) external view returns (bool) {
        bytes32 idHash = walletToIdentity[wallet];
        if (idHash == bytes32(0)) return false;

        Identity storage id = identities[idHash];
        return id.verified && !restricted[idHash];
    }
}