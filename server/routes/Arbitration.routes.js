import express from "express";

import {
  getCase,
  getCaseArbiters,
  getVote,
  getVoteCount,
  getCaseCount,
  getArbitrationConstants,
} from "../controller/Arbitration.controller.js";

const arbitrationRouter = express.Router();

// --------------------------------------------------
// Arbitration cases
// --------------------------------------------------

// GET /api/arbitration/cases/count
arbitrationRouter.get(
  "/cases/count",
  getCaseCount
);

// GET /api/arbitration/cases/:caseId
arbitrationRouter.get(
  "/cases/:caseId",
  getCase
);

// GET /api/arbitration/cases/:caseId/arbiters
arbitrationRouter.get(
  "/cases/:caseId/arbiters",
  getCaseArbiters
);

// GET /api/arbitration/cases/:caseId/vote/:arbiter
arbitrationRouter.get(
  "/cases/:caseId/vote/:arbiter",
  getVote
);

// GET /api/arbitration/cases/:caseId/votes/:choice
arbitrationRouter.get(
  "/cases/:caseId/votes/:choice",
  getVoteCount
);

// --------------------------------------------------
// Contract constants
// --------------------------------------------------

// GET /api/arbitration/constants
arbitrationRouter.get(
  "/constants",
  getArbitrationConstants
);

export default arbitrationRouter;