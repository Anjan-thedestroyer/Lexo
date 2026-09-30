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
  normalizeIdentitySignals,
  runIdentityRuleEngine,
  decisionEngine,
} from "../utils/rules.engine.ts";

import { fetchLLMExplanation } from "../utils/llm.service.ts";

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

type IdentityRegistrationRequest = {
  verificationId: string;
  userId: string;
  wallet: string;
  identityHash: string;
  nationality: string;
  rarimoProof: unknown;

  ageAbove17: boolean;
  passportExpired: boolean;
  authLevel: string;
};

// ============================================================
// ABI
// ============================================================

const IDENTITY_REGISTER_ABI = [
  "function nonces(address) view returns (uint256)",
];

// ============================================================
// EIP-712 TYPES
// ============================================================

const EIP712_TYPES = {
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
};

// ============================================================
// HTTP HANDLER
// ============================================================

const onHttpTrigger = async (
  runtime: Runtime<Config>,
  payload: HTTPPayload
): Promise<string> => {
  runtime.log(
    "[CRE] Identity registration request received"
  );

  try {
    // ==========================================================
    // 1. DECODE PAYLOAD
    // ==========================================================

    if (
      !payload.input ||
      payload.input.length === 0
    ) {
      throw new Error(
        "Empty HTTP payload received"
      );
    }

    const request =
      decodeJson(
        payload.input
      ) as IdentityRegistrationRequest;

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
    } = request;

    // ==========================================================
    // 2. VALIDATE
    // ==========================================================

    if (
      !verificationId ||
      !userId ||
      !wallet ||
      !identityHash ||
      !nationality ||
      !rarimoProof
    ) {
      throw new Error(
        "Missing required payload properties"
      );
    }

    if (!ethers.isAddress(wallet)) {
      throw new Error(
        `Invalid EVM wallet address: ${wallet}`
      );
    }

    if (
      !ethers.isHexString(
        identityHash,
        32
      )
    ) {
      throw new Error(
        "identityHash must be a valid 32-byte hex string"
      );
    }

    // ==========================================================
    // 3. NORMALIZE WALLET
    // ==========================================================

    const normalizedWallet =
      ethers.getAddress(wallet);

    runtime.log(
      `[CRE] Evaluating identity for ${normalizedWallet}`
    );

    // ==========================================================
    // 4. NORMALIZE IDENTITY SIGNALS
    // ==========================================================

    const signals =
      normalizeIdentitySignals({
        nationality,
        ageAbove17,
        passportExpired,
        authLevel,
      });

    runtime.log(
      `[CRE] Country risk: ` +
      `code=${signals.countryRisk.countryCode}, ` +
      `score=${signals.countryRisk.score}, ` +
      `level=${signals.countryRisk.level}`
    );

    // ==========================================================
    // 5. RULE ENGINE
    // ==========================================================

    const riskResult =
      runIdentityRuleEngine(
        signals
      );

    // ==========================================================
    // 6. DECISION
    // ==========================================================

    const decision =
      decisionEngine(
        riskResult.tier
      );

    runtime.log(
      `[CRE] Identity risk score: ${riskResult.score}/100`
    );

    runtime.log(
      `[CRE] Identity tier: ${riskResult.tier}`
    );

    runtime.log(
      `[CRE] Identity decision: ${decision}`
    );

    // ==========================================================
    // 7. LLM EXPLANATION
    // ==========================================================

    let llmReason =
      `Identity verification evaluated with ` +
      `risk score of ${riskResult.score}/100. ` +
      `Decision: ${decision}.`;

    try {
      llmReason =
        await fetchLLMExplanation({
          type: "IDENTITY",

          wallet:
            normalizedWallet,

          riskScore:
            riskResult.score,

          riskTier:
            riskResult.tier,

          decision,

          signals,

          nationality:
            signals.nationality,

          countryRisk:
            signals.countryRisk,
        });
    } catch (error) {
      runtime.log(
        `[CRE] LLM explanation failed: ${String(error)}`
      );
    }

    // ==========================================================
    // 8. MANUAL REVIEW / REJECTION
    // ==========================================================

    if (
      decision !== "APPROVE"
    ) {
      runtime.log(
        `[CRE] Attestation not issued. Decision=${decision}`
      );

      return JSON.stringify({
        approved: false,

        decision,

        score:
          riskResult.score,

        tier:
          riskResult.tier,

        reason:
          llmReason,

        wallet:
          normalizedWallet,

        identityHash,

        verificationId,

        userId,

        countryRisk:
          signals.countryRisk,

        nonce:
          null,

        deadline:
          null,

        signature:
          null,
      });
    }

    // ==========================================================
    // 9. TARGET NETWORK
    // ==========================================================

    const network =
      getNetwork({
        chainFamily: "evm",

        chainSelectorName:
          runtime.config.evm
            .chainSelectorName,

        isTestnet: true,
      });

    if (!network) {
      throw new Error(
        `Target EVM network selection failed: ` +
        `${runtime.config.evm.chainSelectorName}`
      );
    }

    const evmClient =
      new cre.capabilities.EVMClient(
        network.chainSelector.selector
      );

    // ==========================================================
    // 10. GET NONCE
    // ==========================================================

    const nonceInterface =
      new ethers.Interface(
        IDENTITY_REGISTER_ABI
      );

    const nonceCallData =
      nonceInterface.encodeFunctionData(
        "nonces",
        [
          normalizedWallet,
        ]
      );

    const callerAddress =
      normalizedWallet as `0x${string}`;

    const nonceResult =
      evmClient
  .callContract(
    runtime,
    {
      call: encodeCallMsg({
        from: callerAddress,
        to: runtime.config.evm.identityRegisterAddress as `0x${string}`,
        data: nonceCallData as `0x${string}`,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    }
  )
  .result();

    if (!nonceResult.data) {
      throw new Error(
        "EVM call for 'nonces' returned empty byte stream"
      );
    }

    const decodedNonce =
      nonceInterface.decodeFunctionResult(
        "nonces",
        bytesToHex(
          nonceResult.data
        )
      );

    const nonce =
      decodedNonce[0].toString();

    runtime.log(
      `[CRE] Identity nonce: ${nonce}`
    );

    // ==========================================================
    // 11. DEADLINE
    // ==========================================================

    const blockTimestamp =
      Math.floor(
        runtime.now().getTime() /
          1000
      );

    const roundedTimestamp =
      Math.floor(
        blockTimestamp / 300
      ) * 300;

    const deadline =
      roundedTimestamp + 3600;

    // ==========================================================
    // 12. EIP-712 DOMAIN
    // ==========================================================

    const domain = {
      name:
        "Lexo IdentityRegister",

      version:
        "1",

      chainId:
        Number(network.chainId),

      verifyingContract:
        runtime.config.evm
          .identityRegisterAddress,
    };

    // ==========================================================
    // 13. REGISTER IDENTITY MESSAGE
    // ==========================================================

    const message = {
      wallet:
        normalizedWallet,

      identityHash,

      nonce,

      deadline,
    };

    // ==========================================================
    // 14. VERIFIER KEY
    // ==========================================================

    const verifierPrivateKeySecret =
      await runtime.getSecret({
        id:
          "CRE_VERIFIER_PRIVATE_KEY",
      }).result();

    const verifierPrivateKey =
      verifierPrivateKeySecret.value;

    if (!verifierPrivateKey) {
      throw new Error(
        "CRE_VERIFIER_PRIVATE_KEY is unconfigured in environment"
      );
    }

    const verifierSigner =
      new ethers.Wallet(
        verifierPrivateKey
      );

    // ==========================================================
    // 15. SIGN
    // ==========================================================

    const signature =
      await verifierSigner.signTypedData(
        domain,
        EIP712_TYPES,
        message
      );

    runtime.log(
      `[CRE] RegisterIdentity attestation generated`
    );

    // ==========================================================
    // 16. RETURN
    // ==========================================================

    return JSON.stringify({
      approved: true,

      decision,

      score:
        riskResult.score,

      tier:
        riskResult.tier,

      reason:
        llmReason,

      wallet:
        normalizedWallet,

      identityHash,

      verificationId,

      userId,

      countryRisk:
        signals.countryRisk,

      nonce,

      deadline,

      signature,
    });
  } catch (error) {
    runtime.log(
      `[CRE] Identity registration workflow failed: ${String(error)}`
    );

    throw error;
  }
};

// ============================================================
// WORKFLOW
// ============================================================

const initWorkflow = (
  config: Config
) => {
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

  await runner.run(
    initWorkflow
  );
}

main().catch((err) => {
  console.error(
    "[CRE] Workflow failed to initialize in identity registration:",
    err
  );
});
