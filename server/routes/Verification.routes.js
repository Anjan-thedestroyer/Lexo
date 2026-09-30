import express from "express";

import {
  reqAttestationForIdentityRegistration,
  reqAttestationForWalletAddition,
} from "../controller/Verification.controller.js";

const verificationRouter = express.Router();

// --------------------------------------------------
// Identity registration
// --------------------------------------------------

// POST /api/verification/identity-registration
verificationRouter.post(
  "/identity-registration",
  reqAttestationForIdentityRegistration
);

// --------------------------------------------------
// Add wallet
// --------------------------------------------------

// POST /api/verification/wallet-addition
verificationRouter.post(
  "/wallet-addition",
  reqAttestationForWalletAddition
);

export default verificationRouter;