
"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";

import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import IdentityRegisterJSON from "@/abi/IdentityRegister.json";

const IDENTITY_REGISTER_ADDRESS = process.env
  .NEXT_PUBLIC_IDENTITY_REGISTER_ADDRESS as Address;

const EXPECTED_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID || 11155111
);

const IDENTITY_REGISTER_ABI = IdentityRegisterJSON.abi;

export interface WalletAttestation {
  wallet: Address;
  identityHash: Hex;
  nonce: string | number;
  deadline: string | number;
  signature: Hex;
}

export function useLinkWallet() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const { writeContractAsync } = useWriteContract();

  const [isConfirming, setIsConfirming] = useState(false);

  const linkWallet = async (
    attestation: WalletAttestation
  ) => {
    if (!address) {
      throw new Error("Please connect your wallet");
    }

    if (!publicClient) {
      throw new Error("Blockchain client is unavailable");
    }

    if (!IDENTITY_REGISTER_ADDRESS ||
        !isAddress(IDENTITY_REGISTER_ADDRESS)) {
      throw new Error(
        "IdentityRegister contract address is not configured"
      );
    }

    if (chainId !== EXPECTED_CHAIN_ID) {
      throw new Error(
        `Please switch to the required network. Expected chain ID: ${EXPECTED_CHAIN_ID}`
      );
    }

    if (!isAddress(attestation.wallet)) {
      throw new Error("Invalid wallet address in attestation");
    }

    const targetWallet = getAddress(attestation.wallet);

    if (
      getAddress(address) !== targetWallet
    ) {
      throw new Error(
        "Connected wallet must match the wallet being linked"
      );
    }

    if (
      !isHex(attestation.identityHash) ||
      attestation.identityHash.length !== 66
    ) {
      throw new Error("Invalid identity hash");
    }

    if (
      !isHex(attestation.signature) ||
      attestation.signature.length !== 132
    ) {
      throw new Error("Invalid attestation signature");
    }

    const nonce = BigInt(attestation.nonce);
    const deadline = BigInt(attestation.deadline);

    // ========================================================
    // 1. CHECK CURRENT ON-CHAIN NONCE
    // ========================================================

    const currentNonce = await publicClient.readContract({
      address: IDENTITY_REGISTER_ADDRESS,
      abi: IDENTITY_REGISTER_ABI,
      functionName: "nonces",
      args: [targetWallet],
    });

    if (currentNonce !== nonce) {
      throw new Error(
        `Attestation nonce mismatch. Expected ${currentNonce.toString()}, received ${nonce.toString()}. Request a new attestation.`
      );
    }

    // ========================================================
    // 2. CHECK DEADLINE
    // ========================================================

    const currentBlock = await publicClient.getBlock();

    if (
      BigInt(currentBlock.timestamp) > deadline
    ) {
      throw new Error(
        "Attestation has expired. Request a new attestation."
      );
    }

    // ========================================================
    // 3. SUBMIT WALLET LINK TRANSACTION
    // ========================================================

    const hash = await writeContractAsync({
      address: IDENTITY_REGISTER_ADDRESS,
      abi: IDENTITY_REGISTER_ABI,
      functionName: "linkWalletWithAttestation",
      args: [
        targetWallet,
        attestation.identityHash,
        deadline,
        attestation.signature,
      ],
    });

    // ========================================================
    // 4. WAIT FOR TRANSACTION CONFIRMATION
    // ========================================================

    setIsConfirming(true);

    try {
      const receipt =
        await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

      if (receipt.status !== "success") {
        throw new Error(
          "Wallet linking transaction failed"
        );
      }

      return {
        hash,
        receipt,
        wallet: targetWallet,
      };
    } finally {
      setIsConfirming(false);
    }
  };

  return {
    linkWallet,
    isConfirming,
  };
}
