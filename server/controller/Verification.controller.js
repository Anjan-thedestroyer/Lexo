import bcrypt from "bcryptjs";
import UserModel from "../model/User.model.js";
import identityRegisterService from "../services/identityRegister.service.js";
import addWalletService from "../services/walletAddition.service.js";
import Verification from "../model/Verification.model.js";

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
    console.log("Retrieved verification record:", verification);

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