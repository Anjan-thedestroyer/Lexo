# Lexo – Chainlink CRE Risk Assessment & Identity Attestation
## Demo Video

Watch the Lexo MVP walkthrough:

[![Lexo Demo](https://img.youtube.com/vi/NcG__Xuim_U/maxresdefault.jpg)](https://www.youtube.com/watch?v=NcG__Xuim_U)

Lexo uses **Chainlink Runtime Environment (CRE)** to coordinate identity verification, wallet risk assessment, deterministic risk evaluation, AI-generated explanations, and cryptographic identity attestations.

The system connects verified identities to independently screened wallets, helping prevent users from bypassing wallet-level risk checks simply by adding another wallet.

## 1. Architecture Overview

The CRE integration consists of five main components:

- **Country Risk Engine:** Evaluates jurisdictional risk using a versioned country-risk dataset.
- **Identity Risk Engine:** Evaluates identity verification signals, including age eligibility, passport validity, and country risk.
- **Wallet Risk Engine:** Evaluates AML and wallet-related risk indicators.
- **AI Explanation Service:** Uses OpenRouter to generate human-readable explanations of deterministic decisions.
- **EIP-712 Attestation Service:** Generates cryptographically signed identity registration and wallet-linking attestations.

### Verification Flow

```text
Identity / Wallet Verification Request
                |
                v
       Chainlink CRE HTTP Trigger
                |
                v
       Input Validation & Normalization
                |
                v
        Deterministic Risk Engine
                |
                v
         Risk Score & Decision
                |
                v
       AI Explanation (OpenRouter)
                |
                v
       Approval / Rejection Check
                |
          +-----+------+
          |            |
        Reject       Approve
          |            |
          v            v
     Return Result   Read On-chain
                     Nonce & Verifier
                          |
                          v
                   Verify CRE Signer
                          |
                          v
                    EIP-712 Signing
                          |
                          v
                  Return Attestation
                          |
                          v
                 Backend / Contract
```

## 2. Country Risk Assessment

Lexo maintains a versioned country-risk dataset using `countryRisk.json`.

Each country entry contains:

- Country code and name.
- Aggregated risk score.
- Risk classification.
- Individual risk factors and explanations.
- Supporting sources and source URLs.
- Policy version and last-updated information.

The `getCountryRisk()` utility retrieves country risk information using normalized country codes.

Supported classifications:

- LOW
- MODERATE
- HIGH
- VERY_HIGH

Country risk contributes to the overall risk score but does not automatically reject an individual.

The implementation also accounts for overlapping jurisdictional classifications to avoid unnecessary double-counting of correlated risk sources.

## 3. Deterministic Risk Engine

The deterministic rule engine is responsible for calculating risk scores and making verification decisions.

AI does not determine the final outcome.

### Identity Risk Assessment

The identity engine evaluates:

| Signal | Risk contribution |
|---|---:|
| Base score | 10 |
| Age eligibility failure | +90 |
| Expired passport | +80 |
| Country risk | Additive |

### Wallet Risk Assessment

The wallet engine evaluates:

| Signal | Risk contribution |
|---|---:|
| Base score | 10 |
| Sanctions exposure | +90 |
| Fraud indicator | +80 |
| High-risk wallet | +60 |
| Mixer exposure | +60 |
| PEP indicator | +30 |
| Country risk | Additive |
| Wallet risk >= 70 | +40 |
| Transaction risk >= 70 | +40 |
| AML score >= 70 | +40 |

The final score is capped at 100.

### Risk Classification

| Score | Risk tier |
|---|---|
| 0–39 | LOW |
| 40–69 | MEDIUM |
| 70–100 | HIGH |

The current decision engine approves LOW and MEDIUM risk results and rejects HIGH risk results.

## 4. AML Integration

Wallet screening results are incorporated into the verification process.

The implementation supports:

- Sanctions indicators.
- Politically Exposed Person (PEP) indicators.
- Fraud indicators.
- Mixer exposure.
- High-risk wallet indicators.
- Wallet risk.
- Transaction risk.
- AML scores.

For identity registration, AML status is normalized into:

- `SCORED`
- `UNKNOWN`
- `INCONCLUSIVE`

When a scored AML result is available, an additional penalty is applied according to its risk classification.

| AML risk level | Additional penalty |
|---|---:|
| LOW | 0 |
| MODERATE / MEDIUM | 30 |
| HIGH | 70 |
| VERY_HIGH | 90 |

Unknown or inconclusive results do not receive a scored-risk penalty in the current implementation.

The AML penalty is added to the identity risk score, with the combined score capped at 100.

## 5. AI-Powered Decision Explanations

Lexo integrates OpenRouter to generate human-readable explanations for identity and wallet verification decisions.

The AI receives:

- Verification type.
- Deterministic risk score and tier.
- Final verification decision.
- Relevant identity or wallet signals.
- Nationality and country-risk context.

The AI is strictly an explanation layer.

It cannot:
- Recalculate risk scores.
- Change risk classifications.
- Override approval or rejection decisions.
- Invent verification evidence.
- Treat country risk as proof of individual wrongdoing.

### Fallback Mechanism

The project uses a free-tier LLM, so responses may occasionally be unavailable, incomplete, or unreliable.

Lexo implements a deterministic fallback explanation mechanism.

If the API key is unavailable, the request fails, or the model returns an empty response, the system generates an explanation using predefined rules and the existing verification signals.

This allows the verification workflow to continue without making its security decision dependent on LLM availability.

## 6. Chainlink CRE Workflows

Lexo currently implements two independent CRE HTTP-triggered workflows.

### A. Identity Registration

**Workflow:** `workflows/registerIdentity`

The identity registration workflow:

1. Receives identity verification data, including wallet address, identity hash, nationality, Rarimo proof, age eligibility, and passport validity.
2. Validates and normalizes the request.
3. Evaluates identity risk using the deterministic rule engine.
4. Retrieves jurisdictional risk information.
5. Normalizes AML screening results and calculates the additional AML penalty.
6. Calculates the combined risk score and final decision.
7. Requests an AI-generated explanation.
8. Returns a rejection result without generating an attestation when approval criteria are not met.
9. Resolves the Sepolia network and reads the wallet's on-chain nonce.
10. Reads the authorized verifier address from the IdentityRegister contract.
11. Verifies that the CRE signing account matches the on-chain verifier.
12. Generates a typed-data `RegisterIdentity` signature.
13. Returns the signed attestation to the caller.

### B. Wallet Addition

**Workflow:** `workflows/addWallet`

The wallet addition workflow independently evaluates a wallet before associating it with an existing identity.

The workflow:

1. Receives the verification ID, user ID, wallet address, identity hash, and AML screening data.
2. Validates the wallet address and identity hash.
3. Normalizes wallet risk signals.
4. Evaluates wallet risk using the deterministic rule engine.
5. Produces an approval or rejection decision.
6. Generates an AI explanation with fallback support.
7. Returns a rejection result without generating an attestation when the wallet fails the configured approval criteria.
8. Resolves the configured EVM network.
9. Reads the new wallet's nonce and the contract's authorized verifier.
10. Verifies the CRE signing account against the on-chain verifier.
11. Generates a typed-data `LinkWallet` signature.
12. Returns the signed wallet-linking attestation.

Both workflows use Chainlink CRE's HTTP trigger and EVM capabilities.

## 7. EIP-712 Attestations

Lexo uses EIP-712 typed-data signatures to authorize identity registration and wallet linking.

Both attestation types use the following message structure:

| Field | Type |
|---|---|
| wallet | address |
| identityHash | bytes32 |
| nonce | uint256 |
| deadline | uint256 |

### Identity Registration

Primary type: `RegisterIdentity`

### Wallet Addition

Primary type: `LinkWallet`

### Signing Domain

Both workflows use the domain:

- Name: `Lexo IdentityRegister`
- Version: `1`
- Chain ID: `11155111` (Sepolia)
- Verifying contract: IdentityRegister contract

Before signing, CRE reads the current nonce and authorized verifier from the deployed contract.

The signing key is loaded from CRE secrets. Its derived address must match the on-chain verifier address.

This ensures that only the configured verifier can produce attestations accepted by the contract.

The workflow returns the signature, nonce, deadline, contract address, chain ID, verifier address, and associated verification information.

The actual registration or wallet-linking transaction is handled separately by the application.

## 8. Simulation Evidence
**Also look at evidence dir**

Both workflows were successfully compiled and executed using Chainlink CRE workflow simulation.

### Identity Registration Simulation

**Input:**
- Network: Ethereum Sepolia
- Nationality: Nepal (`NP`)
- Age eligibility: Passed
- Passport: Valid
- AML status: UNKNOWN
- AML score: 0

**Results:**

| Metric | Result |
|---|---|
| Country risk score | 8 |
| Country risk level | MODERATE |
| Identity risk score | 18/100 |
| AML penalty | 0 |
| Combined score | 18/100 |
| Combined tier | LOW |
| Decision | APPROVE |

The AI successfully generated an explanation describing the approval decision and contextual country-risk factors.

The workflow successfully:
- Read the on-chain nonce.
- Retrieved the authorized verifier.
- Matched the CRE signing address with the contract verifier.
- Generated the EIP-712 `RegisterIdentity` signature.
- Returned the registration attestation.

### Wallet Addition Simulation

**Input:**
- Network: Ethereum Sepolia
- AML score: 0
- Sanctions: False
- PEP: False
- Fraud: False
- Mixer exposure: False
- High-risk wallet: False

**Results:**

| Metric | Result |
|---|---|
| Base score | 10 |
| Wallet risk score | 10/100 |
| Risk tier | LOW |
| Decision | APPROVE |

The OpenRouter request returned HTTP 200 but produced no usable explanation because the response reached its token limit.

The fallback mechanism successfully generated the explanation.

The workflow subsequently:
- Read the new wallet's nonce.
- Retrieved the on-chain verifier.
- Verified the CRE signing account.
- Generated the EIP-712 `LinkWallet` signature.
- Returned the wallet-linking attestation.

**Simulation status:** Both workflows successfully generated their expected signed attestation outputs. These simulations demonstrate workflow execution and signature generation, not completed on-chain registration transactions.

## 9. Technology Stack

| Technology | Purpose |
|---|---|
| Chainlink CRE SDK | Workflow execution and orchestration |
| TypeScript | Workflow and risk-engine implementation |
| Viem | EVM interaction and typed-data signing |
| EIP-712 | Cryptographic attestations |
| OpenRouter | AI-generated explanations |
| JSON | Versioned country-risk dataset |
| Ethereum Sepolia | Test network |
| Rarimo | Identity verification and proof integration |

## 10. Configuration

The workflows require the following CRE secrets:

| Secret | Purpose |
|---|---|
| `CRE_VERIFIER_PRIVATE_KEY` | Signs EIP-712 attestations |
| `OPENROUTER_API_KEY` | Generates AI explanations |

The workflow configuration also requires:

- EVM chain selector.
- IdentityRegister contract address.
- Correctly configured on-chain verifier.
- Appropriate CRE staging or deployment settings.

Never commit private keys or API secrets to the repository.

## 11. Running Simulations

Compile and simulate the identity registration workflow:

```bash
cre workflow simulate workflows/registerIdentity \
  --non-interactive \
  --trigger-index 0 \
  --http-payload '<IDENTITY_JSON_PAYLOAD>' \
  --target staging-settings
```

Compile and simulate the wallet addition workflow:

```bash
cre workflow simulate workflows/addWallet \
  --non-interactive \
  --trigger-index 0 \
  --http-payload '<WALLET_JSON_PAYLOAD>' \
  --target staging-settings
```

Use the required workflow payload structures and configure CRE secrets before simulation.

## 12. Security and Design Principles

Lexo follows several important design principles:

- **Deterministic decisions:** Approval and rejection are determined by predefined risk rules, not AI output.
- **Independent wallet screening:** Adding another wallet requires a separate risk assessment.
- **Identity-linked wallets:** Wallet attestations reference the existing identity hash.
- **Replay protection:** On-chain nonces are included in EIP-712 signatures.
- **Verifier validation:** CRE verifies its signing address against the contract's authorized verifier.
- **Contextual country risk:** Jurisdictional risk contributes to assessment without automatically determining individual wrongdoing.
- **Graceful AI failure:** Fallback explanations allow verification to continue when the LLM is unavailable.

## 13. Project Objective

Lexo aims to connect real-world identity verification, wallet-level AML screening, programmable legal agreements, and milestone-based escrow into one verifiable workflow.

By combining Chainlink CRE, deterministic risk assessment, AI-generated explanations, and EIP-712 attestations, Lexo provides an infrastructure for identity-aware participation in blockchain-based agreements.

**Verified identities. Screened wallets. Signed agreements. Programmable escrow.**