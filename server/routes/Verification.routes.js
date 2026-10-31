import express from "express";

import {
  getAttestationAfterVerification,
  getManualReviewUsers,
  getVerificationStatus,
  reqAttestationForIdentityRegistration,
  reqAttestationForWalletAddition,
} from "../controller/Verification.controller.js";
import authMiddleware from "../middleware/auth.js";

const verificationRouter = express.Router();

// --------------------------------------------------
// Identity registration
// --------------------------------------------------

// POST /api/verification/identity-registration
verificationRouter.post(
  "/identity-registration",
  authMiddleware,
  reqAttestationForIdentityRegistration
);

// --------------------------------------------------
// Add wallet
// --------------------------------------------------

// POST /api/verification/wallet-addition
verificationRouter.post(
  "/wallet-addition",
  authMiddleware,
  reqAttestationForWalletAddition
);

verificationRouter.get(
  "/manual",getManualReviewUsers
)

verificationRouter.get(
  "/status",
  authMiddleware,
  getVerificationStatus
);
verificationRouter.post("/re-request", authMiddleware,getAttestationAfterVerification)

export default verificationRouter;