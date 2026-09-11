import bcrypt from "bcryptjs";
import identityRegisterService from "../services/identityRegister.service.js";
import WalletModel from "../model/Wallet.model.js";

export async function reqAttestationForIdentityRegistration(req, res) {
    try {
        const {
            name,
            email,
            phone,
            password,
            rootWalletAddress,
            nullifier,
            nationality,
            rarimoProof,
        } = req.body;

        // 1. Validate required fields
        if (
            !name ||
            !email ||
            !phone ||
            !password ||
            !rootWalletAddress ||
            !nullifier ||
            !nationality ||
            !rarimoProof
        ) {
            return res.status(400).json({
                message: "All fields are required",
                success: false,
            });
        }

        // 2. Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Request identity attestation
        const data = await identityRegisterService({
            name,
            email,
            phone,
            password: hashedPassword,
            rootWalletAddress,
            identityHash: nullifier,
            nationality,
            rarimoProof,
        });

        // 4. Return result
        return res.status(201).json({
            message: "Identity registration processed successfully",
            success: true,
            data,
        });
    } catch (error) {
        console.error(
            "Error requesting attestation for identity registration:",
            error
        );

        return res.status(500).json({
            message: error.message || "Internal server error",
            success: false,
        });
    }
}
export async function reqAttestationForWalletAddition(req,res){
    try {
        const {walletAddress,userId} = req.body;
        
        return res.status(201).json({
            message: "Wallet added successfully",
            success: true,
            data: wallet,
        });
    } catch (error) {
        console.error(
            "Error requesting attestation for wallet addition:",
            error
        );
        return res.status(500).json({
            message: error.message || "Internal server error",
            success: false,
        });
    }
}
