import bcrypt from "bcryptjs";
import UserModel from "../model/User.model.js";
import identityRegisterService from "../services/identityRegister.service.js";
import addWalletService from "../services/walletAddition.service.js";
import Verification from "../model/Verification.model.js";
import PassportModel from "../model/Passport.model.js";
import { getRegisterationHash } from "../web3/attestation.web3.js";
import WalletModel from "../model/Wallet.model.js";

export async function reqAttestationForIdentityRegistration(req, res) {
    try {
        // User must already be logged in
        const userId = req.userId;
        const {
            email,
            password,
            rootWalletAddress,
            nullifier,
            nationality,
            rarimoProof,
            ageAbove17,
            passportExpired,
        } = req.body;

        if (
            !email ||
            !password ||
            !rootWalletAddress ||
            !nullifier ||
            !nationality ||
            !rarimoProof ||
            ageAbove17 === undefined ||
            passportExpired === undefined
        ) {
            return res.status(400).json({
                message: "All fields are required",
                success: false,
            });
        }

        const user = await UserModel.findById(userId);

        if (!user) {
            return res.status(404).json({
                message: "User not found",
                success: false,
            });
        }
        if (
            user.email.toLowerCase().trim() !==
            email.toLowerCase().trim()
        ) {
            return res.status(401).json({
                message: "Invalid authentication credentials",
                success: false,
            });
        }
        const passwordValid = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordValid) {
            return res.status(401).json({
                message: "Invalid authentication credentials",
                success: false,
            });
        }
        if (
            user.status &&
            user.status !== "Active"
        ) {
            return res.status(403).json({
                message: "Account is not active",
                success: false,
            });
        }
        const data =
            await identityRegisterService({
                userId,
                rootWalletAddress,
                identityHash:
                nullifier,
                nationality,
                rarimoProof,
                ageAbove17,
                passportExpired
            });

        return res.status(200).json({
            message:
                data.message ||
                "Identity registration processed successfully",
            success: true,
            data,
        });

    } catch (error) {
        console.error(
            "Identity registration error:",
            error
        );

        return res.status(500).json({
            message:
                error.message ||
                "Internal server error",

            success: false,
        });
    }
}
export async function reqAttestationForWalletAddition(
    req,
    res
) {
    try {
        const userId = req.userId;
        const { walletAddress } = req.body;
        if (!walletAddress) {
            return res.status(400).json({
                message: "Wallet address is required",
                success: false,
            });
        }
        const data =
            await addWalletService({
                userId,
                walletAddress,
            });
        return res.status(200).json({
            message:
                "Wallet verification completed successfully. Submit the attestation on-chain.",
            success: true,
            data,
        });
    } catch (error) {
        console.error(
            "Wallet addition verification error:",
            error
        );
        return res.status(500).json({
            message:
                error.message ||
                "Internal server error",
            success: false,
        });
    }
}

export async function getVerificationStatus(req, res) {
  try {
    const userId = req.userId;

    const verification = await Verification.findOne({ user: userId })
      .sort({ createdAt: -1 })
      .select(
        "status registrationStatus decision score tier reasons shouldIssueAttestation attestationWallet attestationIdentityHash attestationNonce attestationDeadline attestationSignature attestationTxHash createdAt updatedAt"
      )
      .lean();

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "No verification record found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Latest verification details retrieved successfully",
      data: {
        verificationId: verification._id,
        status: verification.status,
        registrationStatus: verification.registrationStatus,
        decision: verification.decision,
        score: verification.score,
        tier: verification.tier,
        reasons: verification.reasons,
        shouldIssueAttestation: verification.shouldIssueAttestation,
        attestation: {
          wallet: verification.attestationWallet,
          identityHash: verification.attestationIdentityHash,
          nonce: verification.attestationNonce,
          deadline: verification.attestationDeadline,
          signature: verification.attestationSignature,
          txHash: verification.attestationTxHash,
        },
        createdAt: verification.createdAt,
        updatedAt: verification.updatedAt,
      },
    });
  } catch (error) {
    console.error("Verification status error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
}


export async function getAttestationAfterVerification(req, res) {
    try {
        const userId = req.userId;
        const { rootWalletAddress } = req.body ?? {};

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        if (
            typeof rootWalletAddress !== "string" ||
            !/^0x[a-fA-F0-9]{40}$/.test(rootWalletAddress)
        ) {
            return res.status(400).json({
                success: false,
                message: "A valid connected wallet address is required",
            });
        }

        const normalizedAddress = rootWalletAddress.toLowerCase();

        // 1. Load the user's latest approved identity verification.
        const verification = await Verification.findOne({
            user: userId,
            status: "VERIFIED",
            decision: "APPROVE",
            shouldIssueAttestation: true,
        }).sort({ createdAt: -1 });

        if (!verification) {
            return res.status(403).json({
                success: false,
                message:
                    "No approved identity verification eligible for attestation",
            });
        }

        // 2. Ensure compliance scoring is complete.
        if (
            verification.score == null ||
            !verification.tier
        ) {
            return res.status(403).json({
                success: false,
                message: "Required compliance scoring is incomplete",
            });
        }

        // If AML screening is mandatory, enforce it here.
        // if (
        //     verification.amlStatus !== "SCORED" ||
        //     verification.amlScore == null
        // ) {
        //     return res.status(403).json({
        //         success: false,
        //         message: "Required AML screening is incomplete",
        //     });
        // }

        // 3. Confirm that the passport belongs to this user.
        const passport = await PassportModel.findOne({
            _id: verification.passport,
            user: userId,
        });

        if (!passport) {
            return res.status(403).json({
                success: false,
                message: "Verified passport record not found",
            });
        }

        // 4. Validate the user account.
        const user = await UserModel.findById(userId);

        if (!user || user.status !== "Active") {
            return res.status(403).json({
                success: false,
                message: "User account is not active",
            });
        }

        // 5. Confirm the identity hash exists in the approved verification.
        const identityHash = verification.nullifier;

        if (
            typeof identityHash !== "string" ||
            !/^0x[a-fA-F0-9]{64}$/.test(identityHash)
        ) {
            return res.status(403).json({
                success: false,
                message:
                    "The verified identity does not have a valid identity hash",
            });
        }

        // 6. Generate a fresh attestation for the currently connected wallet.
        // The backend signing service must obtain the current on-chain nonce
        // and sign the exact wallet, identity hash, nonce, and deadline.
        const attestation = await getRegisterationHash(
            userId,
            normalizedAddress
        );

        if (
            !attestation?.wallet ||
            attestation.wallet.toLowerCase() !== normalizedAddress
        ) {
            throw new Error(
                "The generated attestation wallet does not match the requested wallet"
            );
        }

        if (
            !attestation.identityHash ||
            attestation.identityHash.toLowerCase() !== identityHash.toLowerCase()
        ) {
            throw new Error(
                "The generated attestation identity hash does not match the verified identity"
            );
        }

        if (
            attestation.signature == null ||
            attestation.nonce == null ||
            attestation.deadline == null
        ) {
            throw new Error("The generated attestation is incomplete");
        }

        // 7. Save the latest attestation in the Verification record.
        verification.attestationWallet = normalizedAddress;
        verification.attestationIdentityHash = attestation.identityHash;
        verification.attestationNonce = attestation.nonce;
        verification.attestationDeadline = attestation.deadline;
        verification.attestationSignature = attestation.signature;
        verification.attestationTxHash = null;
        verification.registrationStatus = "NOT_SUBMITTED";

        // This field stores the latest signature; no WalletModel record
        // is created here. The wallet is added after on-chain registration.
        user.Identity_attestation = attestation.signature;
        user.identityVerification = "VERIFIED";
        await Promise.all([
            verification.save(),
            user.save(),
        ]);

        console.log("[Attestation] Fresh identity registration attestation:", {
            userId: String(userId),
            verificationId: String(verification._id),
            wallet: normalizedAddress,
            identityHash: attestation.identityHash,
            nonce: String(attestation.nonce),
            deadline: String(attestation.deadline),
            registrationStatus: verification.registrationStatus,
        });

        return res.status(200).json({
            success: true,
            message: "Fresh identity registration attestation generated",
            registrationStatus: verification.registrationStatus,
            attestation: {
                wallet: attestation.wallet,
                identityHash: attestation.identityHash,
                nonce: attestation.nonce,
                deadline: attestation.deadline,
                signature: attestation.signature,
            },
        });
    } catch (error) {
        console.error("getAttestationAfterVerification:", error);

        if (
            error.message?.includes("already registered") ||
            error.message?.includes("already linked") ||
            error.message?.includes("restricted")
        ) {
            return res.status(409).json({
                success: false,
                message: error.message,
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to generate a fresh identity attestation",
        });
    }
}

export const getManualReviewUsers = async (req, res) => {
  try {
    const page = Math.max(
      Number.parseInt(req.query.page, 10) || 1,
      1
    );

    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 10, 1),
      50
    );

    const skip = (page - 1) * limit;

    const filter = {
      status: "MANUAL_REVIEW",
    };

    const [verifications, total] = await Promise.all([
      Verification.find(filter)
        .populate({
          path: "user",
          select: "name email phone identityVerification status",
        })
        .populate({
          path: "passport",
          select: "identityHash nationality status",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Verification.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Manual review users retrieved successfully",
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      data: verifications,
    });
  } catch (error) {
    console.error("Get manual review users error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve manual review users",
    });
  }
};
