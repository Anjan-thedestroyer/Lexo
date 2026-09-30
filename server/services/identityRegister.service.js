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
}) => {
  // ============================================================
  // 1. GET EXISTING USER
  // ============================================================

  if (!userId) {
    throw new Error("User ID is required");
  }

  const user = await UserModel.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.status && user.status !== "Active") {
    throw new Error("Account is not active");
  }

  // User already has an approved identity
  if (user.identityVerification === "APPROVED") {
    throw new Error("Identity is already approved");
  }

  // Prevent duplicate requests while one is being processed
  if (
    user.identityVerification === "PROCESSING" ||
    user.identityVerification === "MANUAL_REVIEW"
  ) {
    throw new Error("Identity verification is already in progress");
  }

  // ============================================================
  // 2. NORMALIZE ROOT WALLET
  // ============================================================

  const normalizedWallet = rootWalletAddress.toLowerCase();

  // ============================================================
  // 3. CHECK WHETHER WALLET ALREADY EXISTS
  // ============================================================

  const existingWallet = await Wallet.findOne({
    address: normalizedWallet,
  });

  if (existingWallet) {
    throw new Error("Wallet is already registered");
  }

  // ============================================================
  // 4. AML SCREEN ROOT WALLET
  // ============================================================

  // Wallet is screened but NOT stored yet.
  const walletData = await screenWallet(normalizedWallet);

  // ============================================================
  // 5. CREATE PASSPORT + VERIFICATION
  // ============================================================

  const passport = await PassportModel.create({
    identityHash,
    citizenship: nationality,
    user: user._id,
    status: "Requested",
  });

  const verification = await Verification.create({
    user: user._id,
    passport: passport._id,
    nullifier: identityHash,
    status: "PROCESSING",
  });

  // Link passport to existing user
  user.passport = passport._id;
  user.identityVerification = "PROCESSING";

  await user.save();

  // ============================================================
  // 6. SEND VERIFICATION TO CRE
  // ============================================================

  let attestation;

  try {
    attestation = await creService.startIdentityVerification({
      verificationId: verification._id.toString(),

      userId: user._id.toString(),

      rootWalletAddress: normalizedWallet,

      identityHash,

      nationality,

      rarimoProof,

      walletData,
    });
  } catch (error) {
    // ==========================================================
    // TECHNICAL / NETWORK FAILURE
    // ==========================================================

    // Do NOT mark this as REJECTED.
    // Rejection means the compliance engine rejected the user.
    // A network/CRE failure is only a processing failure.

    await Verification.findByIdAndUpdate(verification._id, {
      status: "PROCESSING",
      shouldIssueAttestation: false,
    });

    await UserModel.findByIdAndUpdate(user._id, {
      identityVerification: "PROCESSING",
    });

    await PassportModel.findByIdAndUpdate(passport._id, {
      status: "Requested",
    });

    throw error;
  }

  // ============================================================
  // 7. MANUAL REVIEW
  // ============================================================

  if (attestation.decision === "MANUAL_REVIEW") {
    await Promise.all([
      Verification.findByIdAndUpdate(verification._id, {
        status: "MANUAL_REVIEW",
        score: attestation.score ?? null,
        tier: attestation.tier ?? null,
        decision: "MANUAL_REVIEW",
        reasons:
          attestation.reasons ??
          (attestation.reason ? [attestation.reason] : []),
        llmExplanation:
          attestation.llmExplanation ?? attestation.reason ?? null,
        shouldIssueAttestation: false,
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

      message: "Identity verification requires manual review",

      attestationPayload: null,
    };
  }

  // ============================================================
  // 8. REJECTED
  // ============================================================

  if (attestation.decision === "REJECT") {
    await Promise.all([
      Verification.findByIdAndUpdate(verification._id, {
        status: "REJECTED",

        score: attestation.score ?? null,

        tier: attestation.tier ?? null,

        decision: "REJECT",

        reasons:
          attestation.reasons ??
          (attestation.reason ? [attestation.reason] : []),

        llmExplanation:
          attestation.llmExplanation ?? attestation.reason ?? null,

        shouldIssueAttestation: false,
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

      message: attestation.reason || "Identity verification rejected",

      attestationPayload: null,
    };
  }
  if (attestation.decision === "APPROVE") {
    // Make sure CRE actually returned the
    // cryptographic attestation.
    if (
      !attestation.signature ||
      attestation.nonce === undefined ||
      attestation.deadline === undefined
    ) {
      throw new Error("CRE returned an incomplete identity attestation");
    }

    await Promise.all([
      Verification.findByIdAndUpdate(verification._id, {
        status: "VERIFIED",

        score: attestation.score ?? null,

        tier: attestation.tier ?? null,

        decision: "APPROVE",

        reasons: attestation.reasons ?? [],

        llmExplanation:
          attestation.llmExplanation ?? attestation.reason ?? null,

        shouldIssueAttestation: true,
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

      attestationPayload: {
        wallet: normalizedWallet,

        identityHash: attestation.identityHash ?? identityHash,

        nonce: attestation.nonce,

        deadline: attestation.deadline,

        signature: attestation.signature,
      },
    };
  }
  throw new Error("Invalid decision returned by CRE");
};

export default identityRegisterService;
