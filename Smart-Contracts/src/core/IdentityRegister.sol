// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title IdentityRegister
 * @author Abinash Paudel
 * @notice Privacy-focused identity registry mapping a passport-derived identity hash
 *         to multiple authorized Web3 wallets. Registration is redeemed by the user's
 *         own wallet against a backend-signed EIP-712 attestation, rather than the
 *         backend submitting transactions directly — this shifts gas to the user and
 *         gives proof-of-wallet-ownership for free (msg.sender IS the wallet).
 *
 * @dev State-machine notes (read before modifying):
 *      - `identityToWallets[hash].length` is the ONLY source of truth for wallet
 *        count. There is no separate counter, specifically to avoid a class of bug
 *        where a counter and the array it's meant to track drift apart.
 *      - `verified[hash]` becomes true the moment the FIRST wallet is registered
 *        under a hash. It can be turned off by `unverify` (soft revoke — records are
 *        preserved) and back on by `reverify` (explicit re-approval). Neither of
 *        those two functions ever pushes to or pops from the wallets array — state
 *        changes to "is this identity currently trusted" and "which wallets does it
 *        own" are deliberately kept as separate, non-interfering operations.
 */
contract IdentityRegister is Ownable, EIP712 {
    using ECDSA for bytes32;

    /// @notice Address whose signature is trusted to attest wallet-identity links.
    address public verifier;

    /// @notice Maximum number of wallets allowed under a single identity.
    uint256 public constant MAX_WALLET = 5;

    /// @notice identityHash => wallets currently linked to it.
    mapping(bytes32 => address[]) private identityToWallets;

    /// @notice wallet => identityHash it belongs to (bytes32(0) if unlinked).
    mapping(address => bytes32) public walletToIdentity;

    /// @notice identityHash => manually restricted (banned) by the verifier.
    mapping(bytes32 => bool) public restricted;

    /// @notice identityHash => currently verified/trusted.
    mapping(bytes32 => bool) public verified;

    /// @notice Per-wallet nonce for attestation replay protection.
    mapping(address => uint256) public nonces;

    /// @notice digest => already redeemed, for attestation replay protection.
    mapping(bytes32 => bool) public usedAttestations;

    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "WalletAttestation(address wallet,bytes32 identityHash,uint256 deadline,uint256 nonce)"
    );

    event VerifierChanged(address indexed newVerifier);
    event WalletLinked(bytes32 indexed hash, address indexed wallet, bool isRoot);
    event WalletRemoved(bytes32 indexed hash, address indexed wallet);
    event Verified(bytes32 indexed hash);
    event Unverified(bytes32 indexed hash);
    event IdentityRestricted(bytes32 indexed hash, bool isRestricted);

    error NotVerifier();
    error NotAuthorizedIdentityOwner();
    error WalletAlreadyLinked();
    error WalletNotLinkedToIdentity();
    error MaximumWalletCreated();
    error CannotRemoveLastWallet();
    error IdentityIsRestricted();
    error IdentityNotVerified();
    error IdentityHasNoWallets();
    error AttestationExpired();
    error AttestationAlreadyUsed();
    error InvalidAttestationSigner();

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    constructor() Ownable(msg.sender) EIP712("Lexo IdentityRegister", "1") {}

    /// @notice Updates the trusted attestation-signing address.
    function addVerifier(address _verifierAddress) external onlyOwner {
        verifier = _verifierAddress;
        emit VerifierChanged(_verifierAddress);
    }

    /**
     * @notice Registers the CALLER's wallet under an identity hash, redeeming a
     *         backend-signed attestation. msg.sender must be the wallet itself.
     * @param identityHash The identity this wallet is being linked to.
     * @param deadline Unix timestamp after which this attestation can't be redeemed.
     * @param signature The verifier's EIP-712 signature over the attestation data.
     */
    function registerWithAttestation(
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert AttestationExpired();
        if (restricted[identityHash]) revert IdentityIsRestricted();
        if (walletToIdentity[msg.sender] != bytes32(0)) revert WalletAlreadyLinked();

        uint256 nonce = nonces[msg.sender];
        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, msg.sender, identityHash, deadline, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        if (usedAttestations[digest]) revert AttestationAlreadyUsed();
        if (digest.recover(signature) != verifier) revert InvalidAttestationSigner();

        usedAttestations[digest] = true;
        nonces[msg.sender] = nonce + 1;

        address[] storage wallets = identityToWallets[identityHash];
        bool isRoot = wallets.length == 0;

        if (isRoot) {
            verified[identityHash] = true;
            emit Verified(identityHash);
        } else {
            if (!verified[identityHash]) revert IdentityNotVerified();
            if (wallets.length >= MAX_WALLET) revert MaximumWalletCreated();
        }

        wallets.push(msg.sender);
        walletToIdentity[msg.sender] = identityHash;

        emit WalletLinked(identityHash, msg.sender, isRoot);
    }

    /// @notice Returns the EIP-712 digest for a given attestation — lets the backend
    ///         (or tests) verify a signature will recover correctly before issuing it.
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

    /// @notice Explicit re-approval of a previously-unverified identity. Does NOT
    ///         touch the wallets array or push any wallet — pure state flip, so it
    ///         can never desync wallet count from the array (see contract-level note).
    function reverify(bytes32 identityHash) external onlyVerifier {
        if (identityToWallets[identityHash].length == 0) revert IdentityHasNoWallets();
        verified[identityHash] = true;
        emit Verified(identityHash);
    }

    /// @notice Soft-revokes an identity. Records are preserved; wallets stop passing
    ///         isVerified() until reverify() is explicitly called.
    function unverify(bytes32 identityHash) external onlyVerifier {
        verified[identityHash] = false;
        emit Unverified(identityHash);
    }

    /// @notice Bans every wallet under this identity hash. Idempotent.
    function restrict(bytes32 identityHash) external onlyVerifier {
        restricted[identityHash] = true;
        emit IdentityRestricted(identityHash, true);
    }

    /// @notice Lifts a restriction — admin recovery path for false positives.
    function unrestrict(bytes32 identityHash) external onlyVerifier {
        restricted[identityHash] = false;
        emit IdentityRestricted(identityHash, false);
    }

    /**
     * @notice Unlinks a wallet from its identity. Callable by the identity's own
     *         verified owner (any linked wallet) or by the verifier.
     * @dev Gas-optimized swap-and-pop. Reverts if it would leave zero wallets —
     *      an identity must always retain at least one anchor wallet; use restrict()
     *      to ban an identity entirely instead of removing every wallet.
     */
    function removeWallet(bytes32 identityHash, address wallet) external {
        bool callerIsOwner = walletToIdentity[msg.sender] == identityHash && verified[identityHash];
        if (!callerIsOwner && msg.sender != verifier) revert NotAuthorizedIdentityOwner();
        if (walletToIdentity[wallet] != identityHash) revert WalletNotLinkedToIdentity();

        address[] storage wallets = identityToWallets[identityHash];
        if (wallets.length <= 1) revert CannotRemoveLastWallet();

        delete walletToIdentity[wallet];

        uint256 length = wallets.length;
        for (uint256 i = 0; i < length; i++) {
            if (wallets[i] == wallet) {
                wallets[i] = wallets[length - 1];
                wallets.pop();
                break;
            }
        }

        emit WalletRemoved(identityHash, wallet);
    }

    /// @notice All wallets currently linked to an identity hash.
    function getWallets(bytes32 identityHash) external view returns (address[] memory) {
        return identityToWallets[identityHash];
    }

    /// @notice Wallet count for an identity hash (== array length, single source of truth).
    function walletCount(bytes32 identityHash) external view returns (uint256) {
        return identityToWallets[identityHash].length;
    }

    /// @notice Whether an address is currently a verified, unrestricted wallet.
    ///         This is the function EscrowCore should call before every deposit/release.
    function isVerified(address wallet) external view returns (bool) {
        bytes32 id = walletToIdentity[wallet];
        return id != bytes32(0) && verified[id] && !restricted[id];
    }
}
