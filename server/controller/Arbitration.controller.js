import { ethers } from "ethers";
import ArbitrationCourtABI from "../abi/ArbitrationCourt.json" with { type: "json" };

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const arbitrationCourt = new ethers.Contract(
  process.env.ARBITRATION_COURT_ADDRESS,
  ArbitrationCourtABI.abi,
  provider
);

// Cache immutable contract constants in memory
let cachedConstants = null;

/* ------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------ */

/**
 * Safely converts BigInt values, arrays, and Ethers Result objects to plain JSON.
 */
function serialize(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serialize);
  }

  if (value && typeof value === "object") {
    // If it's an Ethers Result object, convert to plain object first
    const obj = typeof value.toObject === "function" ? value.toObject() : value;
    const result = {};

    for (const [key, val] of Object.entries(obj)) {
      if (!/^\d+$/.test(key)) {
        result[key] = serialize(val);
      }
    }
    return result;
  }

  return value;
}

function isValidNumericId(id) {
  return !isNaN(id) && Number(id) >= 0;
}

/* ------------------------------------------------ */
/* Controllers */
/* ------------------------------------------------ */

/**
 * GET /api/arbitration/cases/:caseId
 */
export const getCase = async (req, res) => {
  try {
    const { caseId } = req.params;

    if (!isValidNumericId(caseId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid case ID parameter",
      });
    }

    const caseData = await arbitrationCourt.cases(caseId);

    // Validate if the case exists (checking zero-address or uninitialized fields)
    if (!caseData || caseData.escrow === ethers.ZeroAddress) {
      return res.status(404).json({
        success: false,
        message: `Case #${caseId} not found`,
      });
    }

    return res.json({
      success: true,
      data: serialize(caseData),
    });
  } catch (error) {
    console.error("getCase error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch case",
      error: error.message,
    });
  }
};

/**
 * GET /api/arbitration/cases/:caseId/arbiters
 */
export const getCaseArbiters = async (req, res) => {
  try {
    const { caseId } = req.params;

    if (!isValidNumericId(caseId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid case ID parameter",
      });
    }

    const arbiters = await arbitrationCourt.getCaseArbiters(caseId);

    return res.json({
      success: true,
      data: arbiters,
    });
  } catch (error) {
    console.error("getCaseArbiters error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch case arbiters",
      error: error.message,
    });
  }
};

/**
 * GET /api/arbitration/cases/:caseId/vote/:arbiter
 */
export const getVote = async (req, res) => {
  try {
    const { caseId, arbiter } = req.params;

    if (!isValidNumericId(caseId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid case ID parameter",
      });
    }

    if (!ethers.isAddress(arbiter)) {
      return res.status(400).json({
        success: false,
        message: "Invalid arbiter checksum address",
      });
    }

    const vote = await arbitrationCourt.votes(caseId, arbiter);

    return res.json({
      success: true,
      data: serialize(vote),
    });
  } catch (error) {
    console.error("getVote error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch vote details",
      error: error.message,
    });
  }
};

/**
 * GET /api/arbitration/cases/:caseId/votes/:choice
 */
export const getVoteCount = async (req, res) => {
  try {
    const { caseId, choice } = req.params;

    if (!isValidNumericId(caseId) || !isValidNumericId(choice)) {
      return res.status(400).json({
        success: false,
        message: "Invalid case ID or choice parameter",
      });
    }

    const voteCount = await arbitrationCourt.voteCounts(caseId, choice);

    return res.json({
      success: true,
      data: voteCount.toString(),
    });
  } catch (error) {
    console.error("getVoteCount error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch vote count",
      error: error.message,
    });
  }
};

/**
 * GET /api/arbitration/cases/count
 */
export const getCaseCount = async (req, res) => {
  try {
    const count = await arbitrationCourt.caseCounter();

    return res.json({
      success: true,
      data: count.toString(),
    });
  } catch (error) {
    console.error("getCaseCount error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch total case count",
      error: error.message,
    });
  }
};

/**
 * GET /api/arbitration/constants
 */
export const getArbitrationConstants = async (req, res) => {
  try {
    if (cachedConstants) {
      return res.json({
        success: true,
        data: cachedConstants,
      });
    }

    const [
      initialArbiters,
      additionalAppealArbiters,
      votingDuration,
      executionDelay,
    ] = await Promise.all([
      arbitrationCourt.INITIAL_ARBITERS(),
      arbitrationCourt.ADDITIONAL_APPEAL_ARBITERS(),
      arbitrationCourt.VOTING_DURATION(),
      arbitrationCourt.EXECUTION_DELAY(),
    ]);

    cachedConstants = {
      initialArbiters: initialArbiters.toString(),
      additionalAppealArbiters: additionalAppealArbiters.toString(),
      votingDuration: votingDuration.toString(),
      executionDelay: executionDelay.toString(),
    };

    return res.json({
      success: true,
      data: cachedConstants,
    });
  } catch (error) {
    console.error("getArbitrationConstants error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch arbitration constants",
      error: error.message,
    });
  }
};