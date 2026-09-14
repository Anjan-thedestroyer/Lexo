const CRE_IDENTITY_ENDPOINT =
  process.env.CRE_IDENTITY_ENDPOINT;

const CRE_WALLET_ENDPOINT =
  process.env.CRE_WALLET_ENDPOINT;

const REQUEST_TIMEOUT_MS = 15000;

// Shared HTTP headers
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// ============================================================
// HTTP CLIENT 1: INITIAL IDENTITY VERIFICATION
// ============================================================

const startIdentityVerification = async ({
  verificationId,
  userId,
  rootWalletAddress,
  identityHash,
  nationality,
  rarimoProof,
  walletData,
}) => {
  let response;

  try {
    response = await fetch(CRE_IDENTITY_ENDPOINT, {
      method: "POST",
      headers: DEFAULT_HEADERS,
      body: JSON.stringify({
        verificationId,
        userId,
        wallet: rootWalletAddress,
        identityHash,
        nationality,
        rarimoProof,
        walletData,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Identity verification request timed out after ${REQUEST_TIMEOUT_MS}ms`
      );
    }
    throw new Error(
      `Identity verification network error: ${error.message}`
    );
  }

  if (!response.ok) {
    const errorBody = await response
      .text()
      .catch(() => "No error body");

    throw new Error(
      `Identity verification failed [HTTP ${response.status}]: ${errorBody}`
    );
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "Failed to parse JSON response from Identity Verification node"
    );
  }

  if (!result || typeof result.approved !== "boolean") {
    throw new Error(
      "Invalid response schema received from Identity Verification node"
    );
  }

  if (
    result.approved &&
    (!result.signature ||
      result.nonce === undefined ||
      result.deadline === undefined)
  ) {
    throw new Error(
      "Approved attestation is missing required cryptographic fields"
    );
  }

  return result;
};

// ============================================================
// HTTP CLIENT 2: ADD WALLET VERIFICATION
// ============================================================

const startWalletAdditionVerification = async ({
  verificationId,
  userId,
  walletAddress,
  identityHash,
  walletData,
}) => {
  let response;

  try {
    response = await fetch(CRE_WALLET_ENDPOINT, {
      method: "POST",
      headers: DEFAULT_HEADERS,
      body: JSON.stringify({
        verificationId,
        userId,
        wallet: walletAddress,
        identityHash,
        walletData,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Wallet addition request timed out after ${REQUEST_TIMEOUT_MS}ms`
      );
    }
    throw new Error(
      `Wallet addition network error: ${error.message}`
    );
  }

  if (!response.ok) {
    const errorBody = await response
      .text()
      .catch(() => "No error body");

    throw new Error(
      `Wallet addition failed [HTTP ${response.status}]: ${errorBody}`
    );
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "Failed to parse response from Wallet Addition node"
    );
  }

  if (!result || typeof result.approved !== "boolean") {
    throw new Error(
      "Invalid response schema received from Wallet Addition node"
    );
  }

  if (
    result.approved &&
    (!result.signature ||
      result.nonce === undefined ||
      result.deadline === undefined)
  ) {
    throw new Error(
      "Approved wallet attestation is missing required cryptographic fields"
    );
  }

  return result;
};

export default {
  startIdentityVerification,
  startWalletAdditionVerification,
};