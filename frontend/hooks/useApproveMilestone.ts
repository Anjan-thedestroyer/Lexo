
"use client";

import { useState } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { isAddress, type Address, type Abi } from "viem";
import EscrowCoreJSON from "@/abi/EscrowCore.json";

const ESCROW_ADDRESS = process.env
  .NEXT_PUBLIC_ESCROW_ADDRESS as Address | undefined;

export function useApproveMilestone() {
  const [validationError, setValidationError] = useState("");

  const {
    writeContractAsync,
    data: hash,
    isPending,
    error: writeError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash });

  const approveMilestone = async (dealId: string) => {
    setValidationError("");

    const id = dealId.trim();

    if (!/^\d+$/.test(id) || BigInt(id) === 0n) {
      setValidationError("Enter a valid deal ID greater than 0.");
      return;
    }

    if (!ESCROW_ADDRESS || !isAddress(ESCROW_ADDRESS)) {
      setValidationError("Invalid escrow contract address.");
      return;
    }

    try {
      await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: EscrowCoreJSON.abi as Abi,
        functionName: "approveAndReleaseMilestone",
        args: [BigInt(id)],
      });
    } catch {
      // Wagmi exposes the transaction error through writeError.
    }
  };

  const error =
    validationError ||
    writeError?.shortMessage ||
    receiptError?.shortMessage ||
    "";

  return {
    approveMilestone,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}
