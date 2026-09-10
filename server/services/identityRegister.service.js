import mongoose from "mongoose";
import User from "../model/User.model.js";
import PassportModel from "../model/passport.model.js";
import Wallet from "../model/Wallet.model.js";
import Verification from "../model/Verification.model.js";
import creService from "./cre.service.js";
import screenWallet from "./AML.service.js";
const identityRegisterService = async ({
  email,
  phone,
  password,
  rootWalletAddress,
  identityHash,
  nationality,
  rarimoProof,
}) => {
  const normalizedWallet = rootWalletAddress.toLowerCase();

  // 1. Uniqueness Checks this is disable for now.
//   const existingPassport = await Passport.findOne({ identityHash });
//   if (existingPassport) {
//     throw new Error("Identity is already registered");
//   }

  const walletData = await screenWallet(normalizedWallet)
  const existingWallet = await Wallet.findOne({
    address: normalizedWallet,
    status: "Active",
  });
  if (existingWallet) {
    throw new Error("Wallet is already registered");
  }

  // 2. Atomic Database Insertion via Transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  let user, passport, wallet, verification;

  try {
    user = new User({
      email,
      phone,
      password,
      identityVerification: "PROCESSING",
    });

    passport = new PassportModel({
      identityHash,
      citizenship: nationality,
      user: user._id,
      status: "Requested",
    });

    wallet = new Wallet({
      address: normalizedWallet,
      user: user._id,
      status: "Active",
    });

    verification = new Verification({
      user: user._id,
      passport: passport._id,
      status: "PROCESSING",
      rarimoProof,
    });

    user.passport = passport._id;
    user.wallets = [wallet._id];
    user.rootWallet = wallet._id;

    await Promise.all([
      user.save({ session }),
      passport.save({ session }),
      wallet.save({ session }),
      verification.save({ session }),
    ]);

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  // 3. External CRE Verification Phase
  try {
    const attestation = await creService.startIdentityVerification({
      verificationId: verification._id.toString(),
      userId: user._id.toString(),
      rootWalletAddress: normalizedWallet,
      identityHash,
      nationality,
      rarimoProof,
      walletData
    });

    if (!attestation.approved) {
      throw new Error(attestation.reason || "Identity verification rejected by CRE");
    }

    // Mark as Approved
    await Promise.all([
      Verification.findByIdAndUpdate(verification._id, {
        status: "APPROVED",
        riskScore: attestation.score,
      }),
      User.findByIdAndUpdate(user._id, {
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
        identityHash: attestation.identityHash,
        nonce: attestation.nonce,
        deadline: attestation.deadline,
        signature: attestation.signature,
      },
    };
  } catch (error) {
    // Sync rejection state across all related records
    await Promise.all([
      Verification.findByIdAndUpdate(verification._id, { status: "REJECTED" }),
      User.findByIdAndUpdate(user._id, { identityVerification: "REJECTED" }),
      PassportModel.findByIdAndUpdate(passport._id, { status: "Rejected" }),
    ]);

    throw error;
  }
};

export default identityRegisterService;