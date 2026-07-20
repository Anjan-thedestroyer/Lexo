// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title IdentityRegister (attestation-based registration addition)
 * @notice This shows the pieces to ADD to your existing IdentityRegister contract
 *         to support backend-signed attestations redeemed by the user's own wallet,
 *         instead of the backend directly calling verify()/addWallets() on-chain.
 * @dev Merge this into your existing contract — it's written as additions, not a
 *      full replacement, so you keep verify()/addWallets()/removeWallet() etc.
 *      Note the contract now also inherits EIP712 for typed-data signing.
 */
abstract contract IdentityRegisterAttestation is Ownable, EIP712 {
    using ECDSA for bytes32;

    /// @notice Prevents a single attestation signature from being redeemed twice.
    mapping(bytes32 => bool) public usedAttestations;

    /// @dev EIP-712 typehash for a wallet-linking attestation.
    ///      Binds: which wallet, which identity, an expiry, and a nonce —
    ///      so a signature can't be replayed against a different wallet,
    ///      reused after it expires, or reused twice for the same wallet.
    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "WalletAttestation(address wallet,bytes32 identityHash,uint256 deadline,uint256 nonce)"
    );

    /// @notice Per-wallet nonce, incremented on each successful attestation redemption.
    mapping(address => uint256) public nonces;

    error AttestationExpired();
    error AttestationAlreadyUsed();
    error InvalidAttestationSigner();

    /// @dev Pass a name/version for your EIP-712 domain, e.g. ("Lexo", "1").
    ///      This MUST match what your backend uses when constructing the
    ///      typed-data struct for signing, or recovery will silently return
    ///      the wrong address instead of reverting.
    constructor(string memory name, string memory version) EIP712(name, version) {}

    /**
     * @notice Registers the CALLER's wallet under an identity hash, using a
     *         backend-signed attestation instead of a direct admin transaction.
     * @dev msg.sender must be the wallet being registered — this is what gives
     *      you proof-of-ownership for free, no separate signature needed for that part.
     * @param identityHash The identity hash this wallet is being linked to.
     * @param deadline Unix timestamp after which this attestation can no longer be redeemed.
     * @param signature The backend verifier's EIP-712 signature over the attestation data.
     */
    function registerWithAttestation(
        bytes32 identityHash,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert AttestationExpired();

        uint256 nonce = nonces[msg.sender];

        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, msg.sender, identityHash, deadline, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        if (usedAttestations[digest]) revert AttestationAlreadyUsed();

        address signer = digest.recover(signature);
        if (signer != verifier()) revert InvalidAttestationSigner();

        usedAttestations[digest] = true;
        nonces[msg.sender] = nonce + 1;

        // --- from here, same effect as your existing verify()/addWallets() logic ---
        // e.g.:
        //   if (identityToWallets[identityHash].length == 0) {
        //       // first wallet for this identity — treat like verify()
        //   } else {
        //       // additional wallet — treat like addWallets(), respecting MAX_WALLET
        //   }
        // wire this into your existing internal registration logic so there's
        // ONE source of truth for "how a wallet gets linked," not two parallel paths.
    }

    /// @dev Placeholder — reference your existing `verifier` state variable here.
    function verifier() public view virtual returns (address);
}
