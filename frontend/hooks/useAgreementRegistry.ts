"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import {
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import AgreementRegistryJSON from "@/abi/AgreementRegistry.json";

const AGREEMENT_REGISTRY_ADDRESS = process.env
  .NEXT_PUBLIC_AGREEMENT_REGISTRY_ADDRESS as Address | undefined;

const AGREEMENT_REGISTRY_ABI = AgreementRegistryJSON.abi;
const SEPOLIA_CHAIN_ID = 11155111;

type SubmitPayeeDocumentArgs = {
  dealId: bigint;
  documentHash: Hex;
};

type SignDocumentArgs = {
  dealId: bigint;
  docIndex: 0 | 1;
  contentHash: Hex;
};

function validateBytes32(value: Hex, label: string) {
  if (!isHex(value, { strict: true }) || value.length !== 66) {
    throw new Error(`A valid bytes32 ${label} is required.`);
  }
}

export function useAgreementRegistry() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [step, setStep] = useState("");

  function validateSetup() {
    if (!isConnected || !address) {
      throw new Error("Connect your wallet first.");
    }

    if (chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error("Switch your wallet to Sepolia.");
    }

    if (
      !AGREEMENT_REGISTRY_ADDRESS ||
      !isAddress(AGREEMENT_REGISTRY_ADDRESS)
    ) {
      throw new Error(
        "Invalid NEXT_PUBLIC_AGREEMENT_REGISTRY_ADDRESS configuration."
      );
    }

    if (!publicClient) {
      throw new Error("Blockchain client is unavailable.");
    }
  }

  /**
   * Submit the payee's candidate document hash (Document B).
   *
   * This submits a transaction only. It does not sign either
   * agreement document or record a document signature.
   */
  async function submitPayeeDocument({
    dealId,
    documentHash,
  }: SubmitPayeeDocumentArgs) {
    setLoading(true);
    setError("");
    setSuccess("");
    setStep("validating");

    try {
      validateSetup();

      if (dealId <= 0n) {
        throw new Error("A valid deal ID is required.");
      }

      validateBytes32(documentHash, "document hash");

      setStep("submitting");

      const txHash = await writeContractAsync({
        address: AGREEMENT_REGISTRY_ADDRESS!,
        abi: AGREEMENT_REGISTRY_ABI,
        functionName: "submitPayeeDocument",
        args: [dealId, documentHash],
        chainId: SEPOLIA_CHAIN_ID,
      });

      setStep("confirming");

      const receipt = await publicClient!.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });

      if (receipt.status !== "success") {
        throw new Error(
          `Payee document submission failed: ${txHash}`
        );
      }

      setStep("completed");
      setSuccess("Payee document submitted on-chain.");

      return {
        txHash,
        documentHash,
        blockNumber: receipt.blockNumber,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to submit the payee document.";

      setError(message);
      setSuccess("");
      setStep("failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sign a document and record the signature on-chain.
   *
   * docIndex 0 = Document A (payer document)
   * docIndex 1 = Document B (payee document)
   *
   * The connected wallet must be authorized to sign that
   * document under the contract's rules.
   */
  async function signDocument({
    dealId,
    docIndex,
    contentHash,
  }: SignDocumentArgs) {
    setLoading(true);
    setError("");
    setSuccess("");
    setStep("validating");

    try {
      validateSetup();

      if (dealId <= 0n) {
        throw new Error("A valid deal ID is required.");
      }

      validateBytes32(contentHash, "document hash");

      setStep("signing");

      const signature = await signTypedDataAsync({
        domain: {
          name: "Lexo AgreementRegistry",
          version: "1",
          chainId: SEPOLIA_CHAIN_ID,
          verifyingContract: AGREEMENT_REGISTRY_ADDRESS!,
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
          dealId,
          docIndex,
          contentHash,
        },
      });

      setStep("submitting");

      const txHash = await writeContractAsync({
        address: AGREEMENT_REGISTRY_ADDRESS!,
        abi: AGREEMENT_REGISTRY_ABI,
        functionName: "signDocument",
        args: [dealId, docIndex, signature],
        chainId: SEPOLIA_CHAIN_ID,
      });

      setStep("confirming");

      const receipt = await publicClient!.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });

      if (receipt.status !== "success") {
        throw new Error(`Document signing failed: ${txHash}`);
      }

      setStep("completed");
      setSuccess(
        `Document ${docIndex === 0 ? "A (payer document)" : "B (payee document)"} signature recorded on-chain.`
      );

      return {
        txHash,
        signature,
        blockNumber: receipt.blockNumber,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to sign the document.";

      setError(message);
      setSuccess("");
      setStep("failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return {
    submitPayeeDocument,
    signDocument,
    loading,
    error,
    success,
    step,
    address,
    isConnected,
    chainId,
  };
}
