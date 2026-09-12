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
  normalizeWalletSignals,
  runWalletRuleEngine,
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
  "function nonces(address) view returns (uint256)",
];

// ============================================================
// EIP-712 TYPES
// ============================================================
//
// IMPORTANT:
// Initial registration uses RegisterIdentity.
// Wallet addition uses LinkWallet.
//
// This MUST match the Solidity TYPEHASH:
//
// LinkWallet(
//   address wallet,
//   bytes32 identityHash,
//   uint256 nonce,
//   uint256 deadline
// )
//
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
};

// ============================================================
// HTTP HANDLER
// ============================================================

const onHttpTrigger = async (
  runtime: Runtime<Config>,
  payload: HTTPPayload
) => {
  runtime.log(
    "[CRE] Wallet addition request received"
  );

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
    ) as WalletAdditionRequest;

  const {
    verificationId,
    userId,
    wallet,
    identityHash,
    walletData,
  } = request;

  // ==========================================================
  // 2. VALIDATE
  // ==========================================================

  if (
    !verificationId ||
    !userId ||
    !wallet ||
    !identityHash ||
    !walletData
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
    `[CRE] Evaluating wallet ${normalizedWallet}`
  );

  // ==========================================================
  // 4. NORMALIZE AML SIGNALS
  // ==========================================================

  const signals =
    normalizeWalletSignals({
      amlScore:
        walletData.amlScore,

      ...walletData.amlData,
    });

  // ==========================================================
  // 5. WALLET RULE ENGINE
  // ==========================================================

  const riskResult =
    runWalletRuleEngine(
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
    `[CRE] Wallet risk score: ${riskResult.score}/100`
  );

  runtime.log(
    `[CRE] Wallet tier: ${riskResult.tier}`
  );

  runtime.log(
    `[CRE] Wallet decision: ${decision}`
  );

  // ==========================================================
  // 7. LLM EXPLANATION
  // ==========================================================

  let llmReason =
    `Wallet verification evaluated with ` +
    `risk score of ${riskResult.score}/100. ` +
    `Decision: ${decision}.`;

  try {
    llmReason =
      await fetchLLMExplanation({
        type:
          "ADD_WALLET",

        wallet:
          normalizedWallet,

        riskScore:
          riskResult.score,

        decision,

        signals,

        amlData:
          walletData.amlData,
      });
  } catch {
    runtime.log(
      "[CRE] LLM explanation failed. " +
      "Using deterministic fallback."
    );
  }

  // ==========================================================
  // 8. REJECTION
  // ==========================================================

  if (
    decision === "REJECT"
  ) {
    return JSON.stringify({
      approved:
        false,

      decision,

      score:
        riskResult.score,

      tier:
        riskResult.tier,

      reason:
        llmReason,

      wallet:
        normalizedWallet,

      // Existing Rarimo identity
      identityHash,

      verificationId,

      userId,

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
      chainFamily:
        "evm",

      chainSelectorName:
        runtime.config.evm
          .chainSelectorName,

      isTestnet:
        true,
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
  // 10. GET NONCE FOR NEW WALLET
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
    `[CRE] New wallet nonce: ${nonce}`
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
  // 13. LINK WALLET MESSAGE
  // ==========================================================

  const message = {
    wallet:
      normalizedWallet,

    // Existing Rarimo nullifier
    identityHash,

    nonce,

    deadline,
  };

  // ==========================================================
  // 14. VERIFIER KEY
  // ==========================================================

  // Fetching the private key securely from CRE secrets context
  const verifierPrivateKeySecret = await runtime.getSecret({
    id: "CRE_VERIFIER_PRIVATE_KEY",
  }).result();

const verifierPrivateKey = verifierPrivateKeySecret.value;
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
  // 15. SIGN LINK WALLET
  // ==========================================================

  const signature =
    await verifierSigner.signTypedData(
      domain,

      // IMPORTANT:
      // This is LinkWallet, NOT RegisterIdentity.
      EIP712_TYPES,

      message
    );

  runtime.log(
    `[CRE] LinkWallet attestation generated`
  );

  // ==========================================================
  // 16. RETURN ATTESTATION
  // ==========================================================

  return JSON.stringify({
    approved:
      true,

    decision,

    score:
      riskResult.score,

    tier:
      riskResult.tier,

    reason:
      llmReason,

    wallet:
      normalizedWallet,

    // SAME existing identity
    identityHash,

    verificationId,

    userId,

    nonce,

    deadline,

    signature,
  });
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
  console.error("[CRE] Workflow failed to initialize in add wallet:", err);
});