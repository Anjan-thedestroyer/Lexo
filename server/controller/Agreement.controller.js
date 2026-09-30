import { ethers } from "ethers";
import { uploadToPostFile } from "../utils/postfile.utils.js";

import AgreementRegistryABI from "../abi/AgreementRegistry.json" assert {
  type: "json",
};

// --------------------------------------------------
// Blockchain setup
// --------------------------------------------------

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL
);

const agreementRegistry = new ethers.Contract(
  process.env.AGREEMENT_REGISTRY_ADDRESS,
  AgreementRegistryABI.abi,
  provider
);

// --------------------------------------------------
// Check whether both documents are fully signed
// GET /api/agreement/:dealId/signing-status
// --------------------------------------------------




export async function submitPayerDocument(req, res) {
  try {
    const { dealId } = req.body;
    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required",
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Payer document is required",
      });
    }
    const documentHash = ethers.keccak256(
      req.file.buffer
    );
    const uploadedFile = await uploadToPostFile(req.file);
    return res.status(201).json({
      success: true,
      message: "Payer document prepared successfully",

      data: {
        dealId,
        documentHash,

        file: {
          name: req.file.originalname,
          size: req.file.size,
          mimeType: req.file.mimetype,
          url: uploadedFile.url,
        },

        blockchain: {
          contractAddress:
            process.env.ESCROW_CORE_ADDRESS,

          chainId: Number(
            process.env.CHAIN_ID
          ),
        },
      },
    });
  } catch (error) {
    console.error("submitPayerDocument:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to prepare payer document",
    });
  }
}

export async function submitPayeeDocument(req,res){
  try {
    const { dealId } = req.body;
    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required",
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Payee document is required",
      });
    }
    const documentHash = ethers.keccak256(
      req.file.buffer
    );
    const uploadedFile = await uploadToPostFile(req.file);
    return res.status(201).json({
      success: true,
      message: "Payee document prepared successfully",
      data: {
        dealId,
        documentHash,

        file: {
          name: req.file.originalname,
          size: req.file.size,
          mimeType: req.file.mimetype,
          url: uploadedFile.url,
        },

        blockchain: {
          contractAddress:
            process.env.ESCROW_CORE_ADDRESS,

          chainId: Number(
            process.env.CHAIN_ID
          ),
        },
      },
    });
  } catch (error) {
    console.error("submitPayerDocument:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to prepare payer document",
    });
  }
}

export async function haveBothSigned(req, res) {
  try {
    const { dealId } = req.params;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required",
      });
    }

    const bothSigned =
      await agreementRegistry.haveBothSigned(dealId);

    return res.status(200).json({
      success: true,
      data: {
        dealId,
        bothSigned,
      },
    });
  } catch (error) {
    console.error("haveBothSigned:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to check signing status",
    });
  }
}

// --------------------------------------------------
// Get candidate payees
// GET /api/agreement/:dealId/candidates
// --------------------------------------------------

export async function getCandidatePayees(req, res) {
  try {
    const { dealId } = req.params;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required",
      });
    }

    const candidates =
      await agreementRegistry.getCandidatePayees(dealId);

    return res.status(200).json({
      success: true,
      data: {
        dealId,
        candidates,
      },
    });
  } catch (error) {
    console.error("getCandidatePayees:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to get candidate payees",
    });
  }
}

// --------------------------------------------------
// Get document status
// GET /api/agreement/:dealId/documents/:docIndex/status
// --------------------------------------------------

export async function getDocumentStatus(req, res) {
  try {
    const { dealId, docIndex } = req.params;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required",
      });
    }

    if (![0, 1].includes(Number(docIndex))) {
      return res.status(400).json({
        success: false,
        message: "docIndex must be 0 or 1",
      });
    }

    const result =
      await agreementRegistry.getDocumentStatus(
        dealId,
        Number(docIndex)
      );

    return res.status(200).json({
      success: true,
      data: {
        dealId,
        docIndex: Number(docIndex),
        contentHash: result[0],
        payerSigned: result[1],
        payeeSigned: result[2],
        exists: result[3],
      },
    });
  } catch (error) {
    console.error("getDocumentStatus:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to get document status",
    });
  }
}

// --------------------------------------------------
// Get EIP-712 signing digest
// GET /api/agreement/:dealId/documents/:docIndex/signing-digest
// --------------------------------------------------

export async function getSigningDigest(req, res) {
  try {
    const { dealId, docIndex } = req.params;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required",
      });
    }

    if (![0, 1].includes(Number(docIndex))) {
      return res.status(400).json({
        success: false,
        message: "docIndex must be 0 or 1",
      });
    }

    const digest =
      await agreementRegistry.getSigningDigest(
        dealId,
        Number(docIndex)
      );

    return res.status(200).json({
      success: true,
      data: {
        dealId,
        docIndex: Number(docIndex),
        digest,
      },
    });
  } catch (error) {
    console.error("getSigningDigest:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to get signing digest",
    });
  }
}

// --------------------------------------------------
// Get candidate Payee signing digest
// GET /api/agreement/:dealId/candidates/:candidatePayee/signing-digest
// --------------------------------------------------

export async function getCandidateSigningDigest(req, res) {
  try {
    const { dealId, candidatePayee } = req.params;

    if (!dealId || !candidatePayee) {
      return res.status(400).json({
        success: false,
        message:
          "dealId and candidatePayee are required",
      });
    }

    if (!ethers.isAddress(candidatePayee)) {
      return res.status(400).json({
        success: false,
        message: "Invalid candidate payee address",
      });
    }

    const digest =
      await agreementRegistry.getCandidateSigningDigest(
        dealId,
        candidatePayee
      );

    return res.status(200).json({
      success: true,
      data: {
        dealId,
        candidatePayee,
        digest,
      },
    });
  } catch (error) {
    console.error(
      "getCandidateSigningDigest:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to get candidate signing digest",
    });
  }
}

// --------------------------------------------------
// Get both document hashes
// GET /api/agreement/:dealId/document-hashes
// --------------------------------------------------

export async function getDocumentHashByDeal(req, res) {
  try {
    const { dealId } = req.params;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required",
      });
    }

    const result =
      await agreementRegistry.getDocumentHashByDeal(
        dealId
      );

    return res.status(200).json({
      success: true,
      data: {
        dealId,
        docAHash: result[0],
        docBHash: result[1],
      },
    });
  } catch (error) {
    console.error("getDocumentHashByDeal:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to get document hashes",
    });
  }
}


