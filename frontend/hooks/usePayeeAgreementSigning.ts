
"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import {
  isAddress,
  type Address,
  type Hex,
} from "viem";

import AgreementRegistryJSON from "@/abi/AgreementRegistry.json";
import { useAgreementRegistry } from "@/hooks/useAgreementRegistry";

const AGREEMENT_REGISTRY_ADDRESS = process.env
  .NEXT_PUBLIC_AGREEMENT_REGISTRY_ADDRESS as Address;

const AGREEMENT_REGISTRY_ABI = AgreementRegistryJSON.abi;
const SEPOLIA_CHAIN_ID = 11155111;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    
export type DocumentStatus = {
  contentHash: Hex;
  payerSigned: boolean;
  payeeSigned: boolean;
  exists: boolean;
};

type UsePayeeAgreementSigningArgs = {
  dealId: bigint;
};

export function usePayeeAgreementSigning({
  dealId,
}: UsePayeeAgreementSigningArgs) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const {
    signDocument,
    loading: signing,
    error: signingError,
  } = useAgreementRegistry();

  const [documentA, setDocumentA] = useState<DocumentStatus | null>(null);
  const [documentB, setDocumentB] = useState<DocumentStatus | null>(null);
  const [selectedPayee, setSelectedPayee] = useState<Address | null>(null);
  const [bothSigned, setBothSigned] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refreshStatus = useCallback(async () => {
    if (
      dealId <= 0n ||
      !publicClient ||
      chainId !== SEPOLIA_CHAIN_ID ||
      !isAddress(AGREEMENT_REGISTRY_ADDRESS)
    ) {
      setDocumentA(null);
      setDocumentB(null);
      setSelectedPayee(null);
      setBothSigned(false);

      if (chainId !== SEPOLIA_CHAIN_ID) {
        setError("Switch your wallet to Sepolia.");
      }

      return;
    }

    setChecking(true);
    setError("");

    try {
      const [statusA, statusB, payee, complete] = await Promise.all([
        publicClient.readContract({
          address: AGREEMENT_REGISTRY_ADDRESS,
          abi: AGREEMENT_REGISTRY_ABI,
          functionName: "getDocumentStatus",
          args: [dealId, 0],
        }),
        publicClient.readContract({
          address: AGREEMENT_REGISTRY_ADDRESS,
          abi: AGREEMENT_REGISTRY_ABI,
          functionName: "getDocumentStatus",
          args: [dealId, 1],
        }),
        publicClient.readContract({
          address: AGREEMENT_REGISTRY_ADDRESS,
          abi: AGREEMENT_REGISTRY_ABI,
          functionName: "dealPayee",
          args: [dealId],
        }),
        publicClient.readContract({
          address: AGREEMENT_REGISTRY_ADDRESS,
          abi: AGREEMENT_REGISTRY_ABI,
          functionName: "haveBothSigned",
          args: [dealId],
        }),
      ]);

      const parseStatus = (
        result: readonly [Hex, boolean, boolean, boolean]
      ): DocumentStatus => ({
        contentHash: result[0],
        payerSigned: result[1],
        payeeSigned: result[2],
        exists: result[3],
      });

      const parsedA = parseStatus(
        statusA as readonly [Hex, boolean, boolean, boolean]
      );

      const parsedB = parseStatus(
        statusB as readonly [Hex, boolean, boolean, boolean]
      );

      const selected = payee as Address;

      setDocumentA(parsedA);
      setDocumentB(parsedB);
      setSelectedPayee(
        isAddress(selected) &&
          selected.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
          ? selected
          : null
      );
      setBothSigned(complete as boolean);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load agreement signing status."
      );
    } finally {
      setChecking(false);
    }
  }, [dealId, publicClient, chainId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const isSelectedPayee =
    !!address &&
    !!selectedPayee &&
    address.toLowerCase() === selectedPayee.toLowerCase();

  const needsDocumentASignature =
    !!documentA?.exists && !documentA.payeeSigned;

  const needsDocumentBSignature =
    !!documentB?.exists && !documentB.payeeSigned;

  const canSign =
    isConnected &&
    chainId === SEPOLIA_CHAIN_ID &&
    isSelectedPayee &&
    !bothSigned &&
    (needsDocumentASignature || needsDocumentBSignature);

  const signAsPayee = async () => {
    if (!isConnected || !address) {
      setError("Connect your wallet first.");
      return;
    }

    if (chainId !== SEPOLIA_CHAIN_ID) {
      setError("Switch your wallet to Sepolia.");
      return;
    }

    if (!isSelectedPayee) {
      setError("Only the selected payee can sign these agreements.");
      return;
    }

    setError("");
    setSuccess("");

    try {
      let signedCount = 0;

      // Sign Document A as payee if it has not been signed by the payee.
      if (documentA?.exists && !documentA.payeeSigned) {
        await signDocument({
          dealId,
          docIndex: 0,
          contentHash: documentA.contentHash,
        });

        signedCount++;
        await refreshStatus();
      }

      // Document B becomes available for signing after payer acceptance.
      if (documentB?.exists && !documentB.payeeSigned) {
        await signDocument({
          dealId,
          docIndex: 1,
          contentHash: documentB.contentHash,
        });

        signedCount++;
        await refreshStatus();
      }

      await refreshStatus();

      setSuccess(
        signedCount > 0
          ? "Your agreement signature transaction(s) succeeded."
          : "There are no outstanding signatures for you."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to sign the agreement."
      );

      // Refresh state in case an earlier transaction succeeded.
      await refreshStatus();
    }
  };

  return {
    address,
    isConnected,
    selectedPayee,
    isSelectedPayee,
    documentA,
    documentB,
    bothSigned,
    needsDocumentASignature,
    needsDocumentBSignature,
    canSign,
    checking,
    signing,
    error: error || signingError,
    success,
    refreshStatus,
    signAsPayee,
  };
}
