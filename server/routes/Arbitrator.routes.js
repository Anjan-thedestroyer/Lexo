import express from "express";

import {
  getArbitrator,
  getWalletIdentity,
  checkEligibility,
  getEligiblePoolSize,
  checkCaseAssignment,
} from "../controller/Arbitrator.controller.js";

const arbitratorRouter = express.Router();

// --------------------------------------------------
// Arbitrator
// --------------------------------------------------

arbitratorRouter.get(
  "/:identityHash",
  getArbitrator
);
arbitratorRouter.get(
  "/wallet/:wallet/identity",
  getWalletIdentity
);
arbitratorRouter.get(
  "/:wallet/eligibility",
  checkEligibility
);
arbitratorRouter.get(
  "/pool/size",
  getEligiblePoolSize
);
arbitratorRouter.get(
  "/cases/:caseId/:wallet/assignment",
  checkCaseAssignment
);

export default arbitratorRouter;