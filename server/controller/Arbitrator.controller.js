import { ethers } from "ethers";
import ArbitratorRegistryABI from "../abi/ArbitratorRegistry.json" with { type: "json" };

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const arbitratorRegistry = new ethers.Contract(
  process.env.ARBITER_REGISTRY_ADDRESS,
  ArbitratorRegistryABI.abi,
  provider
);


export const getArbitrator = async (req, res) => {
  try {
    const { identityHash } = req.params;

    const arbitrator =
      await arbitratorRegistry.arbitrators(identityHash);

    return res.json({
      success: true,
      data: {
        wallet: arbitrator.wallet,
        unstakeRequestedAt:
          arbitrator.unstakeRequestedAt.toString(),
        active: arbitrator.active,
        suspended: arbitrator.suspended,
        stake: arbitrator.stake.toString(),
        activeCases: arbitrator.activeCases.toString(),
        reputation: arbitrator.reputation.toString(),
      },
    });
  } catch (error) {
    console.error("getArbitrator:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch arbitrator",
      error: error.message,
    });
  }
};

/**
 * GET /api/arbitrators/wallet/:wallet/identity
 *
 * Solidity:
 * arbitratorToIdentity(address)
 */
export const getWalletIdentity = async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    const identityHash =
      await arbitratorRegistry.arbitratorToIdentity(wallet);

    return res.json({
      success: true,
      data: identityHash,
    });
  } catch (error) {
    console.error("getWalletIdentity:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch arbitrator identity",
      error: error.message,
    });
  }
};

/**
 * GET /api/arbitrators/:wallet/eligibility
 *
 * Solidity:
 * isEligible(address)
 */
export const checkEligibility = async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    const eligible =
      await arbitratorRegistry.isEligible(wallet);

    return res.json({
      success: true,
      data: {
        wallet,
        eligible,
      },
    });
  } catch (error) {
    console.error("checkEligibility:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to check arbitrator eligibility",
      error: error.message,
    });
  }
};

/**
 * GET /api/arbitrators/pool/size
 *
 * Solidity:
 * getEligiblePoolSize()
 */
export const getEligiblePoolSize = async (req, res) => {
  try {
    const size =
      await arbitratorRegistry.getEligiblePoolSize();

    return res.json({
      success: true,
      data: size.toString(),
    });
  } catch (error) {
    console.error("getEligiblePoolSize:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch eligible pool size",
      error: error.message,
    });
  }
};
export const checkCaseAssignment = async (req, res) => {
  try {
    const { caseId, wallet } = req.params;

    if (!ethers.isAddress(wallet)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet address",
      });
    }

    const assigned =
      await arbitratorRegistry.isAssignedToCase(
        caseId,
        wallet
      );

    return res.json({
      success: true,
      data: {
        caseId,
        wallet,
        assigned,
      },
    });
  } catch (error) {
    console.error("checkCaseAssignment:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to check case assignment",
      error: error.message,
    });
  }
};