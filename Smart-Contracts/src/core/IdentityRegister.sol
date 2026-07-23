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
 * @dev Core design:
 *      - The contract never sees passport data. A trusted off-chain `verifier`
 *        address signs an EIP-712 attestation after doing NFC passport
 *        verification + sanctions screening; the user's own wallet redeems
 *        that attestation on-chain via `registerWithAttestation`, which is
 *        what proves wallet ownership (msg.sender IS the wallet).
 *      - `restricted[identityHash]` is a permanent-until-explicitly-lifted ban
 *        flag stored independently of the `Identity` struct, so a ban survives
 *        `unverify()` purging the rest of an identity's state — a banned
 *        identity cannot re-register its way out of a ban.
 *      - `unverify()` is a hard purge: it deletes every wallet mapping and the
 *        entire `Identity` record for a hash. Recovery means a brand new
 *        `registerWithAttestation` call, which establishes a fresh root wallet.
 *      - `identityHash == bytes32(0)` is rejected everywhere it's accepted as
 *        input, because `bytes32(0)` doubles as the "unlinked" sentinel value
 *        in `walletToIdentity`. Without this guard, a wallet registered under
 *        a zero hash would be indistinguishable from an unregistered wallet,
 *        allowing repeated silent re-registration into `identities[0]`.
 */
contract IdentityRegister is Ownable, EIP712 {
    using ECDSA for bytes32;

    /// @notice Address whose EIP-712 signature is trusted to attest wallet-identity links.
    /// @dev Set via `addVerifier`. Should be a dedicated backend signing key.
    address public verifier;

    /// @notice Maximum number of wallets allowed under a single identity hash.
    uint256 public constant MAX_WALLET = 5;

    /// @notice Per-identity record: verification status, anchor root wallet,
    ///         and every wallet currently linked to this identity.
    /// @dev `verified` (1 byte) and `rootWallet` (20 bytes) pack into storage
    ///      slot 0 (21/32 bytes used); `wallets` occupies its own slot.
    struct Identity {
        bool verified;          
        address rootWallet;     
        address[] wallets;     
    }

    /// @notice identityHash => full Identity record.
    mapping(bytes32 => Identity) private identities;

    /// @notice wallet => identityHash it belongs to. `bytes32(0)` means unlinked.
    mapping(address => bytes32) public walletToIdentity;

    /// @notice identityHash => permanently restricted (banned) until explicitly lifted.
    /// @dev Independent of `identities` so a ban survives `unverify()`. See contract @dev note.
    mapping(bytes32 => bool) public restricted;

    /// @notice wallet => next expected nonce for that wallet's attestations.
    /// @dev Incremented on every successful `registerWithAttestation` call. Combined
    ///      with the one-time-only nature of wallet registration (`WalletAlreadyLinked`),
    ///      this prevents a signed attestation from ever being redeemed twice.
    mapping(address => uint256) public nonces;

    /// @dev EIP-712 typehash for the WalletAttestation struct.
    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "WalletAttestation(address wallet,bytes32 identityHash,uint256 deadline,uint256 nonce)"
    );

    /// @notice Emitted when the trusted attestation-signing address changes.
    event VerifierChanged(address indexed newVerifier);

    /// @notice Emitted whenever a wallet becomes linked to an identity hash.
    /// @param isRoot True if this wallet was the first ("root") wallet for the hash.
    event WalletLinked(bytes32 indexed hash, address indexed wallet, bool isRoot);

    /// @notice Emitted when a non-root wallet is unlinked from its identity.
    event WalletRemoved(bytes32 indexed hash, address indexed wallet);

    /// @notice Emitted when an identity hash registers its first (root) wallet.
    event Verified(bytes32 indexed hash);

    /// @notice Emitted when an identity hash's entire record is purged via `unverify`.
    event Unverified(bytes32 indexed hash);

    /// @notice Emitted whenever `restrict`/`unrestrict` changes an identity's ban state.
    event IdentityRestricted(bytes32 indexed hash, bool isRestricted);

    /// @notice Emitted when an identity's anchor root wallet changes.
    event RootWalletChanged(bytes32 indexed hash, address indexed newRootWallet);

    /// @dev Thrown when a `verifier`-only function is called by another address.
    error NotVerifier();

    /// @dev Thrown when the caller is neither the identity's own verified wallet
    ///      owner nor the trusted verifier.
    error NotAuthorizedIdentityOwner();

    /// @dev Thrown when the calling wallet is already linked to some identity hash.
    error WalletAlreadyLinked();

    /// @dev Thrown when a target wallet is not actually linked to the given identity hash.
    error WalletNotLinkedToIdentity();

    /// @dev Thrown when registering a wallet would exceed `MAX_WALLET` for that identity.
    error MaximumWalletCreated();

    /// @dev Thrown when `removeWallet` would leave an identity with zero wallets.
    error CannotRemoveLastWallet();

    /// @dev Thrown when attempting to remove an identity's root wallet while other
    ///      wallets remain — use `changeRootWallet` first. Note: if the root wallet
    ///      is also the LAST remaining wallet, `CannotRemoveLastWallet` fires instead
    ///      of this error; the root is protected either way, just via different errors
    ///      depending on remaining wallet count.
    error CannotDeleteRootWallet();

    /// @dev Thrown when acting on an identity hash currently flagged as restricted (banned).
    error IdentityIsRestricted();

    /// @dev Thrown when attempting to add a secondary wallet to an identity hash
    ///      that has not been verified (no root wallet yet, or purged via `unverify`
    ///      and never re-registered).
    error IdentityNotVerified();

    /// @dev Thrown by `unverify` when called on an identity hash with no wallets to purge.
    error IdentityHasNoWallets();

    /// @dev Thrown when `block.timestamp` has passed an attestation's `deadline`.
    error AttestationExpired();

    /// @dev Thrown when the address recovered from a signature does not match `verifier`.
    error InvalidAttestationSigner();

    /// @dev Thrown when `addVerifier` is called with the zero address.
    error InvalidVerifierAddress();

    /// @dev Thrown when `bytes32(0)` is passed as an `identityHash` argument anywhere
    ///      it's accepted as input — guards against sentinel-value state collisions
    ///      (see contract-level @dev note).
    error ZeroIdentityHash();

    /// @dev Restricts a function to only be callable by the current `verifier` address.
    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    /// @notice Deploys the registry. Deployer becomes the `Ownable` owner; the
    ///         EIP-712 domain is fixed to ("Lexo IdentityRegister", "1").
    constructor() Ownable(msg.sender) EIP712("Lexo IdentityRegister", "1") {}

    /**
     * @notice Updates the trusted attestation-signing address.
     * @dev Owner-only.
     * @param _verifierAddress The new address whose signatures will be trusted.
     */
    function addVerifier(address _verifierAddress) external onlyOwner {
        if (_verifierAddress == address(0)) revert InvalidVerifierAddress();
        verifier = _verifierAddress;
        emit VerifierChanged(_verifierAddress);
    }

    /**
     * @notice Registers the CALLER's wallet under an identity hash by redeeming a
     *         backend-signed EIP-712 attestation.
     * @dev msg.sender must be the wallet being registered — this proves wallet
     *      ownership without a separate proof-of-ownership signature. The first
     *      wallet ever registered under a hash becomes its `rootWallet` and marks
     *      the identity `verified`. Every subsequent wallet requires the identity
     *      to already be `verified` and under the `MAX_WALLET` cap.
     * @param identityHash The identity hash this wallet is being linked to. Cannot be zero.
     * @param deadline Unix timestamp after which this attestation can no longer be redeemed.
     * @param signature The verifier's EIP-712 signature over
     *        (msg.sender, identityHash, deadline, current nonce for msg.sender).
     */
    function registerWithAttestation(
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) external {
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

    /**
     * @notice Computes the EIP-712 digest for a given attestation, so the backend
     *         (or tests) can confirm a signature will recover correctly before issuing it.
     * @param wallet The wallet the attestation is being issued for.
     * @param identityHash The identity hash the wallet would be linked to.
     * @param deadline The proposed expiry timestamp.
     * @param nonce The nonce to sign against (typically `nonces[wallet]`).
     * @return The EIP-712 typed-data digest that `verifier` must sign.
     */
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
     * @notice Purges all wallet mappings and the Identity record for an identity hash.
     * @dev Does NOT clear `restricted[identityHash]` — bans persist across unverify
     *      by design. Hard reset: recovery requires a brand new
     *      `registerWithAttestation` call establishing a fresh root wallet.
     * @param identityHash The identity hash to purge. Cannot be zero.
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

    /**
     * @notice Permanently restricts (bans) an identity hash until explicitly lifted.
     * @param identityHash The identity hash to restrict. Cannot be zero.
     */
    function restrict(bytes32 identityHash) external onlyVerifier {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        restricted[identityHash] = true;
        emit IdentityRestricted(identityHash, true);
    }

    /**
     * @notice Lifts a restriction on an identity hash — the recovery path for false positives.
     * @param identityHash The identity hash to unrestrict. Cannot be zero.
     */
    function unrestrict(bytes32 identityHash) external onlyVerifier {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        restricted[identityHash] = false;
        emit IdentityRestricted(identityHash, false);
    }

    /**
     * @notice Unlinks a wallet from an identity profile.
     * @dev Gas-optimized swap-and-pop. An identity must always retain at least one
     *      wallet, and its root wallet cannot be removed while other wallets remain
     *      (use `changeRootWallet` first) — see `CannotDeleteRootWallet` for the
     *      one edge case where the last-wallet check fires instead.
     * @param identityHash The identity hash the wallet belongs to. Cannot be zero.
     * @param wallet The wallet to unlink.
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

    /**
     * @notice Changes an identity's anchor root wallet to a different wallet already
     *         linked to the same identity hash.
     * @dev Callable by the identity's own verified owner or the verifier. The new
     *      root wallet must already be linked to this identity hash.
     * @param identityHash The identity hash whose root wallet is changing. Cannot be zero.
     * @param newRootWallet An existing linked wallet to promote to root.
     */
    function changeRootWallet(bytes32 identityHash, address newRootWallet) external {
        if (identityHash == bytes32(0)) revert ZeroIdentityHash();
        Identity storage id = identities[identityHash];

        bool callerIsOwner = walletToIdentity[msg.sender] == identityHash && id.verified;
        if (!callerIsOwner && msg.sender != verifier) revert NotAuthorizedIdentityOwner();
        if (walletToIdentity[newRootWallet] != identityHash) revert WalletNotLinkedToIdentity();

        id.rootWallet = newRootWallet;
        emit RootWalletChanged(identityHash, newRootWallet);
    }

    /**
     * @notice Returns the full Identity record for an identity hash in one call.
     * @param identityHash The identity hash to look up.
     * @return isVerifiedStatus Whether the identity currently has a registered root wallet.
     * @return isRestrictedStatus Whether the identity is currently banned.
     * @return root The current root wallet address (zero address if never registered).
     * @return walletList Every wallet currently linked to this identity hash.
     */
    function getIdentity(bytes32 identityHash)
        external
        view
        returns (bool isVerifiedStatus, bool isRestrictedStatus, address root, address[] memory walletList)
    {
        Identity storage id = identities[identityHash];
        return (id.verified, restricted[identityHash], id.rootWallet, id.wallets);
    }

    function getIdentityHashByWallet(address wallet) external view returns (bytes32 identityHash){
        return walletToIdentity[wallet];
    }

    /**
     * @notice Returns every wallet currently linked to an identity hash.
     * @param identityHash The identity hash to look up.
     * @return The list of linked wallet addresses.
     */
    function getWallets(bytes32 identityHash) external view returns (address[] memory) {
        return identities[identityHash].wallets;
    }

    /**
     * @notice Returns how many wallets are currently linked to an identity hash.
     * @param identityHash The identity hash to look up.
     * @return The wallet count (0 if never registered or purged via `unverify`).
     */
    function walletCount(bytes32 identityHash) external view returns (uint256) {
        return identities[identityHash].wallets.length;
    }

    /**
     * @notice Checks whether a wallet is currently verified and not restricted.
     * @dev This is the function downstream contracts (e.g. the escrow core) should
     *      call before allowing any action gated on identity — always a live read
     *      of current state, never a cached or pushed flag.
     * @param wallet The wallet address to check.
     * @return True if the wallet is linked to a verified, unrestricted identity.
     */
    function isVerified(address wallet) external view returns (bool) {
        bytes32 idHash = walletToIdentity[wallet];
        if (idHash == bytes32(0)) return false;

        Identity storage id = identities[idHash];
        return id.verified && !restricted[idHash];
    }
}
