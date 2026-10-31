# Lexo: Identity-Aware Programmable Legal Agreements

**Verified people. Screened wallets. Signed agreements. Milestone escrow. AI explains the decision, and rules make it.**

🎥 **Demo video:** [![Lexo Demo](https://img.youtube.com/vi/NcG__Xuim_U/maxresdefault.jpg)](https://www.youtube.com/watch?v=NcG__Xuim_U) 

Lexo connects verified real-world identities to independently risk-screened blockchain wallets, then lets those participants form signed agreements backed by milestone-based escrow. Chainlink CRE evaluates identity and wallet risk and produces the signed on-chain authorization. AI explains the decisions in plain language but never makes them.

> **Status:** hackathon prototype on Ethereum Sepolia with a mock stablecoin. The contracts are unaudited. Do not use real funds.

## Table of contents

- [The problem](#the-problem)
- [What Lexo does](#what-lexo-does)
- [Architecture](#architecture)
- [AI: explanation, not authority](#ai-explanation-not-authority)
- [Deployed contracts](#deployed-contracts-ethereum-sepolia)
- [Chainlink CRE workflows](#chainlink-cre-workflows)
- [On-chain evidence](#on-chain-evidence)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Responsible AI and privacy](#responsible-ai-and-privacy)
- [Limitations](#limitations)
- [Future work](#future-work)

## The problem

A blockchain address says nothing about who is behind it, while identity verification, legal agreements, compliance checks and payments often operate in separate systems.

- **Identity fragmentation:** users can switch wallets, which makes it hard to maintain trust across addresses.
- **Disconnected agreements:** signed documents are not necessarily connected to the funds that execute them.
- **Centralized escrow:** funds often depend on an intermediary.
- **Fragmented compliance:** AML and country-risk results are disconnected from on-chain authorization.
- **Opaque decisions:** users may not understand why an application approved or rejected them.

## What Lexo does

**Verified identity → Wallet screening → CRE risk evaluation → On-chain authorization → Agreement → EIP-712 consent → Escrow → Milestone settlement**

1. **Identity verification.** Users verify through Rarimo using passport-based verification. A nullifier-derived commitment becomes the `identityHash`. Raw passport data is not written on-chain.
2. **Risk evaluation in Chainlink CRE.** The backend triggers a CRE workflow that evaluates country risk (versioned policy `country-risk-v1`), age eligibility, passport validity and wallet AML screening. The deterministic rules return one of three outcomes: `APPROVE`, `MANUAL REVIEW` or `REJECT`.
3. **On-chain authorization.** For approved cases, the workflow reads the authorized verifier and nonce from `IdentityRegister` and generates an EIP-712 signature. The application submits it to register the identity and root wallet.
4. **Multi-wallet trust.** One `identityHash` can be linked to up to five wallets. Every additional wallet is screened and evaluated through CRE before linking. The backend tracks wallet status (Active, Inactive, Removed), and removed wallets cannot authenticate.
5. **Platform Core Agreement.** A mock platform agreement is accepted through the `CoreAgreement` contract. `IdentityRegister` checks that acceptance on-chain before registering an identity. For wallet linking, the requirement is enforced by the backend. This is a demonstration agreement, not a finalized legal document.
6. **Individual agreements and escrow.** Participants create hashed agreements, both parties sign with EIP-712, and the payer funds milestone-based escrow in `EscrowCore`. Milestones release one at a time after the payer approves them and both parties have signed.

### Example: a $1,000 website project

| Milestone | Payment |
|---|---:|
| Design completion | $300 |
| Development completion | $300 |
| Final delivery | $400 |
| **Total** | **$1,000** |

1. The client and developer each verify their identity and wallet.
2. The client creates the agreement and funds the escrow in one transaction. The document hash is recorded with the deal.
3. The developer submits terms, the client accepts them with an EIP-712 signature, and both parties sign.
4. The client approves and releases milestones one at a time.
5. The developer withdraws the released funds, minus a 0.3% protocol fee.

This flow was run on Sepolia. See [On-chain evidence](#on-chain-evidence).

## Architecture

```text
 Rarimo passport verification
            │
            ▼
 Frontend (Next.js) ──▶ Backend (Express, MongoDB)
                              │  identity + wallet signals
                              ▼
                     Chainlink CRE workflows
          (risk evaluation, verifier read, EIP-712 signature)
                              │  signed authorization
                              ▼
   CoreAgreement ◀── IdentityRegister ◀── AgreementRegistry ◀── EscrowCore
   (platform terms)   (identity ↔ wallets)  (document signatures)  (milestone funds)

 Backend ──▶ OpenRouter LLM: explains the decision after it is made
```

- **Off-chain:** identity verification, risk scoring and AI explanations. Personal data stays here.
- **On-chain:** identity commitments, wallet links, document hashes, signatures and escrowed funds.
- **Trust boundary:** the deterministic risk engine decides, and a single configured verifier key signs the attestation.

## AI: explanation, not authority

Lexo uses AI to explain identity-registration and wallet-linking outcomes in plain language.

1. The deterministic risk engine evaluates identity and wallet information.
2. It produces a structured result: scores, checks and a decision.
3. AI converts that result into a readable explanation.
4. The user sees the decision alongside its explanation.

**Boundaries**
- AI runs after the decision and cannot approve, reject, override rules or issue signatures.
- If the AI is unavailable or returns an invalid response, the decision stands and a fallback explanation is used.
- Explanations are decision support, not legal or regulatory determinations.

**Provider:** OpenRouter, using the `openrouter/free` router alias.

**Data sent to the model:** risk scores and tier, country name and risk level, check results and the decision. Raw passport data, the user's name and the identity hash are not sent.

**Example (approved case, model-generated):**
> The identity verification was approved with a low risk score of 18. Although Nepal carries moderate country risk, the positive verification signals support the final APPROVE decision.

In the tested rejection cases (a high-risk wallet and a failed identity check), OpenRouter returned empty responses, so Lexo displayed its fallback explanations. The decisions were unaffected. [FILL: edit or remove this paragraph if you have since re-run those cases and obtained real model output.]

## Deployed contracts (Ethereum Sepolia)

Chain ID `11155111`.

| Contract | Address |
|---|---|
| IdentityRegister | [`0x7c827d0293b7ed891ed589542d1d11450590812d`](https://sepolia.etherscan.io/address/0x7c827d0293b7ed891ed589542d1d11450590812d) |
| AgreementRegistry | [`0x0BbDA7e77Fcd74cB21Bc0368628f061e89faC148`](https://sepolia.etherscan.io/address/0x0BbDA7e77Fcd74cB21Bc0368628f061e89faC148) |
| CoreAgreement (platform terms) | [`0x7b283E9B12f35F5373CDE81Ca0C4024d0F417bE8`](https://sepolia.etherscan.io/address/0x7b283E9B12f35F5373CDE81Ca0C4024d0F417bE8) |
| EscrowCore | [`0xC8eB82Ed3148d5E7C6E9dE3F49EB2C14977508B7`](https://sepolia.etherscan.io/address/0xC8eB82Ed3148d5E7C6E9dE3F49EB2C14977508B7) |
| MockUSDT (faucet token) | [`0x888dd7Bc9f61E0060D792ff6a187FD475dd9970A`](https://sepolia.etherscan.io/address/0x888dd7Bc9f61E0060D792ff6a187FD475dd9970A) |
| Authorized verifier | [`0xb745E488D1F2BECb5DcF0404BCDc325093B62F59`](https://sepolia.etherscan.io/address/0xb745E488D1F2BECb5DcF0404BCDc325093B62F59) |

**Built into the contracts**
- `IdentityRegister` accepts an identity only with a valid verifier-signed EIP-712 attestation (nonce and deadline), and only for a caller who has accepted the platform terms in `CoreAgreement`.
- Each identity can link at most 5 wallets.
- Milestones release only after `AgreementRegistry.haveBothSigned` returns true.
- Cancelling an agreement with a selected payee needs EIP-712 signatures from both parties, with a nonce and deadline.
- Funds use a pull-withdrawal pattern with reentrancy protection, and only verified wallets can perform restricted escrow operations.

## Chainlink CRE workflows

Two workflows evaluate risk and produce the EIP-712 authorization: **identity registration** and **additional wallet linking**. The backend triggers them over HTTP.

| | Identity registration | Wallet linking |
|---|---|---|
| Simulated | 2026-10-31T10:16:01Z | 2026-10-31T10:18:12Z |
| Binary hash | `4601fdddccd67b1b93ed26b5340ca9ac1b3bc563e7cb729288b692725ec4609c` | `4fd85ad3ba0c316396b52341b1299cc038263cacfedcf31957ed86fd3a126f20` |
| Config hash | `98366a9ad81a0621afcef36927781c4fbfd2f77aac5f40e40f3722e81b07b5cf` | same |
| Decision | APPROVE | APPROVE |
| Score / tier | 18 / LOW | 18 / LOW |
| Country risk | 8 (MODERATE) | 8 (MODERATE) |
| AML | SCORED, 0 | evaluated independently |
| Result | EIP-712 signature generated | EIP-712 signature generated (nonce 1) |

Logs are in the `evidence` folder inside `cre` [FILL: exact path]. These are successful **simulations**, not live deployed workflows.

## On-chain evidence

**Identity**

| Operation | Transaction |
|---|---|
| Identity registration | [`0x5cf4…03a2`](https://sepolia.etherscan.io/tx/0x5cf4f305b948c2132b2581e4d5bd80714ede86d009ed020c768020efbb8503a2) |
| Additional wallet linking | [`0xf295…c265`](https://sepolia.etherscan.io/tx/0xf29574107fcfc2028993eebfbcce9b9b647424b548cc15f628c5d52dab37c265) |

**$1,000 agreement, end to end**

| Step | Transaction |
|---|---|
| Agreement creation and escrow funding | [`0x8b71…52e3`](https://sepolia.etherscan.io/tx/0x8b71e3cab7f30b0ad863c66517998882904d2e3358642712f5bb2256f8cc52e3) |
| Payee agreement request | [`0x235e…5d30`](https://sepolia.etherscan.io/tx/0x235eb04e62474e0711000cb131c049ae2f7bab4f755be135b95d27c5c21b5d30) |
| Payer acceptance of payee agreement | [`0xaad3…b4b8`](https://sepolia.etherscan.io/tx/0xaad3fd79efece7cb7743d8ca541d586e73e8188a5d964e4b395ffa6d74a1b4b8) |
| Payee signing remaining agreements (1) | [`0x9f94…08ce`](https://sepolia.etherscan.io/tx/0x9f9453acaf07e5f7af8572f7de5b63225831f115dc01beb727e7777a8d3c08ce) |
| Payee signing remaining agreements (2) | [`0x782d…0a5d`](https://sepolia.etherscan.io/tx/0x782d1515623e04ba0ff7e3c5be289d7c30c97ceffc92a3a2a7058841dd1a0a5d) |
| Payer approving and releasing milestone | [`0xac11…6d4`](https://sepolia.etherscan.io/tx/0xac1139c504cd1b626d7b9561e4f9ba79b865ba656fc90a71c9b37bebdd76d6d4) |
| Payee withdrawing funds | [`0xbdd8…513d`](https://sepolia.etherscan.io/tx/0xbdd8aae324aca7f7efce3d862fb86a838b6c33e36545ba51ad498400bed3513d) |

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript, Wagmi, Viem, RainbowKit |
| Backend | Node.js, Express, MongoDB (Mongoose), JWT |
| Identity | Rarimo |
| Orchestration and risk evaluation | Chainlink CRE (SDK and CLI) |
| Smart contracts and testing | Solidity, Foundry |
| Network | Ethereum Sepolia |
| AI | OpenRouter |

## Getting started

> Adjust folder names and scripts to match this repository. [FILL]

**Prerequisites:** Node.js, [Foundry](https://book.getfoundry.sh/), a MongoDB instance, a Sepolia RPC URL, an OpenRouter API key and the Chainlink CRE CLI.

```bash
# Smart contracts
cd contracts          # [FILL folder]
forge build
forge test

# Backend
cd backend            # [FILL folder]
npm install
npm run dev

# Frontend
cd frontend           # [FILL folder]
npm install
npm run dev
```

Create the environment files from the provided examples [FILL] and set the RPC URL, MongoDB URI, JWT secret, OpenRouter key and contract addresses. **Never commit private keys.** That includes the CRE verifier key, any deployer key and any API key.

To simulate a CRE workflow, use the CRE CLI from the `cre` folder [FILL command].

## Testing

```bash
forge test
```

**Result:** 126 of 142 tests pass, with 100,000 fuzz runs. The 16 remaining failures belong to the unfinished arbitration prototype, which is not part of the working system.

## Responsible AI and privacy

| Information | Where it goes |
|---|---|
| Passport data | Verified through the identity-verification process. Raw data is never written on-chain. |
| Rarimo nullifier | Becomes the `identityHash` commitment |
| Wallet addresses | Backend and blockchain |
| AML and risk results | Backend compliance records |
| Platform Core Agreement | Acceptance recorded in `CoreAgreement` and checked by `IdentityRegister` before identity registration. For wallet linking, enforced by the backend. |
| Individual agreements | Document hash and signatures associated with escrow |
| AI explanations | Shown as non-authoritative decision support |

- Decisions are deterministic and versioned.
- Country risk is one input and is not an automatic rejection.
- AI explanations cannot change an outcome.
- Uncertain cases are flagged for manual review.
- Risk factors, policy version and decision results are retained for traceability.

## Limitations

- Sepolia testnet only, with a mock stablecoin. The contracts are unaudited.
- The Platform Core Agreement is a mock document, not a finalized legal agreement.
- CRE workflows were simulated and are not deployed as live workflows.
- One configured verifier key signs attestations, and `IdentityRegister` trusts that single verifier. DON-based signing is future work.
- AML screening uses free educational services behind a swappable interface. Production use needs licensed compliance feeds.
- AI only explains, and the accuracy of its explanations has not been measured. The free OpenRouter tier gives no fixed model and no data-retention guarantees, so it should be used with synthetic data only.
- **No dispute resolution.** `EscrowCore` contains dispute hooks, but no arbitration contract is connected, so disputes cannot be raised. If a payer will not approve a milestone and the payee will not co-sign a cancellation, the remaining funds stay locked.
- EIP-712 signatures prove consent but do not by themselves establish legal enforceability. That depends on jurisdiction and contract requirements. Lexo is not legal advice.
- Lexo charges a 0.3% protocol fee on withdrawals. Platform pricing is not defined.

## Future work

- DON-based signing in place of a single verifier key.
- Sanctions and PEP providers, and licensed compliance-data feeds.
- AI-assisted agreement review that compares parties, milestones and amounts against the proposed escrow.
- A dispute-resolution module. An unaudited concept prototype exists in the repository but is not part of the tested system.
- Support for procurement platforms, marketplaces and real-world-asset agreements.

## License

MIT