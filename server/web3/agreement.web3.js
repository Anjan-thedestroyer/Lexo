import { ethers } from "ethers";
import AgreementRegistryABI from "../abi/AgreementRegistry.json" with { type: "json" };

import EscrowModel from "../model/Escrow.model.js";
import AgreementModel from "../model/Agreement.model.js";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const agreementRegistry = new ethers.Contract(
  process.env.AGREEMENT_REGISTRY_ADDRESS,
  AgreementRegistryABI,
  provider
);

const DOC_A = 0;
const DOC_B = 1;

/* HELPERS */

function normalizeAddress(address) {
  return address ? address.toLowerCase() : "";
}

async function findEscrowByBlockchainDealId(dealId) {
  return await EscrowModel.findOne({
    blockchainDealId: dealId.toString(),
  }).select("_id");
}

function getEventMetadata(eventPayload) {
  const log = eventPayload.log || eventPayload;
  return {
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };
}

/* 1. DOCUMENT SUBMITTED */

export async function handleDocumentSubmitted(dealId, docIndex, submitter, contentHash, eventPayload) {
  try {
    const blockchainDealId = dealId.toString();
    const { txHash, blockNumber } = getEventMetadata(eventPayload);

    const escrow = await findEscrowByBlockchainDealId(blockchainDealId);
    if (!escrow) {
      console.warn(`Escrow not found for dealId ${blockchainDealId}`);
      return;
    }

    const numericDocIndex = Number(docIndex);

    if (numericDocIndex === DOC_A) {
      await AgreementModel.updateOne(
        { dealId: escrow._id },
        {
          $set: {
            contentHash,
            payerDocumentStatus: "CONFIRMED",
            payerWallet: normalizeAddress(submitter),
            payerDocumentTxHash: txHash,
          },
        }
      );
      console.log(`Payer document confirmed for deal ${blockchainDealId}`);
      return;
    }

    if (numericDocIndex === DOC_B) {
      const wallet = normalizeAddress(submitter);

      const result = await AgreementModel.updateOne(
        {
          dealId: escrow._id,
          "candidatePayees.wallet": { $ne: wallet },
        },
        {
          $push: {
            candidatePayees: {
              wallet,
              documentHash: contentHash,
              status: "PENDING",
              transactionHash: txHash,
              blockNumber,
              submittedAt: new Date(),
            },
          },
        }
      );

      if (result.matchedCount === 0) {
        console.log(`Candidate already exists: ${wallet}`);
        return;
      }

      console.log(`Payee candidate document recorded for deal ${blockchainDealId}`);
    }
  } catch (error) {
    console.error("DocumentSubmitted listener error:", error);
  }
}

/* 2. PAYEE AGREEMENT REJECTED */

export async function handlePayeeAgreementRejected(dealId, candidatePayee, eventPayload) {
  try {
    const blockchainDealId = dealId.toString();
    const wallet = normalizeAddress(candidatePayee);
    const { txHash } = getEventMetadata(eventPayload);

    const escrow = await findEscrowByBlockchainDealId(blockchainDealId);
    if (!escrow) return;

    const result = await AgreementModel.updateOne(
      {
        dealId: escrow._id,
        "candidatePayees.wallet": wallet,
      },
      {
        $set: {
          "candidatePayees.$.status": "REJECTED",
          "candidatePayees.$.rejectedAt": new Date(),
          "candidatePayees.$.rejectionTxHash": txHash,
        },
      }
    );

    if (result.modifiedCount === 0) {
      console.warn(`Candidate ${wallet} not found in MongoDB`);
      return;
    }

    console.log(`Payee ${wallet} marked as REJECTED`);
  } catch (error) {
    console.error("PayeeAgreementRejected listener error:", error);
  }
}

/* 3. PAYEE AGREEMENT ACCEPTED */

export async function handlePayeeAgreementAccepted(dealId, selectedPayee, contentHash, eventPayload) {
  try {
    const blockchainDealId = dealId.toString();
    const wallet = normalizeAddress(selectedPayee);
    const { txHash } = getEventMetadata(eventPayload);

    const escrow = await findEscrowByBlockchainDealId(blockchainDealId);
    if (!escrow) return;

    const result = await AgreementModel.updateOne(
      {
        dealId: escrow._id,
        "candidatePayees.wallet": wallet,
      },
      {
        $set: {
          payeeWallet: wallet,
          payeeDocumentStatus: "CONFIRMED",
          payeeAgreementTxHash: txHash,
          payeeDocumentHash: contentHash,
          "candidatePayees.$.status": "ACCEPTED",
          "candidatePayees.$.acceptedAt": new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      console.warn(`Candidate ${wallet} not found for deal ${blockchainDealId}`);
      return;
    }

    console.log(`Payee ${wallet} accepted for deal ${blockchainDealId}`);
  } catch (error) {
    console.error("PayeeAgreementAccepted listener error:", error);
  }
}

/* 4. DOCUMENT SIGNED */

export async function handleDocumentSigned(dealId, docIndex, signer, eventPayload) {
  try {
    const blockchainDealId = dealId.toString();
    const { txHash } = getEventMetadata(eventPayload);

    const escrow = await findEscrowByBlockchainDealId(blockchainDealId);
    if (!escrow) return;

    const [contentHash, payerSigned, payeeSigned] = await agreementRegistry.getDocumentStatus(
      dealId,
      docIndex
    );

    const updateFields = {
      payerSigned,
      payeeSigned,
      lastSigningTxHash: txHash,
    };

    if (Number(docIndex) === DOC_A) {
      updateFields.contentHash = contentHash;
    } else if (Number(docIndex) === DOC_B) {
      updateFields.payeeDocumentHash = contentHash;
    }

    await AgreementModel.updateOne(
      { dealId: escrow._id },
      { $set: updateFields }
    );

    console.log(`Signing state synchronized for deal ${blockchainDealId}`);
  } catch (error) {
    console.error("DocumentSigned listener error:", error);
  }
}

/* 5. BOTH DOCUMENTS SIGNED */

export async function handleBothDocumentsSigned(dealId, eventPayload) {
  try {
    const blockchainDealId = dealId.toString();
    const { txHash, blockNumber } = getEventMetadata(eventPayload);

    const escrow = await findEscrowByBlockchainDealId(blockchainDealId);
    if (!escrow) return;

    const fullySigned = await agreementRegistry.haveBothSigned(dealId);
    if (!fullySigned) {
      console.warn("BothDocumentsSigned event received, but on-chain state shows incomplete signatures.");
      return;
    }

    await AgreementModel.updateOne(
      { dealId: escrow._id },
      {
        $set: {
          payerSigned: true,
          payeeSigned: true,
          agreementFullySigned: true,
          status: "SIGNED",
          fullySignedTxHash: txHash,
          fullySignedBlockNumber: blockNumber,
        },
      }
    );

    console.log(`Agreement ${blockchainDealId} marked SIGNED`);
  } catch (error) {
    console.error("BothDocumentsSigned listener error:", error);
  }
}


