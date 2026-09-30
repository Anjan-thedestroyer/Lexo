import express from "express";
import multer from "multer";

import {
  submitPayerDocument,
  submitPayeeDocument,
  haveBothSigned,
  getCandidatePayees,
  getDocumentStatus,
  getSigningDigest,
  getCandidateSigningDigest,
  getDocumentHashByDeal,
} from "../controller/Agreement.controller.js";

const agreementRoutes = express.Router();

// Store uploaded file in memory so req.file.buffer is available
const upload = multer({
  storage: multer.memoryStorage(),
});

// --------------------------------------------------
// Submit documents
// --------------------------------------------------

// POST /api/agreement/payer/document
agreementRoutes.post(
  "/payer/document",
  upload.single("document"),
  submitPayerDocument
);

// POST /api/agreement/payee/document
agreementRoutes.post(
  "/payee/document",
  upload.single("document"),
  submitPayeeDocument
);

// --------------------------------------------------
// Agreement status
// --------------------------------------------------

// GET /api/agreement/:dealId/signing-status
agreementRoutes.get(
  "/:dealId/signing-status",
  haveBothSigned
);

// --------------------------------------------------
// Candidate payees
// --------------------------------------------------

// GET /api/agreement/:dealId/candidates
agreementRoutes.get(
  "/:dealId/candidates",
  getCandidatePayees
);

// GET /api/agreement/:dealId/candidates/:candidatePayee/signing-digest
agreementRoutes.get(
  "/:dealId/candidates/:candidatePayee/signing-digest",
  getCandidateSigningDigest
);

// --------------------------------------------------
// Documents
// --------------------------------------------------

// GET /api/agreement/:dealId/documents/:docIndex/status
agreementRoutes.get(
  "/:dealId/documents/:docIndex/status",
  getDocumentStatus
);

// GET /api/agreement/:dealId/documents/:docIndex/signing-digest
agreementRoutes.get(
  "/:dealId/documents/:docIndex/signing-digest",
  getSigningDigest
);

// GET /api/agreement/:dealId/document-hashes
agreementRoutes.get(
  "/:dealId/document-hashes",
  getDocumentHashByDeal
);

export default agreementRoutes;