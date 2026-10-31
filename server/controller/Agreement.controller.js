import { ethers, isAddress } from "ethers";
import { uploadToPostFile } from "../utils/postfile.utils.js";

import AgreementRegistryABI from "../abi/AgreementRegistry.json" with {
  type: "json",
};
import EscrowModel from "../model/Escrow.model.js";
import AgreementModel from "../model/Agreement.model.js";
import mongoose from "mongoose";
import UserModel from "../model/User.model.js";
import WalletModel from "../model/Wallet.model.js";

// --------------------------------------------------
// Blockchain setup
// --------------------------------------------------

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL
);
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS;

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
        documentHash,

        file: {
          name: req.file.originalname,
          size: req.file.size,
          mimeType: req.file.mimetype,
          url: uploadedFile.url,
        },

        blockchain: {
          contractAddress:
            process.env.ESCROW_ADDRESS
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

export const saveEscrowDocument = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const {
            dealId,
            invitedPayees = [],
            payerWallet,
            documentUrl,
            documentHash,
            transactionHash,
            totalAmount,
            milestones,
        } = req.body;

        // 1. Get the authenticated payer from auth middleware.
        const payerId = req.userId;

        if (!payerId || !mongoose.isValidObjectId(payerId)) {
            return res.status(401).json({
                success: false,
                message: "Authentication required.",
            });
        }

        // 2. Validate required fields.
        if (
            dealId === undefined ||
            !payerWallet ||
            !documentUrl ||
            !documentHash ||
            !transactionHash ||
            totalAmount === undefined ||
            !Array.isArray(milestones) ||
            !Array.isArray(invitedPayees)
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "dealId, payerWallet, documentUrl, documentHash, transactionHash, totalAmount, milestones and invitedPayees are required.",
            });
        }

        // 3. Validate dealId.
        if (
            !/^\d+$/.test(String(dealId)) ||
            !Number.isSafeInteger(Number(dealId))
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid dealId.",
            });
        }

        // 4. Validate payer wallet.
        if (!isAddress(payerWallet)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payerWallet address.",
            });
        }

        const normalizedPayerWallet = payerWallet.toLowerCase();

        // 5. Validate document hash.
        if (!/^0x[a-fA-F0-9]{64}$/.test(documentHash)) {
            return res.status(400).json({
                success: false,
                message: "Invalid documentHash. Expected bytes32.",
            });
        }

        // 6. Validate transaction hash format only.
        // No backend receipt or transaction-success check is performed.
        if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
            return res.status(400).json({
                success: false,
                message: "Invalid transactionHash.",
            });
        }

        // 7. Validate document URL.
        if (
            typeof documentUrl !== "string" ||
            !documentUrl.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid documentUrl.",
            });
        }

        // 8. Validate total amount.
        if (
            !["string", "number"].includes(typeof totalAmount) ||
            !String(totalAmount).trim() ||
            !Number.isFinite(Number(totalAmount)) ||
            Number(totalAmount) <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid totalAmount.",
            });
        }

        // 9. Normalize and validate invited wallet addresses.
        const normalizedInvitedPayees = [
            ...new Set(
                invitedPayees.map((address) =>
                    typeof address === "string"
                        ? address.trim().toLowerCase()
                        : ""
                )
            ),
        ];

        if (
            normalizedInvitedPayees.some(
                (address) => !isAddress(address)
            )
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "One or more invited payee wallet addresses are invalid.",
            });
        }

        // 10. Validate milestones.
        if (milestones.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one milestone is required.",
            });
        }

        const normalizedMilestones = milestones.map((milestone) => ({
            title: String(milestone?.title ?? "").trim(),
            description: String(milestone?.description ?? "").trim(),
            amount: String(milestone?.amount ?? "").trim(),
        }));

        if (
            normalizedMilestones.some(
                (milestone) =>
                    !milestone.title ||
                    !milestone.amount ||
                    !Number.isFinite(Number(milestone.amount)) ||
                    Number(milestone.amount) <= 0
            )
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Every milestone must have a title and a positive amount.",
            });
        }

        // 11. Confirm the payer wallet belongs to this authenticated user.
        const payerWalletRecord = await WalletModel.findOne({
            address: normalizedPayerWallet,
            user: payerId,
            status: "Active",
        }).select("_id");

        // if (!payerWalletRecord) {
        //     return res.status(403).json({
        //         success: false,
        //         message:
        //             "Your payer wallet is not an active wallet linked to your account.",
        //     });
        // }

        // 12. Find registered invitees.
        // Unregistered wallets are still stored in Agreement.invitePayee.
        const registeredWallets = normalizedInvitedPayees.length
            ? await WalletModel.find({
                  address: { $in: normalizedInvitedPayees },
                  status: "Active",
              }).select("address user")
            : [];

        // Don't invite the payer as their own payee.
        const registeredUserIds = [
            ...new Set(
                registeredWallets
                    .filter(
                        (wallet) =>
                            wallet.user.toString() !== payerId.toString()
                    )
                    .map((wallet) => wallet.user.toString())
            ),
        ];

        let result;

        // 13. Save escrow, agreement and invitations atomically.
        await session.withTransaction(async () => {
            let escrow = await EscrowModel.findOne({
                dealId: Number(dealId),
            }).session(session);

            if (escrow) {
                // A retry may update the existing record, but a different
                // payer must not be allowed to claim it.
                if (escrow.payer.toString() !== payerId.toString()) {
                    const error = new Error(
                        "This dealId is already associated with another payer."
                    );
                    error.statusCode = 409;
                    throw error;
                }

                escrow.totalAmount = String(totalAmount);
                escrow.milestones = normalizedMilestones;
                escrow.payee = null;

                await escrow.save({ session });
            } else {
                [escrow] = await EscrowModel.create(
                    [
                        {
                            dealId: Number(dealId),
                            payer: payerId,
                            payee: null,
                            totalAmount: String(totalAmount),
                            milestones: normalizedMilestones,
                            token: "USDT",
                            status: "CREATED",
                        },
                    ],
                    { session }
                );
            }

            let agreement = await AgreementModel.findOne({
                dealId: escrow._id,
            }).session(session);

            if (agreement) {
                if (agreement.payer.toString() !== payerId.toString()) {
                    const error = new Error(
                        "The existing Agreement belongs to another payer."
                    );
                    error.statusCode = 409;
                    throw error;
                }

                agreement.payerContentLink = documentUrl.trim();
                agreement.payerContentHash = documentHash;
                agreement.payerAddress = normalizedPayerWallet;
                agreement.invitePayee = normalizedInvitedPayees;
                agreement.status = "PENDING_SIGNATURE";

                // Payee is assigned later when an invitee accepts.
                agreement.payee = null;
                agreement.payeeAddress = null;
            } else {
                agreement = new AgreementModel({
                    dealId: escrow._id,
                    payerContentLink: documentUrl.trim(),
                    payerContentHash: documentHash,
                    payer: payerId,
                    payerAddress: normalizedPayerWallet,
                    payee: null,
                    payeeAddress: null,
                    invitePayee: normalizedInvitedPayees,
                    status: "PENDING_SIGNATURE",
                    payerSigned: true,
                });
            }

            await agreement.save({ session });

            escrow.agreement = agreement._id;
            await escrow.save({ session });

            // Add the escrow ID to each registered invitee's invitations.
            // $addToSet avoids duplicates if the request is retried.
            if (registeredUserIds.length > 0) {
                await UserModel.updateMany(
                    { _id: { $in: registeredUserIds } },
                    { $addToSet: { invitation: escrow._id } },
                    { session }
                );
            }

            result = { escrow, agreement };
        });

        return res.status(200).json({
            success: true,
            message: "Escrow and Agreement saved successfully.",
            data: {
                escrowId: result.escrow._id,
                agreementId: result.agreement._id,
                dealId: result.escrow.dealId,
                payer: result.escrow.payer,
                payee: result.escrow.payee,
                invitedPayees: result.agreement.invitePayee,
                registeredInvitees: registeredWallets
                    .filter(
                        (wallet) =>
                            wallet.user.toString() !== payerId.toString()
                    )
                    .map((wallet) => ({
                        address: wallet.address,
                        userId: wallet.user,
                    })),
                documentUrl: result.agreement.contentLink,
                documentHash: result.agreement.contentHash,
                transactionHash,
            },
        });
    } catch (error) {
        console.error("saveEscrowDocument error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message:
                error.message ||
                "Failed to save Escrow and Agreement.",
        });
    } finally {
        await session.endSession();
    }
};
export const getPayerEscrows = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const escrows = await EscrowModel.find({
      payer: userId,
    })
      .populate("payer", "name email")
      .populate("payee", "name email")
      .populate("agreement")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: escrows.length,
      data: escrows,
    });
  } catch (error) {
    console.error("getPayerEscrows error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch payer escrows",
    });
  }
};

// ============================================================
// GET ESCROWS WHERE LOGGED-IN USER IS THE ASSIGNED PAYEE
// GET /api/agreement/escrows/payee
// ============================================================

export const getPayeeEscrows = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const escrows = await EscrowModel.find({
      payee: userId,
    })
      .populate("payer", "name email")
      .populate("payee", "name email")
      .populate("agreement")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: escrows.length,
      data: escrows,
    });
  } catch (error) {
    console.error("getPayeeEscrows error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch payee escrows",
    });
  }
};

// ============================================================
// GET ESCROWS WHERE LOGGED-IN USER IS INVITED
// GET /api/agreement/escrows/invited
// ============================================================

export const getInvitedEscrows = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Only use active wallets belonging to this user.
    const wallets = await WalletModel.find({
      user: userId,
      status: "Active",
    })
      .select("address")
      .lean();

    const addresses = wallets
      .map((wallet) => wallet.address?.toLowerCase())
      .filter(Boolean);

    if (addresses.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    // Find agreements that invite any active wallet owned by the user.
    const agreements = await AgreementModel.find({
      invitePayee: {
        $in: addresses,
      },
    })
      .select("dealId payerAddress payeeAddress invitePayee status")
      .lean();

    const dealIds = agreements.map((agreement) => agreement.dealId);

    if (dealIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    // Agreement.dealId references the Escrow document's _id
    // in the current schema described for Lexo.
    const escrows = await EscrowModel.find({
      _id: { $in: dealIds },
      payer: { $ne: userId },
      payee: { $ne: userId },
    })
      .populate("payer", "name email")
      .populate("payee", "name email")
      .populate("agreement")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: escrows.length,
      data: escrows,
    });
  } catch (error) {
    console.error("getInvitedEscrows error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch invited escrows",
    });
  }
};

