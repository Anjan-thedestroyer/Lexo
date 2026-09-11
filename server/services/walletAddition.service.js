import UserModel from "../model/user.model.js";
import Wallet from "../model/Wallet.model.js";
import Verification from "../model/Verification.model.js";

import creService from "./cre.service.js";
import screenWallet from "./AML.service.js";

const addWalletService = async ({
  userId,
  walletAddress,
}) => {
  // ==========================================================
  // 1. VALIDATE INPUT
  // ==========================================================

  if (!userId) {
    throw new Error(
      "User ID is required"
    );
  }

  if (!walletAddress) {
    throw new Error(
      "Wallet address is required"
    );
  }

  const normalizedWallet =
    walletAddress.toLowerCase();

  // ==========================================================
  // 2. GET USER
  // ==========================================================

  const user =
    await UserModel.findById(
      userId
    );

  if (!user) {
    throw new Error(
      "User not found"
    );
  }

  // ==========================================================
  // 3. USER MUST ALREADY BE VERIFIED
  // ==========================================================

  if (
    user.identityVerification !==
    "APPROVED"
  ) {
    throw new Error(
      "User identity has not been approved"
    );
  }

  // ==========================================================
  // 4. CHECK WALLET DUPLICATE
  // ==========================================================

  const existingWallet =
    await Wallet.findOne({
      address:
        normalizedWallet,
    });

  if (existingWallet) {
    throw new Error(
      "Wallet is already registered"
    );
  }

  // ==========================================================
  // 5. GET EXISTING VERIFIED IDENTITY
  // ==========================================================

  const verification =
    await Verification.findOne({
      UserModel:
        user._id,

      status:
        "VERIFIED",
    }).sort({
      createdAt:
        -1,
    });

  if (!verification) {
    throw new Error(
      "No verified identity found for this user"
    );
  }

  // ==========================================================
  // 6. REUSE EXISTING RARIMO NULLIFIER
  // ==========================================================

  const identityHash =
    verification.nullifier;

  if (!identityHash) {
    throw new Error(
      "Verified identity does not contain a nullifier"
    );
  }

  // ==========================================================
  // 7. AML SCREEN NEW WALLET
  // ==========================================================

  const walletData =
    await screenWallet(
      normalizedWallet
    );

  // ==========================================================
  // 8. CRE WALLET VERIFICATION
  // ==========================================================

  const attestation =
    await creService
      .startWalletAdditionVerification({
        verificationId:
          verification._id.toString(),

        userId:
          user._id.toString(),

        walletAddress:
          normalizedWallet,

        // Existing identity
        identityHash,

        walletData,
      });

  // ==========================================================
  // 9. HANDLE REJECTION
  // ==========================================================

  if (
    !attestation.approved
  ) {
    throw new Error(
      attestation.reason ||
        "Wallet verification rejected by CRE"
    );
  }

  // ==========================================================
  // 10. VALIDATE ATTESTATION
  // ==========================================================

  if (
    !attestation.signature ||
    attestation.nonce ===
      undefined ||
    attestation.deadline ===
      undefined
  ) {
    throw new Error(
      "CRE returned incomplete wallet attestation"
    );
  }

  // ==========================================================
  // 11. CREATE WALLET RECORD
  // ==========================================================

  const wallet =
    await Wallet.create({
      address:
        normalizedWallet,

      user:
        user._id,

      status:
        "Active",
    });

  // ==========================================================
  // 12. RETURN
  // ==========================================================

  return {
    userId:
      user._id,

    walletId:
      wallet._id,

    identityVerification:
      "APPROVED",

    attestationPayload: {
      wallet:
        normalizedWallet,

      // SAME RARIMO NULLIFIER
      identityHash:
        attestation.identityHash,

      nonce:
        attestation.nonce,

      deadline:
        attestation.deadline,

      signature:
        attestation.signature,
    },
  };
};

export default addWalletService;