"use client";

import { useEffect, useMemo } from "react";
import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";

import {
  decodeEventLog,
  isAddress,
  isHex,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import EscrowCoreJSON from "@/abi/EscrowCore.json";
import MockUSDTJSON from "@/abi/MockUSDT.json";

const ESCROW_ADDRESS = process.env
  .NEXT_PUBLIC_ESCROW_ADDRESS as Address | undefined;

const TOKEN_ADDRESS = process.env
  .NEXT_PUBLIC_TOKEN_ADDRESS as Address | undefined;

const MAX_MILESTONES = 15;

const dealCreatedEventAbi = [
  {
    type: "event",
    name: "DealCreated",
    anonymous: false,
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "totalBalance", type: "uint256", indexed: false },
    ],
  },
] as const;

type CreateEscrowParams = {
  descriptions: string[];
  amounts: string[];
  invitedPayees: Address[];
  documentHash: Hex;
  tokenDecimals: number;
};

export function useCreateEscrow(expectedChainId: number) {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();

  const publicClient = usePublicClient({
    chainId: expectedChainId,
  });

  const {
    writeContractAsync,
    data: hash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
    chainId: expectedChainId,
  });

  const transactionSucceeded =
    isConfirmed && receipt?.status === "success";

  // Log the confirmed receipt to diagnose event extraction.
  useEffect(() => {
    if (!receipt) return;

    console.log("[ESCROW HOOK] Transaction receipt:", {
      status: receipt.status,
      transactionHash: receipt.transactionHash,
      configuredEscrowAddress: ESCROW_ADDRESS,
      receiptLogCount: receipt.logs.length,
      logs: receipt.logs.map((log, index) => ({
        index,
        address: log.address,
        topics: log.topics,
        data: log.data,
        matchesConfiguredEscrow:
          !!ESCROW_ADDRESS &&
          log.address.toLowerCase() === ESCROW_ADDRESS.toLowerCase(),
      })),
    });
  }, [receipt]);

  const dealId = useMemo(() => {
    if (!transactionSucceeded || !receipt) {
      console.log("[ESCROW HOOK] Cannot extract dealId yet:", {
        transactionSucceeded,
        hasReceipt: Boolean(receipt),
      });

      return undefined;
    }

    if (!ESCROW_ADDRESS || !isAddress(ESCROW_ADDRESS)) {
      console.error(
        "[ESCROW HOOK] ESCROW_ADDRESS is missing or invalid:",
        ESCROW_ADDRESS
      );
      return undefined;
    }

    for (const [index, log] of receipt.logs.entries()) {
      if (
        log.address.toLowerCase() !== ESCROW_ADDRESS.toLowerCase()
      ) {
        continue;
      }

      try {
        const event = decodeEventLog({
          abi: dealCreatedEventAbi,
          eventName: "DealCreated",
          data: log.data,
          topics: log.topics,
          strict: true,
        });

        const extractedDealId = event.args.dealId.toString();

        console.log("[ESCROW HOOK] DealCreated event decoded:", {
          logIndex: index,
          contractAddress: log.address,
          dealId: extractedDealId,
          payer: event.args.payer,
          totalBalance: event.args.totalBalance.toString(),
        });

        return extractedDealId;
      } catch (decodeError) {
        console.warn(
          `[ESCROW HOOK] Could not decode log ${index} as DealCreated:`,
          {
            address: log.address,
            topics: log.topics,
            data: log.data,
            error:
              decodeError instanceof Error
                ? decodeError.message
                : decodeError,
          }
        );
      }
    }

    console.error(
      "[ESCROW HOOK] Transaction succeeded, but no matching DealCreated event was found.",
      {
        configuredEscrowAddress: ESCROW_ADDRESS,
        receiptLogAddresses: receipt.logs.map((log) => log.address),
        expectedEvent: "DealCreated(uint256 indexed,address indexed,uint256)",
      }
    );

    return undefined;
  }, [receipt, transactionSucceeded]);

  useEffect(() => {
    console.log("[ESCROW HOOK] Current state:", {
      hash,
      transactionSucceeded,
      isConfirmed,
      isConfirming,
      isPending,
      dealId: dealId ?? null,
      currentChainId,
      expectedChainId,
      error: writeError?.message ?? receiptError?.message ?? null,
    });
  }, [
    hash,
    transactionSucceeded,
    isConfirmed,
    isConfirming,
    isPending,
    dealId,
    currentChainId,
    expectedChainId,
    writeError,
    receiptError,
  ]);

  async function createEscrow({
    descriptions,
    amounts,
    invitedPayees,
    documentHash,
    tokenDecimals,
  }: CreateEscrowParams): Promise<Hex> {
    if (!isConnected || !address) {
      throw new Error("Connect your wallet first.");
    }

    if (currentChainId !== expectedChainId) {
      throw new Error("Switch to the correct network first.");
    }

    if (!publicClient) {
      throw new Error("Blockchain client is not available.");
    }

    if (!ESCROW_ADDRESS || !isAddress(ESCROW_ADDRESS)) {
      throw new Error("Invalid escrow contract address.");
    }

    if (!TOKEN_ADDRESS || !isAddress(TOKEN_ADDRESS)) {
      throw new Error("Invalid MockUSDT token address.");
    }

    if (
      descriptions.length === 0 ||
      descriptions.length > MAX_MILESTONES ||
      descriptions.length !== amounts.length
    ) {
      throw new Error("Invalid milestone details.");
    }

    if (
      !Number.isInteger(tokenDecimals) ||
      tokenDecimals < 0 ||
      tokenDecimals > 255
    ) {
      throw new Error("Invalid token decimals.");
    }

    if (!isHex(documentHash) || documentHash.length !== 66) {
      throw new Error("Document hash must be bytes32.");
    }

    if (descriptions.some((item) => !item.trim())) {
      throw new Error("Milestone descriptions cannot be empty.");
    }

    const normalizedPayees = invitedPayees.map((payee) => {
      if (!isAddress(payee)) {
        throw new Error("Invalid invited payee address.");
      }

      return payee;
    });

    const amountsInBaseUnits = amounts.map((amount) => {
      if (!/^\d+(\.\d+)?$/.test(amount.trim())) {
        throw new Error("Invalid token amount.");
      }

      const parsed = parseUnits(amount.trim(), tokenDecimals);

      if (parsed <= 0n) {
        throw new Error("Amounts must be greater than zero.");
      }

      return parsed;
    });

    const totalAmount = amountsInBaseUnits.reduce(
      (total, amount) => total + amount,
      0n
    );

    console.log("[ESCROW HOOK] Checking token balance:", {
      tokenAddress: TOKEN_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      payer: address,
      totalAmount: totalAmount.toString(),
      tokenDecimals,
    });

    const balance = await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: MockUSDTJSON.abi,
      functionName: "balanceOf",
      args: [address],
    });

    console.log("[ESCROW HOOK] Token balance:", {
      balance: balance.toString(),
      required: totalAmount.toString(),
    });

    if (balance < totalAmount) {
      throw new Error(
        "Insufficient USDT balance. Get more test USDT before creating this escrow."
      );
    }

    const allowance = await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: MockUSDTJSON.abi,
      functionName: "allowance",
      args: [address, ESCROW_ADDRESS],
    });

    console.log("[ESCROW HOOK] Token allowance:", {
      allowance: allowance.toString(),
      required: totalAmount.toString(),
    });

    if (allowance < totalAmount) {
      console.log("[ESCROW HOOK] Requesting token approval...");

      const approvalHash = await writeContractAsync({
        address: TOKEN_ADDRESS,
        abi: MockUSDTJSON.abi,
        functionName: "approve",
        args: [ESCROW_ADDRESS, totalAmount],
        chainId: expectedChainId,
      });

      console.log("[ESCROW HOOK] Approval transaction submitted:", {
        approvalHash,
      });

      const approvalReceipt =
        await publicClient.waitForTransactionReceipt({
          hash: approvalHash,
        });

      console.log("[ESCROW HOOK] Approval receipt:", {
        status: approvalReceipt.status,
        transactionHash: approvalReceipt.transactionHash,
      });

      if (approvalReceipt.status !== "success") {
        throw new Error(
          "USDT approval transaction failed. Escrow was not created."
        );
      }
    }

    console.log("[ESCROW HOOK] Submitting createDeal:", {
      contractAddress: ESCROW_ADDRESS,
      functionName: "createDeal",
      descriptions,
      amountsInBaseUnits: amountsInBaseUnits.map(String),
      invitedPayees: normalizedPayees,
      documentHash,
    });

    const transactionHash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: EscrowCoreJSON.abi,
      functionName: "createDeal",
      args: [
        descriptions,
        amountsInBaseUnits,
        normalizedPayees,
        documentHash,
      ],
      chainId: expectedChainId,
    });

    console.log("[ESCROW HOOK] createDeal transaction submitted:", {
      transactionHash,
    });

    return transactionHash;
  }

  return {
    createEscrow,
    hash,
    receipt,
    dealId,
    transactionSucceeded,
    isPending,
    isConfirming,
    isConfirmed,
    isSuccess: transactionSucceeded && dealId !== undefined,
    error: writeError ?? receiptError ?? null,
    reset,
  };
}
