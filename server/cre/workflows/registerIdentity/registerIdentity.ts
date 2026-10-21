
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

/* =========================================================
   CONFIG — UNCHANGED
   ========================================================= */

const CHAIN_SELECTOR_NAME = "ethereum-testnet-sepolia";
const CHAIN_ID = 11155111;

const IDENTITY_REGISTER_ADDRESS =
  "0x7c827d0293b7ed891ed589542d1d11450590812d" as Address;

/* =========================================================
   CONTRACT ABI — UNCHANGED
   ========================================================= */

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

/* =========================================================
   INPUT TYPES
   ========================================================= */

// Matches the object returned by the existing AML service.
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

/* =========================================================
   HELPERS
   ========================================================= */

function assertBytes32(value: string, field: string): Hex {
  if (!isHex(value) || value.length !== 66) {
    throw new Error(`${field} must be a valid bytes32 value`);
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
  status: unknown
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

  throw new Error(`Unsupported AML status: ${status}`);
}

function normalizeAmlRiskLevel(
  riskLevel: unknown
): string | null {
  if (typeof riskLevel !== "string" || !riskLevel.trim()) {
    return null;
  }

  return riskLevel
    .toUpperCase()
    .trim()
    .replace(/[\s-]+/g, "_");
}

function getCombinedRiskTier(score: number): RiskTier {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

/* =========================================================
   HTTP HANDLER
   ========================================================= */

const onHttpTrigger = async (
  runtime: Runtime<WorkflowConfig>,
  payload: HTTPPayload
): Promise<string> => {
  runtime.log("[CRE] Identity registration request received");

  try {
    if (!payload.input || payload.input.length === 0) {
      throw new Error("Empty HTTP payload received");
    }

    const input = decodeJson(
      payload.input
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

    /* INPUT VALIDATION */

    if (!verificationId || !userId) {
      throw new Error("verificationId and userId are required");
    }

    if (!wallet || !isAddress(wallet)) {
      throw new Error("Invalid wallet address");
    }

    if (!identityHash) {
      throw new Error("identityHash is required");
    }

    if (!nationality || typeof nationality !== "string") {
      throw new Error("Valid nationality is required");
    }

    if (rarimoProof === undefined || rarimoProof === null) {
      throw new Error("rarimoProof is required");
    }

    if (
      typeof ageAbove17 !== "boolean" ||
      typeof passportExpired !== "boolean"
    ) {
      throw new Error(
        "ageAbove17 and passportExpired must be booleans"
      );
    }

    const normalizedWallet = getAddress(wallet);

    const normalizedIdentityHash = assertBytes32(
      identityHash,
      "identityHash"
    );

    runtime.log(`[CRE] Chain selector: ${CHAIN_SELECTOR_NAME}`);
    runtime.log(`[CRE] Chain ID: ${CHAIN_ID}`);
    runtime.log(
      `[CRE] IdentityRegister: ${IDENTITY_REGISTER_ADDRESS}`
    );
    runtime.log(`[CRE] Verification ID: ${verificationId}`);
    runtime.log(`[CRE] Wallet: ${normalizedWallet}`);
    runtime.log(`[CRE] Identity hash: ${normalizedIdentityHash}`);
    runtime.log(`[CRE] Nationality: ${nationality}`);
    runtime.log(`[CRE] Age above 17: ${ageAbove17}`);
    runtime.log(`[CRE] Passport expired: ${passportExpired}`);
    runtime.log(
      `[CRE] Rarimo proof supplied: ${Boolean(rarimoProof)}`
    );

    /*
     * NOTE:
     * Proof presence does not prove cryptographic validity.
     * Preserve the existing proof validation/integration separately.
     */

    /* IDENTITY SIGNALS — ORIGINAL INPUT PRESERVED */

    const identitySignals = normalizeIdentitySignals({
      nationality,
      ageAbove17,
      passportExpired,
      rarimoProof,
    });

    runtime.log("[CRE] Identity signals normalized");
    runtime.log(
      `Country code: ${identitySignals.countryRisk.countryCode}`
    );
    runtime.log(
      `Country score: ${identitySignals.countryRisk.score}`
    );
    runtime.log(
      `Country level: ${identitySignals.countryRisk.level}`
    );

    /* IDENTITY RISK */

    const ruleResult = runIdentityRuleEngine(identitySignals);

    runtime.log(`[CRE] Identity risk score: ${ruleResult.score}/100`);
    runtime.log(`[CRE] Identity risk tier: ${ruleResult.tier}`);

    /* AML DATA — MATCHES AML.service.js OUTPUT */

    const amlStatus = normalizeAmlStatus(
      walletData?.amlStatus
    );

    const amlScore = walletData?.amlScore ?? null;

    const amlRiskLevel = normalizeAmlRiskLevel(
      walletData?.riskLevel
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
      throw new Error("AML score must be between 0 and 100");
    }

    let amlPenalty = 0;

    /*
     * Only apply AML penalties to a scored result.
     * UNKNOWN and INCONCLUSIVE remain explicitly recorded.
     */
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
            }`
          );
      }
    }

    /*
     * An AML provider's numeric score is recorded, but the
     * configured penalty is based on its riskLevel. This avoids
     * assuming all providers use the same score semantics.
     */
    const combinedScore = Math.min(
      100,
      ruleResult.score + amlPenalty
    );

    const combinedTier = getCombinedRiskTier(combinedScore);

    runtime.log(`[CRE] AML status: ${amlStatus}`);
    runtime.log(
      `[CRE] AML score: ${amlScore ?? "unavailable"}`
    );
    runtime.log(
      `[CRE] AML risk level: ${amlRiskLevel ?? "unknown"}`
    );
    runtime.log(`[CRE] AML penalty: ${amlPenalty}`);
    runtime.log(`[CRE] Combined risk score: ${combinedScore}/100`);
    runtime.log(`[CRE] Combined risk tier: ${combinedTier}`);

    /* FINAL DETERMINISTIC DECISION */

    const decision = decisionEngine(combinedTier);

    const validDecisions = [
      "APPROVE",
      "MANUAL_REVIEW",
      "REJECT",
    ] as const;

    if (
      !validDecisions.includes(
        decision as (typeof validDecisions)[number]
      )
    ) {
      throw new Error(`Unsupported identity decision: ${decision}`);
    }

    const approved = decision === "APPROVE";

    runtime.log(`[CRE] Final decision: ${decision}`);

    const countryRisk = {
      ...identitySignals.countryRisk,
      country: identitySignals.countryRisk.country ?? "",
    };

    /* LLM EXPLANATION — NOT A DECISION MAKER */

    const explanation = await fetchLLMExplanation(runtime, {
      type: "IDENTITY",
      wallet: normalizedWallet,
      riskScore: combinedScore,
      riskTier: combinedTier,
      decision,
      signals: identitySignals,
      nationality: identitySignals.nationality,
      countryRisk: identitySignals.countryRisk,
    });

    runtime.log(`[CRE] LLM explanation: ${explanation}`);

    /* COMMON RESPONSE FIELDS */

    const responseRiskFields = {
      score: combinedScore,
      tier: combinedTier,
      identityScore: ruleResult.score,
      amlStatus,
      amlScore,
      amlRiskLevel,
    };

    /* NON-APPROVAL: NO SIGNATURE */

    if (!approved) {
      runtime.log(
        `[CRE] ${decision}: no identity attestation generated`
      );

      return JSON.stringify({
        approved: false,
        decision,
        ...responseRiskFields,
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
      });
    }

    /* RESOLVE SEPOLIA NETWORK — UNCHANGED */

    runtime.log("[CRE] Resolving EVM network");

    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: CHAIN_SELECTOR_NAME,
      isTestnet: true,
    });

    if (!network) {
      throw new Error(
        `Target EVM network not found: ${CHAIN_SELECTOR_NAME}`
      );
    }

    if (Number(network.chainId) !== CHAIN_ID) {
      throw new Error(
        `Unexpected chain ID: ${network.chainId}`
      );
    }

    const evmClient = new cre.capabilities.EVMClient(
      network.chainSelector.selector
    );

    /* READ ON-CHAIN NONCE — UNCHANGED */

    runtime.log("[CRE] Reading identity nonce");

    const nonceCallData = encodeFunctionData({
      abi: IDENTITY_REGISTER_ABI,
      functionName: "nonces",
      args: [normalizedWallet],
    });

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
      throw new Error("EVM nonce call returned empty response");
    }

    const nonce = decodeNonce(nonceResult.data);

    runtime.log(`[CRE] On-chain nonce: ${nonce.toString()}`);

    /* READ ON-CHAIN VERIFIER — UNCHANGED */

    runtime.log("[CRE] Reading contract verifier");

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
      throw new Error("EVM verifier call returned empty response");
    }

    const onChainVerifier = decodeVerifier(verifierResult.data);

    runtime.log(`[CRE] On-chain verifier: ${onChainVerifier}`);

    /* LOAD SIGNER SECRET — UNCHANGED */

    const secret = runtime
      .getSecret({ id: "CRE_VERIFIER_PRIVATE_KEY" })
      .result();

    if (
      !secret ||
      typeof secret.value !== "string" ||
      !secret.value
    ) {
      throw new Error(
        "CRE_VERIFIER_PRIVATE_KEY secret is missing or empty"
      );
    }

    /* CREATE SIGNER — UNCHANGED */

    const verifierAccount = privateKeyToAccount(
      secret.value as `0x${string}`
    );

    const signingAddress = getAddress(verifierAccount.address);

    runtime.log(`[CRE] Signing address: ${signingAddress}`);

    if (
      signingAddress.toLowerCase() !==
      onChainVerifier.toLowerCase()
    ) {
      throw new Error(
        `Verifier mismatch. On-chain=${onChainVerifier}, CRE=${signingAddress}`
      );
    }

    runtime.log("[CRE] Signer matches on-chain verifier");

    /* ATTESTATION DEADLINE — UNCHANGED */

    const deadline =
      suppliedDeadline ??
      Math.floor(Date.now() / 1000) + 15 * 60;

    if (
      !Number.isSafeInteger(deadline) ||
      deadline <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error("Invalid or expired attestation deadline");
    }

    runtime.log(`[CRE] Attestation deadline: ${deadline}`);

    /* EIP-712 SIGNATURE — UNCHANGED */

    runtime.log("[CRE] Signing EIP-712 identity attestation");

    const signature = await verifierAccount.signTypedData({
      domain: {
        name: "Lexo IdentityRegister",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: IDENTITY_REGISTER_ADDRESS,
      },
      types: {
        RegisterIdentity: [
          { name: "wallet", type: "address" },
          { name: "identityHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
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

    runtime.log("[CRE] EIP-712 signature generated");
    runtime.log("[CRE] Identity attestation ready");

    return JSON.stringify({
      approved: true,
      decision,
      ...responseRiskFields,
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
    });
  } catch (error) {
    runtime.log(
      `[CRE] Identity registration workflow failed: ${String(error)}`
    );

    throw error;
  }
};

/* HTTP TRIGGER — UNCHANGED */

const httpCapability = new cre.capabilities.HTTPCapability();

const httpTrigger = httpCapability.trigger({
  authorizedKeys: [],
});

/* WORKFLOW — UNCHANGED */

export async function initWorkflow() {
  return [
    cre.handler(httpTrigger, onHttpTrigger),
  ];
}

/* ENTRYPOINT — UNCHANGED */

export async function main() {
  const runner = await Runner.newRunner<WorkflowConfig>();
  await runner.run(initWorkflow);
}

main().catch((error) => {
  console.error("[CRE] Workflow failed to initialize:", error);
});
