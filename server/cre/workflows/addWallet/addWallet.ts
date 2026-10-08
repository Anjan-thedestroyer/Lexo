// import {
//   cre,
//   Runner,
//   decodeJson,
//   encodeCallMsg,
//   getNetwork,
//   bytesToHex,
//   LAST_FINALIZED_BLOCK_NUMBER,
//   type HTTPPayload,
//   type Runtime,
// } from "@chainlink/cre-sdk";

// import {
//   decodeFunctionResult,
//   encodeFunctionData,
//   getAddress,
//   isAddress,
//   isHex,
//   type Address,
//   type Hex,
// } from "viem";

// import { privateKeyToAccount } from "viem/accounts";

// import {
//   normalizeWalletSignals,
//   runWalletRuleEngine,
//   decisionEngine,
// } from "../../utils/rules.engine";

// import { fetchLLMExplanation } from "../../utils/llm.service";

// // ============================================================
// // CONFIG
// // ============================================================

// type Config = {
//   evm: {
//     chainSelectorName: string;
//     identityRegisterAddress: string;
//   };
// };

// // ============================================================
// // REQUEST
// // ============================================================

// type WalletAdditionRequest = {
//   verificationId: string;
//   userId: string;

//   // New wallet
//   wallet: string;

//   // Existing Rarimo nullifier
//   identityHash: string;

//   // AML result from backend
//   walletData: {
//     amlScore: number | null;
//     amlData: Record<string, any>;
//   };
// };

// // ============================================================
// // ABI
// // ============================================================

// const IDENTITY_REGISTER_ABI = [
//   {
//     type: "function",
//     name: "nonces",
//     stateMutability: "view",
//     inputs: [{ name: "wallet", type: "address" }],
//     outputs: [{ name: "", type: "uint256" }],
//   },
//   {
//     type: "function",
//     name: "verifier",
//     stateMutability: "view",
//     inputs: [],
//     outputs: [{ name: "", type: "address" }],
//   },
// ] as const;

// // ============================================================
// // EIP-712 TYPES
// // ============================================================
// //
// // Must match Solidity:
// //
// // LinkWallet(
// //   address wallet,
// //   bytes32 identityHash,
// //   uint256 nonce,
// //   uint256 deadline
// // )
// //
// // ============================================================

// const EIP712_TYPES = {
//   LinkWallet: [
//     {
//       name: "wallet",
//       type: "address",
//     },
//     {
//       name: "identityHash",
//       type: "bytes32",
//     },
//     {
//       name: "nonce",
//       type: "uint256",
//     },
//     {
//       name: "deadline",
//       type: "uint256",
//     },
//   ],
// } as const;

// // ============================================================
// // HELPERS
// // ============================================================

// function assertBytes32(value: string, field: string): Hex {
//   if (!isHex(value) || value.length !== 66) {
//     throw new Error(`${field} must be a valid bytes32 value`);
//   }

//   return value as Hex;
// }

// function decodeNonce(data: Uint8Array): bigint {
//   const raw = bytesToHex(data);

//   return decodeFunctionResult({
//     abi: IDENTITY_REGISTER_ABI,
//     functionName: "nonces",
//     data: raw,
//   });
// }

// function decodeVerifier(data: Uint8Array): Address {
//   const raw = bytesToHex(data);

//   const verifier = decodeFunctionResult({
//     abi: IDENTITY_REGISTER_ABI,
//     functionName: "verifier",
//     data: raw,
//   });

//   return getAddress(verifier);
// }

// // ============================================================
// // HTTP HANDLER
// // ============================================================

// const onHttpTrigger = async (
//   runtime: Runtime<Config>,
//   payload: HTTPPayload,
// ): Promise<string> => {
//   runtime.log("[CRE] Wallet addition request received");

//   try {
//     // ========================================================
//     // 1. DECODE PAYLOAD
//     // ========================================================

//     if (!payload.input || payload.input.length === 0) {
//       throw new Error("Empty HTTP payload received");
//     }

//     const request = decodeJson(
//       payload.input,
//     ) as WalletAdditionRequest;

//     const {
//       verificationId,
//       userId,
//       wallet,
//       identityHash,
//       walletData,
//     } = request;

//     // ========================================================
//     // 2. VALIDATE
//     // ========================================================

//     if (
//       !verificationId ||
//       !userId ||
//       !wallet ||
//       !identityHash ||
//       !walletData
//     ) {
//       throw new Error("Missing required payload properties");
//     }

//     if (!isAddress(wallet)) {
//       throw new Error(`Invalid EVM wallet address: ${wallet}`);
//     }

//     const normalizedWallet = getAddress(wallet);
//     const normalizedIdentityHash = assertBytes32(
//       identityHash,
//       "identityHash",
//     );

//     runtime.log(`[CRE] Evaluating wallet ${normalizedWallet}`);

//     runtime.log(`[CRE] Verification ID: ${verificationId}`);
//     runtime.log(`[CRE] User ID: ${userId}`);
//     runtime.log(`[CRE] Identity hash: ${normalizedIdentityHash}`);

//     // ========================================================
//     // 3. NORMALIZE AML SIGNALS
//     // ========================================================

//     const signals = normalizeWalletSignals({
//       amlScore: walletData.amlScore,
//       ...walletData.amlData,
//     });

//     runtime.log("[CRE] WALLET SIGNALS");
//     runtime.log(`Nationality: ${signals.nationality}`);
//     runtime.log(`AML score: ${signals.amlScore}`);
//     runtime.log(`Sanctions: ${signals.sanctions}`);
//     runtime.log(`PEP: ${signals.pep}`);
//     runtime.log(`Fraud: ${signals.fraud}`);
//     runtime.log(`Wallet risk: ${signals.walletRisk}`);
//     runtime.log(`Mixer exposure: ${signals.mixerExposure}`);
//     runtime.log(`High-risk wallet: ${signals.highRiskWallet}`);
//     runtime.log(`Transaction risk: ${signals.transactionRisk}`);
//     runtime.log(`Country risk: ${signals.countryRisk.score}`);

//     // ========================================================
//     // 4. WALLET RULE ENGINE
//     // ========================================================

//     const riskResult = runWalletRuleEngine(signals);

//     runtime.log("[CRE] WALLET RULE ENGINE RESULT");
//     runtime.log(`Wallet risk score: ${riskResult.score}/100`);
//     runtime.log(`Wallet tier: ${riskResult.tier}`);

//     // ========================================================
//     // 5. DECISION
//     // ========================================================

//     const decision = decisionEngine(riskResult.tier);

//     runtime.log(`[CRE] Wallet decision: ${decision}`);

//     // ========================================================
//     // 6. LLM EXPLANATION
//     // ========================================================

//     const explanation = fetchLLMExplanation(runtime, {
//       type: "ADD_WALLET",
//       wallet: normalizedWallet,
//       riskScore: riskResult.score,
//       riskTier: riskResult.tier,
//       decision,
//       signals,
//       nationality: signals.nationality,
//       countryRisk: signals.countryRisk,
//     });

//     runtime.log(`[CRE] LLM explanation: ${explanation}`);

//     // ========================================================
//     // 7. REJECTION
//     // ========================================================
    

//     if (decision === "REJECT") {
//       runtime.log(
//         "[CRE] Wallet rejected. No attestation generated.",
//       );

//       return JSON.stringify({
//         approved: false,
//         decision,
//         score: riskResult.score,
//         tier: riskResult.tier,
//         reason: explanation,
//         wallet: normalizedWallet,
//         identityHash: normalizedIdentityHash,
//         verificationId,
//         userId,
//         countryRisk: signals.countryRisk,
//         nonce: null,
//         deadline: null,
//         signature: null,
//         contract: runtime.config.evm.identityRegisterAddress,
//         chainId: null,
//         verifier: null,
//       });
//     }

//     // ========================================================
//     // 8. TARGET NETWORK
//     // ========================================================

//     const network = getNetwork({
//       chainFamily: "evm",
//       chainSelectorName:
//         runtime.config.evm.chainSelectorName,
//       isTestnet: true,
//     });

//     if (!network) {
//       throw new Error(
//         `Target EVM network selection failed: ${runtime.config.evm.chainSelectorName}`,
//       );
//     }

//     runtime.log(
//       `[CRE] Network chain ID: ${network.chainId}`,
//     );

//     runtime.log(
//       `[CRE] Network selector: ${network.chainSelector.selector}`,
//     );

//     const evmClient = new cre.capabilities.EVMClient(
//       network.chainSelector.selector,
//     );

//     runtime.log("[CRE] EVMClient initialized");

//     // ========================================================
//     // 9. GET NONCE FOR NEW WALLET
//     // ========================================================

//     runtime.log("[CRE] Reading new wallet nonce...");

//     const nonceCallData = encodeFunctionData({
//       abi: IDENTITY_REGISTER_ABI,
//       functionName: "nonces",
//       args: [normalizedWallet],
//     });

//     runtime.log(
//       `[CRE] Nonce calldata: ${nonceCallData}`,
//     );

//     const nonceResult = evmClient
//       .callContract(runtime, {
//         call: encodeCallMsg({
//           from: normalizedWallet,
//           to: getAddress(
//             runtime.config.evm.identityRegisterAddress,
//           ),
//           data: nonceCallData,
//         }),
//         blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
//       })
//       .result();

//     if (!nonceResult.data) {
//       throw new Error(
//         "EVM call for 'nonces' returned empty byte stream",
//       );
//     }

//     const nonce = decodeNonce(nonceResult.data);

//     runtime.log(
//       `[CRE] New wallet nonce: ${nonce.toString()}`,
//     );

//     // ========================================================
//     // 10. READ ON-CHAIN VERIFIER
//     // ========================================================

//     runtime.log("[CRE] Reading on-chain verifier...");

//     const verifierCallData = encodeFunctionData({
//       abi: IDENTITY_REGISTER_ABI,
//       functionName: "verifier",
//     });

//     const verifierResult = evmClient
//       .callContract(runtime, {
//         call: encodeCallMsg({
//           from: normalizedWallet,
//           to: getAddress(
//             runtime.config.evm.identityRegisterAddress,
//           ),
//           data: verifierCallData,
//         }),
//         blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
//       })
//       .result();

//     if (!verifierResult.data) {
//       throw new Error(
//         "EVM call for 'verifier' returned empty byte stream",
//       );
//     }

//     const onChainVerifier = decodeVerifier(
//       verifierResult.data,
//     );

//     runtime.log(
//       `[CRE] On-chain verifier: ${onChainVerifier}`,
//     );

//     // ========================================================
//     // 11. DEADLINE
//     // ========================================================

//     const blockTimestamp = Math.floor(
//       runtime.now().getTime() / 1000,
//     );

//     const roundedTimestamp =
//       Math.floor(blockTimestamp / 300) * 300;

//     const deadline = roundedTimestamp + 3600;

//     runtime.log(
//       `[CRE] Attestation deadline: ${deadline}`,
//     );

//     // ========================================================
//     // 12. EIP-712 DOMAIN
//     // ========================================================

//     const verifyingContract = getAddress(
//       runtime.config.evm.identityRegisterAddress,
//     );

//     const domain = {
//       name: "Lexo IdentityRegister",
//       version: "1",
//       chainId: Number(network.chainId),
//       verifyingContract,
//     };

//     // ========================================================
//     // 13. LINK WALLET MESSAGE
//     // ========================================================

//     const message = {
//       wallet: normalizedWallet,
//       identityHash: normalizedIdentityHash,
//       nonce,
//       deadline: BigInt(deadline),
//     };

//     // ========================================================
//     // 14. VERIFIER SECRET
//     // ========================================================

//     runtime.log(
//       "[CRE] Loading CRE_VERIFIER_PRIVATE_KEY...",
//     );

//     const verifierPrivateKeySecret = runtime
//       .getSecret({
//         id: "CRE_VERIFIER_PRIVATE_KEY",
//       })
//       .result();

//     const verifierPrivateKey =
//       verifierPrivateKeySecret.value;

//     if (
//       typeof verifierPrivateKey !== "string" ||
//       !verifierPrivateKey
//     ) {
//       throw new Error(
//         "CRE_VERIFIER_PRIVATE_KEY is unconfigured in CRE secrets",
//       );
//     }

//     // ========================================================
//     // 15. CREATE VIEM SIGNER
//     // ========================================================

//     const verifierAccount = privateKeyToAccount(
//       verifierPrivateKey as `0x${string}`,
//     );

//     const signingAddress = getAddress(
//       verifierAccount.address,
//     );

//     runtime.log(
//       `[CRE] Signing verifier address: ${signingAddress}`,
//     );

//     // ========================================================
//     // 16. VERIFY SIGNER MATCHES CONTRACT
//     // ========================================================

//     if (
//       signingAddress.toLowerCase() !==
//       onChainVerifier.toLowerCase()
//     ) {
//       throw new Error(
//         `Verifier mismatch. On-chain=${onChainVerifier}, CRE=${signingAddress}`,
//       );
//     }

//     runtime.log(
//       "[CRE] Verifier address matches contract",
//     );

//     // ========================================================
//     // 17. SIGN LINK WALLET ATTESTATION
//     // ========================================================

//     runtime.log(
//       "[CRE] Creating LinkWallet EIP-712 attestation...",
//     );

//     const signature =
//       await verifierAccount.signTypedData({
//         domain,
//         types: EIP712_TYPES,
//         primaryType: "LinkWallet",
//         message,
//       });

//     runtime.log(
//       "[CRE] LinkWallet attestation generated",
//     );

//     // ========================================================
//     // 18. RETURN ATTESTATION
//     // ========================================================

//     return JSON.stringify({
//       approved: true,
//       decision,
//       score: riskResult.score,
//       tier: riskResult.tier,
//       reason: explanation,
//       wallet: normalizedWallet,
//       identityHash: normalizedIdentityHash,
//       verificationId,
//       userId,
//       countryRisk: signals.countryRisk,
//       nonce: nonce.toString(),
//       deadline,
//       signature,
//       contract: verifyingContract,
//       chainId: Number(network.chainId),
//       verifier: onChainVerifier,
//     });
    
//   } catch (error) {
//     runtime.log(
//       `[CRE] Wallet addition workflow failed: ${String(error)}`,
//     );

//     throw error;
//   }

  
// };

// // ============================================================
// // WORKFLOW
// // ============================================================

// const httpCapability =
//   new cre.capabilities.HTTPCapability();

// const httpTrigger =
//   httpCapability.trigger({
//     authorizedKeys: [],
//   });

// export async function initWorkflow() {
//   return [
//     cre.handler(
//       httpTrigger,
//       onHttpTrigger,
//     ),
//   ];
// }

// // ============================================================
// // MAIN
// // ============================================================

// export async function main() {
//   const runner =
//     await Runner.newRunner<Config>();

//   await runner.run(initWorkflow);
// }

// main().catch((error) => {
//   console.error(
//     "[CRE] Wallet addition workflow failed to initialize:",
//     error,
//   );
// });
import {
  cre,
  Runner,
  decodeJson,
  encodeCallMsg,
  getNetwork,
  bytesToHex,
  LAST_FINALIZED_BLOCK_NUMBER,
  type HTTPPayload,
  type Runtime,
} from "@chainlink/cre-sdk";

import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import { privateKeyToAccount } from "viem/accounts";

import {
  normalizeWalletSignals,
  runWalletRuleEngine,
  decisionEngine,
} from "../../utils/rules.engine";

import { fetchLLMExplanation } from "../../utils/llm.service";

// ============================================================
// CONFIG
// ============================================================

type Config = {
  evm: {
    chainSelectorName: string;
    identityRegisterAddress: string;
  };
};

// ============================================================
// REQUEST
// ============================================================

type WalletAdditionRequest = {
  verificationId: string;
  userId: string;

  // New wallet
  wallet: string;

  // Existing Rarimo nullifier
  identityHash: string;

  // AML result from backend
  walletData: {
    amlScore: number | null;
    amlData: Record<string, any>;
  };
};

// ============================================================
// ABI
// ============================================================

const IDENTITY_REGISTER_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "verifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ============================================================
// EIP-712 TYPES
// ============================================================

const EIP712_TYPES = {
  LinkWallet: [
    {
      name: "wallet",
      type: "address",
    },
    {
      name: "identityHash",
      type: "bytes32",
    },
    {
      name: "nonce",
      type: "uint256",
    },
    {
      name: "deadline",
      type: "uint256",
    },
  ],
} as const;

// ============================================================
// HELPERS
// ============================================================

function assertBytes32(value: string, field: string): Hex {
  if (!isHex(value) || value.length !== 66) {
    throw new Error(`${field} must be a valid bytes32 value`);
  }

  return value as Hex;
}

function decodeNonce(data: Uint8Array): bigint {
  const raw = bytesToHex(data);

  return decodeFunctionResult({
    abi: IDENTITY_REGISTER_ABI,
    functionName: "nonces",
    data: raw,
  });
}

function decodeVerifier(data: Uint8Array): Address {
  const raw = bytesToHex(data);

  const verifier = decodeFunctionResult({
    abi: IDENTITY_REGISTER_ABI,
    functionName: "verifier",
    data: raw,
  });

  return getAddress(verifier);
}

// ============================================================
// HTTP HANDLER
// ============================================================

const onHttpTrigger = async (
  runtime: Runtime<Config>,
  payload: HTTPPayload,
): Promise<string> => {
  runtime.log("[CRE] Wallet addition request received");

  try {
    // ========================================================
    // 1. DECODE PAYLOAD
    // ========================================================

    if (!payload.input || payload.input.length === 0) {
      throw new Error("Empty HTTP payload received");
    }

    const request = decodeJson(
      payload.input,
    ) as WalletAdditionRequest;

    const {
      verificationId,
      userId,
      wallet,
      identityHash,
      walletData,
    } = request;

    // ========================================================
    // 2. VALIDATE
    // ========================================================

    if (
      !verificationId ||
      !userId ||
      !wallet ||
      !identityHash ||
      !walletData
    ) {
      throw new Error("Missing required payload properties");
    }

    if (!isAddress(wallet)) {
      throw new Error(`Invalid EVM wallet address: ${wallet}`);
    }

    const normalizedWallet = getAddress(wallet);

    const normalizedIdentityHash = assertBytes32(
      identityHash,
      "identityHash",
    );

    runtime.log(
      `[CRE] Evaluating wallet ${normalizedWallet}`,
    );

    runtime.log(
      `[CRE] Verification ID: ${verificationId}`,
    );

    runtime.log(
      `[CRE] User ID: ${userId}`,
    );

    runtime.log(
      `[CRE] Identity hash: ${normalizedIdentityHash}`,
    );

    // ========================================================
    // 3. NORMALIZE AML SIGNALS
    // ========================================================

    const signals = normalizeWalletSignals({
      amlScore: walletData.amlScore,
      ...walletData.amlData,
    });

    runtime.log("[CRE] WALLET SIGNALS");

    runtime.log(
      `Nationality: ${signals.nationality}`,
    );

    runtime.log(
      `AML score: ${signals.amlScore}`,
    );

    runtime.log(
      `Sanctions: ${signals.sanctions}`,
    );

    runtime.log(
      `PEP: ${signals.pep}`,
    );

    runtime.log(
      `Fraud: ${signals.fraud}`,
    );

    runtime.log(
      `Wallet risk: ${signals.walletRisk}`,
    );

    runtime.log(
      `Mixer exposure: ${signals.mixerExposure}`,
    );

    runtime.log(
      `High-risk wallet: ${signals.highRiskWallet}`,
    );

    runtime.log(
      `Transaction risk: ${signals.transactionRisk}`,
    );

    runtime.log(
      `Country risk: ${signals.countryRisk.score}`,
    );

    // ========================================================
    // 4. WALLET RULE ENGINE
    // ========================================================

    const riskResult = runWalletRuleEngine(signals);

    runtime.log(
      "[CRE] WALLET RULE ENGINE RESULT",
    );

    runtime.log(
      `Wallet risk score: ${riskResult.score}/100`,
    );

    runtime.log(
      `Wallet tier: ${riskResult.tier}`,
    );

    // ========================================================
    // 5. DECISION
    // ========================================================

    const decision = decisionEngine(
      riskResult.tier,
    );

    runtime.log(
      `[CRE] Wallet decision: ${decision}`,
    );

    // ========================================================
    // 6. LLM EXPLANATION
    // ========================================================

    const explanation = fetchLLMExplanation(
      runtime,
      {
        type: "ADD_WALLET",
        wallet: normalizedWallet,
        riskScore: riskResult.score,
        riskTier: riskResult.tier,
        decision,
        signals,
        nationality: signals.nationality,
        countryRisk: signals.countryRisk,
      },
    );

    runtime.log(
      `[CRE] LLM explanation: ${explanation}`,
    );

    // ========================================================
    // 7. REJECTION
    // ========================================================

    if (decision === "REJECT") {
      runtime.log(
        "[CRE] Wallet rejected. No attestation generated.",
      );

      const rejectionAttestation = {
        approved: false,
        decision,
        score: riskResult.score,
        tier: riskResult.tier,
        reason: explanation,
        wallet: normalizedWallet,
        identityHash: normalizedIdentityHash,
        verificationId,
        userId,
        countryRisk: signals.countryRisk,
        nonce: null,
        deadline: null,
        signature: null,
        contract:
          runtime.config.evm.identityRegisterAddress,
        chainId: null,
        verifier: null,
      };

      runtime.log(
        "[CRE] ===== WALLET ATTESTATION =====",
      );

      runtime.log(
        JSON.stringify(
          rejectionAttestation,
          null,
          2,
        ),
      );

      runtime.log(
        "[CRE] ===============================",
      );

      return JSON.stringify(
        rejectionAttestation,
      );
    }

    // ========================================================
    // 8. TARGET NETWORK
    // ========================================================

    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName:
        runtime.config.evm.chainSelectorName,
      isTestnet: true,
    });

    if (!network) {
      throw new Error(
        `Target EVM network selection failed: ${runtime.config.evm.chainSelectorName}`,
      );
    }

    runtime.log(
      `[CRE] Network chain ID: ${network.chainId}`,
    );

    runtime.log(
      `[CRE] Network selector: ${network.chainSelector.selector}`,
    );

    const evmClient =
      new cre.capabilities.EVMClient(
        network.chainSelector.selector,
      );

    runtime.log(
      "[CRE] EVMClient initialized",
    );

    // ========================================================
    // 9. GET NONCE FOR NEW WALLET
    // ========================================================

    runtime.log(
      "[CRE] Reading new wallet nonce...",
    );

    const nonceCallData =
      encodeFunctionData({
        abi: IDENTITY_REGISTER_ABI,
        functionName: "nonces",
        args: [normalizedWallet],
      });

    runtime.log(
      `[CRE] Nonce calldata: ${nonceCallData}`,
    );

    const nonceResult = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: normalizedWallet,
          to: getAddress(
            runtime.config.evm
              .identityRegisterAddress,
          ),
          data: nonceCallData,
        }),
        blockNumber:
          LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();

    if (!nonceResult.data) {
      throw new Error(
        "EVM call for 'nonces' returned empty byte stream",
      );
    }

    const nonce = decodeNonce(
      nonceResult.data,
    );

    runtime.log(
      `[CRE] New wallet nonce: ${nonce.toString()}`,
    );

    // ========================================================
    // 10. READ ON-CHAIN VERIFIER
    // ========================================================

    runtime.log(
      "[CRE] Reading on-chain verifier...",
    );

    const verifierCallData =
      encodeFunctionData({
        abi: IDENTITY_REGISTER_ABI,
        functionName: "verifier",
      });

    const verifierResult = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: normalizedWallet,
          to: getAddress(
            runtime.config.evm
              .identityRegisterAddress,
          ),
          data: verifierCallData,
        }),
        blockNumber:
          LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();

    if (!verifierResult.data) {
      throw new Error(
        "EVM call for 'verifier' returned empty byte stream",
      );
    }

    const onChainVerifier =
      decodeVerifier(
        verifierResult.data,
      );

    runtime.log(
      `[CRE] On-chain verifier: ${onChainVerifier}`,
    );

    // ========================================================
    // 11. DEADLINE
    // ========================================================

    const blockTimestamp = Math.floor(
      runtime.now().getTime() / 1000,
    );

    const roundedTimestamp =
      Math.floor(
        blockTimestamp / 300,
      ) * 300;

    const deadline =
      roundedTimestamp + 3600;

    runtime.log(
      `[CRE] Attestation deadline: ${deadline}`,
    );

    // ========================================================
    // 12. EIP-712 DOMAIN
    // ========================================================

    const verifyingContract =
      getAddress(
        runtime.config.evm
          .identityRegisterAddress,
      );

    const domain = {
      name: "Lexo IdentityRegister",
      version: "1",
      chainId: Number(network.chainId),
      verifyingContract,
    };

    // ========================================================
    // 13. LINK WALLET MESSAGE
    // ========================================================

    const message = {
      wallet: normalizedWallet,
      identityHash: normalizedIdentityHash,
      nonce,
      deadline: BigInt(deadline),
    };

    // ========================================================
    // 14. VERIFIER SECRET
    // ========================================================

    runtime.log(
      "[CRE] Loading CRE_VERIFIER_PRIVATE_KEY...",
    );

    const verifierPrivateKeySecret =
      runtime
        .getSecret({
          id: "CRE_VERIFIER_PRIVATE_KEY",
        })
        .result();

    const verifierPrivateKey =
      verifierPrivateKeySecret.value;

    if (
      typeof verifierPrivateKey !==
        "string" ||
      !verifierPrivateKey
    ) {
      throw new Error(
        "CRE_VERIFIER_PRIVATE_KEY is unconfigured in CRE secrets",
      );
    }

    // ========================================================
    // 15. CREATE VIEM SIGNER
    // ========================================================

    const verifierAccount =
      privateKeyToAccount(
        verifierPrivateKey as `0x${string}`,
      );

    const signingAddress =
      getAddress(
        verifierAccount.address,
      );

    runtime.log(
      `[CRE] Signing verifier address: ${signingAddress}`,
    );

    // ========================================================
    // 16. VERIFY SIGNER MATCHES CONTRACT
    // ========================================================

    if (
      signingAddress.toLowerCase() !==
      onChainVerifier.toLowerCase()
    ) {
      throw new Error(
        `Verifier mismatch. On-chain=${onChainVerifier}, CRE=${signingAddress}`,
      );
    }

    runtime.log(
      "[CRE] Verifier address matches contract",
    );

    // ========================================================
    // 17. SIGN LINK WALLET ATTESTATION
    // ========================================================

    runtime.log(
      "[CRE] Creating LinkWallet EIP-712 attestation...",
    );

    const signature =
      await verifierAccount.signTypedData({
        domain,
        types: EIP712_TYPES,
        primaryType: "LinkWallet",
        message,
      });

    runtime.log(
      "[CRE] LinkWallet attestation generated",
    );

    // ========================================================
    // 18. BUILD ATTESTATION
    // ========================================================

    const attestation = {
      approved: true,
      decision,
      score: riskResult.score,
      tier: riskResult.tier,
      reason: explanation,
      wallet: normalizedWallet,
      identityHash: normalizedIdentityHash,
      verificationId,
      userId,
      countryRisk: signals.countryRisk,

      // Values read from chain
      nonce: nonce.toString(),
      contract: verifyingContract,
      chainId: Number(network.chainId),
      verifier: onChainVerifier,

      // Generated by CRE
      deadline,
      signature,
    };

    // ========================================================
    // 19. PRINT COMPLETE ATTESTATION
    // ========================================================

    runtime.log(
      "[CRE] ===== LINK WALLET ATTESTATION =====",
    );

    runtime.log(
      JSON.stringify(
        attestation,
        null,
        2,
      ),
    );

    runtime.log(
      "[CRE] ====================================",
    );

    // ========================================================
    // 20. RETURN ATTESTATION
    // ========================================================

    return JSON.stringify(
      attestation,
    );
  } catch (error) {
    runtime.log(
      `[CRE] Wallet addition workflow failed: ${String(error)}`,
    );

    throw error;
  }
};

// ============================================================
// WORKFLOW
// ============================================================

const httpCapability =
  new cre.capabilities.HTTPCapability();

const httpTrigger =
  httpCapability.trigger({
    authorizedKeys: [],
  });

export async function initWorkflow() {
  return [
    cre.handler(
      httpTrigger,
      onHttpTrigger,
    ),
  ];
}

// // ============================================================
// // MAIN
// // ============================================================

export async function main() {
  const runner =
    await Runner.newRunner<Config>();

  await runner.run(initWorkflow);
}
