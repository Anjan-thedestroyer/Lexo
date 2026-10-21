
"use client";

import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useCallback } from "react";

const IDENTITY_REGISTER_ADDRESS =
  "0x7c827d0293b7ed891ed589542d1d11450590812d" as const;

const SEPOLIA_CHAIN_ID = 11155111;

const identityRegisterAbi = [
  {
    type: "function",
    name: "registerIdentity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "identityHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export function useRegisterIdentityAttestation() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

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

  const registerIdentity = useCallback(
    async (attestation: {
      wallet: `0x${string}`;
      identityHash: `0x${string}`;
      nonce: string | number;
      deadline: string | number;
      signature: `0x${string}`;
    }) => {
      if (!isConnected || !address) {
        throw new Error("Connect your wallet first.");
      }

      if (chainId !== SEPOLIA_CHAIN_ID) {
        throw new Error("Please switch MetaMask to Sepolia.");
      }

      if (
        address.toLowerCase() !== attestation.wallet.toLowerCase()
      ) {
        throw new Error(
          "Connected wallet does not match the attested wallet."
        );
      }

      if (BigInt(attestation.deadline) <= BigInt(
        Math.floor(Date.now() / 1000)
      )) {
        throw new Error(
          "Attestation expired. Request a new attestation."
        );
      }

      if (!/^0x[0-9a-fA-F]{64}$/.test(attestation.identityHash)) {
        throw new Error("Invalid identity hash.");
      }

      return writeContractAsync({
        address: IDENTITY_REGISTER_ADDRESS,
        abi: identityRegisterAbi,
        functionName: "registerIdentity",
        args: [
          attestation.wallet,
          attestation.identityHash,
          BigInt(attestation.nonce),
          BigInt(attestation.deadline),
          attestation.signature,
        ],
        chainId: SEPOLIA_CHAIN_ID,
      });
    },
    [address, chainId, isConnected, writeContractAsync]
  );

  return {
    registerIdentity,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error: writeError || receiptError,
  };
}
