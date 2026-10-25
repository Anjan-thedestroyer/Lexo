
import UserModel from "../model/User.model.js";
import PassportModel from "../model/Passport.model.js";
import Wallet from "../model/Wallet.model.js";
import Verification from "../model/Verification.model.js";
import creService from "./cre.service.js";
import screenWallet from "./AML.service.js";

const identityRegisterService = async ({
  userId,
  rootWalletAddress,
  identityHash,
  nationality,
  rarimoProof,
  ageAbove17,
  passportExpired,
}) => {
  // 1. Validate required input
  if (!userId) {
    throw new Error("User ID is required");
  }

  if (
    typeof rootWalletAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(rootWalletAddress)
  ) {
    throw new Error("A valid EVM wallet address is required");
  }

  if (typeof identityHash !== "string" || !identityHash.trim()) {
    throw new Error("Identity nullifier is required");
  }

  if (!nationality || !rarimoProof) {
    throw new Error("Nationality and identity proof are required");
  }

  const normalizedWallet = rootWalletAddress.toLowerCase();
  const normalizedIdentityHash = identityHash.trim();

  // 2. Get existing user
  const user = await UserModel.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.status && user.status !== "Active") {
    throw new Error("Account is not active");
  }

  // if (user.identityVerification === "APPROVED") {
  //   throw new Error("Identity is already approved");
  // }

  // if (
  //   user.identityVerification === "PROCESSING" ||
  //   user.identityVerification === "MANUAL_REVIEW"
  // ) {
  //   throw new Error("Identity verification is already in progress");
  // }

  // 3. Check for an already registered wallet
  const existingWallet = await Wallet.findOne({
    address: normalizedWallet,
  });

  if (existingWallet) {
    throw new Error("Wallet is already registered");
  }

  // 4. AML screen the wallet
  const walletData = await screenWallet(normalizedWallet);

  // 5. Create passport and verification records
  const passport = await PassportModel.create({
    identityHash: normalizedIdentityHash,
    nationality,
    user: user._id,
    status: "Requested",
  });

  const verification = await Verification.create({
    user: user._id,
    passport: passport._id,
    nullifier: normalizedIdentityHash,
    status: "PROCESSING",
    registrationStatus: "NOT_SUBMITTED",
  });

  user.passport = passport._id;
  user.identityVerification = "PROCESSING";
  await user.save();

  
  // 6. Send the request to CRE
  let attestation;

  try {
    attestation = await creService.startIdentityVerification({
      verificationId: verification._id.toString(),
      userId: user._id.toString(),
      rootWalletAddress: normalizedWallet,
      identityHash: normalizedIdentityHash,
      nationality,
      rarimoProof,
      ageAbove17,
      passportExpired,
      walletData,
    });
  } catch (error) {
    console.error(
      `CRE identity verification failed for ${verification._id}:`,
      error.message
    );

    await Promise.all([
      Verification.findByIdAndUpdate(verification._id, {
        status: "FAILED",
        registrationStatus: "NOT_SUBMITTED",
        shouldIssueAttestation: false,
        reasons: [`CRE technical failure: ${error.message}`],
      }),

      UserModel.findByIdAndUpdate(user._id, {
        identityVerification: "NOT_VERIFIED",
        passport: null,
      }),

      PassportModel.findByIdAndUpdate(passport._id, {
        status: "Requested",
      }),
    ]);

    throw error;
  }

  const validDecisions = ["APPROVE", "MANUAL_REVIEW", "REJECT"];

  if (
    !attestation ||
    !validDecisions.includes(attestation.decision)
  ) {
    throw new Error("Invalid decision returned by CRE");
  }

  
  
const commonUpdate = {
    score: attestation.score ?? null,
    tier: attestation.tier ?? null,
    decision: attestation.decision,

    reasons:
        attestation.reasons ??
        (attestation.reason ? [attestation.reason] : []),

    llmExplanation:
        attestation.llmExplanation ?? attestation.reason ?? null,

    // Prefer CRE's values; otherwise use the direct AML result.
    amlScore:
        attestation.amlScore ??
        walletData?.amlScore ??
        null,

    amlStatus:
        attestation.amlStatus ??
        walletData?.amlStatus ??
        "UNKNOWN",

    amlRiskLevel:
        attestation.amlRiskLevel ??
        walletData?.amlRiskLevel ??
        walletData?.riskLevel ??
        null,

    countryRiskScore:
        attestation.countryRisk?.score ?? null,

    shouldIssueAttestation: false,
};

  // 8. Manual review
  if (attestation.decision === "MANUAL_REVIEW") {
    await Promise.all([
      Verification.findByIdAndUpdate(verification._id, {
        ...commonUpdate,
        status: "MANUAL_REVIEW",
        registrationStatus: "NOT_SUBMITTED",
      }),
      UserModel.findByIdAndUpdate(user._id, {
        identityVerification: "MANUAL_REVIEW",
      }),
      PassportModel.findByIdAndUpdate(passport._id, {
        status: "ManualReview",
      }),
    ]);

    return {
      userId: user._id,
      verificationId: verification._id,
      identityVerification: "MANUAL_REVIEW",
      registrationStatus: "NOT_SUBMITTED",
      message: "Identity verification requires manual review",
      attestationPayload: null,
    };
  }

  // 9. Rejected
  if (attestation.decision === "REJECT") {
    await Promise.all([
      Verification.findByIdAndUpdate(verification._id, {
        ...commonUpdate,
        status: "REJECTED",
        registrationStatus: "NOT_SUBMITTED",
      }),
      UserModel.findByIdAndUpdate(user._id, {
        identityVerification: "REJECTED",
      }),
      PassportModel.findByIdAndUpdate(passport._id, {
        status: "Rejected",
      }),
    ]);

    return {
      userId: user._id,
      verificationId: verification._id,
      identityVerification: "REJECTED",
      registrationStatus: "NOT_SUBMITTED",
      message: attestation.reason || "Identity verification rejected",
      attestationPayload: null,
    };
  }

  // 10. Approved: require the cryptographic attestation
  if (
    typeof attestation.signature !== "string" ||
    !attestation.signature ||
    attestation.nonce === undefined ||
    attestation.deadline === undefined
  ) {
    throw new Error("CRE returned an incomplete identity attestation");
  }

  const attestationWallet = (
    attestation.wallet || normalizedWallet
  ).toLowerCase();

  const attestationIdentityHash =
    attestation.identityHash ?? normalizedIdentityHash;

  // Do not accept an attestation for a different wallet or identity.
  if (attestationWallet !== normalizedWallet) {
    throw new Error("CRE attestation wallet does not match the requested wallet");
  }

  if (attestationIdentityHash !== normalizedIdentityHash) {
    throw new Error("CRE attestation identity does not match the requested identity");
  }

  // Save the approval and payload.
  // VERIFIED here means off-chain identity approval only.
  await Promise.all([
    Verification.findByIdAndUpdate(verification._id, {
      ...commonUpdate,
      status: "VERIFIED",
      shouldIssueAttestation: true,
      registrationStatus: "NOT_SUBMITTED",
      attestationWallet,
      attestationIdentityHash,
      attestationNonce: String(attestation.nonce),
      attestationDeadline: String(attestation.deadline),
      attestationSignature: attestation.signature,
    }),
    UserModel.findByIdAndUpdate(user._id, {
      identityVerification: "APPROVED",
    }),
    PassportModel.findByIdAndUpdate(passport._id, {
      status: "Verified",
    }),
  ]);

  return {
    userId: user._id,
    verificationId: verification._id,
    identityVerification: "APPROVED",
    registrationStatus: "NOT_SUBMITTED",
    message: "Identity approved; on-chain registration is still required",
    attestationPayload: {
      wallet: attestationWallet,
      identityHash: attestationIdentityHash,
      nonce: String(attestation.nonce),
      deadline: String(attestation.deadline),
      signature: attestation.signature,
    },
  };
};

export default identityRegisterService;
