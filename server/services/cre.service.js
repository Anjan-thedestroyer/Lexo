
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// ============================================================
// CONFIGURATION
// ============================================================

const CRE_SIMULATION_TIMEOUT_MS = 120000;

const VALID_DECISIONS = [
  "APPROVE",
  "MANUAL_REVIEW",
  "REJECT",
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRE_DIR = path.resolve(__dirname, "../cre");
const CRE_BIN = process.env.CRE_BIN || "cre";

// ============================================================
// SHARED HELPERS
// ============================================================

const validateCREDecision = (result, label) => {
  if (
    !result ||
    !VALID_DECISIONS.includes(result.decision)
  ) {
    throw new Error(
      `Invalid decision returned by ${label}; expected APPROVE, MANUAL_REVIEW, or REJECT`,
    );
  }

  if (
    result.decision === "APPROVE" &&
    (
      typeof result.signature !== "string" ||
      !result.signature ||
      result.nonce === undefined ||
      result.deadline === undefined
    )
  ) {
    throw new Error(
      `Approved ${label} is missing required cryptographic attestation fields`,
    );
  }

  return result;
};

// ============================================================
// SHARED LOCAL CRE SIMULATION
// ============================================================

const runLocalCRE = async ({
  workflowPath,
  body,
  label,
}) => {
  const cliPayload = JSON.stringify(body);

  const args = [
    "workflow",
    "simulate",
    workflowPath,
    "--non-interactive",
    "--trigger-index",
    "0",
    "--http-payload",
    cliPayload,
    "--target",
    "staging-settings",
  ];

  let stdout;

  try {
    const result = await execFileAsync(
      CRE_BIN,
      args,
      {
        cwd: CRE_DIR,
        timeout: CRE_SIMULATION_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      },
    );

    stdout = result.stdout;
  } catch (error) {
    console.error(
      `[CRE] Local ${label} simulation failed:`,
      error.stderr || error.message,
    );

    throw new Error(
      `Local CRE ${label} simulation failed: ${error.message}`,
    );
  }

  const output = stdout.replace(
    /\u001b\[[0-9;]*m/g,
    "",
  );

  const marker =
    "Workflow Simulation Result:";

  const markerIndex =
    output.lastIndexOf(marker);

  if (markerIndex === -1) {
    console.error(
      `[CRE] ${label} simulation result marker not found.`,
    );

    console.error(output);

    throw new Error(
      `CRE ${label} simulation result was not found in CLI output`,
    );
  }

  const resultText = output
    .slice(markerIndex + marker.length)
    .trim();

  if (!resultText) {
    throw new Error(
      `CRE ${label} simulation returned an empty result`,
    );
  }

  let result;

  try {
    // CRE prints the returned object as a JSON-encoded string.
    // Extract the first complete JSON string.

    const firstQuote =
      resultText.indexOf('"');

    if (firstQuote === -1) {
      throw new Error(
        "JSON result string was not found",
      );
    }

    let escaped = false;
    let endQuote = -1;

    for (
      let i = firstQuote + 1;
      i < resultText.length;
      i++
    ) {
      const char = resultText[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        endQuote = i;
        break;
      }
    }

    if (endQuote === -1) {
      throw new Error(
        "Incomplete JSON result string",
      );
    }

    const jsonString = resultText.slice(
      firstQuote,
      endQuote + 1,
    );

    result = JSON.parse(jsonString);

    if (typeof result === "string") {
      result = JSON.parse(result);
    }
  } catch (error) {
    console.error(
      `[CRE] Failed to parse ${label} simulation output:`,
      resultText,
    );

    throw new Error(
      `Failed to parse CRE ${label} simulation result: ${error.message}`,
    );
  }

  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result)
  ) {
    throw new Error(
      `CRE ${label} simulation returned an invalid result`,
    );
  }

  if (
    String(result.verificationId) !==
      String(body.verificationId) ||
    String(result.userId) !==
      String(body.userId)
  ) {
    throw new Error(
      `CRE ${label} result verificationId/userId does not match the request`,
    );
  }

  console.log(
    `[CRE] Local ${label} simulation result received:`,
    {
      verificationId: result.verificationId,
      userId: result.userId,
      decision: result.decision,
    },
  );

  return result;
};

// ============================================================
// LOCAL CRE SIMULATION: INITIAL IDENTITY VERIFICATION
// ============================================================

const runLocalIdentityCRE = async (body) => {
  return runLocalCRE({
    workflowPath:
      "workflows/registerIdentity",
    body,
    label: "identity",
  });
};

// ============================================================
// LOCAL CRE SIMULATION: WALLET ADDITION
// ============================================================

const runLocalWalletCRE = async (body) => {
  return runLocalCRE({
    workflowPath:
      "workflows/addWallet",
    body,
    label: "wallet addition",
  });
};

// ============================================================
// CLIENT 1: INITIAL IDENTITY VERIFICATION
// ============================================================

const startIdentityVerification = async ({
  verificationId,
  userId,
  rootWalletAddress,
  identityHash,
  nationality,
  rarimoProof,
  ageAbove17,
  passportExpired,
  walletData,
}) => {
  const result = await runLocalIdentityCRE({
    verificationId,
    userId,
    wallet: rootWalletAddress,
    identityHash,
    nationality,
    rarimoProof,
    ageAbove17,
    passportExpired,
    walletData,
  });

  return validateCREDecision(
    result,
    "Identity Verification workflow",
  );
};

// ============================================================
// CLIENT 2: ADD WALLET VERIFICATION
// Uses local CRE simulation, same as identity registration.
// ============================================================

const startWalletAdditionVerification = async ({
  verificationId,
  userId,
  walletAddress,
  identityHash,
  walletData,
}) => {
  const result = await runLocalWalletCRE({
    verificationId,
    userId,
    wallet: walletAddress,
    identityHash,
    walletData,
  });

  return validateCREDecision(
    result,
    "Wallet Addition workflow",
  );
};

// ============================================================
// EXPORTS
// ============================================================

export default {
  startIdentityVerification,
  startWalletAdditionVerification,
};
