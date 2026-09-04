import User from "../models/User.js";
import Passport from "../models/Passport.js";
import Wallet from "../models/Wallet.js";
import Verification from "../models/Verification.js";
import creService from "./cre.service.js";

const identityRegisterService = async ({
    email,
    phone,
    password,
    rootWalletAddress,
    passportHash,
    nationality,
    rarimoProof,
}) => {
    // 1. Check Passport uniqueness
    const existingPassport = await Passport.findOne({ passportHash });
    if (existingPassport) {
        throw new Error("Passport is already registered");
    }

    // 2. Check Root Wallet uniqueness
    const existingWallet = await Wallet.findOne({
        address: rootWalletAddress.toLowerCase(),
        status: "Active",
    });
    if (existingWallet) {
        throw new Error("Wallet is already registered");
    }

    // 3. Create User
    const user = await User.create({
        email,
        phone,
        password,
        identityVerification: "PROCESSING",
    });

    // 4. Create Passport
    const passport = await Passport.create({
        passportHash,
        citizenship: nationality,
        user: user._id,
        status: "Requested",
    });

    // 5. Register first wallet
    const wallet = await Wallet.create({
        address: rootWalletAddress.toLowerCase(),
        user: user._id,
        status: "Active",
    });

    // 6. Set root wallet pointers
    user.passport = passport._id;
    user.wallets = [wallet._id];
    user.rootWallet = wallet._id;
    await user.save();

    // 7. Create verification record
    const verification = await Verification.create({
        user: user._id,
        passport: passport._id,
        status: "PROCESSING",
        rarimoProof,
    });

    // --------------------------------------------------
    // 8. Request EIP-712 Attestation Signature from CRE
    // --------------------------------------------------
    const attestation = await creService.startIdentityVerification({
        verificationId: verification._id,
        userId: user._id,
        rootWalletAddress,
        passportHash,
        nationality,
        rarimoProof,
    });

    if (!attestation.approved) {
        verification.status = "REJECTED";
        user.identityVerification = "REJECTED";
        await verification.save();
        await user.save();

        throw new Error(`CRE Verification Failed: ${attestation.reason || "High risk profile"}`);
    }

    // --------------------------------------------------
    // 9. Update DB Records to APPROVED
    // --------------------------------------------------
    verification.status = "APPROVED";
    verification.riskScore = attestation.score;
    await verification.save();

    user.identityVerification = "APPROVED";
    await user.save();

    passport.status = "Verified";
    await passport.save();

    // --------------------------------------------------
    // 10. Return EIP-712 Attestation Payload to Frontend
    // --------------------------------------------------
    return {
        userId: user._id,
        verificationId: verification._id,
        identityVerification: user.identityVerification,
        // The client uses these parameters to submit on-chain
        attestationPayload: {
            wallet: rootWalletAddress,
            identityHash: attestation.identityHash,
            deadline: attestation.deadline,
            signature: attestation.signature,
        },
    };
};

export default identityRegisterService;