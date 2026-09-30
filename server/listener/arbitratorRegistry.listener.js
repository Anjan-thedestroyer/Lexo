import { ethers } from "ethers";

import ArbitratorRegistryABI from "../ABI/ArbitratorRegistry.json" with {
  type: "json",
};

import ArbitratorModel from "../model/Arbitrator.model.js";
import ArbitratorAssignmentModel from "../model/ArbitratorAssignment.model.js";

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL
);

const arbitratorRegistry = new ethers.Contract(
  process.env.ARBITER_REGISTRY_ADDRESS,
  ArbitratorRegistryABI.abi,
  provider
);

/* =========================================================
   HELPERS
========================================================= */

function normalizeAddress(address) {
  return address.toLowerCase();
}

/**
 * Get complete arbitrator information directly
 * from the blockchain.
 */
async function getArbitratorFromChain(identityHash) {
  const arbitrator =
    await arbitratorRegistry.arbitrators(identityHash);

  return {
    identityHash,

    wallet: normalizeAddress(
      arbitrator.wallet
    ),

    unstakeRequestedAt:
      arbitrator.unstakeRequestedAt > 0
        ? new Date(
            Number(
              arbitrator.unstakeRequestedAt
            ) * 1000
          )
        : null,

    active:
      arbitrator.active,

    suspended:
      arbitrator.suspended,

    stake:
      arbitrator.stake.toString(),

    activeCases:
      Number(arbitrator.activeCases),

    reputation:
      Number(arbitrator.reputation),

    eligible:
      arbitrator.active &&
      !arbitrator.suspended,
  };
}

/* =========================================================
   1. ARBITRATOR ADDED
========================================================= */

async function handleArbitratorAdded(
  identityHash,
  wallet,
  stake,
  event
) {
  try {
    const data =
      await getArbitratorFromChain(
        identityHash
      );

    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          ...data,

          "transactions.added":
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
      `[Registry] ArbitratorAdded: ${wallet}`
    );
  } catch (error) {
    console.error(
      "[Registry] ArbitratorAdded error:",
      error
    );
  }
}

/* =========================================================
   2. STAKE INCREASED
========================================================= */

async function handleStakeIncreased(
  identityHash,
  wallet,
  addedAmount,
  newTotalStake,
  event
) {
  try {
    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          wallet:
            normalizeAddress(wallet),

          stake:
            newTotalStake.toString(),

          "transactions.stakeIncreased":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Registry] StakeIncreased: ${wallet}`
    );
  } catch (error) {
    console.error(
      "[Registry] StakeIncreased error:",
      error
    );
  }
}

/* =========================================================
   3. UNSTAKE REQUESTED
========================================================= */

async function handleUnstakeRequested(
  identityHash,
  wallet,
  timestamp,
  event
) {
  try {
    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          wallet:
            normalizeAddress(wallet),

          unstakeRequestedAt:
            new Date(
              Number(timestamp) * 1000
            ),

          "transactions.unstakeRequested":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Registry] UnstakeRequested: ${wallet}`
    );
  } catch (error) {
    console.error(
      "[Registry] UnstakeRequested error:",
      error
    );
  }
}

/* =========================================================
   4. UNSTAKE COMPLETED
========================================================= */

async function handleUnstakeCompleted(
  identityHash,
  wallet,
  amountReturned,
  event
) {
  try {
    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          wallet:
            normalizeAddress(wallet),

          stake: "0",

          active: false,

          eligible: false,

          unstakeRequestedAt: null,

          "transactions.unstakeCompleted":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Registry] UnstakeCompleted: ${wallet}`
    );
  } catch (error) {
    console.error(
      "[Registry] UnstakeCompleted error:",
      error
    );
  }
}

/* =========================================================
   5. SLASHED
========================================================= */

async function handleSlashed(
  identityHash,
  wallet,
  amount,
  recipient,
  event
) {
  try {
    const data =
      await getArbitratorFromChain(
        identityHash
      );

    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          ...data,

          "transactions.slashed":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Registry] Slashed: ${wallet}`
    );
  } catch (error) {
    console.error(
      "[Registry] Slashed error:",
      error
    );
  }
}

/* =========================================================
   6. REPUTATION UPDATED
========================================================= */

async function handleReputationUpdated(
  identityHash,
  newReputation,
  event
) {
  try {
    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          reputation:
            Number(newReputation),

          "transactions.reputationUpdated":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Registry] ReputationUpdated: ${identityHash}`
    );
  } catch (error) {
    console.error(
      "[Registry] ReputationUpdated error:",
      error
    );
  }
}

/* =========================================================
   7. CASE ASSIGNED
========================================================= */

async function handleCaseAssigned(
  identityHash,
  wallet,
  newActiveCases,
  event
) {
  try {
    /*
     * This function must exist in your project.
     *
     * It should extract the caseId associated
     * with this assignment event.
     */
    const caseId =
      await findCaseIdFromAssignmentEvent(
        event
      );

    /* -----------------------------------------------------
       Update arbitrator
    ----------------------------------------------------- */

    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          wallet:
            normalizeAddress(wallet),

          activeCases:
            Number(newActiveCases),
        },
      }
    );

    /* -----------------------------------------------------
       Create / update assignment
    ----------------------------------------------------- */

    if (caseId !== null) {
      await ArbitratorAssignmentModel.findOneAndUpdate(
        {
          caseId,

          wallet:
            normalizeAddress(wallet),
        },

        {
          $set: {
            identityHash,

            status: "ASSIGNED",

            assignedAt: new Date(),

            assignmentTxHash:
              event?.log?.transactionHash ??
              null,
          },
        },

        {
          upsert: true,

          new: true,
        }
      );
    }

    console.log(
      `[Registry] CaseAssigned: ${wallet}`
    );
  } catch (error) {
    console.error(
      "[Registry] CaseAssigned error:",
      error
    );
  }
}

/* =========================================================
   8. CASE FINISHED
========================================================= */

async function handleCaseFinished(
  identityHash,
  wallet,
  newActiveCases,
  event
) {
  try {
    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          activeCases:
            Number(newActiveCases),

          "transactions.caseFinished":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Registry] CaseFinished: ${wallet}`
    );
  } catch (error) {
    console.error(
      "[Registry] CaseFinished error:",
      error
    );
  }
}

/* =========================================================
   9. STATUS CHANGED
========================================================= */

async function handleStatusChanged(
  identityHash,
  suspended,
  active,
  event
) {
  try {
    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          suspended,

          active,

          eligible:
            active && !suspended,

          "transactions.statusChanged":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Registry] StatusChanged: ${identityHash}`
    );
  } catch (error) {
    console.error(
      "[Registry] StatusChanged error:",
      error
    );
  }
}

/* =========================================================
   10. WALLET CHANGED
========================================================= */

async function handleWalletChanged(
  identityHash,
  oldWallet,
  newWallet,
  event
) {
  try {
    await ArbitratorModel.findOneAndUpdate(
      { identityHash },

      {
        $set: {
          wallet:
            normalizeAddress(newWallet),

          "transactions.walletChanged":
            event?.log?.transactionHash ??
            null,
        },
      }
    );

    console.log(
      `[Registry] WalletChanged: ${oldWallet} -> ${newWallet}`
    );
  } catch (error) {
    console.error(
      "[Registry] WalletChanged error:",
      error
    );
  }
}

/* =========================================================
   11. ARBITRATOR SELECTED
========================================================= */

async function handleArbitratorSelected(
  caseId,
  wallet,
  randomIndex,
  poolSize,
  event
) {
  try {
    console.log(
      `[Registry] ArbitratorSelected: case=${caseId}, wallet=${wallet}`
    );

    console.log(
      `[Registry] Selection details: randomIndex=${randomIndex}, poolSize=${poolSize}`
    );
  } catch (error) {
    console.error(
      "[Registry] ArbitratorSelected error:",
      error
    );
  }
}

/* =========================================================
   START LISTENERS
========================================================= */

export function startArbitratorRegistryListeners() {
  console.log(
    "Starting ArbitratorRegistry listeners..."
  );

  console.log(
    `ArbitratorRegistry address: ${process.env.ARBITRATOR_REGISTRY_ADDRESS}`
  );

  /* -------------------------------------------------------
     Register all blockchain event listeners
  ------------------------------------------------------- */

  arbitratorRegistry.on(
    "ArbitratorAdded",
    handleArbitratorAdded
  );

  arbitratorRegistry.on(
    "StakeIncreased",
    handleStakeIncreased
  );

  arbitratorRegistry.on(
    "UnstakeRequested",
    handleUnstakeRequested
  );

  arbitratorRegistry.on(
    "UnstakeCompleted",
    handleUnstakeCompleted
  );

  arbitratorRegistry.on(
    "Slashed",
    handleSlashed
  );

  arbitratorRegistry.on(
    "ReputationUpdated",
    handleReputationUpdated
  );

  arbitratorRegistry.on(
    "CaseAssigned",
    handleCaseAssigned
  );

  arbitratorRegistry.on(
    "CaseFinished",
    handleCaseFinished
  );

  arbitratorRegistry.on(
    "StatusChanged",
    handleStatusChanged
  );

  arbitratorRegistry.on(
    "WalletChanged",
    handleWalletChanged
  );

  arbitratorRegistry.on(
    "ArbitratorSelected",
    handleArbitratorSelected
  );

  console.log(
    "ArbitratorRegistry listeners running."
  );
}