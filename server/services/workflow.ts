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

import { ethers } from "ethers";

import {
  normalizeSignals,
  runRuleEngine,
  decisionEngine,
} from "./rules.engine.ts";

import { fetchLLMExplanation } from "./llm.service.ts";

// ============================================================
// CONFIG & TYPES
// ============================================================

type Config = {
  evm: {
    chainSelectorName: string;
    identityRegisterAddress: string;
  };
};

type AttestationRequest = {
  verificationId: string;
  userId: string;
  wallet: string;
  identityHash: string;
  nationality: string;
  rarimoProof: Record<string, any>;

  walletData: {
    amlScore: number | null;
    amlData: Record<string, any>;
  };
};

const IDENTITY_REGISTER_ABI = [
  "function nonces(address) view returns (uint256)",
];

const EIP712_TYPES = {
  RegisterIdentity: [
    { name: "wallet", type: "address" },
    { name: "identityHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

// ============================================================
// MAIN HTTP HANDLER
// ============================================================

const onHttpTrigger = async (
  runtime: Runtime<Config>,
  payload: HTTPPayload
) => {
  runtime.log("[CRE] Identity attestation request received");

  // ==========================================================
  // 1. DECODE PAYLOAD
  // ==========================================================

  if (!payload.input || payload.input.length === 0) {
    throw new Error("Empty HTTP payload received");
  }

  const request = decodeJson(payload.input) as AttestationRequest;

  const {
    verificationId,
    userId,
    wallet,
    identityHash,
    nationality,
    rarimoProof,
    walletData,
  } = request;

  runtime.log(
    `[CRE] Request processing - ID: ${verificationId}, User: ${userId}, Wallet: ${wallet}`
  );

  // ==========================================================
  // 2. BASIC VALIDATION
  // ==========================================================

  if (!wallet || !identityHash || !rarimoProof) {
    throw new Error(
      "Missing required payload properties: wallet, identityHash, or rarimoProof"
    );
  }

  if (!ethers.isAddress(wallet)) {
    throw new Error(`Invalid EVM wallet address: ${wallet}`);
  }

  if (!ethers.isHexString(identityHash, 32)) {
    throw new Error(
      "identityHash must be a valid 32-byte hex string (0x...)"
    );
  }

  const normalizedWallet = ethers.getAddress(wallet);

  // ==========================================================
  // 3. VALIDATE RARIMO DATA
  // ==========================================================

  const verifiedIdentity = verifyRarimoProof(
    rarimoProof,
    identityHash,
    nationality
  );

  if (!verifiedIdentity.valid) {
    runtime.log(
      `[CRE] Rarimo identity validation failed for wallet ${normalizedWallet}`
    );

    return JSON.stringify({
      approved: false,
      decision: "REJECT",
      score: 100,
      reason: "Invalid identity proof",
      wallet: normalizedWallet,
      identityHash,
      nonce: null,
      deadline: null,
      signature: null,
    });
  }

  // ==========================================================
  // 4. NORMALIZE VERIFICATION + AML SIGNALS
  // ==========================================================

  const signals = normalizeSignals({
    nationality: verifiedIdentity.nationality,
    ageAbove17: verifiedIdentity.ageAbove17,
    passportExpired: verifiedIdentity.passportExpired,
    authLevel: verifiedIdentity.authLevel,

    // AML score comes from backend wallet screening
    amlScore: walletData?.amlScore ?? null,
  });

  // ==========================================================
  // 5. DETERMINISTIC RISK ENGINE
  // ==========================================================

  const riskResult = runRuleEngine(signals);

  const decision = decisionEngine(riskResult.tier);

  runtime.log(
    `[CRE] Risk Analysis Complete - Score: ${riskResult.score}, Decision: ${decision}`
  );

  // ==========================================================
  // 6. CLAUDE EXPLANATION
  // ==========================================================

  let llmReason =
    `Verification evaluated with risk score of ${riskResult.score}/100.`;

  try {
    llmReason = await fetchLLMExplanation({
      wallet: normalizedWallet,
      riskScore: riskResult.score,
      decision,
      signals,

      // Send the complete AML result to Claude.
      // We only extract amlScore for the deterministic rule engine.
      amlData: walletData?.amlData,
    });
  } catch (error) {
    runtime.log(
      "[CRE] Claude explanation failed. Using deterministic fallback."
    );
  }

  // ==========================================================
  // 7. HANDLE REJECTION
  // ==========================================================

  if (decision === "REJECT") {
    runtime.log(
      `[CRE] Identity verification rejected for wallet ${normalizedWallet}`
    );

    return JSON.stringify({
      approved: false,
      decision,
      score: riskResult.score,
      reason: llmReason,
      wallet: normalizedWallet,
      identityHash,
      nonce: null,
      deadline: null,
      signature: null,
    });
  }

  // ==========================================================
  // 8. RESOLVE TARGET NETWORK
  // ==========================================================

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.evm.chainSelectorName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error(
      `Target EVM network selection failed: ${runtime.config.evm.chainSelectorName}`
    );
  }

  const evmClient = new cre.capabilities.EVMClient(
    network.chainSelector.selector
  );

  // ==========================================================
  // 9. FETCH ON-CHAIN NONCE
  // ==========================================================

  const nonceInterface = new ethers.Interface(
    IDENTITY_REGISTER_ABI
  );

  const nonceCallData = nonceInterface.encodeFunctionData(
    "nonces",
    [normalizedWallet]
  );

  const callerAddress = normalizedWallet as `0x${string}`;

  const nonceResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: callerAddress,
        to: runtime.config.evm.identityRegisterAddress as `0x${string}`,
        data: nonceCallData as `0x${string}`,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  if (!nonceResult.data) {
    throw new Error(
      "EVM call for 'nonces' returned empty byte stream"
    );
  }

  const decodedNonce = nonceInterface.decodeFunctionResult(
    "nonces",
    bytesToHex(nonceResult.data)
  );

  const nonce = decodedNonce[0].toString();

  // ==========================================================
  // 10. CREATE ATTESTATION DEADLINE
  // ==========================================================

  const blockTimestamp = Math.floor(
    runtime.now().getTime() / 1000
  );

  const roundedTimestamp =
    Math.floor(blockTimestamp / 300) * 300;

  const deadline = roundedTimestamp + 3600;

  // ==========================================================
  // 11. CONSTRUCT EIP-712 DOMAIN
  // ==========================================================

  const domain = {
    name: "Lexo IdentityRegister",
    version: "1",
    chainId: Number(network.chainId),
    verifyingContract:
      runtime.config.evm.identityRegisterAddress,
  };

  const message = {
    wallet: normalizedWallet,
    identityHash,
    nonce,
    deadline,
  };

  // ==========================================================
  // 12. SIGN EIP-712 ATTESTATION
  // ==========================================================

  const verifierPrivateKey =
    process.env.CRE_VERIFIER_PRIVATE_KEY;

  if (!verifierPrivateKey) {
    throw new Error(
      "CRE_VERIFIER_PRIVATE_KEY is unconfigured in environment"
    );
  }

  const verifierSigner = new ethers.Wallet(
    verifierPrivateKey
  );

  const signature = await verifierSigner.signTypedData(
    domain,
    EIP712_TYPES,
    message
  );

  runtime.log(
    `[CRE] Identity attestation generated for wallet ${normalizedWallet}`
  );

  // ==========================================================
  // 13. RETURN ATTESTATION
  // ==========================================================

  return JSON.stringify({
    approved: true,
    decision,
    score: riskResult.score,
    reason: llmReason,
    wallet: normalizedWallet,
    identityHash,
    nonce,
    deadline,
    signature,
  });
};

// ============================================================
// RARIMO IDENTITY VALIDATION
// ============================================================

function verifyRarimoProof(
  proof: Record<string, any>,
  expectedNullifier: string,
  expectedNationality: string
) {
  if (!proof || typeof proof !== "object") {
    return {
      valid: false,
      nationality: null,
      ageAbove17: false,
      passportExpired: false,
      authLevel: "UNKNOWN",
    };
  }

  const proofNullifier =
    proof.nullifier || proof.nullifierHash;

  const proofNationality =
    proof.nationality || proof.countryCode;

  // Make sure the nullifier supplied by Rarimo
  // matches the identityHash being registered.
  if (
    proofNullifier &&
    proofNullifier.toLowerCase() !==
      expectedNullifier.toLowerCase()
  ) {
    return {
      valid: false,
      nationality: null,
      ageAbove17: false,
      passportExpired: false,
      authLevel: "UNKNOWN",
    };
  }

  return {
    valid: true,

    nullifier: expectedNullifier,

    nationality:
      proofNationality || expectedNationality,

    ageAbove17: Boolean(proof.ageAbove17),

    passportExpired:
      Boolean(proof.passportExpired),

    authLevel:
      String(proof.authLevel || "AA"),
  };
}

// ============================================================
// WORKFLOW
// ============================================================

const initWorkflow = (config: Config) => {
  const httpCapability =
    new cre.capabilities.HTTPCapability();

  const httpTrigger =
    httpCapability.trigger({});

  return [
    cre.handler(
      httpTrigger,
      onHttpTrigger
    ),
  ];
};

// ============================================================
// MAIN
// ============================================================

export async function main() {
  const runner =
    await Runner.newRunner<Config>();

  await runner.run(initWorkflow);
}

main();
