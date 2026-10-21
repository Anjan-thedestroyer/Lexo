
// const CRE_IDENTITY_ENDPOINT = process.env.CRE_IDENTITY_ENDPOINT;
// const CRE_WALLET_ENDPOINT = process.env.CRE_WALLET_ENDPOINT;

// const REQUEST_TIMEOUT_MS = 15000;

// const DEFAULT_HEADERS = {
//   "Content-Type": "application/json",
//   Accept: "application/json",
// };

// const VALID_DECISIONS = ["APPROVE", "MANUAL_REVIEW", "REJECT"];

// // ============================================================
// // SHARED HELPERS
// // ============================================================


// const postCRERequest = async ({ endpoint, body, errorPrefix }) => {
//   if (!endpoint) {
//     throw new Error(
//       `${errorPrefix}: endpoint environment variable is missing`
//     );
//   }

//   let response;

//   try {
//     response = await fetch(endpoint, {
//       method: "POST",
//       headers: DEFAULT_HEADERS,
//       body: JSON.stringify({input: body}),
//       signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
//     });
//   } catch (error) {
//     if (
//       error.name === "AbortError" ||
//       error.name === "TimeoutError"
//     ) {
//       throw new Error(
//         `${errorPrefix} request timed out after ${REQUEST_TIMEOUT_MS}ms`
//       );
//     }

//     throw new Error(
//       `${errorPrefix} network error: ${error.message}`
//     );
//   }

//   const responseText = await response.text();

//   console.log("[CRE] HTTP status:", response.status);
//   console.log(
//     "[CRE] Content-Type:",
//     response.headers.get("content-type")
//   );
//   console.log("[CRE] Raw response:", responseText);

//   if (!response.ok) {
//     throw new Error(
//       `${errorPrefix} failed [HTTP ${response.status}]: ${
//         responseText || "No error body"
//       }`
//     );
//   }

//   if (!responseText.trim()) {
//     throw new Error(
//       `${errorPrefix} returned an empty response body`
//     );
//   }

//   let data;

//   try {
//     data = JSON.parse(responseText);
//   } catch {
//     throw new Error(
//       `${errorPrefix} returned invalid JSON`
//     );
//   }

//   return data;
// };


// const validateCREDecision = (result, label) => {
//   if (!result || !VALID_DECISIONS.includes(result.decision)) {
//     throw new Error(
//       `Invalid decision returned by ${label}; expected APPROVE, MANUAL_REVIEW, or REJECT`
//     );
//   }

//   if (
//     result.decision === "APPROVE" &&
//     (
//       typeof result.signature !== "string" ||
//       !result.signature ||
//       result.nonce === undefined ||
//       result.deadline === undefined
//     )
//   ) {
//     throw new Error(
//       `Approved ${label} is missing required cryptographic attestation fields`
//     );
//   }

//   return result;
// };

// // ============================================================
// // HTTP CLIENT 1: INITIAL IDENTITY VERIFICATION
// // ============================================================

// const startIdentityVerification = async ({
//   verificationId,
//   userId,
//   rootWalletAddress,
//   identityHash,
//   nationality,
//   rarimoProof,
//   ageAbove17,
//   passportExpired,
//   walletData,
// }) => {
//   const result = await postCRERequest({
//     endpoint: CRE_IDENTITY_ENDPOINT,
//     errorPrefix: "Identity verification",
//     body: {
//       verificationId,
//       userId,
//       wallet: rootWalletAddress,
//       identityHash,
//       nationality,
//       rarimoProof,
//       ageAbove17,
//       passportExpired,
//       walletData,
//     },
//   });

//   return validateCREDecision(result, "Identity Verification workflow");
// };

// // ============================================================
// // HTTP CLIENT 2: ADD WALLET VERIFICATION
// // ============================================================

// const startWalletAdditionVerification = async ({
//   verificationId,
//   userId,
//   walletAddress,
//   identityHash,
//   walletData,
// }) => {
//   const result = await postCRERequest({
//     endpoint: CRE_WALLET_ENDPOINT,
//     errorPrefix: "Wallet addition",
//     body: {
//       verificationId,
//       userId,
//       wallet: walletAddress,
//       identityHash,
//       walletData,
//     },
//   });

//   return validateCREDecision(result, "Wallet Addition workflow");
// };

// export default {
//   startIdentityVerification,
//   startWalletAdditionVerification,
// };



import UserModel from "../model/User.model.js";
import PassportModel from "../model/Passport.model.js";
import Wallet from "../model/Wallet.model.js";
import Verification from "../model/Verification.model.js";
import creService from "./cre.service.js";
import screenWallet from "./AML.service.js";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// ============================================================
// CONFIGURATION
// ============================================================

const CRE_IDENTITY_ENDPOINT = process.env.CRE_IDENTITY_ENDPOINT;
const CRE_WALLET_ENDPOINT = process.env.CRE_WALLET_ENDPOINT;

const REQUEST_TIMEOUT_MS = 15000;
const CRE_SIMULATION_TIMEOUT_MS = 120000;

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

const VALID_DECISIONS = ["APPROVE", "MANUAL_REVIEW", "REJECT"];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRE_DIR = path.resolve(__dirname, "../cre");
const CRE_BIN = process.env.CRE_BIN || "cre";

// ============================================================
// SHARED HELPERS
// ============================================================

const validateCREDecision = (result, label) => {
  if (!result || !VALID_DECISIONS.includes(result.decision)) {
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
// LOCAL CRE SIMULATION: INITIAL IDENTITY VERIFICATION
// ============================================================


const runLocalIdentityCRE = async (body) => {
  const cliPayload = JSON.stringify(body);

  const args = [
    "workflow",
    "simulate",
    "workflows/registerIdentity",
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
    const result = await execFileAsync(CRE_BIN, args, {
      cwd: CRE_DIR,
      timeout: CRE_SIMULATION_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });

    stdout = result.stdout;
  } catch (error) {
    console.error(
      "[CRE] Local identity simulation failed:",
      error.stderr || error.message,
    );

    throw new Error(
      `Local CRE identity simulation failed: ${error.message}`,
    );
  }

  const output = stdout.replace(/\u001b\[[0-9;]*m/g, "");
  const marker = "Workflow Simulation Result:";
  const markerIndex = output.lastIndexOf(marker);

  if (markerIndex === -1) {
    console.error("[CRE] Simulation result marker not found.");
    console.error(output);
    throw new Error("CRE simulation result was not found in CLI output");
  }

  const resultText = output.slice(markerIndex + marker.length).trim();

  if (!resultText) {
    throw new Error("CRE simulation returned an empty result");
  }

  let result;

  try {
    // CRE prints the returned object as a JSON-encoded string.
    // Extract the first complete JSON string, ignoring trailing CLI logs.
    const firstQuote = resultText.indexOf('"');

    if (firstQuote === -1) {
      throw new Error("JSON result string was not found");
    }

    let escaped = false;
    let endQuote = -1;

    for (let i = firstQuote + 1; i < resultText.length; i++) {
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
      throw new Error("Incomplete JSON result string");
    }

    const jsonString = resultText.slice(firstQuote, endQuote + 1);
    result = JSON.parse(jsonString);

    if (typeof result === "string") {
      result = JSON.parse(result);
    }
  } catch (error) {
    console.error("[CRE] Failed to parse simulation output:", resultText);
    throw new Error(
      `Failed to parse CRE simulation result: ${error.message}`,
    );
  }

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("CRE simulation returned an invalid result object");
  }

  if (
    String(result.verificationId) !== String(body.verificationId) ||
    String(result.userId) !== String(body.userId)
  ) {
    throw new Error(
      "CRE result verificationId/userId does not match the request",
    );
  }

  console.log("[CRE] Local simulation result received:", {
    verificationId: result.verificationId,
    userId: result.userId,
    decision: result.decision,
  });

  return result;
};


// ============================================================
// EXISTING HTTP HELPER
// Preserved for the wallet-addition workflow.
// ============================================================

const postCRERequest = async ({ endpoint, body, errorPrefix }) => {
  if (!endpoint) {
    throw new Error(
      `${errorPrefix}: endpoint environment variable is missing`,
    );
  }

  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: DEFAULT_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error.name === "AbortError" ||
      error.name === "TimeoutError"
    ) {
      throw new Error(
        `${errorPrefix} request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }

    throw new Error(
      `${errorPrefix} network error: ${error.message}`,
    );
  }

  const responseText = await response.text();

  console.log("[CRE] HTTP status:", response.status);
  console.log(
    "[CRE] Content-Type:",
    response.headers.get("content-type"),
  );
  console.log("[CRE] Raw response:", responseText);

  if (!response.ok) {
    throw new Error(
      `${errorPrefix} failed [HTTP ${response.status}]: ${
        responseText || "No error body"
      }`,
    );
  }

  if (!responseText.trim()) {
    throw new Error(
      `${errorPrefix} returned an empty response body`,
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);

    // Support endpoints that return a JSON-encoded JSON string.
    if (typeof data === "string") {
      data = JSON.parse(data);
    }
  } catch {
    throw new Error(`${errorPrefix} returned invalid JSON`);
  }

  return data;
};

// ============================================================
// CLIENT 1: INITIAL IDENTITY VERIFICATION
// Uses local CRE simulation instead of HTTP fetch.
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
// Preserved: continues using the existing HTTP endpoint.
// ============================================================

const startWalletAdditionVerification = async ({
  verificationId,
  userId,
  walletAddress,
  identityHash,
  walletData,
}) => {
  const result = await postCRERequest({
    endpoint: CRE_WALLET_ENDPOINT,
    errorPrefix: "Wallet addition",
    body: {
      verificationId,
      userId,
      wallet: walletAddress,
      identityHash,
      walletData,
    },
  });

  return validateCREDecision(result, "Wallet Addition workflow");
};

// ============================================================
// EXPORTS
// ============================================================

export default {
  startIdentityVerification,
  startWalletAdditionVerification,
};
