import { ethers } from "ethers";
import EscrowCoreABI from "../abi/EscrowCore.json" with { type: "json" };
import EscrowModel from "../model/Escrow.model.js";
import UserModel from "../model/user.model.js";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const escrowCore = new ethers.Contract(
  process.env.ESCROW_ADDRESS,
  EscrowCoreABI.abi,
  provider
);

/* ------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------ */

function parseDealId(id) {
  return typeof id === "bigint" ? Number(id) : Number(BigInt(id));
}

async function getTxHash(event) {
  return event.log?.transactionHash || event.transactionHash || null;
}

async function findUserByWallet(wallet) {
  if (!wallet) return null;
  return UserModel.findOne({
    "wallets.address": wallet.toLowerCase(),
  });
}

/* ------------------------------------------------ */
/* Event Handlers */
/* ------------------------------------------------ */

async function handleDealCreated(dealIdRaw, payer, totalBalance, event) {
  try {
    const dealId = parseDealId(dealIdRaw);

    const existing = await EscrowModel.findOne({ dealId });
    if (existing) {
      console.log(`Escrow already exists for deal ${dealId}`);
      return existing;
    }

    const payerUser = await findUserByWallet(payer);
    if (!payerUser) {
      console.warn(`Payer user not found for wallet address ${payer}`);
      return;
    }

    // Fetch on-chain details to ensure accuracy
    const deal = await escrowCore.deals(dealId);
    const milestones = [];

    const totalMilestones = Number(deal.totalMilestones);
    for (let i = 0; i < totalMilestones; i++) {
      const milestone = await escrowCore.milestones(dealId, i);
      milestones.push({
        title: `Milestone ${i + 1}`,
        description: milestone.description,
        amount: milestone.amount.toString(),
        status: milestone.isCompleted ? "APPROVED" : "PENDING",
      });
    }

    const txHash = await getTxHash(event);

    const escrow = await EscrowModel.create({
      dealId,
      payer: payerUser._id,
      payee: null,
      totalAmount: totalBalance.toString(),
      token: "USDT",
      status: "FUNDED",
      milestones,
      transactions: {
        funded: txHash,
        released: null,
        refunded: null,
      },
    });

    console.log(`Escrow index created for deal ${dealId}`);
    return escrow;
  } catch (error) {
    console.error("handleDealCreated error:", error);
  }
}

async function handlePayeeSynced(dealIdRaw, payee, event) {
  try {
    const dealId = parseDealId(dealIdRaw);
    const payeeUser = await findUserByWallet(payee);

    if (!payeeUser) {
      console.warn(`Payee user not found for address ${payee}`);
      return;
    }

    let escrow = await EscrowModel.findOne({ dealId });

    // Fallback sync if listener race condition occurs
    if (!escrow) {
      console.warn(`Escrow missing on PayeeSynced for deal ${dealId}. Retrying fetch...`);
      const dealData = await escrowCore.deals(dealId);
      escrow = await handleDealCreated(dealId, dealData.payer, dealData.totalBalance, event);
      if (!escrow) return;
    }

    escrow.payee = payeeUser._id;
    if (escrow.status === "CREATED") {
      escrow.status = "FUNDED";
    }

    await escrow.save();
    console.log(`Payee ${payee} synced to deal ${dealId}`);
  } catch (error) {
    console.error("handlePayeeSynced error:", error);
  }
}

async function handleMilestoneReleased(dealIdRaw, milestoneIdRaw, amountReleased, event) {
  try {
    const dealId = parseDealId(dealIdRaw);
    const milestoneId = Number(milestoneIdRaw);

    const escrow = await EscrowModel.findOne({ dealId });
    if (!escrow) {
      console.warn(`Escrow not found for deal ${dealId} on milestone release`);
      return;
    }

    if (!escrow.milestones[milestoneId]) {
      console.warn(`Milestone index ${milestoneId} out of bounds for deal ${dealId}`);
      return;
    }

    escrow.milestones[milestoneId].status = "RELEASED";
    escrow.milestones[milestoneId].releasedAt = new Date();
    escrow.milestones[milestoneId].amount = amountReleased.toString();

    escrow.status = "IN_PROGRESS";
    escrow.transactions.released = await getTxHash(event);

    await escrow.save();
    console.log(`Milestone ${milestoneId} released for deal ${dealId}`);
  } catch (error) {
    console.error("handleMilestoneReleased error:", error);
  }
}

async function handleDealCompleted(dealIdRaw) {
  try {
    const dealId = parseDealId(dealIdRaw);
    const escrow = await EscrowModel.findOne({ dealId });
    if (!escrow) return;

    escrow.status = "COMPLETED";
    for (const milestone of escrow.milestones) {
      if (milestone.status !== "RELEASED") {
        milestone.status = "RELEASED";
        if (!milestone.releasedAt) milestone.releasedAt = new Date();
      }
    }

    await escrow.save();
    console.log(`Deal ${dealId} marked as COMPLETED`);
  } catch (error) {
    console.error("handleDealCompleted error:", error);
  }
}

async function handleDisputeRaised(raisor, dealIdRaw, reason, caseId, arbitrationFee) {
  try {
    const dealId = parseDealId(dealIdRaw);
    const escrow = await EscrowModel.findOne({ dealId });
    if (!escrow) return;

    const raisorUser = await findUserByWallet(raisor);

    escrow.status = "DISPUTED";
    escrow.dispute = {
      ...escrow.dispute,
      status: "OPEN",
      reason,
      openedAt: new Date(),
      openedBy: raisorUser ? raisorUser._id : escrow.dispute?.openedBy,
    };

    await escrow.save();
    console.log(`Dispute raised on deal ${dealId} (Case #${caseId.toString()})`);
  } catch (error) {
    console.error("handleDisputeRaised error:", error);
  }
}

async function handleDisputeResolved(dealIdRaw, payerAmount, payeeAmount) {
  try {
    const dealId = parseDealId(dealIdRaw);
    const escrow = await EscrowModel.findOne({ dealId });
    if (!escrow) return;

    escrow.status = "COMPLETED";
    escrow.dispute = {
      ...escrow.dispute,
      status: "RESOLVED",
      resolvedAt: new Date(),
    };

    await escrow.save();
    console.log(`Dispute resolved for deal ${dealId}`);
  } catch (error) {
    console.error("handleDisputeResolved error:", error);
  }
}

async function handleDealCancelled(dealIdRaw, cancelledBy) {
  try {
    const dealId = parseDealId(dealIdRaw);
    const escrow = await EscrowModel.findOne({ dealId });
    if (!escrow) return;

    escrow.status = "CANCELLED";
    await escrow.save();
    console.log(`Deal ${dealId} cancelled by ${cancelledBy}`);
  } catch (error) {
    console.error("handleDealCancelled error:", error);
  }
}

/* ------------------------------------------------ */
/* Service Lifecycle */
/* ------------------------------------------------ */

export function startEscrowListener() {
  console.log("Initializing EscrowCore Event Subscriptions...");

  escrowCore.on("DealCreated", handleDealCreated);
  escrowCore.on("PayeeSynced", handlePayeeSynced);
  escrowCore.on("MilestoneReleased", handleMilestoneReleased);
  escrowCore.on("DealCompleted", handleDealCompleted);
  escrowCore.on("DisputeRaised", handleDisputeRaised);
  escrowCore.on("DisputeResolved", handleDisputeResolved);
  escrowCore.on("DealCancelled", handleDealCancelled);

  console.log("EscrowCore listeners successfully running.");
}