# Lexo: Identity-Aware Programmable Legal Agreements
## Demo Video

Watch the Lexo MVP walkthrough:

[![Lexo Demo](https://img.youtube.com/vi/NcG__Xuim_U/maxresdefault.jpg)](https://www.youtube.com/watch?v=NcG__Xuim_U)

**Verified people. Screened wallets. Signed agreements. Milestone escrow. AI explains the decision, and rules make it.**

## At a glance

Lexo connects verified real-world identities to independently risk-screened wallets, helping prevent users from abandoning a flagged wallet and simply starting over.

Verified participants create hashed agreements, sign using EIP-712, and fund milestone-based escrow that releases according to agreement conditions.

Chainlink CRE evaluates identity and wallet risk and produces signed on-chain authorization.

**AI explains identity decisions in plain language. It never makes the decision.**

---

## 1. The Problem

Blockchain addresses do not establish who is behind them. Meanwhile, identity verification, legal agreements, compliance checks, and payments often operate in separate systems.

- **Identity fragmentation:** Users can switch wallets, making it difficult to maintain trust across addresses.
- **Disconnected agreements:** Signed documents are not necessarily connected to the funds executing them.
- **Centralized escrow:** Funds often depend on an intermediary.
- **Fragmented compliance:** AML and country-risk results are disconnected from on-chain authorization.
- **Opaque decisions:** Users may not understand why an application was approved or rejected.

## 2. The Solution

**Verified Identity → Wallet Screening → CRE Risk Evaluation → On-chain Authorization → Agreement → EIP-712 Consent → Escrow → Milestone Settlement**

### Identity verification

Users verify through Rarimo using passport-based verification. A nullifier-derived commitment becomes the `identityHash`. Raw passport data is not written on-chain.

### Risk evaluation with Chainlink CRE

The backend triggers a CRE workflow that evaluates:

- Country risk using the versioned `country-risk-v1` policy.
- Age eligibility.
- Passport validity.
- Independently screened wallet AML risk.

The deterministic rules produce one of three outcomes:

- `APPROVE`
- `MANUAL_REVIEW`
- `REJECT`

### On-chain authorization

For approved cases, the workflow reads the authorized verifier and nonce from `IdentityRegister` and generates an EIP-712 signature.

The application submits the signature to register the identity and root wallet on-chain.

### Multi-wallet trust

One `identityHash` can be associated with multiple wallets.

Every additional wallet is independently screened and evaluated through CRE before linking.

Wallets have three statuses:

- `Active`
- `Inactive`
- `Removed`

Removed wallets cannot authenticate.

### Platform Core Agreement

Lexo includes a mock platform agreement that users review and sign before proceeding with identity registration and wallet linking.

Its signing status is checked through `AgreementRegistry`.

This is a demonstration agreement, not a finalized legal document.

### Individual Agreements and Escrow

Participants create hashed agreements, both parties sign using EIP-712, and the payer funds milestone-based escrow through `EscrowCore`.

---

## 3. AI in Lexo: Explanation, Not Authority

Lexo uses AI to explain identity-registration and wallet-linking outcomes in plain language.

### How it works

1. The deterministic risk engine evaluates identity and wallet information.
2. It produces a structured result containing risk scores, checks, and a decision.
3. AI converts that result into a readable explanation.
4. The user sees the decision alongside its explanation.

### AI boundaries

- AI explains decisions after deterministic evaluation.
- It cannot approve, reject, override rules, or issue authorization signatures.
- If AI is unavailable or returns an invalid response, the structured decision remains valid and a fallback explanation is used.
- AI explanations are decision support, not legal or regulatory determinations.

**Model provider:** OpenRouter  
**Configured model identifier:** `openrouter/free`

### Data handling

The model receives structured risk information, including:

- Risk scores and risk tier.
- Country name and risk level.
- Verification check results.
- Final decision.

It does not receive raw passport data, the user's name, or the identity hash.

### AI Explanation Examples

#### Approved Case — Identity Registration

**Input:**
- Overall score: 18
- Risk tier: LOW
- Country risk: 8 (MODERATE)
- Age: PASS
- Passport: PASS
- AML score: 0

**Configured model:** `openrouter/free`

**Recorded explanation:**

> The identity verification was approved with a low risk score of 18. Although Nepal carries moderate country risk, the positive verification signals support the final APPROVE decision.

**Result:** `APPROVE`

EIP-712 authorization was generated in the corresponding successful CRE simulation.

#### Rejected Case — Additional Wallet Linking

**Input:**
- Wallet risk score: 100/100
- Risk tier: HIGH
- AML score: 90/100
- Sanctions indicator: TRUE
- Fraud indicator: TRUE
- Mixer exposure: TRUE
- High-risk wallet indicator: TRUE

**Configured model:** `openrouter/free`  
**Actual responding model:** `nvidia/nemotron-3.5-super-vl:free`

**Explanation:**

> The wallet addition was rejected with a high risk score of 100/100. The decision was based on a sanctions exposure indicator, a fraud risk indicator, mixer exposure, and a high-risk wallet indicator. The wallet also received an AML score of 90/100.

**Result:** `REJECT`

No attestation or on-chain authorization signature was generated.

#### Additional Evidence — Identity Registration Rejection

**Input:**
- Identity risk score: 100/100
- Risk tier: HIGH
- Country risk score: 8 (MODERATE)
- AML score: 90
- Age eligibility: FAIL
- Passport validity: FAIL

**Configured model:** `openrouter/free`  
**Actual responding model:** `nvidia/nemotron-3.5-super-vl:free`

**Explanation:**

> The identity verification was rejected with a high risk score of 100/100. This decision was based on the applicant not meeting the configured age eligibility requirement and the passport being recorded as expired.

**Result:** `REJECT`

No identity attestation was generated.

**The deterministic risk engine makes the decision. AI only explains it.**

---

## 4. Technical Execution

### Deployed Contracts — Ethereum Sepolia

| Component | Status | Address |
|---|---|---|
| IdentityRegister | Deployed | `0x7c827d0293b7ed891ed589542d1d11450590812d` |
| AgreementRegistry | Deployed | `0x0BbDA7e77Fcd74cB21Bc0368628f061e89faC148` |
| Platform Core Agreement | Deployed | `0x7b283E9B12f35F5373CDE81Ca0C4024d0F417bE8` |
| EscrowCore | Deployed | `0xC8eB82Ed3148d5E7C6E9dE3F49EB2C14977508B7` |
| MockUSDT (faucet token) | Deployed | `0x888dd7Bc9f61E0060D792ff6a187FD475dd9970A` |

### Implementation Evidence

| Component | Status | Evidence |
|---|---|---|
| CRE identity registration | Successfully simulated | 2026-10-30 18:43:04 UTC |
| CRE additional wallet linking | Successfully simulated | 2026-10-30 18:49:09 UTC |
| On-chain identity registration | Successful | Transaction hash below |
| On-chain wallet linking | Successful | Transaction hash below |
| Foundry tests | Passed | 142 tests, 126 passed, 100,000 fuzz runs |
| End-to-end agreement flow | Demonstrated | Demo video |

**Testing note:** The remaining failing tests relate to the arbitration system, which is not optimized and is intended for future expansion. Arbitration is not part of the implemented agreement flow.

### On-chain Identity Transactions

| Operation | Transaction Hash |
|---|---|
| Identity registration | `0x5cf4f305b948c2132b2581e4d5bd80714ede86d009ed020c768020efbb8503a2` |
| Additional wallet linking | `0xf29574107fcfc2028993eebfbcce9b9b647424b548cc15f628c5d52dab37c265` |

### CRE Simulation Results

**Network:** Ethereum Sepolia  
**Chain ID:** `11155111`

#### Identity Registration

- Execution: `2026-10-30T18:43:04Z`
- Binary hash: `4601fdddccd67b1b93ed26b5340ca9ac1b3bc563e7cb729288b692725ec4609c`
- Config hash: `98366a9ad81a0621afcef36927781c4fbfd2f77aac5f40e40f3722e81b07b5cf`

#### Additional Wallet Linking

- Execution: `2026-10-30T18:49:09Z`
- Binary hash: `4fd85ad3ba0c316396b52341b1299cc038263cacfedcf31957ed86fd3a126f20`
- Config hash: `98366a9ad81a0621afcef36927781c4fbfd2f77aac5f40e40f3722e81b07b5cf`

#### Evaluation Summary

| Signal | Identity Registration | Wallet Linking |
|---|---|---|
| Decision | APPROVE | APPROVE |
| Overall score / tier | 18 / LOW | 18 / LOW |
| Country risk | 8 (MODERATE) | 8 (MODERATE) |
| AML | SCORED, 0 | Evaluated independently |
| Authorized verifier | `0xb745E488D1F2BECb5DcF0404BCDc325093B62F59` | Same |
| Result | EIP-712 signature generated | EIP-712 signature generated (nonce 1) |

*These are successful CRE simulations, not evidence of live deployed CRE workflows.*

### Smart Contract Security and Execution

The implemented contracts include:

- `IdentityRegister` checks platform agreement acceptance through the agreement registry before identity registration.
- The Platform Core Agreement is a platform-level acceptance requirement, separate from individual payer-payee agreements.
- Milestones release only after `AgreementRegistry.haveBothSigned` returns true for the individual agreement.
- Cancelling an active agreement requires EIP-712 signatures from both parties, with a nonce and deadline.
- Funds use a pull-withdrawal pattern with reentrancy protection.
- Only verified wallets can perform restricted escrow operations.
- `IdentityRegister` uses nonce-based EIP-712 verifier authorization and enforces a maximum number of wallets per identity.

---

## 5. Practical Legal and Business Utility

### Who It's For

Lexo is designed for platforms and businesses coordinating agreements and payments between parties who may not know each other.

- Freelance marketplaces.
- B2B service platforms.
- Procurement platforms.
- Contractor-payment workflows.

### The Problem It Addresses

A platform may use separate KYC, e-signature, and escrow providers without connecting their records.

It can become difficult to establish who agreed to what, whether participants were screened, and whether payment followed the agreed conditions.

### Worked Example: A $1,000 Website Project

| Milestone | Payment |
|---|---:|
| Design completion | $300 |
| Development completion | $300 |
| Final delivery | $400 |
| **Total** | **$1,000** |

1. The client and developer verify their identities and wallets.
2. The client creates an agreement, and its document hash is connected to the escrow.
3. Both parties sign using EIP-712, and the client funds the escrow.
4. Milestone payments are released according to the agreement's approval conditions.
5. The developer withdraws the released funds.

### Sepolia Transaction Evidence

| Transaction | Hash |
|---|---|
| Agreement creation and escrow funding | `0x8b71e3cab7f30b0ad863c66517998882904d2e3358642712f5bb2256f8cc52e3` |
| Payee agreement request | `0x235eb04e62474e0711000cb131c049ae2f7bab4f755be135b95d27c5c21b5d30` |
| Payer acceptance of payee agreement | `0xaad3fd79efece7cb7743d8ca541d586e73e8188a5d964e4b395ffa6d74a1b4b8` |
| Payee signing remaining agreements (Transaction 1) | `0x9f9453acaf07e5f7af8572f7de5b63225831f115dc01beb727e7777a8d3c08ce` |
| Payee signing remaining agreements (Transaction 2) | `0x782d1515623e04ba0ff7e3c5be289d7c30c97ceffc92a3a2a7058841dd1a0a5d` |
| Payer approving and releasing milestone | `0xac1139c504cd1b626d7b9561e4fb9a79b865ba656fc90a71c9b37bebdd76d6d4` |
| Payee withdrawing funds | `0xbdd8aae324aca7f7efce3d862fb86a838b6c33e36545ba51ad498400bed3513` |

### What Lexo Changes

- Participants are verified people rather than anonymous addresses.
- Each wallet is independently screened.
- Agreement document hashes, signatures, and escrow funds are connected on-chain.
- Compliance decisions retain their risk factors and policy version.
- Escrow does not require a centralized custodian.

### Business Model

`EscrowCore` charges a **0.3% protocol fee on withdrawals**, paid to a configurable fee recipient.

Platform pricing has not yet been defined.

### Legal Enforceability

Lexo provides infrastructure for agreements, cryptographic consent, and programmable settlement.

Blockchain execution alone does not establish legal enforceability. That depends on jurisdiction, contract requirements, and valid consent.

Lexo is not legal advice or a substitute for jurisdiction-specific legal review.

---

## 6. Responsible AI and Privacy

| Information | Where It Goes |
|---|---|
| Passport data | Verified through the identity-verification process; raw data is not written on-chain |
| Rarimo nullifier | Becomes the `identityHash` commitment |
| Wallet addresses | Backend and blockchain |
| AML and risk results | Backend compliance records |
| Platform Core Agreement | Mock platform terms; signing status checked through `AgreementRegistry` |
| Individual agreements | Agreement document hash and signatures associated with escrow |
| AI explanations | Presented as non-authoritative decision support |

### Responsible AI Principles

- Decisions are deterministic and versioned.
- Country risk is one input and is not an automatic rejection.
- AI explanations cannot change the outcome.
- Uncertain cases are flagged for manual review.
- Risk factors, policy version, and decision results are retained for traceability.

---

## 7. Honest Limitations

- The application currently runs on Sepolia testnet with a mock stablecoin.
- The Platform Core Agreement is a mock demonstration document, not a finalized legal agreement.
- CRE workflows were successfully simulated but are not deployed as live workflows.
- The system uses one configured verifier key, and `IdentityRegister` trusts one authorized verifier. DON-based signing is future work.
- AML screening uses educational/free services behind a swappable interface. Production use requires appropriate licensed compliance feeds.
- AI provides explanations only. Its accuracy has not been formally measured.
- AI explanations currently use the free OpenRouter tier through the `openrouter/free` router alias. The underlying model can vary between requests, and there are no fixed model or data-retention guarantees. The integration should be restricted to synthetic data until an appropriate production provider and data-processing agreement are established.
- Dispute resolution is not implemented in this build. `EscrowCore` contains dispute hooks, but no arbitration contract is connected, so disputes cannot currently be raised.

---

## 8. Future Work

- DON-based signing instead of a single verifier key.
- Sanctions, PEP, and licensed compliance-data providers.
- AI-assisted agreement review to compare parties, milestones, and amounts against the proposed escrow.
- A dispute-resolution module. An unaudited concept prototype exists in the repository but is not part of the tested system.
- Support for procurement platforms, marketplaces, and real-world-asset agreements.

---

## 9. Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript, Wagmi, Viem, RainbowKit |
| Backend | Node.js, Express, MongoDB, JWT |
| Identity | Rarimo |
| Automation and Risk Evaluation | Chainlink CRE (SDK and CLI) |
| Smart Contracts and Testing | Solidity, Foundry |
| Blockchain | Ethereum Sepolia |
| AI | OpenRouter |

---

## 10. Project Summary

Lexo connects real-world identity verification, independent wallet screening, deterministic compliance evaluation, cryptographic agreement signing, and milestone-based escrow into one programmable agreement workflow.

Chainlink CRE coordinates risk evaluation and verifier authorization. Smart contracts enforce the resulting authorization and agreement conditions. AI makes the decisions understandable without becoming the decision-maker.

**Lexo: Trust the identity. Screen the wallet. Sign the agreement. Execute the terms.**