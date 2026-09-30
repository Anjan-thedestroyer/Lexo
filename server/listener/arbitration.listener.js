import { ethers } from "ethers";

import ArbitrationCourtABI from "../ABI/ArbitrationCourt.json" with {
  type: "json",
};

import ArbitrationCaseModel from "../model/ArbitrationCase.model.js";

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL
);

const arbitrationCourt = new ethers.Contract(
  process.env.ARBITRATION_COURT_ADDRESS,
  ArbitrationCourtABI.abi,
  provider
);

/* =========================================================
   HELPERS
========================================================= */

function toDate(timestamp) {
  if (!timestamp) return null;

  return new Date(Number(timestamp) * 1000);
}

/**
 * Fetch complete case information directly from the contract.
 *
 * Some information is not included in events:
 * - reason
 * - arbitrationFee
 * - createdAt
 * - votingDeadline
 * - etc.
 *
 * Therefore, after receiving an event, we read
 * the current case state from the blockchain.
 */
async function getCaseFromChain(caseId) {
  const caseData = await arbitrationCourt.cases(caseId);

  const arbiters =
    await arbitrationCourt.getCaseArbiters(caseId);

  return {
    dealId: Number(caseData.dealId),

    parentCaseId: Number(caseData.parentCaseId),

    reason: caseData.reason,

    docAHash: caseData.docAHash,

    docBHash: caseData.docBHash,

    arbitrationFee:
      caseData.arbitrationFee.toString(),

    status: Number(caseData.status),

    initiator:
      caseData.initiator.toLowerCase(),

    arbiters: arbiters.map((address) =>
      address.toLowerCase()
    ),

    createdAtChain:
      toDate(caseData.createdAt),

    votingDeadline:
      toDate(caseData.votingDeadline),

    decidedAt:
      toDate(caseData.decidedAt),

    winningChoice:
      Number(caseData.winningChoice),

    isAppeal:
      caseData.isAppeal,

    appealTriggered:
      caseData.appealTriggered,
  };
}

/**
 * Convert Solidity enum status to MongoDB status.
 */
function mapCaseStatus(status) {
  const statuses = [
    "CREATED",
    "VOTING",
    "DECIDED",
    "EXECUTED",
    "CANCELLED",
  ];

  return statuses[status] ?? "VOTING";
}

/* =========================================================
   1. CASE CREATED
========================================================= */

async function handleCaseCreated(
  caseId,
  dealId,
  initiator,
  docAHash,
  docBHash,
  arbiters,
  event
) {
  try {
    caseId = Number(caseId);
    dealId = Number(dealId);

    const chainCase =
      await getCaseFromChain(caseId);

    await ArbitrationCaseModel.findOneAndUpdate(
      { caseId },

      {
        $set: {
          ...chainCase,

          caseId,

          dealId,

          initiator:
            initiator.toLowerCase(),

          docAHash,

          docBHash,

          arbiters: arbiters.map(
            (address) =>
              address.toLowerCase()
          ),

          status:
            mapCaseStatus(
              chainCase.status
            ),

          "transactions.created":
            event?.log?.transactionHash ??
            null,
        },
      },

      {
        upsert: true,
        new: true,
      }
    );

    console.log(
      `[Arbitration] CaseCreated: ${caseId}`
    );
  } catch (error) {
    console.error(
      "[Arbitration] CaseCreated error:",
      error
    );
  }
}

/* =========================================================
   2. CASE RECREATED
========================================================= */

async function handleCaseRecreated(
  newCaseId,
  parentCaseId,
  arbiters,
  event
) {
  try {
    newCaseId = Number(newCaseId);
    parentCaseId = Number(parentCaseId);

    const chainCase =
      await getCaseFromChain(
        newCaseId
      );

    /* -----------------------------------------------------
       Create / update appeal case
    ----------------------------------------------------- */

    await ArbitrationCaseModel.findOneAndUpdate(
      { caseId: newCaseId },

      {
        $set: {
          ...chainCase,

          caseId: newCaseId,

          parentCaseId,

          isAppeal: true,

          arbiters: arbiters.map(
            (address) =>
              address.toLowerCase()
          ),

          status:
            mapCaseStatus(
              chainCase.status
            ),

          "transactions.recreated":
            event?.log?.transactionHash ??
            null,
        },
      },

      {
        upsert: true,
        new: true,
      }
    );

    /* -----------------------------------------------------
       Mark original case as having an appeal
    ----------------------------------------------------- */

    await ArbitrationCaseModel.findOneAndUpdate(
      { caseId: parentCaseId },

      {
        $set: {
          appealTriggered: true,
        },
      }
    );

    console.log(
      `[Arbitration] CaseRecreated: ${newCaseId}`
    );
  } catch (error) {
    console.error(
      "[Arbitration] CaseRecreated error:",
      error
    );
  }
}

/* =========================================================
   3. VOTE CAST
========================================================= */

async function handleVoteCast(
  caseId,
  arbiter,
  choice,
  event
) {
  try {
    caseId = Number(caseId);
    choice = Number(choice);

    const normalizedArbiter =
      arbiter.toLowerCase();

    const votedAt = new Date();

    /* -----------------------------------------------------
       Remove previous vote by this arbiter
       This prevents duplicate votes in MongoDB.
    ----------------------------------------------------- */

    await ArbitrationCaseModel.findOneAndUpdate(
      { caseId },

      {
        $pull: {
          votes: {
            arbiter:
              normalizedArbiter,
          },
        },
      }
    );

    /* -----------------------------------------------------
       Add latest vote
    ----------------------------------------------------- */

    await ArbitrationCaseModel.findOneAndUpdate(
      { caseId },

      {
        $push: {
          votes: {
            arbiter:
              normalizedArbiter,

            choice,

            hasVoted: true,

            txHash:
              event?.log?.transactionHash ??
              null,

            votedAt,
          },
        },
      }
    );

    console.log(
      `[Arbitration] VoteCast: case=${caseId}, arbiter=${arbiter}`
    );
  } catch (error) {
    console.error(
      "[Arbitration] VoteCast error:",
      error
    );
  }
}

/* =========================================================
   4. CASE DECIDED
========================================================= */

async function handleCaseDecided(
  caseId,
  outcome,
  executionUnlockTime,
  event
) {
  try {
    caseId = Number(caseId);
    outcome = Number(outcome);

    await ArbitrationCaseModel.findOneAndUpdate(
      { caseId },

      {
        $set: {
          status: "DECIDED",

          winningChoice: outcome,

          executionUnlockTime:
            toDate(
              executionUnlockTime
            ),

          decidedAt: new Date(),

          "transactions.decided":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Arbitration] CaseDecided: ${caseId}`
    );
  } catch (error) {
    console.error(
      "[Arbitration] CaseDecided error:",
      error
    );
  }
}

/* =========================================================
   5. CASE EXECUTED
========================================================= */

async function handleCaseExecuted(
  caseId,
  outcome,
  event
) {
  try {
    caseId = Number(caseId);
    outcome = Number(outcome);

    await ArbitrationCaseModel.findOneAndUpdate(
      { caseId },

      {
        $set: {
          status: "EXECUTED",

          winningChoice: outcome,

          executedAt: new Date(),

          "transactions.executed":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Arbitration] CaseExecuted: ${caseId}`
    );
  } catch (error) {
    console.error(
      "[Arbitration] CaseExecuted error:",
      error
    );
  }
}

/* =========================================================
   START LISTENERS
========================================================= */

export function startArbitrationListeners() {
  console.log(
    "Starting ArbitrationCourt listeners..."
  );

  console.log(
    `ArbitrationCourt address: ${process.env.ARBITRATION_COURT_ADDRESS}`
  );

  /* -----------------------------------------------------
     Register blockchain event listeners
  ----------------------------------------------------- */

  arbitrationCourt.on(
    "CaseCreated",
    handleCaseCreated
  );

  arbitrationCourt.on(
    "CaseRecreated",
    handleCaseRecreated
  );

  arbitrationCourt.on(
    "VoteCast",
    handleVoteCast
  );

  arbitrationCourt.on(
    "CaseDecided",
    handleCaseDecided
  );

  arbitrationCourt.on(
    "CaseExecuted",
    handleCaseExecuted
  );

  console.log(
    "ArbitrationCourt listeners running."
  );
}