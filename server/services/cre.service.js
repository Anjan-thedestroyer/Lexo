const CRE_DON_ENDPOINT =
  process.env.CRE_DON_ENDPOINT ||
  "https://cre-node-cluster.network/request-attestation";

const REQUEST_TIMEOUT_MS = 15000; // 15-second timeout safeguard

const startIdentityVerification = async ({
  verificationId,
  userId,
  rootWalletAddress,
  identityHash,
  nationality,
  rarimoProof,
  walletData
}) => {
  let response;

  try {
    response = await fetch(CRE_DON_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        verificationId,
        userId,
        wallet: rootWalletAddress,
        identityHash,
        nationality,
        rarimoProof,
        walletData
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`CRE request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new Error(`CRE network connection error: ${error.message}`);
  }

  // 1. Handle HTTP status errors
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "No error body");
    throw new Error(
      `CRE execution failed [HTTP ${response.status}]: ${errorBody}`
    );
  }

  // 2. Safely parse JSON response
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Failed to parse JSON response from CRE DON node");
  }

  // 3. Validate response structure
  if (!result || typeof result.approved !== "boolean") {
    throw new Error("Invalid response schema received from CRE node");
  }

  // Ensure approval response contains valid attestation payload
  if (result.approved) {
    if (!result.signature || !result.nonce || !result.deadline) {
      throw new Error("Approved attestation is missing required cryptographic signatures");
    }
  }

  return result;
};

export default {
  startIdentityVerification,
};