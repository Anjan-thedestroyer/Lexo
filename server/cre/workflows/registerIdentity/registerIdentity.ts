
import {
  cre,
  Runner,
  decodeJson,
  encodeCallMsg,
  getNetwork,
  bytesToHex,
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
  normalizeIdentitySignals,
  runIdentityRuleEngine,
  decisionEngine,
} from "../../utils/rules.engine";

import { fetchLLMExplanation } from "../../utils/llm.service";

// ============================================================
// CONFIG
// ============================================================

const CHAIN_SELECTOR_NAME = "ethereum-testnet-sepolia";
const CHAIN_ID = 11155111;

const IDENTITY_REGISTER_ADDRESS =
  "0x7c827d0293b7ed891ed589542d1d11450590812d" as Address;

// ============================================================
// CONTRACT ABI
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
// INPUT TYPES
// ============================================================

type WalletData = {
  amlScore: number | null;
  amlData: unknown | null;
  amlStatus: "SCORED" | "UNKNOWN" | "INCONCLUSIVE";
  riskLevel: string;
  reason?: string;
};

type RegisterIdentityPayload = {
  verificationId: string;
  userId: string;
  wallet: string;
  identityHash: string;
  nationality: string;
  rarimoProof: unknown;
  ageAbove17: boolean;
  passportExpired: boolean;
  deadline?: number;
  walletData?: WalletData;
};

type WorkflowConfig = Record<string, never>;

type RiskTier = "LOW" | "MEDIUM" | "HIGH";

// ============================================================
// HELPERS
// ============================================================

function assertBytes32(
  value: string,
  field: string,
): Hex {
  if (!isHex(value) || value.length !== 66) {
    throw new Error(
      `${field} must be a valid bytes32 value`,
    );
  }

  return value as Hex;
}

function decodeNonce(data: Uint8Array): bigint {
  return decodeFunctionResult({
    abi: IDENTITY_REGISTER_ABI,
    functionName: "nonces",
    data: bytesToHex(data),
  });
}

function decodeVerifier(data: Uint8Array): Address {
  const verifier = decodeFunctionResult({
    abi: IDENTITY_REGISTER_ABI,
    functionName: "verifier",
    data: bytesToHex(data),
  });

  return getAddress(verifier);
}

function normalizeAmlStatus(
  status: unknown,
): "SCORED" | "UNKNOWN" | "INCONCLUSIVE" {
  if (typeof status !== "string") {
    return "UNKNOWN";
  }

  const normalized = status.toUpperCase().trim();

  if (
    normalized === "SCORED" ||
    normalized === "UNKNOWN" ||
    normalized === "INCONCLUSIVE"
  ) {
    return normalized;
  }

  throw new Error(
    `Unsupported AML status: ${status}`,
  );
}

function normalizeAmlRiskLevel(
  riskLevel: unknown,
): string | null {
  if (
    typeof riskLevel !== "string" ||
    !riskLevel.trim()
  ) {
    return null;
  }

  return riskLevel
    .toUpperCase()
    .trim()
    .replace(/[\s-]+/g, "_");
}

function getCombinedRiskTier(
  score: number,
): RiskTier {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";

  return "LOW";
}

// ============================================================
// HTTP HANDLER
// ============================================================

const onHttpTrigger = async (
  runtime: Runtime<WorkflowConfig>,
  payload: HTTPPayload,
): Promise<string> => {
  runtime.log(
    "[CRE] Identity registration request received",
  );

  try {
    // ========================================================
    // 1. DECODE PAYLOAD
    // ========================================================

    if (!payload.input || payload.input.length === 0) {
      throw new Error(
        "Empty HTTP payload received",
      );
    }

    const input = decodeJson(
      payload.input,
    ) as RegisterIdentityPayload;

    const {
      verificationId,
      userId,
      wallet,
      identityHash,
      nationality,
      rarimoProof,
      ageAbove17,
      passportExpired,
      deadline: suppliedDeadline,
      walletData,
    } = input;

    // ========================================================
    // 2. INPUT VALIDATION
    // ========================================================

    if (!verificationId || !userId) {
      throw new Error(
        "verificationId and userId are required",
      );
    }

    if (!wallet || !isAddress(wallet)) {
      throw new Error(
        "Invalid wallet address",
      );
    }

    if (!identityHash) {
      throw new Error(
        "identityHash is required",
      );
    }

    if (
      !nationality ||
      typeof nationality !== "string"
    ) {
      throw new Error(
        "Valid nationality is required",
      );
    }

    if (
      rarimoProof === undefined ||
      rarimoProof === null
    ) {
      throw new Error(
        "rarimoProof is required",
      );
    }

    if (
      typeof ageAbove17 !== "boolean" ||
      typeof passportExpired !== "boolean"
    ) {
      throw new Error(
        "ageAbove17 and passportExpired must be booleans",
      );
    }

    const normalizedWallet = getAddress(wallet);

    const normalizedIdentityHash = assertBytes32(
      identityHash,
      "identityHash",
    );

    runtime.log(
      `[CRE] Chain selector: ${CHAIN_SELECTOR_NAME}`,
    );

    runtime.log(
      `[CRE] Chain ID: ${CHAIN_ID}`,
    );

    runtime.log(
      `[CRE] IdentityRegister: ${IDENTITY_REGISTER_ADDRESS}`,
    );

    runtime.log(
      `[CRE] Verification ID: ${verificationId}`,
    );

    runtime.log(
      `[CRE] User ID: ${userId}`,
    );

    runtime.log(
      `[CRE] Wallet: ${normalizedWallet}`,
    );

    runtime.log(
      `[CRE] Identity hash: ${normalizedIdentityHash}`,
    );

    runtime.log(
      `[CRE] Nationality: ${nationality}`,
    );

    runtime.log(
      `[CRE] Age above 17: ${ageAbove17}`,
    );

    runtime.log(
      `[CRE] Passport expired: ${passportExpired}`,
    );

    runtime.log(
      `[CRE] Rarimo proof supplied: ${Boolean(rarimoProof)}`,
    );

    // ========================================================
    // 3. NORMALIZE IDENTITY SIGNALS
    // ========================================================

    const identitySignals = normalizeIdentitySignals({
      nationality,
      ageAbove17,
      passportExpired,
      rarimoProof,
    });

    runtime.log(
      "[CRE] IDENTITY SIGNALS NORMALIZED",
    );

    runtime.log(
      `Country code: ${identitySignals.countryRisk.countryCode}`,
    );

    runtime.log(
      `Country score: ${identitySignals.countryRisk.score}`,
    );

    runtime.log(
      `Country level: ${identitySignals.countryRisk.level}`,
    );

    // ========================================================
    // 4. IDENTITY RULE ENGINE
    // ========================================================

    const ruleResult = runIdentityRuleEngine(
      identitySignals,
    );

    runtime.log(
      "[CRE] IDENTITY RULE ENGINE RESULT",
    );

    runtime.log(
      `[CRE] Identity risk score: ${ruleResult.score}/100`,
    );

    runtime.log(
      `[CRE] Identity risk tier: ${ruleResult.tier}`,
    );

    // ========================================================
    // 5. AML NORMALIZATION
    // ========================================================

    runtime.log(
      "[CRE] NORMALIZING AML DATA",
    );

    const amlStatus = normalizeAmlStatus(
      walletData?.amlStatus,
    );

    const amlScore = walletData?.amlScore ?? null;

    const amlRiskLevel = normalizeAmlRiskLevel(
      walletData?.riskLevel,
    );

    if (
      amlScore !== null &&
      (
        typeof amlScore !== "number" ||
        !Number.isFinite(amlScore) ||
        amlScore < 0 ||
        amlScore > 100
      )
    ) {
      throw new Error(
        "AML score must be between 0 and 100",
      );
    }

    // ========================================================
    // 6. AML PENALTY
    // ========================================================

    let amlPenalty = 0;

    if (walletData && amlStatus === "SCORED") {
      switch (amlRiskLevel) {
        case "LOW":
          amlPenalty = 0;
          break;

        case "MODERATE":
        case "MEDIUM":
          amlPenalty = 30;
          break;

        case "HIGH":
          amlPenalty = 70;
          break;

        case "VERY_HIGH":
          amlPenalty = 90;
          break;

        default:
          throw new Error(
            `Unsupported AML risk level for scored wallet: ${
              amlRiskLevel ?? "missing"
            }`,
          );
      }
    }

    // ========================================================
    // 7. COMBINED RISK
    // ========================================================

    const combinedScore = Math.min(
      100,
      ruleResult.score + amlPenalty,
    );

    const combinedTier = getCombinedRiskTier(
      combinedScore,
    );

    runtime.log(
      `[CRE] AML status: ${amlStatus}`,
    );

    runtime.log(
      `[CRE] AML score: ${amlScore ?? "unavailable"}`,
    );

    runtime.log(
      `[CRE] AML risk level: ${amlRiskLevel ?? "unknown"}`,
    );

    runtime.log(
      `[CRE] AML penalty: ${amlPenalty}`,
    );

    runtime.log(
      `[CRE] Combined risk score: ${combinedScore}/100`,
    );

    runtime.log(
      `[CRE] Combined risk tier: ${combinedTier}`,
    );

    // ========================================================
    // 8. FINAL DETERMINISTIC DECISION
    // ========================================================

    const decision = decisionEngine(
      combinedTier,
    );

    const validDecisions = [
      "APPROVE",
      "MANUAL_REVIEW",
      "REJECT",
    ] as const;

    if (
      !validDecisions.includes(
        decision as (typeof validDecisions)[number],
      )
    ) {
      throw new Error(
        `Unsupported identity decision: ${decision}`,
      );
    }

    const approved = decision === "APPROVE";

    runtime.log(
      `[CRE] Final identity decision: ${decision}`,
    );

    const countryRisk = {
      ...identitySignals.countryRisk,
      country: identitySignals.countryRisk.country ?? "",
    };

    // ========================================================
    // 9. LLM EXPLANATION
    // ========================================================

    runtime.log(
      "[CRE] Requesting AI explanation...",
    );

    const explanation = await fetchLLMExplanation(
      runtime,
      {
        type: "IDENTITY",
        wallet: normalizedWallet,
        riskScore: combinedScore,
        riskTier: combinedTier,
        decision,
        signals: identitySignals,
        nationality: identitySignals.nationality,
        countryRisk: identitySignals.countryRisk,
      },
    );

    runtime.log("");

    runtime.log(
      "[CRE] ========================================",
    );

    runtime.log(
      "[CRE]        LEXO IDENTITY AI EXPLANATION",
    );

    runtime.log(
      "[CRE] ========================================",
    );

    runtime.log(
      `[CRE] Decision: ${decision}`,
    );

    runtime.log(
      `[CRE] Identity score: ${ruleResult.score}/100`,
    );

    runtime.log(
      `[CRE] AML penalty: ${amlPenalty}`,
    );

    runtime.log(
      `[CRE] Combined score: ${combinedScore}/100`,
    );

    runtime.log(
      `[CRE] Combined tier: ${combinedTier}`,
    );

    runtime.log(
      `[CRE] Explanation: ${explanation}`,
    );

    runtime.log(
      "[CRE] ========================================",
    );

    runtime.log("");

    // ========================================================
    // 10. COMMON RESPONSE FIELDS
    // ========================================================

    const responseRiskFields = {
      score: combinedScore,
      tier: combinedTier,
      identityScore: ruleResult.score,
      amlStatus,
      amlScore,
      amlRiskLevel,
    };

    // ========================================================
    // 11. NON-APPROVAL
    // ========================================================

    if (!approved) {
      runtime.log(
        `[CRE] ${decision}: no identity attestation generated`,
      );

      const rejectionResponse = {
        approved: false,
        decision,

        ...responseRiskFields,

        explanation,
        reason: explanation,

        wallet: normalizedWallet,
        identityHash: normalizedIdentityHash,
        verificationId,
        userId,
        countryRisk,

        nonce: null,
        deadline: null,
        signature: null,

        contract: IDENTITY_REGISTER_ADDRESS,
        chainId: CHAIN_ID,
        verifier: null,
      };

      runtime.log(
        "[CRE] ===== IDENTITY REGISTRATION RESULT =====",
      );

      runtime.log(
        JSON.stringify(
          rejectionResponse,
          null,
          2,
        ),
      );

      runtime.log(
        "[CRE] ========================================",
      );

      return JSON.stringify(rejectionResponse);
    }

    // ========================================================
    // 12. RESOLVE SEPOLIA NETWORK
    // ========================================================

    runtime.log(
      "[CRE] Resolving EVM network...",
    );

    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: CHAIN_SELECTOR_NAME,
      isTestnet: true,
    });

    if (!network) {
      throw new Error(
        `Target EVM network not found: ${CHAIN_SELECTOR_NAME}`,
      );
    }

    if (Number(network.chainId) !== CHAIN_ID) {
      throw new Error(
        `Unexpected chain ID: ${network.chainId}`,
      );
    }

    runtime.log(
      `[CRE] Connected chain ID: ${network.chainId}`,
    );

    runtime.log(
      `[CRE] Network selector: ${network.chainSelector.selector}`,
    );

    const evmClient = new cre.capabilities.EVMClient(
      network.chainSelector.selector,
    );

    runtime.log(
      "[CRE] EVMClient initialized",
    );

    // ========================================================
    // 13. READ ON-CHAIN NONCE
    // ========================================================

    runtime.log(
      "[CRE] Reading identity nonce...",
    );

    const nonceCallData = encodeFunctionData({
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
          to: IDENTITY_REGISTER_ADDRESS,
          data: nonceCallData,
        }),
      })
      .result();

    if (!nonceResult.data) {
      throw new Error(
        "EVM nonce call returned empty response",
      );
    }

    const nonce = decodeNonce(
      nonceResult.data,
    );

    runtime.log(
      `[CRE] On-chain nonce: ${nonce.toString()}`,
    );

    // ========================================================
    // 14. READ ON-CHAIN VERIFIER
    // ========================================================

    runtime.log(
      "[CRE] Reading contract verifier...",
    );

    const verifierCallData = encodeFunctionData({
      abi: IDENTITY_REGISTER_ABI,
      functionName: "verifier",
    });

    const verifierResult = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: normalizedWallet,
          to: IDENTITY_REGISTER_ADDRESS,
          data: verifierCallData,
        }),
      })
      .result();

    if (!verifierResult.data) {
      throw new Error(
        "EVM verifier call returned empty response",
      );
    }

    const onChainVerifier = decodeVerifier(
      verifierResult.data,
    );

    runtime.log(
      `[CRE] On-chain verifier: ${onChainVerifier}`,
    );

    // ========================================================
    // 15. LOAD VERIFIER SECRET
    // ========================================================

    runtime.log(
      "[CRE] Loading CRE_VERIFIER_PRIVATE_KEY...",
    );

    const secret = runtime
      .getSecret({
        id: "CRE_VERIFIER_PRIVATE_KEY",
      })
      .result();

    if (
      !secret ||
      typeof secret.value !== "string" ||
      !secret.value
    ) {
      throw new Error(
        "CRE_VERIFIER_PRIVATE_KEY secret is missing or empty",
      );
    }

    // ========================================================
    // 16. CREATE SIGNER
    // ========================================================

    const verifierAccount = privateKeyToAccount(
      secret.value as `0x${string}`,
    );

    const signingAddress = getAddress(
      verifierAccount.address,
    );

    runtime.log(
      `[CRE] Signing address: ${signingAddress}`,
    );

    // ========================================================
    // 17. VERIFY SIGNER
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
      "[CRE] Signer matches on-chain verifier",
    );

    // ========================================================
    // 18. ATTESTATION DEADLINE
    // ========================================================

    const currentTimestamp = Math.floor(
      runtime.now().getTime() / 1000,
    );

    const deadline =
      suppliedDeadline ??
      currentTimestamp + 15 * 60;

    if (
      !Number.isSafeInteger(deadline) ||
      deadline <= currentTimestamp
    ) {
      throw new Error(
        "Invalid or expired attestation deadline",
      );
    }

    runtime.log(
      `[CRE] Attestation deadline: ${deadline}`,
    );

    // ========================================================
    // 19. EIP-712 SIGNATURE
    // ========================================================

    runtime.log(
      "[CRE] Creating RegisterIdentity EIP-712 attestation...",
    );

    const signature = await verifierAccount.signTypedData({
      domain: {
        name: "Lexo IdentityRegister",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: IDENTITY_REGISTER_ADDRESS,
      },

      types: {
        RegisterIdentity: [
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
      },

      primaryType: "RegisterIdentity",

      message: {
        wallet: normalizedWallet,
        identityHash: normalizedIdentityHash,
        nonce,
        deadline: BigInt(deadline),
      },
    });

    runtime.log(
      "[CRE] EIP-712 signature generated",
    );

    // ========================================================
    // 20. BUILD ATTESTATION
    // ========================================================

    const attestation = {
      approved: true,
      decision,

      ...responseRiskFields,

      explanation,
      reason: explanation,

      wallet: normalizedWallet,
      identityHash: normalizedIdentityHash,
      verificationId,
      userId,
      countryRisk,

      nonce: nonce.toString(),
      deadline,
      signature,

      contract: IDENTITY_REGISTER_ADDRESS,
      chainId: CHAIN_ID,
      verifier: onChainVerifier,
    };

    // ========================================================
    // 21. PRINT COMPLETE ATTESTATION
    // ========================================================

    runtime.log(
      "[CRE] ===== IDENTITY REGISTRATION ATTESTATION =====",
    );

    runtime.log(
      JSON.stringify(
        attestation,
        null,
        2,
      ),
    );

    runtime.log(
      "[CRE] =============================================",
    );

    // ========================================================
    // 22. RETURN ATTESTATION
    // ========================================================

    return JSON.stringify(attestation);

  } catch (error) {
    runtime.log(
      `[CRE] Identity registration workflow failed: ${String(error)}`,
    );

    throw error;
  }
};

// ============================================================
// HTTP TRIGGER
// ============================================================

const httpCapability =
  new cre.capabilities.HTTPCapability();

const httpTrigger = httpCapability.trigger({
  authorizedKeys: [],
});

// ============================================================
// WORKFLOW
// ============================================================

export async function initWorkflow() {
  return [
    cre.handler(
      httpTrigger,
      onHttpTrigger,
    ),
  ];
}

// ============================================================
// MAIN
// ============================================================

export async function main() {
  const runner = await Runner.newRunner<WorkflowConfig>();

  await runner.run(initWorkflow);
}

main().catch((error) => {
  console.error(
    "[CRE] Workflow failed to initialize:",
    error,
  );
});
