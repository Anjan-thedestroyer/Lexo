const CRE_DON_ENDPOINT =
  process.env.CRE_DON_ENDPOINT ||
  "https://cre-node-cluster.network/request-attestation";

const REQUEST_TIMEOUT_MS = 15000;

// ============================================================
// INITIAL IDENTITY VERIFICATION
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
    response =
      await fetch(
        CRE_DON_ENDPOINT,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",
          },

          body:
            JSON.stringify({
              verificationId,
              userId,
              wallet:
                rootWalletAddress,
              identityHash,
              nationality,
              rarimoProof,
              walletData,
            }),

          signal:
            AbortSignal.timeout(
              REQUEST_TIMEOUT_MS
            ),
        }
      );
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      throw new Error(
        `CRE request timed out after ${REQUEST_TIMEOUT_MS}ms`
      );
    }

    throw new Error(
      `CRE network connection error: ${error.message}`
    );
  }

  // ==========================================================
  // CRE ERROR
  // ==========================================================

  if (!response.ok) {
    const errorBody =
      await response
        .text()
        .catch(
          () =>
            "No error body"
        );

    throw new Error(
      `CRE execution failed [HTTP ${response.status}]: ${errorBody}`
    );
  }

  // ==========================================================
  // PARSE RESPONSE
  // ==========================================================

  let result;

  try {
    result =
      await response.json();
  } catch {
    throw new Error(
      "Failed to parse JSON response from CRE DON node"
    );
  }

  // ==========================================================
  // VALIDATE RESPONSE
  // ==========================================================

  if (
    !result ||
    typeof result.approved !==
      "boolean"
  ) {
    throw new Error(
      "Invalid response schema received from CRE node"
    );
  }

  // ==========================================================
  // VALIDATE APPROVED ATTESTATION
  // ==========================================================

  if (
    result.approved
  ) {
    if (
      !result.signature ||
      result.nonce ===
        undefined ||
      result.deadline ===
        undefined
    ) {
      throw new Error(
        "Approved attestation is missing required cryptographic fields"
      );
    }
  }

  return result;
};

// ============================================================
// ADD WALLET VERIFICATION
// ============================================================

const startWalletAdditionVerification =
  async ({
    verificationId,
    userId,
    walletAddress,
    identityHash,
    walletData,
  }) => {
    let response;

    try {
      response =
        await fetch(
          CRE_DON_ENDPOINT,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body:
              JSON.stringify({
                verificationId,

                userId,

                wallet:
                  walletAddress,

                // Existing Rarimo nullifier
                identityHash,

                walletData,

                action:
                  "ADD_WALLET",
              }),

            signal:
              AbortSignal.timeout(
                REQUEST_TIMEOUT_MS
              ),
          }
        );
    } catch (error) {
      if (
        error.name ===
        "AbortError"
      ) {
        throw new Error(
          `CRE wallet addition request timed out after ${REQUEST_TIMEOUT_MS}ms`
        );
      }

      throw new Error(
        `CRE wallet addition network error: ${error.message}`
      );
    }

    // ========================================================
    // CRE ERROR
    // ========================================================

    if (!response.ok) {
      const errorBody =
        await response
          .text()
          .catch(
            () =>
              "No error body"
          );

      throw new Error(
        `CRE wallet addition failed [HTTP ${response.status}]: ${errorBody}`
      );
    }

    // ========================================================
    // PARSE RESPONSE
    // ========================================================

    let result;

    try {
      result =
        await response.json();
    } catch {
      throw new Error(
        "Failed to parse wallet addition response from CRE node"
      );
    }

    // ========================================================
    // VALIDATE RESPONSE
    // ========================================================

    if (
      !result ||
      typeof result.approved !==
        "boolean"
    ) {
      throw new Error(
        "Invalid wallet addition response from CRE node"
      );
    }

    // ========================================================
    // VALIDATE APPROVED ATTESTATION
    // ========================================================

    if (
      result.approved
    ) {
      if (
        !result.signature ||
        result.nonce ===
          undefined ||
        result.deadline ===
          undefined
      ) {
        throw new Error(
          "Approved wallet attestation is missing required cryptographic fields"
        );
      }
    }

    return result;
  };

export default {
  startIdentityVerification,
  startWalletAdditionVerification,
};