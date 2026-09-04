import fetch from "node-fetch";

const CRE_DON_ENDPOINT = process.env.CRE_DON_ENDPOINT || "https://cre-node-cluster.network/request-attestation";

export const startIdentityVerification = async ({
  verificationId,
  userId,
  rootWalletAddress,
  passportHash,
  nationality,
  rarimoProof,
}) => {
  // 1. Trigger CRE DON
  const response = await fetch(CRE_DON_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verificationId,
      userId,
      wallet: rootWalletAddress,
      identityHash: passportHash,
      nationality,
      rarimoProof,
    }),
  });

  if (!response.ok) {
    throw new Error(`CRE execution failed with status: ${response.status}`);
  }

  const result = await response.json();

  // result contains: { approved, decision, score, identityHash, deadline, signature }
  return result;
};

export default { startIdentityVerification };