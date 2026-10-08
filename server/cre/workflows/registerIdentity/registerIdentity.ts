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
   CONFIG
   ========================================================= */

const CHAIN_SELECTOR_NAME = "ethereum-testnet-sepolia";
const CHAIN_ID = 11155111;

const IDENTITY_REGISTER_ADDRESS =
  "0x7c827d0293b7ed891ed589542d1d11450590812d" as Address;

/* =========================================================
   CONTRACT ABI
   ========================================================= */

const IDENTITY_REGISTER_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [
      {
        name: "wallet",
        type: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "verifier",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
      },
    ],
  },
] as const;

/* =========================================================
   INPUT TYPE
   ========================================================= */

type RegisterIdentityPayload = {
  verificationId: string;
  userId: string;
  wallet: string;
  identityHash: string;
  nationality: string;
  rarimoProof?: unknown;
  ageAbove17: boolean;
  passportExpired: boolean;
  authLevel: string;
  deadline?: number;
};

/* =========================================================
   WORKFLOW CONFIG
   ========================================================= */

type WorkflowConfig = Record<string, never>;

/* =========================================================
   HELPERS
   ========================================================= */

function assertBytes32(
  value: string,
  field: string
): Hex {
  if (!isHex(value) || value.length !== 66) {
    throw new Error(
      `${field} must be a valid bytes32 value`
    );
  }

  return value as Hex;
}

function decodeNonce(
  data: Uint8Array
): bigint {
  const raw = bytesToHex(data);

  return decodeFunctionResult({
    abi: IDENTITY_REGISTER_ABI,
    functionName: "nonces",
    data: raw,
  });
}

function decodeVerifier(
  data: Uint8Array
): Address {
  const raw = bytesToHex(data);

  const verifier = decodeFunctionResult({
    abi: IDENTITY_REGISTER_ABI,
    functionName: "verifier",
    data: raw,
  });

  return getAddress(verifier);
}

/* =========================================================
   HTTP HANDLER
   ========================================================= */

const onHttpTrigger = async (
  runtime: Runtime<WorkflowConfig>,
  payload: HTTPPayload
): Promise<string> => {
  runtime.log(
    "[CRE] Identity registration request received"
  );

  try {
    /* =======================================================
       DECODE INPUT
       ======================================================= */

    if (
      !payload.input ||
      payload.input.length === 0
    ) {
      throw new Error(
        "Empty HTTP payload received"
      );
    }

    /*
     * CRE decodeJson accepts the payload only.
     * The TypeScript type is applied afterwards.
     */
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
      authLevel,
      deadline: suppliedDeadline,
    } = input;

    /* =======================================================
       BASIC VALIDATION
       ======================================================= */

    if (!verificationId) {
      throw new Error(
        "verificationId is required"
      );
    }

    if (!userId) {
      throw new Error(
        "userId is required"
      );
    }

    if (!wallet || !isAddress(wallet)) {
      throw new Error(
        "Invalid wallet address"
      );
    }

    if (!identityHash) {
      throw new Error(
        "identityHash is required"
      );
    }

    if (!nationality) {
      throw new Error(
        "nationality is required"
      );
    }

    const normalizedWallet =
      getAddress(wallet);

    const normalizedIdentityHash =
      assertBytes32(
        identityHash,
        "identityHash"
      );

    /* =======================================================
       INPUT LOGGING
       ======================================================= */

    runtime.log(
      `[CRE] Chain selector: ${CHAIN_SELECTOR_NAME}`
    );

    runtime.log(
      `[CRE] Chain ID: ${CHAIN_ID}`
    );

    runtime.log(
      `[CRE] IdentityRegister: ${IDENTITY_REGISTER_ADDRESS}`
    );

    runtime.log(
      "[CRE] INPUT VALUES"
    );

    runtime.log(
      `verificationId: ${verificationId}`
    );

    runtime.log(
      `userId: ${userId}`
    );

    runtime.log(
      `wallet: ${normalizedWallet}`
    );

    runtime.log(
      `identityHash: ${normalizedIdentityHash}`
    );

    runtime.log(
      `nationality: ${nationality}`
    );

    runtime.log(
      `rarimoProof present: ${
        rarimoProof !== undefined &&
        rarimoProof !== null
      }`
    );

    runtime.log(
      `ageAbove17: ${ageAbove17}`
    );

    runtime.log(
      `passportExpired: ${passportExpired}`
    );

    runtime.log(
      `authLevel: ${authLevel}`
    );

    /* =======================================================
       IDENTITY SIGNALS
       ======================================================= */

    const identitySignals =
      normalizeIdentitySignals({
        nationality,
        ageAbove17,
        passportExpired,
        authLevel,
        rarimoProof,
      });

    runtime.log(
      "[CRE] IDENTITY SIGNALS"
    );

    runtime.log(
      `Country code: ${identitySignals.countryRisk.countryCode}`
    );

    runtime.log(
      `Country score: ${identitySignals.countryRisk.score}`
    );

    runtime.log(
      `Country level: ${identitySignals.countryRisk.level}`
    );

    runtime.log(
      `Nationality: ${identitySignals.nationality}`
    );

    /* =======================================================
       DETERMINISTIC RULE ENGINE
       ======================================================= */

    const ruleResult =
      runIdentityRuleEngine(
        identitySignals
      );

    runtime.log(
      "[CRE] RULE ENGINE RESULT"
    );

    runtime.log(
      `Risk score: ${ruleResult.score}/100`
    );

    runtime.log(
      `Risk tier: ${ruleResult.tier}`
    );

    /*
     * RiskResult contains only:
     *   score
     *   tier
     *
     * Decision is derived separately.
     */
    const decision =
      decisionEngine(
        ruleResult.tier
      );

    const approved =
      decision === "APPROVE";

    runtime.log(
      `Decision: ${decision}`
    );

    /* =======================================================
       COUNTRY RISK
       ======================================================= */

    const countryRisk = {
      ...identitySignals.countryRisk,
      country:
        identitySignals.countryRisk.country ??
        "",
    };

    /* =======================================================
       LLM EXPLANATION
       ======================================================= */

    /*
     * The LLM is explanatory only.
     *
     * It does NOT:
     * - calculate risk
     * - change the score
     * - change the tier
     * - change the decision
     */

    const explanation =
      fetchLLMExplanation(
        runtime,
        {
          type: "IDENTITY",

          wallet:
            normalizedWallet,

          riskScore:
            ruleResult.score,

          riskTier:
            ruleResult.tier,

          decision,

          signals:
            identitySignals,

          nationality:
            identitySignals.nationality,

          countryRisk:
            identitySignals.countryRisk,
        }
      );

    runtime.log(
      `[CRE] LLM explanation: ${explanation}`
    );

    /* =======================================================
       REJECTED IDENTITY
       ======================================================= */

    if (!approved) {
      runtime.log(
        "[CRE] Identity rejected. No attestation generated."
      );

      return JSON.stringify({
        approved: false,

        decision,

        score:
          ruleResult.score,

        tier:
          ruleResult.tier,

        reason:
          explanation,

        wallet:
          normalizedWallet,

        identityHash:
          normalizedIdentityHash,

        verificationId,

        userId,

        countryRisk,

        nonce: null,

        deadline: null,

        signature: null,

        contract:
          IDENTITY_REGISTER_ADDRESS,

        chainId:
          CHAIN_ID,

        verifier: null,
      });
    }

    /* =======================================================
       RESOLVE EVM NETWORK
       ======================================================= */

    runtime.log(
      "[CRE] RESOLVING EVM NETWORK"
    );

    const network =
      getNetwork({
        chainFamily: "evm",
        chainSelectorName:
          CHAIN_SELECTOR_NAME,
        isTestnet: true,
      });

    if (!network) {
      throw new Error(
        `Target EVM network not found: ${CHAIN_SELECTOR_NAME}`
      );
    }

    runtime.log(
      `[CRE] Network chain ID: ${network.chainId}`
    );

    runtime.log(
      `[CRE] Network selector: ${network.chainSelector.selector}`
    );

    const evmClient =
      new cre.capabilities.EVMClient(
        network.chainSelector.selector
      );

    runtime.log(
      "[CRE] EVMClient initialized"
    );

    /* =======================================================
       READ NONCE
       ======================================================= */

    runtime.log(
      "[CRE] Reading IdentityRegister nonce..."
    );

    const nonceCallData =
      encodeFunctionData({
        abi:
          IDENTITY_REGISTER_ABI,

        functionName:
          "nonces",

        args: [
          normalizedWallet,
        ],
      });

    runtime.log(
      `[CRE] Nonce calldata: ${nonceCallData}`
    );

    const nonceResult =
      evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from:
              normalizedWallet,

            to:
              IDENTITY_REGISTER_ADDRESS,

            data:
              nonceCallData,
          }),
        })
        .result();

    if (!nonceResult.data) {
      throw new Error(
        "EVM nonce call returned empty response"
      );
    }

    const nonce =
      decodeNonce(
        nonceResult.data
      );

    runtime.log(
      `[CRE] Current nonce: ${nonce.toString()}`
    );

    /* =======================================================
       READ ON-CHAIN VERIFIER
       ======================================================= */

    runtime.log(
      "[CRE] Reading on-chain verifier..."
    );

    const verifierCallData =
      encodeFunctionData({
        abi:
          IDENTITY_REGISTER_ABI,

        functionName:
          "verifier",
      });

    const verifierResult =
      evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from:
              normalizedWallet,

            to:
              IDENTITY_REGISTER_ADDRESS,

            data:
              verifierCallData,
          }),
        })
        .result();

    if (!verifierResult.data) {
      throw new Error(
        "EVM verifier call returned empty response"
      );
    }

    const onChainVerifier =
      decodeVerifier(
        verifierResult.data
      );

    runtime.log(
      `[CRE] On-chain verifier: ${onChainVerifier}`
    );

    /* =======================================================
       GET CRE VERIFIER PRIVATE KEY
       ======================================================= */

    const verifierPrivateKeySecret =
      runtime
        .getSecret({
          id:
            "CRE_VERIFIER_PRIVATE_KEY",
        })
        .result();

    if (!verifierPrivateKeySecret) {
      throw new Error(
        "CRE_VERIFIER_PRIVATE_KEY secret is not configured"
      );
    }

    const verifierPrivateKey =
      verifierPrivateKeySecret.value;

    if (
      typeof verifierPrivateKey !==
        "string" ||
      !verifierPrivateKey
    ) {
      throw new Error(
        "CRE_VERIFIER_PRIVATE_KEY secret has no value"
      );
    }

    /* =======================================================
       CREATE SIGNER
       ======================================================= */

    const verifierAccount =
      privateKeyToAccount(
        verifierPrivateKey as `0x${string}`
      );

    const signingAddress =
      getAddress(
        verifierAccount.address
      );

    runtime.log(
      `[CRE] Signing verifier address: ${signingAddress}`
    );

    /* =======================================================
       VERIFY SIGNER
       ======================================================= */

    if (
      signingAddress.toLowerCase() !==
      onChainVerifier.toLowerCase()
    ) {
      throw new Error(
        `Verifier mismatch. On-chain=${onChainVerifier}, CRE=${signingAddress}`
      );
    }

    runtime.log(
      "[CRE] Verifier address matches contract"
    );

    /* =======================================================
       DEADLINE
       ======================================================= */

    const deadline =
      suppliedDeadline ??
      Math.floor(
        Date.now() / 1000
      ) + 15 * 60;

    if (
      !Number.isSafeInteger(
        deadline
      ) ||
      deadline <= 0
    ) {
      throw new Error(
        "Invalid attestation deadline"
      );
    }

    runtime.log(
      `[CRE] Attestation deadline: ${deadline}`
    );

    /* =======================================================
       EIP-712 SIGNATURE
       ======================================================= */

    runtime.log(
      "[CRE] Creating EIP-712 attestation..."
    );

    const signature =
      await verifierAccount.signTypedData({
        domain: {
          name:
            "Lexo IdentityRegister",

          version:
            "1",

          chainId:
            CHAIN_ID,

          verifyingContract:
            IDENTITY_REGISTER_ADDRESS,
        },

        types: {
          RegisterIdentity: [
            {
              name:
                "wallet",

              type:
                "address",
            },

            {
              name:
                "identityHash",

              type:
                "bytes32",
            },

            {
              name:
                "nonce",

              type:
                "uint256",
            },

            {
              name:
                "deadline",

              type:
                "uint256",
            },
          ],
        },

        primaryType:
          "RegisterIdentity",

        message: {
          wallet:
            normalizedWallet,

          identityHash:
            normalizedIdentityHash,

          nonce,

          deadline:
            BigInt(deadline),
        },
      });

    runtime.log(
      "[CRE] EIP-712 signature generated"
    );

    /* =======================================================
       FINAL RESPONSE
       ======================================================= */

    runtime.log(
      "[CRE] IDENTITY ATTESTATION READY"
    );

    return JSON.stringify({
      approved: true,

      decision,

      score:
        ruleResult.score,

      tier:
        ruleResult.tier,

      reason:
        explanation,

      wallet:
        normalizedWallet,

      identityHash:
        normalizedIdentityHash,

      verificationId,

      userId,

      countryRisk,

      nonce:
        nonce.toString(),

      deadline,

      signature,

      contract:
        IDENTITY_REGISTER_ADDRESS,

      chainId:
        CHAIN_ID,

      verifier:
        onChainVerifier,
    });
  } catch (error) {
    runtime.log(
      `[CRE] Identity registration workflow failed: ${String(error)}`
    );

    throw error;
  }
};

/* =========================================================
   HTTP TRIGGER
   ========================================================= */

const httpCapability =
  new cre.capabilities.HTTPCapability();

const httpTrigger =
  httpCapability.trigger({
    authorizedKeys: [],
  });

/* =========================================================
   WORKFLOW
   ========================================================= */

export async function initWorkflow() {
  return [
    cre.handler(
      httpTrigger,
      onHttpTrigger
    ),
  ];
}

/* =========================================================
   ENTRYPOINT
   ========================================================= */

export async function main() {
  const runner =
    await Runner.newRunner<WorkflowConfig>();

  await runner.run(initWorkflow);
}

main().catch((error) => {
  console.error(
    "[CRE] Workflow failed to initialize:",
    error
  );
});

