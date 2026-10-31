# Lexo Frontend

**Identity-Aware Programmable Legal Agreements**

Lexo is a platform for creating identity-aware digital agreements with verified participants, independently screened wallets, cryptographic signatures, and milestone-based escrow.

This repository contains the frontend application, providing the interface for identity verification, wallet management, agreement creation, and escrow interactions.

## Features

- **Identity Verification:** Integrates with Rarimo for passport-based zero-knowledge identity verification.
- **Wallet Connection:** Connect and manage wallets using RainbowKit and Wagmi.
- **Risk Assessment:** Displays identity and wallet risk assessment results processed through Chainlink CRE.
- **Identity Registration:** Supports on-chain identity registration using cryptographic attestations and wallet signatures.
- **Agreement Management:** Create, view, and sign digital agreements.
- **Milestone Escrow:** Create milestone-based escrow linked to agreements, with document hashes recorded on-chain while the original documents remain stored off-chain.
- **Dashboard:** Access identity status, connected wallets, agreements, and escrow information.

## Tech Stack

| Technology | Purpose |
|---|---|
| Next.js 16 | Frontend framework |
| React 19 | UI development |
| TypeScript | Type safety |
| Tailwind CSS 4 | Styling |
| RainbowKit | Wallet connection interface |
| Wagmi | Ethereum wallet and contract interactions |
| Viem | Ethereum utilities and contract integration |
| TanStack Query | Data fetching and caching |
| Axios | Backend API communication |
| Lucide React | Icons |

## Project Structure

```text
src/
├── app/
│   ├── login/
│   ├── register/
│   ├── dashboard/
│   ├── identity/
│   ├── wallets/
│   └── ...
├── components/
├── lib/
│   ├── axios.ts
│   └── wagmi.ts
├── abi/
└── ...
```

The application uses the Next.js App Router. Wallet configuration and application providers are centralized to keep blockchain interactions consistent across the frontend.

## Getting Started

### Prerequisites

- Node.js
- npm
- A Web3 wallet, such as MetaMask
- Access to the Lexo backend API

### Installation

Clone the repository:

```bash
git clone <YOUR_REPOSITORY_URL>
cd Lexo/frontend
```

Install dependencies:

```bash
npm install
```

### Environment Configuration

Create a `.env.local` file in the frontend directory.

Configure the contract addresses and other environment variables required by the application:

```env
NEXT_PUBLIC_CORE_AGREEMENT_ADDRESS=
NEXT_PUBLIC_IDENTITY_REGISTER_ADDRESS=
NEXT_PUBLIC_ESCROW_ADDRESS=
NEXT_PUBLIC_TOKEN_DECIMALS=6
```

Configure the backend API endpoint in the Axios configuration.

Use the deployed contract addresses corresponding to the selected network. The current development environment targets **Ethereum Sepolia**.

### Run Locally

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Production Build

Build the application:

```bash
npm run build
```

Start the production server:

```bash
npm run start
```

Run lint checks:

```bash
npm run lint
```

## Application Workflow

1. **Authentication:** Users register or log in to access Lexo.
2. **Identity Verification:** Users complete passport-based verification through Rarimo.
3. **Risk Assessment:** Chainlink CRE orchestrates identity and wallet risk assessment, producing a decision and supporting explanation.
4. **Identity Registration:** Approved verification results are used to generate cryptographic attestations for on-chain identity registration.
5. **Wallet Management:** Users can link additional wallets to their verified identity, subject to the platform's verification and screening requirements.
6. **Agreement Creation:** Users create agreements and define their terms and participants.
7. **Milestone Escrow:** Users configure milestone amounts and create escrow linked to an agreement.

## Blockchain Integration

The frontend interacts with Ethereum smart contracts through Wagmi and Viem.

Key integrations include:

- **IdentityRegister:** On-chain identity and wallet registration.
- **CoreAgreement:** Agreement-related signing and verification.
- **Escrow:** Milestone-based escrow creation and interactions.

Agreement documents are stored off-chain. Their cryptographic hashes are submitted on-chain to provide a verifiable reference to the original documents.

## Integrations

- **Rarimo:** Passport-based zero-knowledge identity verification.
- **Chainlink CRE:** Orchestrates identity and wallet risk assessment workflows.
- **Ethereum:** Provides on-chain identity registration and escrow execution.

## Notes

Lexo is currently an MVP developed to demonstrate the integration of identity verification, risk assessment, cryptographic agreements, and programmable milestone escrow.

Some demonstration flows may use mock documents and mock tokens. These are intended for testing and demonstration purposes.