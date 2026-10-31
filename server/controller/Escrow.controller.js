import { ethers } from "ethers";

import EscrowModel from "../model/Escrow.model.js";
import UserModel from "../model/User.model.js";

import EscrowCoreABI from "../abi/EscrowCore.json" with { type: "json" };
import PayeeReqModel from "../model/PayeeReq.model.js";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const escrowCore = new ethers.Contract(
  process.env.ESCROW_ADDRESS,
  EscrowCoreABI.abi,
  provider
);

/* ------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------ */

function serialize(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serialize);
  }

  if (value && typeof value === "object") {
    const result = {};

    for (const [key, val] of Object.entries(value)) {
      // Ignore ethers' numeric indexes
      if (!/^\d+$/.test(key)) {
        result[key] = serialize(val);
      }
    }

    return result;
  }

  return value;
}

/* ------------------------------------------------ */
/* GET COMPLETE DEAL FROM BLOCKCHAIN */
/* ------------------------------------------------ */

export const getDeal = async (req, res) => {
  try {
    const { dealId } = req.params;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required",
      });
    }

    const deal = await escrowCore.deals(dealId);

    return res.status(200).json({
      success: true,
      data: serialize(deal),
    });
  } catch (error) {
    console.error("getDeal error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch deal",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET MILESTONE */
/* ------------------------------------------------ */

export const getMilestone = async (req, res) => {
  try {
    const { dealId, milestoneId } = req.params;

    if (!dealId || milestoneId === undefined) {
      return res.status(400).json({
        success: false,
        message: "dealId and milestoneId are required",
      });
    }

    const milestone = await escrowCore.milestones(
      dealId,
      milestoneId
    );

    return res.status(200).json({
      success: true,
      data: serialize(milestone),
    });
  } catch (error) {
    console.error("getMilestone error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch milestone",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET INVITED PAYEES */
/* ------------------------------------------------ */

export const getInvitedPayees = async (req, res) => {
  try {
    const { dealId } = req.params;

    const payees = await escrowCore.getInvitedPayees(dealId);

    return res.status(200).json({
      success: true,
      data: payees,
    });
  } catch (error) {
    console.error("getInvitedPayees error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch invited payees",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET DEALS WHERE WALLET IS INVITED */
/* ------------------------------------------------ */

export const getInvitedDeals = async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    const deals = await escrowCore.getInvitedDeals(wallet);

    return res.status(200).json({
      success: true,
      data: deals.map((id) => id.toString()),
    });
  } catch (error) {
    console.error("getInvitedDeals error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch invited deals",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET PAYER DEALS */
/* ------------------------------------------------ */

export const getPayerDeals = async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    const deals = await escrowCore.getPayerDeals(wallet);

    return res.status(200).json({
      success: true,
      data: deals.map((id) => id.toString()),
    });
  } catch (error) {
    console.error("getPayerDeals error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch payer deals",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET PAYEE DEALS */
/* ------------------------------------------------ */

export const getPayeeDeals = async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    const deals = await escrowCore.getPayeeDeals(wallet);

    return res.status(200).json({
      success: true,
      data: deals.map((id) => id.toString()),
    });
  } catch (error) {
    console.error("getPayeeDeals error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch payee deals",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET DEAL TOTAL BALANCE */
/* ------------------------------------------------ */

export const getDealTotalBalance = async (req, res) => {
  try {
    const { dealId } = req.params;

    const balance = await escrowCore.getDealTotalBalance(dealId);

    return res.status(200).json({
      success: true,
      data: balance.toString(),
    });
  } catch (error) {
    console.error("getDealTotalBalance error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch deal balance",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET PENDING WITHDRAWAL */
/* ------------------------------------------------ */

export const getPendingWithdrawal = async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    const amount = await escrowCore.pendingWithdrawals(wallet);

    return res.status(200).json({
      success: true,
      data: amount.toString(),
    });
  } catch (error) {
    console.error("getPendingWithdrawal error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending withdrawal",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET DISPUTE */
/* ------------------------------------------------ */

export const getDispute = async (req, res) => {
  try {
    const { dealId } = req.params;

    const dispute = await escrowCore.disputeLogs(dealId);

    return res.status(200).json({
      success: true,
      data: serialize(dispute),
    });
  } catch (error) {
    console.error("getDispute error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch dispute",
      error: error.message,
    });
  }
};

/* ------------------------------------------------ */
/* GET USER NONCE */
/* ------------------------------------------------ */

export const getNonce = async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    const nonce = await escrowCore.nonces(wallet);

    return res.status(200).json({
      success: true,
      data: nonce.toString(),
    });
  } catch (error) {
    console.error("getNonce error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch nonce",
      error: error.message,
    });
  }
};
export const approveMilestoneController = async (req, res) => {
    try {
        const { dealId } = req.body;
        const userId = req.userId;

        if (!dealId) {
            return res.status(400).json({
                success: false,
                message: "Deal ID is required.",
            });
        }

        const escrow = await EscrowModel.findOne({
            dealId: Number(dealId),
            payer: userId,
        });

        if (!escrow) {
            return res.status(404).json({
                success: false,
                message: "Escrow not found or you are not the payer.",
            });
        }

        const currentMilestone = escrow.milestones.find(
            (milestone) =>
                milestone.status !== "RELEASED"
        );

        if (!currentMilestone) {
            return res.status(400).json({
                success: false,
                message: "All milestones have already been released.",
            });
        }

        currentMilestone.status = "RELEASED";
        currentMilestone.releasedAt = new Date();

        const allReleased = escrow.milestones.every(
            (milestone) => milestone.status === "RELEASED"
        );

        escrow.status = allReleased ? "COMPLETED" : "BOTH_SIGNED";

        if (req.body.txHash) {
            escrow.transactions.released = req.body.txHash;
        }

        await escrow.save();

        return res.status(200).json({
            success: true,
            message: allReleased
                ? "Final milestone released. Escrow completed."
                : "Milestone released successfully.",
            data: {
                dealId: escrow.dealId,
                milestone: currentMilestone,
                escrowStatus: escrow.status,
            },
        });
    } catch (error) {
        console.error("Approve milestone error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update milestone.",
        });
    }
};
export async function getActiveEscrows(req, res) {
    try {
        const escrows = await EscrowModel.find({
            status: "CREATED",
        })
            .populate({
                path: "agreement",
                select: "payerContentLink payeeContentLink status",
              })            
            .populate("payer", "name email")
            .populate("payee", "name email")
            .sort({ createdAt: -1 })
            .lean();

        const agreementIds = escrows
            .map((escrow) => escrow.agreement?._id)
            .filter(Boolean);

        const requests = await PayeeReqModel.find({
            agreementId: { $in: agreementIds },
            status: "PENDING",
        })
            .populate("payee", "name email")
            .sort({ createdAt: -1 })
            .lean();

        const requestsByAgreement = {};

        for (const request of requests) {
            const key = String(request.agreementId);

            if (!requestsByAgreement[key]) {
                requestsByAgreement[key] = [];
            }

            requestsByAgreement[key].push(request);
        }

        const data = escrows.map((escrow) => ({
            ...escrow,
            payeeRequests:
                requestsByAgreement[String(escrow.agreement?._id)] ?? [],
        }));

        return res.status(200).json({
            success: true,
            data,
        });
    } catch (error) {
        console.error("Get created escrows:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch created escrows.",
        });
    }
}