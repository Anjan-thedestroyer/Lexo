import mongoose from "mongoose";
import UserModel from "../model/user.model.js";
import PassportModel from "../model/passport.model.js";
import Wallet from "../model/Wallet.model.js";
import Verification from "../model/Verification.model.js";
import creService from "./cre.service.js";
import screenWallet from "./AML.service.js";

const identityRegisterService = async ({
  name,
  email,
  phone,
  password,
  rootWalletAddress,
  identityHash,
  nationality,
  rarimoProof,
}) => {
  const normalizedWallet = rootWalletAddress.toLowerCase();

  // 1. Check whether this wallet is already registered.
  // Do this before running AML/CRE.
  const existingWallet = await Wallet.findOne({
    address: normalizedWallet,
  });

  if (existingWallet) {
    throw new Error("Wallet is already registered");
  }

  // 2. Screen the root wallet with AML.
  // The wallet address is used for screening but is NOT
  // stored in the Wallet collection yet.
  const walletData = await screenWallet(normalizedWallet);

  // 3. Create User, Passport and Verification records.
  // DO NOT create the Wallet record yet.
  const session = await mongoose.startSession();
  session.startTransaction();

  let user;
  let passport;
  let verification;

  try {
    user = new UserModel({
      name,
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

    verification = new Verification({
      user: user._id,
      passport: passport._id,
      nullifier: identityHash,
      status: "PROCESSING",
    });

    user.passport = passport._id;

    await Promise.all([
      user.save({ session }),
      passport.save({ session }),
      verification.save({ session }),
    ]);

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }

  // 4. Run CRE verification.
  try {
    const attestation =
      await creService.startIdentityVerification({
        verificationId: verification._id.toString(),
        userId: user._id.toString(),
        rootWalletAddress: normalizedWallet,
        identityHash,
        nationality,
        rarimoProof,
        walletData,
      });

    // 5. CRE rejected the identity.
    if (!attestation.approved) {
      await Promise.all([
        Verification.findByIdAndUpdate(
          verification._id,
          {
            status: "REJECTED",
            score: attestation.score ?? null,
            tier: attestation.tier ?? null,
            decision: "REJECT",
            reasons: attestation.reason
              ? [attestation.reason]
              : [],
            llmExplanation: attestation.reason ?? null,
            shouldIssueAttestation: false,
          }
        ),

        UserModel.findByIdAndUpdate(user._id, {
          identityVerification: "REJECTED",
        }),

        PassportModel.findByIdAndUpdate(passport._id, {
          status: "Rejected",
        }),
      ]);

      throw new Error(
        attestation.reason ||
          "Identity verification rejected by CRE"
      );
    }

    // 6. CRE approved.
    // The root wallet is STILL not stored yet.
    // It will be stored after the user successfully
    // submits the IdentityRegister transaction.
    await Promise.all([
      Verification.findByIdAndUpdate(
        verification._id,
        {
          status: "VERIFIED",
          score: attestation.score ?? null,
          tier: attestation.tier ?? null,
          decision: "APPROVE",
          llmExplanation: attestation.reason ?? null,
          shouldIssueAttestation: true,
        }
      ),

      UserModel.findByIdAndUpdate(user._id, {
        identityVerification: "APPROVED",
      }),

      PassportModel.findByIdAndUpdate(passport._id, {
        status: "Verified",
      }),
    ]);

    // 7. Return the attestation to the frontend.
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
    // Don't overwrite the already-recorded CRE rejection.
    if (
      error.message ===
      "Identity verification rejected by CRE"
    ) {
      throw error;
    }

    // Handle unexpected CRE/network/system failures.
    await Promise.all([
      Verification.findByIdAndUpdate(
        verification._id,
        {
          status: "REJECTED",
          shouldIssueAttestation: false,
        }
      ),

      UserModel.findByIdAndUpdate(user._id, {
        identityVerification: "REJECTED",
      }),

      PassportModel.findByIdAndUpdate(
        passport._id,
        {
          status: "Rejected",
        }
      ),
    ]);

    throw error;
  }
};

export default identityRegisterService;