
"use client";

import { useCallback, useEffect } from "react";

import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";

import {
  formatUnits,
  type Address,
} from "viem";

import EscrowCoreJSON from "@/abi/EscrowCore.json";

const ESCROW_ADDRESS = process.env
  .NEXT_PUBLIC_ESCROW_ADDRESS as Address;

const TOKEN_DECIMALS = 6;

export function useWithdraw() {
  const { address, isConnected } = useAccount();

  // Read pending withdrawal balance
  const {
    data,
    isLoading: isLoadingBalance,
    error: balanceError,
    refetch,
  } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: EscrowCoreJSON.abi,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(
        isConnected && address && ESCROW_ADDRESS
      ),
    },
  });

  console.log(data)

  // Explicitly type the result as bigint
  const pendingBalance: bigint =
    typeof data === "bigint" ? data : 0n;

  // Write withdrawal transaction
  const {
    writeContractAsync,
    data: hash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  // Wait for transaction confirmation
  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
  });

  // Withdraw function
  const withdraw = useCallback(async () => {
    if (!isConnected || !address) {
      throw new Error("Please connect your wallet first.");
    }

    if (!ESCROW_ADDRESS) {
      throw new Error(
        "Escrow contract address is not configured."
      );
    }

    if (pendingBalance <= 0n) {
      throw new Error(
        "You have no pending balance to withdraw."
      );
    }

    return writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: EscrowCoreJSON.abi,
      functionName: "withdraw",
      args: [],
    });
  }, [
    isConnected,
    address,
    pendingBalance,
    writeContractAsync,
  ]);

  // Refresh balance after successful withdrawal
  useEffect(() => {
    if (isSuccess) {
      void refetch();
    }
  }, [isSuccess, refetch]);

  // Formatted balance
  const formattedPendingBalance = formatUnits(
    pendingBalance,
    TOKEN_DECIMALS
  );

  return {
    pendingBalance,
    formattedPendingBalance,

    withdraw,

    refetch,
    reset,

    hash,
    isPending,
    isConfirming,
    isSuccess,

    isLoadingBalance,
    balanceError,

    error: writeError || receiptError,
  };
}
