
import { ethers } from "ethers";
import AgreementRegistryABI from "../abi/AgreementRegistry.json" with {
    type: "json",
};

import EscrowModel from "../model/Escrow.model.js";
import AgreementModel from "../model/Agreement.model.js";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const agreementRegistry = new ethers.Contract(
    process.env.AGREEMENT_REGISTRY_ADDRESS,
    AgreementRegistryABI.abi,
    provider
);

const DOC_A = 0;
const DOC_B = 1;

function getEventMetadata(event) {
    const log = event?.log ?? event;

    return {
        txHash: log?.transactionHash ?? null,
        blockNumber: log?.blockNumber ?? null,
    };
}

async function findAgreementByDealId(dealId) {
    // Agreement.dealId is a MongoDB ObjectId reference to Escrow.
    // Escrow.dealId is the numeric blockchain ID.
    const escrow = await EscrowModel.findOne({
        dealId: dealId.toString(),
    }).select("_id agreement");

    if (!escrow) {
        console.warn(`Escrow not found for blockchain deal ${dealId}`);
        return null;
    }

    if (escrow.agreement) {
        return AgreementModel.findById(escrow.agreement);
    }

    // Fallback for records where the agreement exists but
    // the escrow.agreement reference has not been populated.
    return AgreementModel.findOne({ dealId: escrow._id });
}

async function syncDocumentSigning(dealId, event) {
    try {
        const agreement = await findAgreementByDealId(dealId);
        if (!agreement) return;

        const fullySigned = await agreementRegistry.haveBothSigned(dealId);

        agreement.payerSigned = fullySigned;
        agreement.payeeSigned = fullySigned;

        if (fullySigned) {
            agreement.status = "SIGNED";
        } else if (agreement.status === "DRAFT") {
            agreement.status = "PENDING_SIGNATURE";
        }

        await agreement.save();

        console.log("Agreement signing state synchronized", {
            dealId: dealId.toString(),
            agreementId: agreement._id.toString(),
            ...getEventMetadata(event),
        });
    } catch (error) {
        console.error("syncDocumentSigning:", error);
    }
}

async function handleDocumentSubmitted(
    dealId,
    docIndex,
    submitter,
    contentHash,
    event
) {
    try {
        const index = Number(docIndex);

        if (![DOC_A, DOC_B].includes(index)) {
            console.warn("Unknown document index:", index);
            return;
        }

        const agreement = await findAgreementByDealId(dealId);
        if (!agreement) return;

        // The model only has one contentHash/contentLink pair.
        // Only document A (the payer document) is stored here.
        // Document B must not overwrite the payer's document.
        if (index === DOC_A) {
            agreement.contentHash = contentHash;

            if (agreement.status === "DRAFT") {
                agreement.status = "PENDING_SIGNATURE";
            }

            await agreement.save();
        }

        console.log("DocumentSubmitted synchronized", {
            dealId: dealId.toString(),
            index,
            submitter,
            contentHash,
            ...getEventMetadata(event),
        });
    } catch (error) {
        console.error("handleDocumentSubmitted:", error);
    }
}

async function handlePayeeAgreementRejected(
    dealId,
    candidatePayee,
    event
) {
    console.log("Payee agreement rejected on-chain", {
        dealId: dealId.toString(),
        candidatePayee,
        ...getEventMetadata(event),
        note: "No rejection fields exist in AgreementSchema",
    });
}

async function handlePayeeAgreementAccepted(
    dealId,
    selectedPayee,
    contentHash,
    event
) {
    try {
        const agreement = await findAgreementByDealId(dealId);
        if (!agreement) return;

        // Never assign selectedPayee directly to agreement.payee:
        // it is a wallet address, not a MongoDB User ObjectId.
        // Resolve the user separately if the product requires this.

        // Do not overwrite the payer's document hash with the payee's.
        console.log("Payee agreement accepted on-chain", {
            dealId: dealId.toString(),
            selectedPayee,
            contentHash,
            agreementId: agreement._id.toString(),
            ...getEventMetadata(event),
        });
    } catch (error) {
        console.error("handlePayeeAgreementAccepted:", error);
    }
}

async function handleDocumentSigned(
    dealId,
    docIndex,
    signer,
    event
) {
    const index = Number(docIndex);

    if (![DOC_A, DOC_B].includes(index)) {
        console.warn("Unknown document index:", index);
        return;
    }

    console.log("DocumentSigned event", {
        dealId: dealId.toString(),
        index,
        signer,
        ...getEventMetadata(event),
    });

    // Use the contract's overall signing state to synchronize
    // the two Boolean fields in the current Agreement schema.
    await syncDocumentSigning(dealId, event);
}

async function handleBothDocumentsSigned(dealId, event) {
    try {
        const fullySigned = await agreementRegistry.haveBothSigned(dealId);

        if (!fullySigned) {
            console.warn("Contract reports incomplete signatures:", dealId.toString());
            return;
        }

        const agreement = await findAgreementByDealId(dealId);
        if (!agreement) return;

        agreement.payerSigned = true;
        agreement.payeeSigned = true;
        agreement.status = "SIGNED";

        await agreement.save();

        console.log("Agreement marked SIGNED", {
            dealId: dealId.toString(),
            agreementId: agreement._id.toString(),
            ...getEventMetadata(event),
        });
    } catch (error) {
        console.error("handleBothDocumentsSigned:", error);
    }
}

const handlers = {
    DocumentSubmitted: handleDocumentSubmitted,
    PayeeAgreementRejected: handlePayeeAgreementRejected,
    PayeeAgreementAccepted: handlePayeeAgreementAccepted,
    DocumentSigned: handleDocumentSigned,
    BothDocumentsSigned: handleBothDocumentsSigned,
};

export function startAgreementListeners() {
    for (const [eventName, handler] of Object.entries(handlers)) {
        agreementRegistry.off(eventName, handler);
        agreementRegistry.on(eventName, handler);
    }

    console.log("AgreementRegistry listeners running.");
}

export async function stopAgreementListeners() {
    for (const [eventName, handler] of Object.entries(handlers)) {
        agreementRegistry.off(eventName, handler);
    }

    console.log("AgreementRegistry listeners stopped.");
}
