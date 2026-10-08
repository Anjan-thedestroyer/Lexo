"use client";

import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { sepolia } from "wagmi/chains";

import { CORE_AGREEMENT_ABI } from "@/abi/CoreAgreement";

const CORE_AGREEMENT_ADDRESS = process.env.NEXT_PUBLIC_CORE_AGREEMENT_ADDRESS as `0x${string}`;

export function useCoreAgreement() {
  const { address } = useAccount();

  const {
    data: hasSigned,
    isLoading: isCheckingSigned,
    refetch: refetchSigned,
  } = useReadContract({
    address: CORE_AGREEMENT_ADDRESS,
    abi: CORE_AGREEMENT_ABI,
    functionName: "hasSignedAgreement",
    args: address ? [address] : undefined,
    chainId: sepolia.id,
    query: {
      enabled: !!address && !!CORE_AGREEMENT_ADDRESS,
    },
  });

  const {
    writeContract,
    data: hash,
    isPending: isSigning,
    error: signError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({
    hash,
    chainId: sepolia.id,
  });

  const signAgreement = () => {
    writeContract({
      address: CORE_AGREEMENT_ADDRESS,
      abi: CORE_AGREEMENT_ABI,
      functionName: "signAgreement",
      chainId: sepolia.id,
      gas: BigInt(200000),
    });
  };

  return {
    hasSigned: Boolean(hasSigned),
    isCheckingSigned,
    signAgreement,
    isSigning,
    isConfirming,
    isConfirmed,
    signError,
    txHash: hash,
    refetchSigned,
  };
}