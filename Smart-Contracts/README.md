# Lexo Smart Contracts

Solidity contracts behind **Lexo**, an identity-aware platform for programmable legal agreements. They connect a verified identity registry, a platform-terms acceptance contract, an on-chain agreement registry and milestone-based escrow.

> **Status:** hackathon prototype on Ethereum Sepolia. The contracts are **unaudited** and use a mock stablecoin. Do not use them with real funds.

## Contents

| Contract | Purpose |
|---|---|
| `CoreAgreement` | Mock platform terms. Stores the hash of the terms document and records when each wallet accepted it. |
| `IdentityRegister` | Maps a verified `identityHash` to up to 5 wallets. Registration and wallet linking require an EIP-712 attestation signed by a trusted verifier. |
| `AgreementRegistry` | Stores document hashes for each deal, verifies EIP-712 signatures from payer and payee, and tells escrow when both parties have signed. |
| `EscrowCore` | Holds ERC-20 funds for a deal and releases them milestone by milestone. |
| `MockUSDT` | 6-decimal test token with a faucet, used only for development. |

## Deployed addresses (Sepolia, chain ID 11155111)

| Contract | Address |
|---|---|
| IdentityRegister | [`0x7c827d0293b7ed891ed589542d1d11450590812d`](https://sepolia.etherscan.io/address/0x7c827d0293b7ed891ed589542d1d11450590812d) |
| CoreAgreement | [`0x7b283E9B12f35F5373CDE81Ca0C4024d0F417bE8`](https://sepolia.etherscan.io/address/0x7b283E9B12f35F5373CDE81Ca0C4024d0F417bE8) |
| AgreementRegistry | [`0x0BbDA7e77Fcd74cB21Bc0368628f061e89faC148`](https://sepolia.etherscan.io/address/0x0BbDA7e77Fcd74cB21Bc0368628f061e89faC148) |
| EscrowCore | [`0xC8eB82Ed3148d5E7C6E9dE3F49EB2C14977508B7`](https://sepolia.etherscan.io/address/0xC8eB82Ed3148d5E7C6E9dE3F49EB2C14977508B7) |
| MockUSDT | [`0x888dd7Bc9f61E0060D792ff6a187FD475dd9970A`](https://sepolia.etherscan.io/address/0x888dd7Bc9f61E0060D792ff6a187FD475dd9970A) |
| Authorized verifier | [`0xb745E488D1F2BECb5DcF0404BCDc325093B62F59`](https://sepolia.etherscan.io/address/0xb745E488D1F2BECb5DcF0404BCDc325093B62F59) |

## How the contracts fit together

```text
                 signAgreement()
   Wallet ─────────────────────────────▶ CoreAgreement
     │                                        ▲
     │ registerIdentityWithAttestation()      │ hasSignedAgreement()
     ▼                                        │
 IdentityRegister ────────────────────────────┘
     ▲  isVerified()                 ▲  isVerified()
     │                               │
 AgreementRegistry ◀── submitPayerDocument ── EscrowCore
     │   haveBothSigned()  ───────────────────▶   │
     └──── syncPayeeFromRegistry() ───────────────┘
```

- An off-chain verifier (the Chainlink CRE workflow plus the backend) evaluates identity and wallet risk. For approved cases it signs an EIP-712 attestation, and the wallet submits it to `IdentityRegister`.
- `EscrowCore` and `AgreementRegistry` both rely on `IdentityRegister.isVerified` so that only verified, unrestricted wallets can use them.
- `EscrowCore` releases funds only when `AgreementRegistry.haveBothSigned` returns true.

## Contract details

### CoreAgreement

A simple on-chain acceptance of platform terms.

- `agreementHash` (immutable): hash of the terms document, set at deployment (must be non-zero).
- `publishedAt` (immutable): deployment timestamp.
- `signAgreement()`: records `block.timestamp` for `msg.sender`. Each address can sign once (`AlreadySigned`).
- `hasSignedAgreement(address)`: true once the address has signed.

This is a transaction-based acceptance by the sending wallet, not an EIP-712 signature. The terms are a demonstration document, not a finalized legal agreement.

### IdentityRegister

Privacy-focused registry. Only an identity commitment (`identityHash`) and wallet addresses are stored. No personal data goes on-chain.

| Function | Who | What it does |
|---|---|---|
| `registerIdentityWithAttestation(wallet, identityHash, deadline, signature)` | The wallet itself, after signing `CoreAgreement` | Registers a new identity with `wallet` as root wallet. Requires a valid verifier signature, an unexpired deadline, an unrestricted and unused `identityHash`, and a wallet not already linked. |
| `linkWalletWithAttestation(wallet, identityHash, deadline, signature)` | The new wallet itself | Links an additional wallet to an existing verified identity (maximum 5). Requires a verifier signature over the new wallet. |
| `changeRootWallet(identityHash, newRootWallet)` | Current root wallet | Moves the root role to another wallet already linked to the identity. |
| `restrict` / `unrestrict(identityHash)` | Verifier | Blocks or unblocks an identity. A restricted identity fails `isVerified` and can't be used to register or link. |
| `removeWallet(identityHash, wallet)` | Verifier | Unlinks a wallet. The root wallet and the last remaining wallet can't be removed. |
| `unverify(identityHash)` | Verifier | Deletes the identity and unlinks all its wallets. |
| `setVerifier(address)` | Owner | Sets the trusted verifier address (must be non-zero). |
| `isVerified(wallet)` | Anyone (view) | True if the wallet's identity is verified, approved and not restricted. |

Replay protection: each wallet has a `nonces[wallet]` counter that is included in the signed data and incremented on use, and every attestation carries a `deadline`.

### AgreementRegistry

Source of truth for the documents behind each deal. Each deal has two documents: **Document A** (payer's terms, `docIndex` 0) and **Document B** (payee's terms, `docIndex` 1).

| Function | Who | What it does |
|---|---|---|
| `submitPayerDocument(dealId, hash, payer)` | `EscrowCore` only | Records Document A and the payer when a deal is created. Document A starts **unsigned**. |
| `submitPayeeDocument(dealId, hash)` | Any verified wallet | A prospective payee submits their Document B hash. One submission per candidate, and only while no payee is selected. |
| `acceptPayeeAgreement(dealId, candidate, payerSignature)` | Payer | Accepts a candidate's Document B using the payer's EIP-712 signature over it. Selects the payee, marks Document B as payer-signed, and calls `EscrowCore.syncPayeeFromRegistry`. |
| `rejectPayeeAgreement(dealId, candidate)` | Payer | Removes a candidate's submitted document. |
| `signDocument(dealId, docIndex, signature)` | Payer or payee | Signs Document A or B with an EIP-712 signature. Each party can sign each document once. |
| `haveBothSigned(dealId)` | Anyone (view) | True when a payee is selected and both parties have signed **both** documents. |
| `setEscrowCore(address)` | Owner, once | Links the registry to `EscrowCore`. Can only be set once. |

Helper views return the EIP-712 digest to sign: `getSigningDigest` and `getCandidateSigningDigest`.

### EscrowCore

Milestone-based escrow for an ERC-20 token.

| Function | Who | What it does |
|---|---|---|
| `createDeal(descriptions, amounts, invitedPayees, documentHash)` | Verified payer | Creates a deal with 1 to 15 milestones and pulls the **total** amount from the payer (the payer must approve the token first). Registers Document A in `AgreementRegistry`. |
| `syncPayeeFromRegistry(dealId)` | `AgreementRegistry` only | Callback that sets the deal's payee once the payer accepts a Document B. The payee must be verified. |
| `approveAndReleaseMilestone(dealId)` | Payer | Releases the **current** milestone (one per call, in order) to the payee's withdrawable balance. Requires `haveBothSigned`. The deal completes after the last milestone. |
| `withdraw()` | Any verified wallet | Pays out the caller's `pendingWithdrawals`, minus a **0.3%** protocol fee sent to `feeRecipient`. Uses a pull pattern and a reentrancy guard. |
| `cancelDeal(dealId, deadline, payerSig, payeeSig)` | Verified wallet | If no payee has been selected, the payer can cancel alone. Otherwise it needs EIP-712 `CancelDeal` signatures from **both** payer and payee. The remaining balance is refunded to the payer. |
| `setFeeRecipient(address)` | Owner | Changes the fee recipient. |

Invited payees are stored for convenience but are advisory. Any verified wallet can submit a Document B, and the payer chooses.

#### Dispute hooks (not part of this build)

`EscrowCore` also contains `raiseDispute`, `reRaiseDispute`, `resolveDispute` and the owner-only `addArbitrator`. They are **inert unless an arbitration contract is registered** with `addArbitrator`. In the deployed build, `arbiter` is unset, so `raiseDispute` reverts and no deal can enter the `Disputed` state. The arbitration module is an unfinished concept prototype, is not deployed, and has known unresolved issues. **Do not call `addArbitrator` on the deployed contract.**

## EIP-712 typed data

| Contract (domain name, version) | Type |
|---|---|
| `IdentityRegister` ("Lexo IdentityRegister", "1") | `RegisterIdentity(address wallet,bytes32 identityHash,uint256 nonce,uint256 deadline)` |
| `IdentityRegister` | `LinkWallet(address wallet,bytes32 identityHash,uint256 nonce,uint256 deadline)` |
| `AgreementRegistry` ("Lexo AgreementRegistry", "1") | `AgreementDoc(uint256 dealId,uint8 docIndex,bytes32 contentHash)` |
| `EscrowCore` ("Lexo EscrowCore", "1") | `CancelDeal(uint256 dealId,uint256 nonce,uint256 deadline)` |

`IdentityRegister` also exposes `getRegisterIdentityDigest` and `getLinkWalletDigest` for building and checking digests off-chain.

## End-to-end flow

1. **Platform terms.** The user calls `CoreAgreement.signAgreement()`.
2. **Identity.** Off-chain checks pass and the verifier signs a `RegisterIdentity` attestation. The user submits it to `IdentityRegister`.
3. **Extra wallets (optional).** For each additional wallet, a new screening runs, the verifier signs `LinkWallet`, and the new wallet submits it.
4. **Create a deal.** The payer approves the token and calls `EscrowCore.createDeal`. Funds are locked and Document A is recorded.
5. **Select a payee.** A verified payee submits Document B. The payer accepts it with an EIP-712 signature, which selects the payee.
6. **Sign.** The payer signs Document A, and the payee signs both documents, using `signDocument`. `haveBothSigned` becomes true.
7. **Release.** The payer calls `approveAndReleaseMilestone` for each milestone in order.
8. **Withdraw.** The payee calls `withdraw()` and receives the released funds minus the 0.3% fee.

## Roles and permissions

| Role | Powers |
|---|---|
| **Owner** (deployer) | `IdentityRegister.setVerifier`, `AgreementRegistry.setEscrowCore` (once), `EscrowCore.setFeeRecipient`, `EscrowCore.addArbitrator` |
| **Verifier** | Signs identity and wallet attestations. Can `restrict`, `unrestrict`, `removeWallet` and `unverify`. |
| **Payer** | Creates and funds deals, accepts or rejects payees, approves milestones. |
| **Payee** | Submits Document B, signs documents, withdraws released funds. |
| **Any verified wallet** | Submits payee documents, withdraws its own balance. |

## Deployment and configuration order

1. Deploy `CoreAgreement(agreementHash)`.
2. Deploy `IdentityRegister(coreAgreement)`.
3. Call `IdentityRegister.setVerifier(verifierAddress)`.
4. Deploy `AgreementRegistry(identityRegister)`.
5. Deploy the token (`MockUSDT` on testnet).
6. Deploy `EscrowCore(token, identityRegister, agreementRegistry, feeRecipient)`.
7. Call `AgreementRegistry.setEscrowCore(escrowCore)` (one time only).

Do **not** call `EscrowCore.addArbitrator`.

## Build and test

The project uses [Foundry](https://book.getfoundry.sh/).

```bash
forge build
forge test
forge test --match-test <name> -vvv   # run one test with traces
```

The test suite includes unit tests and fuzz tests for the identity, agreement and escrow contracts.

## Security notes and trust assumptions

- **Single verifier.** `IdentityRegister` trusts one verifier address for attestations and for `restrict`, `unrestrict`, `removeWallet` and `unverify`. If that key is compromised, an attacker could issue attestations and manage identities. The owner can also replace the verifier at any time. Moving to decentralized (DON-based) signing is future work.
- **Replay and expiry.** Attestations carry a nonce and a deadline. Cancellation signatures carry a nonce and a deadline as well.
- **Funds.** Withdrawals use a pull pattern with `nonReentrant`. Token transfers use `SafeERC20`.
- **Privacy.** Only the `identityHash`, wallet addresses and document hashes are stored on-chain.

## Known limitations

- Unaudited prototype. Testnet only, with a mock stablecoin.
- **No on-chain dispute path.** If a payer won't approve a milestone and the payee won't co-sign a cancellation, the remaining funds stay locked. There is no timeout or unilateral refund.
- `linkWalletWithAttestation` does not check `CoreAgreement` on-chain. Only registration does. Any acceptance requirement for wallet linking is enforced off-chain.
- Wallet statuses such as Active, Inactive and Removed are tracked by the off-chain backend. On-chain, a wallet is either linked to an identity or not, and the identity is either restricted or not.
- `EscrowCore` assumes the token transfers exactly the amount requested. Fee-on-transfer or rebasing tokens are not supported.
- Document A is created unsigned, so the payer must also call `signDocument` for it before milestones can release.
- The dispute and arbitration code is inert in the deployed configuration, is not part of the tested system, and has known unresolved issues.

## License

MIT