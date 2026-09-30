import express from "express";

import {
  getDeal,
  getMilestone,
  getInvitedPayees,
  getInvitedDeals,
  getPayerDeals,
  getPayeeDeals,
  getDealTotalBalance,
  getPendingWithdrawal,
  getDispute,
  getNonce,
} from "../controller/Escrow.controller.js";

const escrowRouter = express.Router();

/*
 * Blockchain view functions
 */

// Complete deal
escrowRouter.get("/deal/:dealId", getDeal);

// Specific milestone
escrowRouter.get(
  "/deal/:dealId/milestone/:milestoneId",
  getMilestone
);

// Payees invited to a deal
escrowRouter.get(
  "/deal/:dealId/invited-payees",
  getInvitedPayees
);

// Deals where wallet is invited
escrowRouter.get(
  "/invited/:wallet",
  getInvitedDeals
);

// Deals created by payer
escrowRouter.get(
  "/payer/:wallet",
  getPayerDeals
);

// Deals assigned to payee
escrowRouter.get(
  "/payee/:wallet",
  getPayeeDeals
);

// Remaining deal balance
escrowRouter.get(
  "/deal/:dealId/balance",
  getDealTotalBalance
);

// Pending withdrawals
escrowRouter.get(
  "/withdrawable/:wallet",
  getPendingWithdrawal
);

// Dispute
escrowRouter.get(
  "/deal/:dealId/dispute",
  getDispute
);

// Cancel nonce
escrowRouter.get(
  "/nonce/:wallet",
  getNonce
);

export default escrowRouter;