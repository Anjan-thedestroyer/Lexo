
"use client";

import { useCallback, useState } from "react";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import {
  isAddress,
  type Address,
  type Hex,
} from "viem";
import {
  Users,
  FileSignature,
  LoaderCircle,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";

import type { Escrow } from "./escrow";
import EscrowCard from "./EscrowCard";
import { useAgreementRegistry } from "@/hooks/useAgreementRegistry";
import AgreementRegistryJSON from "@/abi/AgreementRegistry.json";

const SEPOLIA_CHAIN_ID = 11155111;

const REGISTRY_ADDRESS = process.env
  .NEXT_PUBLIC_AGREEMENT_REGISTRY_ADDRESS as Address | undefined;

const REGISTRY_ABI = AgreementRegistryJSON.abi;

type DocumentStatus = readonly [
  contentHash: Hex,
  payerSigned: boolean,
  payeeSigned: boolean,
  exists: boolean,
];

type DocumentInfo = {
  contentHash: Hex;
  exists: boolean;
  payerSigned: boolean;
  payeeSigned: boolean;
};

type DocumentsState = {
  0: DocumentInfo | null;
  1: DocumentInfo | null;
};

function getNumericDealId(
  dealId?: number | string,
): bigint | null {
  if (dealId === undefined || dealId === null) return null;

  const value = String(dealId).trim();

  if (!/^\d+$/.test(value)) return null;

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function PayeeSignButton({ dealId }: { dealId: bigint }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const {
    signDocument,
    loading,
    error,
    success,
  } = useAgreementRegistry();

  const [checking, setChecking] = useState(false);
  const [signingDocument, setSigningDocument] = useState<0 | 1 | null>(
    null,
  );
  const [documents, setDocuments] = useState<DocumentsState>({
    0: null,
    1: null,
  });
  const [checkError, setCheckError] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");

  const checkDocuments = useCallback(async () => {
    if (!isConnected || !address || !isAddress(address)) {
      setCheckError("Connect your wallet first.");
      return;
    }

    if (chainId !== SEPOLIA_CHAIN_ID) {
      setCheckError("Switch your wallet to Sepolia.");
      return;
    }

    if (!publicClient) {
      setCheckError("Blockchain client is unavailable.");
      return;
    }

    if (!REGISTRY_ADDRESS || !isAddress(REGISTRY_ADDRESS)) {
      setCheckError("Agreement Registry address is not configured.");
      return;
    }

    setChecking(true);
    setCheckError("");
    setLocalSuccess("");

    try {
      const selectedPayee = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: "dealPayee",
        args: [dealId],
      });

      if (
        !isAddress(selectedPayee as string) ||
        selectedPayee.toLowerCase() !== address.toLowerCase()
      ) {
        throw new Error(
          "You are not the selected payee. The payer must accept your proposal first.",
        );
      }

      const [documentAResult, documentBResult] = await Promise.all([
        publicClient.readContract({
          address: REGISTRY_ADDRESS,
          abi: REGISTRY_ABI,
          functionName: "getDocumentStatus",
          args: [dealId, 0],
        }),
        publicClient.readContract({
          address: REGISTRY_ADDRESS,
          abi: REGISTRY_ABI,
          functionName: "getDocumentStatus",
          args: [dealId, 1],
        }),
      ]);

      const [hashA, payerSignedA, payeeSignedA, existsA] =
        documentAResult as DocumentStatus;

      const [hashB, payerSignedB, payeeSignedB, existsB] =
        documentBResult as DocumentStatus;

      setDocuments({
        0: {
          contentHash: hashA,
          exists: existsA,
          payerSigned: payerSignedA,
          payeeSigned: payeeSignedA,
        },
        1: {
          contentHash: hashB,
          exists: existsB,
          payerSigned: payerSignedB,
          payeeSigned: payeeSignedB,
        },
      });
    } catch (err) {
      setCheckError(
        err instanceof Error
          ? err.message
          : "Could not check the agreement documents.",
      );
    } finally {
      setChecking(false);
    }
  }, [address, chainId, dealId, isConnected, publicClient]);

  const handleSign = async (docIndex: 0 | 1) => {
    if (loading || checking || signingDocument !== null) return;

    setCheckError("");
    setLocalSuccess("");

    try {
      if (!isConnected || !address || !isAddress(address)) {
        throw new Error("Connect your wallet first.");
      }

      if (chainId !== SEPOLIA_CHAIN_ID) {
        throw new Error("Switch your wallet to Sepolia.");
      }

      if (!publicClient) {
        throw new Error("Blockchain client is unavailable.");
      }

      if (!REGISTRY_ADDRESS || !isAddress(REGISTRY_ADDRESS)) {
        throw new Error("Agreement Registry address is not configured.");
      }

      setSigningDocument(docIndex);

      // Recheck authorization and document state immediately before signing.
      const selectedPayee = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: "dealPayee",
        args: [dealId],
      });

      if (
        !isAddress(selectedPayee as string) ||
        selectedPayee.toLowerCase() !== address.toLowerCase()
      ) {
        throw new Error(
          "Only the selected payee can sign these documents.",
        );
      }

      const result = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: "getDocumentStatus",
        args: [dealId, docIndex],
      });

      const [
        contentHash,
        ,
        payeeSigned,
        exists,
      ] = result as DocumentStatus;

      if (!exists) {
        throw new Error(
          `Document ${docIndex === 0 ? "A" : "B"} does not exist on-chain yet.`,
        );
      }

      if (payeeSigned) {
        setLocalSuccess(
          `You have already signed Document ${docIndex === 0 ? "A" : "B"}.`,
        );
        await checkDocuments();
        return;
      }

      await signDocument({
        dealId,
        docIndex,
        contentHash,
      });

      setLocalSuccess(
        `Document ${docIndex === 0 ? "A" : "B"} signed successfully.`,
      );

      await checkDocuments();
    } catch (err) {
      setCheckError(
        err instanceof Error
          ? err.message
          : `Failed to sign Document ${docIndex === 0 ? "A" : "B"}.`,
      );
    } finally {
      setSigningDocument(null);
    }
  };

  const busy = checking || loading || signingDocument !== null;

  function renderDocument(
    docIndex: 0 | 1,
    label: string,
  ) {
    const document = documents[docIndex];

    const signed = document?.payeeSigned ?? false;
    const exists = document?.exists ?? false;

    return (
      <div className="rounded-xl border border-white/10 bg-[#0d111b] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-white">{label}</p>

            <p className="mt-1 text-xs text-gray-400">
              {signed
                ? "Your signature is recorded on-chain."
                : exists
                  ? "Awaiting your signature."
                  : "Document not available on-chain."}
            </p>

            {document?.exists && (
              <p className="mt-1 text-xs text-gray-500">
                Payer: {document.payerSigned ? "Signed" : "Not signed"}
                {" · "}
                Payee: {document.payeeSigned ? "Signed" : "Not signed"}
              </p>
            )}
          </div>

          {signed ? (
            <span className="inline-flex shrink-0 items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 size={16} />
              Signed
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleSign(docIndex)}
              disabled={
                busy ||
                !isConnected ||
                chainId !== SEPOLIA_CHAIN_ID ||
                !exists
              }
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signingDocument === docIndex ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <FileSignature size={16} />
              )}

              {signingDocument === docIndex
                ? "Signing..."
                : `Sign Document ${docIndex === 0 ? "A" : "B"}`}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-white">
          Sign agreement documents
        </h3>

        <p className="mt-1 text-sm text-gray-400">
          After the payer accepts your proposal, check the documents and
          sign each one that still needs your signature.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void checkDocuments()}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-500/10 px-4 py-3 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {checking ? (
          <LoaderCircle size={16} className="animate-spin" />
        ) : (
          <RefreshCw size={16} />
        )}
        {checking ? "Checking documents..." : "Check document status"}
      </button>

      {documents[0] !== null && documents[1] !== null && (
        <div className="space-y-3">
          {renderDocument(0, "Document A — Payer's document")}
          {renderDocument(1, "Document B — Payee's document")}
        </div>
      )}

      {!isConnected && (
        <p className="text-sm text-amber-300">
          Connect your wallet to check and sign the documents.
        </p>
      )}

      {chainId !== undefined &&
        isConnected &&
        chainId !== SEPOLIA_CHAIN_ID && (
          <p className="text-sm text-amber-300">
            Switch your wallet to Sepolia.
          </p>
        )}

      {checkError && (
        <p role="alert" className="break-words text-sm text-red-400">
          {checkError}
        </p>
      )}

      {localSuccess && (
        <p role="status" className="text-sm text-emerald-400">
          {localSuccess}
        </p>
      )}

      {success && (
        <p role="status" className="text-sm text-emerald-400">
          {success}
        </p>
      )}

      {error && (
        <p role="alert" className="break-words text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ParticipatedEscrows({
  escrows,
}: {
  escrows: Escrow[];
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">
          Participated Escrows
        </h2>

        <p className="mt-1 text-sm text-gray-400">
          Escrows created by others that you participate in.
        </p>
      </div>

      {escrows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0d111b] px-5 py-10 text-center">
          <Users className="mb-3 text-gray-500" size={28} />

          <p className="text-sm font-medium text-gray-300">
            No participated escrows yet
          </p>

          <p className="mt-1 text-sm text-gray-500">
            Escrows where you are a participant will appear here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {escrows.map((escrow) => {
            const dealId = getNumericDealId(escrow.dealId);

            return (
              <div key={escrow.id} className="min-w-0">
                <EscrowCard escrow={escrow} />

                {dealId !== null && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-[#101522] p-5 sm:p-6">
                    <PayeeSignButton dealId={dealId} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
