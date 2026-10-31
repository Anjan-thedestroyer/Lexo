
import { ethers } from "ethers";
import EscrowCoreABI from "../abi/EscrowCore.json" with { type: "json" };

import EscrowModel from "../model/Escrow.model.js";
import AgreementModel from "../model/Agreement.model.js";
import UserModel from "../model/User.model.js";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const escrowCore = new ethers.Contract(
    process.env.ESCROW_ADDRESS,
    EscrowCoreABI.abi,
    provider
);

function parseDealId(value) {
    const id = BigInt(value);

    if (id < 0n) {
        throw new Error("Invalid blockchain deal ID");
    }

    // The existing Escrow schema stores dealId as Number.
    if (id > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Blockchain deal ID exceeds safe integer range");
    }

    return Number(id);
}

function getTxHash(event) {
    return event?.log?.transactionHash
        ?? event?.transactionHash
        ?? null;
}

async function findUserByWallet(wallet) {
    if (!wallet || !ethers.isAddress(wallet)) return null;

    const normalized = wallet.toLowerCase();

    return UserModel.findOne({
        "wallets.address": {
            $regex: `^${normalized}$`,
            $options: "i",
        },
    });
}

async function getOnChainDeal(dealId) {
    return escrowCore.deals(dealId);
}

async function getMilestones(dealId, totalMilestones) {
    const milestones = [];

    for (let i = 0; i < totalMilestones; i++) {
        const item = await escrowCore.milestones(dealId, i);

        milestones.push({
            title: `Milestone ${i + 1}`,
            description: item.description ?? "",
            amount: item.amount.toString(),
            status: item.isCompleted ? "APPROVED" : "PENDING",
        });
    }

    return milestones;
}

async function findEscrow(dealId) {
    return EscrowModel.findOne({ dealId });
}

async function handleDealCreated(
    dealIdRaw,
    payer,
    totalBalance,
    event
) {
    try {
        const dealId = parseDealId(dealIdRaw);

        const existing = await findEscrow(dealId);
        if (existing) {
            console.log(`Escrow already exists for deal ${dealId}`);
            return existing;
        }

        const payerUser = await findUserByWallet(payer);

        if (!payerUser) {
            console.warn(
                `Payer user not found for wallet ${payer}; escrow not created`
            );
            return null;
        }

        const deal = await getOnChainDeal(dealId);
        const milestones = await getMilestones(
            dealId,
            Number(deal.totalMilestones)
        );

        const escrow = await EscrowModel.create({
            dealId,
            payer: payerUser._id,
            payee: null,
            agreement: null,
            totalAmount: totalBalance.toString(),
            token: "USDT",
            status: "CREATED",
            milestones,
            transactions: {
                funded: null,
                released: null,
                refunded: null,
            },
        });

        console.log("Escrow created from DealCreated", {
            dealId,
            escrowId: escrow._id.toString(),
            transactionHash: getTxHash(event),
        });

        return escrow;
    } catch (error) {
        console.error("handleDealCreated:", error);
        return null;
    }
}

async function handlePayeeSynced(dealIdRaw, payee, event) {
    try {
        const dealId = parseDealId(dealIdRaw);
        const payeeUser = await findUserByWallet(payee);

        if (!payeeUser) {
            console.warn(`Payee user not found for wallet ${payee}`);
            return;
        }

        let escrow = await findEscrow(dealId);

        if (!escrow) {
            const deal = await getOnChainDeal(dealId);

            escrow = await handleDealCreated(
                dealId,
                deal.payer,
                deal.totalBalance,
                event
            );
        }

        if (!escrow) return;

        escrow.payee = payeeUser._id;
        await escrow.save();

        // Link an existing Agreement only when it can be identified safely.
        // Agreement.dealId refers to the escrow's MongoDB _id.
        const agreement = await AgreementModel.findOne({
            dealId: escrow._id,
        });

        if (agreement && !escrow.agreement) {
            escrow.agreement = agreement._id;
            await escrow.save();
        }

        console.log("Payee synchronized", {
            dealId,
            payee,
            escrowId: escrow._id.toString(),
            transactionHash: getTxHash(event),
        });
    } catch (error) {
        console.error("handlePayeeSynced:", error);
    }
}

async function handleMilestoneReleased(
    dealIdRaw,
    milestoneIdRaw,
    amountReleased,
    event
) {
    try {
        const dealId = parseDealId(dealIdRaw);
        const milestoneId = Number(milestoneIdRaw);

        const escrow = await findEscrow(dealId);

        if (!escrow) {
            console.warn(`Escrow not found for deal ${dealId}`);
            return;
        }

        const milestone = escrow.milestones[milestoneId];

        if (!milestone) {
            console.warn(`Milestone ${milestoneId} not found for deal ${dealId}`);
            return;
        }

        milestone.status = "RELEASED";
        milestone.releasedAt = new Date();
        milestone.amount = amountReleased.toString();

        if (escrow.milestones.every((item) => item.status === "RELEASED")) {
            escrow.status = "COMPLETED";
        } else {
            escrow.status = "IN_PROGRESS";
        }

        escrow.transactions.released = getTxHash(event);

        await escrow.save();

        console.log(`Milestone ${milestoneId} released for deal ${dealId}`);
    } catch (error) {
        console.error("handleMilestoneReleased:", error);
    }
}

async function handleDealCompleted(dealIdRaw) {
    try {
        const dealId = parseDealId(dealIdRaw);
        const escrow = await findEscrow(dealId);

        if (!escrow) return;

        escrow.status = "COMPLETED";

        for (const milestone of escrow.milestones) {
            milestone.status = "RELEASED";
            milestone.releasedAt ??= new Date();
        }

        await escrow.save();
        console.log(`Deal ${dealId} marked COMPLETED`);
    } catch (error) {
        console.error("handleDealCompleted:", error);
    }
}

async function handleDisputeRaised(
    raisor,
    dealIdRaw,
    reason,
    caseId,
    arbitrationFee
) {
    try {
        const dealId = parseDealId(dealIdRaw);
        const escrow = await findEscrow(dealId);

        if (!escrow) return;

        const raisorUser = await findUserByWallet(raisor);

        escrow.status = "DISPUTED";
        escrow.dispute.status = "OPEN";
        escrow.dispute.reason = reason;
        escrow.dispute.openedAt = new Date();

        if (raisorUser) {
            escrow.dispute.openedBy = raisorUser._id;
        }

        await escrow.save();

        console.log("Dispute raised", {
            dealId,
            caseId: caseId.toString(),
            arbitrationFee: arbitrationFee.toString(),
        });
    } catch (error) {
        console.error("handleDisputeRaised:", error);
    }
}

async function handleDisputeResolved(
    dealIdRaw,
    payerAmount,
    payeeAmount
) {
    try {
        const dealId = parseDealId(dealIdRaw);
        const escrow = await findEscrow(dealId);

        if (!escrow) return;

        escrow.dispute.status = "RESOLVED";
        escrow.dispute.resolvedAt = new Date();

        // Only mark COMPLETED if the contract's resolution means
        // the deal is terminal. Change this if refunds are possible.
        escrow.status = "COMPLETED";

        await escrow.save();

        console.log("Dispute resolved", {
            dealId,
            payerAmount: payerAmount.toString(),
            payeeAmount: payeeAmount.toString(),
        });
    } catch (error) {
        console.error("handleDisputeResolved:", error);
    }
}

async function handleDealCancelled(dealIdRaw, cancelledBy) {
    try {
        const dealId = parseDealId(dealIdRaw);
        const escrow = await findEscrow(dealId);

        if (!escrow) return;

        escrow.status = "CANCELLED";
        await escrow.save();

        console.log(`Deal ${dealId} cancelled by ${cancelledBy}`);
    } catch (error) {
        console.error("handleDealCancelled:", error);
    }
}

const handlers = {
    DealCreated: handleDealCreated,
    PayeeSynced: handlePayeeSynced,
    MilestoneReleased: handleMilestoneReleased,
    DealCompleted: handleDealCompleted,
    DisputeRaised: handleDisputeRaised,
    DisputeResolved: handleDisputeResolved,
    DealCancelled: handleDealCancelled,
};

export function startEscrowListener() {
    for (const [eventName, handler] of Object.entries(handlers)) {
        escrowCore.off(eventName, handler);
        escrowCore.on(eventName, handler);
    }

    console.log("EscrowCore listeners running.");
}

export async function stopEscrowListener() {
    for (const [eventName, handler] of Object.entries(handlers)) {
        escrowCore.off(eventName, handler);
    }

    console.log("EscrowCore listeners stopped.");
}
