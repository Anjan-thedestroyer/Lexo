"use client";

import { useCallback, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useWalletClient,
  useWriteContract,
} from "wagmi";
import {
  isAddress,
  isHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import AgreementRegistryJSON from "@/abi/AgreementRegistry.json";

const AGREEMENT_REGISTRY_ADDRESS = process.env
  .NEXT_PUBLIC_AGREEMENT_REGISTRY_ADDRESS as Address | undefined;

const AGREEMENT_REGISTRY_ABI =
  AgreementRegistryJSON.abi as Abi;

const DOMAIN_NAME = "Lexo AgreementRegistry";
const DOMAIN_VERSION = "1";
const DOC_B = 1;

type AcceptPayeeAgreementArgs = {
  dealId: number;
  candidatePayee: Address;
  contentHash: Hex;
};

function validateDealId(dealId: number) {
  if (!Number.isSafeInteger(dealId) || dealId < 0) {
    throw new Error("Invalid on-chain deal ID.");
  }
}

function validateAddress(address: string, label: string): asserts address is Address {
  if (!isAddress(address)) {
    throw new Error(`${label} is missing or invalid.`);
  }
}

function validateContentHash(hash: string): asserts hash is Hex {
  if (!isHex(hash, { strict: true }) || hash.length !== 66) {
    throw new Error(
      "The agreement document hash must be a 32-byte hex value.",
    );
  }
}

export function useAgreementRegistry() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [isConfirming, setIsConfirming] = useState(false);

  const getContractAddress = useCallback((): Address => {
    if (
      !AGREEMENT_REGISTRY_ADDRESS ||
      !isAddress(AGREEMENT_REGISTRY_ADDRESS)
    ) {
      throw new Error(
        "NEXT_PUBLIC_AGREEMENT_REGISTRY_ADDRESS is missing or invalid.",
      );
    }

    return AGREEMENT_REGISTRY_ADDRESS;
  }, []);

  const ensureWalletReady = useCallback(async () => {
    if (!isConnected || !address) {
      throw new Error("Connect the payer wallet first.");
    }

    if (!walletClient) {
      throw new Error("Wallet client is unavailable. Reconnect your wallet.");
    }

    if (!publicClient) {
      throw new Error("Public client is unavailable.");
    }

    if (walletClient.chain.id !== chainId) {
      throw new Error("Your wallet network has changed. Reconnect and retry.");
    }

    return {
      account: address,
      walletClient,
      publicClient,
      contractAddress: getContractAddress(),
    };
  }, [
    address,
    chainId,
    getContractAddress,
    isConnected,
    publicClient,
    walletClient,
  ]);

  const waitForSuccessfulReceipt = useCallback(
    async (hash: Hex): Promise<Hex> => {
      const { publicClient } = await ensureWalletReady();

      setIsConfirming(true);

      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

        if (receipt.status !== "success") {
          throw new Error(
            `Transaction ${hash} reverted on-chain. The backend was not updated.`,
          );
        }

        return hash;
      } finally {
        setIsConfirming(false);
      }
    },
    [ensureWalletReady],
  );

  const acceptPayeeAgreement = useCallback(
    async ({
      dealId,
      candidatePayee,
      contentHash,
    }: AcceptPayeeAgreementArgs): Promise<Hex> => {
      validateDealId(dealId);
      validateAddress(candidatePayee, "Candidate payee address");
      validateContentHash(contentHash);

      const {
        account,
        walletClient,
        publicClient,
        contractAddress,
      } = await ensureWalletReady();

      // Sign the payee's agreement document using the payer's wallet.
      const payerSignature = await signTypedDataAsync({
        account,
        domain: {
          name: DOMAIN_NAME,
          version: DOMAIN_VERSION,
          chainId,
          verifyingContract: contractAddress,
        },
        types: {
          AgreementDoc: [
            { name: "dealId", type: "uint256" },
            { name: "docIndex", type: "uint8" },
            { name: "contentHash", type: "bytes32" },
          ],
        },
        primaryType: "AgreementDoc",
        message: {
          dealId: BigInt(dealId),
          docIndex: DOC_B,
          contentHash,
        },
      });

      if (!isHex(payerSignature)) {
        throw new Error("Failed to create the payer's EIP-712 signature.");
      }

      // Submit the acceptance transaction.
      setIsConfirming(true);

      try {
        const hash = await walletClient.writeContract({
          account,
          address: contractAddress,
          abi: AGREEMENT_REGISTRY_ABI,
          functionName: "acceptPayeeAgreement",
          args: [
            BigInt(dealId),
            candidatePayee,
            payerSignature,
          ],
          chain: walletClient.chain,
        });

        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

        if (receipt.status !== "success") {
          throw new Error(
            `Acceptance transaction ${hash} reverted. The backend was not updated.`,
          );
        }

        return hash;
      } finally {
        setIsConfirming(false);
      }
    },
    [
      chainId,
      ensureWalletReady,
      signTypedDataAsync,
    ],
  );

  const rejectPayeeAgreement = useCallback(
    async (
      dealId: number,
      candidatePayee: Address,
    ): Promise<Hex> => {
      validateDealId(dealId);
      validateAddress(candidatePayee, "Candidate payee address");

      const {
        account,
        walletClient,
        publicClient,
        contractAddress,
      } = await ensureWalletReady();

      setIsConfirming(true);

      try {
        const hash = await walletClient.writeContract({
          account,
          address: contractAddress,
          abi: AGREEMENT_REGISTRY_ABI,
          functionName: "rejectPayeeAgreement",
          args: [BigInt(dealId), candidatePayee],
          chain: walletClient.chain,
        });

        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

        if (receipt.status !== "success") {
          throw new Error(
            `Rejection transaction ${hash} reverted. The backend was not updated.`,
          );
        }

        return hash;
      } finally {
        setIsConfirming(false);
      }
    },
    [ensureWalletReady],
  );

  return {
    acceptPayeeAgreement,
    rejectPayeeAgreement,
    isConfirming,
  };
}