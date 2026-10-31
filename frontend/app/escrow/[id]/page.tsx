
"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { usePublicClient } from "wagmi";
import {
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import axios from "axios";

import axiosInstance from "@/lib/axios";
import Navbar from "@/component/Navbar";
import { useAgreementRegistry } from "@/hooks/useAgreementRegistry";
import AgreementRegistryJSON from "@/abi/AgreementRegistry.json";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];
const SEPOLIA_CHAIN_ID = 11155111;

const AGREEMENT_REGISTRY_ADDRESS = process.env
  .NEXT_PUBLIC_AGREEMENT_REGISTRY_ADDRESS as Address | undefined;

const AGREEMENT_REGISTRY_ABI = AgreementRegistryJSON.abi;

type ApiUser = {
  _id: string;
  name?: string;
  email?: string;
};

type ApiAgreement = {
  _id: string;
  title?: string;
};

type ApiMilestone = {
  _id?: string;
  title?: string;
  description?: string;
  amount: string | number;
};

type ApiEscrow = {
  _id: string;
  dealId: number | string;
  totalAmount: string | number;
  token?: string;
  status: string;
  payer?: ApiUser | string | null;
  payee?: ApiUser | string | null;
  milestones?: ApiMilestone[];
  agreement?: ApiAgreement | string | null;
  createdAt?: string;
};

type ApiResponse = {
  success?: boolean;
  message?: string;
  data?: ApiEscrow[] | { escrows?: ApiEscrow[] };
  escrows?: ApiEscrow[];
};

type PreparedDocument = {
  documentHash: Hex;
  file: {
    name: string;
    size: number;
    mimeType: string;
    url: string;
  };
};

type DocumentStatus = readonly [
  contentHash: Hex,
  payerSigned: boolean,
  payeeSigned: boolean,
  exists: boolean,
];

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; error?: string }
      | undefined;

    return (
      data?.message ||
      data?.error ||
      error.message ||
      "The request failed."
    );
  }

  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function normalizeEscrows(payload: ApiResponse): ApiEscrow[] {
  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (
    payload.data &&
    !Array.isArray(payload.data) &&
    Array.isArray(payload.data.escrows)
  ) {
    return payload.data.escrows;
  }

  return Array.isArray(payload.escrows)
    ? payload.escrows
    : [];
}

function getAgreement(escrow: ApiEscrow): ApiAgreement | null {
  return escrow.agreement &&
    typeof escrow.agreement === "object" &&
    "_id" in escrow.agreement
    ? escrow.agreement
    : null;
}

function getUserLabel(
  user: ApiUser | string | null | undefined,
): string {
  if (!user) return "Not assigned";
  if (typeof user === "string") return user;

  return user.name || user.email || user._id;
}

function getUserEmail(
  user: ApiUser | string | null | undefined,
): string {
  if (!user || typeof user === "string") return "";

  return user.email || "";
}

function formatAmount(value: string | number): string {
  const amount = Number(value);

  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, {
        maximumFractionDigits: 6,
      })
    : String(value);
}

/**
 * Upload the selected document and return the backend-generated hash and URL.
 */
async function uploadDocument(
  file: File,
): Promise<PreparedDocument> {
  const formData = new FormData();
  formData.append("document", file);

  const response = await axiosInstance.post(
    "/agreement/payee/document",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );

  if (!response.data?.success || !response.data?.data) {
    throw new Error(
      response.data?.message || "Document upload failed.",
    );
  }

  const prepared = response.data.data as PreparedDocument;

  if (
    !isHex(prepared.documentHash, { size: 32 }) ||
    !prepared.file?.url
  ) {
    throw new Error(
      "The server did not return a valid document hash and URL.",
    );
  }

  return prepared;
}

export default function PayeeAgreementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const publicClient = usePublicClient();

  const {
    address,
    isConnected,
    chainId,
    submitPayeeDocument,
    signDocument,
    loading: chainLoading,
  } = useAgreementRegistry();

  const [escrow, setEscrow] = useState<ApiEscrow | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<Hex | "">("");
  const [signMessage, setSignMessage] = useState("");
  const [signError, setSignError] = useState("");
  const [signTxHash, setSignTxHash] = useState<Hex | "">("");

  const loadEscrow = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axiosInstance.get<ApiResponse>(
        "/escrow/active",
      );

      const selected = normalizeEscrows(response.data).find(
        (item) => item._id === id,
      );

      if (!selected) {
        throw new Error("Escrow not found.");
      }

      if (!getAgreement(selected)) {
        throw new Error(
          "The escrow has no associated agreement.",
        );
      }

      setEscrow(selected);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadEscrow();
  }, [loadEscrow]);

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const selected = event.target.files?.[0] ?? null;

    setError("");
    setMessage("");
    setTxHash("");
    setSignError("");
    setSignMessage("");
    setSignTxHash("");

    if (!selected) {
      setFile(null);
      return;
    }

    const extension = selected.name
      .slice(selected.name.lastIndexOf("."))
      .toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setFile(null);
      setError("Choose a PDF, DOC, or DOCX file.");
      event.target.value = "";
      return;
    }

    if (
      selected.size === 0 ||
      selected.size > MAX_FILE_SIZE
    ) {
      setFile(null);
      setError(
        "The file must be non-empty and no larger than 15 MB.",
      );
      event.target.value = "";
      return;
    }

    setFile(selected);
  }

  /**
   * Sign Document B after submission if the contract allows it.
   */
  async function handleSignPayeeDocument(): Promise<boolean> {
    if (signing || chainLoading) return false;

    setSignError("");
    setSignMessage("");
    setSignTxHash("");

    try {
      if (!escrow) {
        throw new Error("Escrow details are unavailable.");
      }

      if (!isConnected || !address || !isAddress(address)) {
        throw new Error("Connect your wallet first.");
      }

      if (chainId !== SEPOLIA_CHAIN_ID) {
        throw new Error("Switch your wallet to Sepolia.");
      }

      if (!publicClient) {
        throw new Error("Blockchain client is unavailable.");
      }

      if (
        !AGREEMENT_REGISTRY_ADDRESS ||
        !isAddress(AGREEMENT_REGISTRY_ADDRESS)
      ) {
        throw new Error(
          "Invalid AgreementRegistry address configuration.",
        );
      }

      let dealId: bigint;

      try {
        dealId = BigInt(escrow.dealId);
      } catch {
        throw new Error("Invalid escrow deal ID.");
      }

      if (dealId <= 0n) {
        throw new Error("Invalid escrow deal ID.");
      }

      setSigning(true);

      // 1. Confirm the connected wallet is the selected payee.
      const selectedPayee = await publicClient.readContract({
        address: AGREEMENT_REGISTRY_ADDRESS,
        abi: AGREEMENT_REGISTRY_ABI,
        functionName: "dealPayee",
        args: [dealId],
      });

      if (
        !isAddress(selectedPayee as string) ||
        (selectedPayee as string).toLowerCase() !==
          address.toLowerCase()
      ) {
        throw new Error(
          "Your document was submitted, but you cannot sign yet. The payer must accept your proposal first.",
        );
      }

      // 2. Read Document B (docIndex = 1).
      const result = await publicClient.readContract({
        address: AGREEMENT_REGISTRY_ADDRESS,
        abi: AGREEMENT_REGISTRY_ABI,
        functionName: "getDocumentStatus",
        args: [dealId, 1],
      });

      const [
        contentHash,
        ,
        payeeSigned,
        exists,
      ] = result as DocumentStatus;

      if (!exists) {
        throw new Error(
          "Your document was submitted, but Document B is not yet available for signing. The payer must accept your proposal first.",
        );
      }

      if (!isHex(contentHash, { size: 32 })) {
        throw new Error(
          "The contract returned an invalid document hash.",
        );
      }

      // 3. Avoid signing the same document twice.
      if (payeeSigned) {
        setSignMessage(
          "Your signature for Document B is already recorded on-chain.",
        );
        return true;
      }

      // 4. Request the wallet signature and record it on-chain.
      const signed = await signDocument({
        dealId,
        docIndex: 1,
        contentHash,
      });

      setSignTxHash(signed.txHash);

      setSignMessage(
        "Payee Document B (docIndex = 1) signed and recorded on-chain successfully.",
      );

      return true;
    } catch (err: unknown) {
      console.error("Payee document signing error:", err);
      setSignError(getErrorMessage(err));
      return false;
    } finally {
      setSigning(false);
    }
  }

  /**
   * Upload the document, submit its hash, create the backend request,
   * and automatically attempt the payee's Document B signature.
   */
  async function handleSubmit() {
    if (submitting || chainLoading || signing) return;

    setError("");
    setMessage("");
    setTxHash("");
    setSignError("");
    setSignMessage("");
    setSignTxHash("");

    let confirmedTx: Hex | "" = "";

    try {
      if (!escrow) {
        throw new Error("Escrow details are unavailable.");
      }

      const agreement = getAgreement(escrow);

      if (!agreement?._id) {
        throw new Error("Agreement record is missing.");
      }

      if (!file) {
        throw new Error("Select your agreement document.");
      }

      if (!isConnected || !address || !isAddress(address)) {
        throw new Error("Connect a valid wallet first.");
      }

      if (chainId !== SEPOLIA_CHAIN_ID) {
        throw new Error("Switch your wallet to Sepolia.");
      }

      if (
        escrow.status !== "CREATED" ||
        escrow.payee
      ) {
        throw new Error(
          "This escrow is not available for a new payee.",
        );
      }

      let dealId: bigint;

      try {
        dealId = BigInt(escrow.dealId);
      } catch {
        throw new Error("Invalid escrow deal ID.");
      }

      if (
        dealId <= 0n ||
        dealId > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error("Invalid escrow deal ID.");
      }

      setSubmitting(true);

      // 1. Upload the payee's proposed document.
      const prepared = await uploadDocument(file);

      // 2. Verify the backend hash matches the original file.
      const localHash = keccak256(
        new Uint8Array(await file.arrayBuffer()),
      );

      if (
        localHash.toLowerCase() !==
        prepared.documentHash.toLowerCase()
      ) {
        throw new Error(
          "The uploaded document hash does not match the selected file.",
        );
      }

      // 3. Submit the payee document hash on-chain.
      const chainResult = await submitPayeeDocument({
        dealId,
        documentHash: prepared.documentHash,
      });

      confirmedTx = chainResult.txHash;
      setTxHash(confirmedTx);

      setMessage(
        "Document hash confirmed on-chain. Saving your payee request...",
      );

      // 4. Save the payee request in the backend.
      const response = await axiosInstance.post(
        "/req/payee/request",
        {
          agreementId: agreement._id,
          dealId: Number(dealId),
          payeeAddress: address,
          documentHash: prepared.documentHash,
          payeeContentLink: prepared.file.url,
          txHash: confirmedTx,
        },
      );

      if (!response.data?.success) {
        throw new Error(
          response.data?.message ||
            "Failed to create the payee request.",
        );
      }

      setMessage(
        "Document submitted and payee request created. Requesting your signature for Document B...",
      );

      // 5. Automatically attempt to sign Document B.
      const signed = await handleSignPayeeDocument();

      if (signed) {
        setMessage(
          "Agreement document submitted, payee request created, and Document B signed successfully.",
        );
      } else {
        setMessage(
          "Your document and payee request were submitted successfully. Document B signing is pending; see the signing message below.",
        );
      }
    } catch (err: unknown) {
      console.error("Payee agreement submission error:", err);

      const reason = getErrorMessage(err);

      setError(
        confirmedTx
          ? `${reason} The document submission transaction was already confirmed: ${confirmedTx}`
          : reason,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || chainLoading || signing;
  const agreement = escrow ? getAgreement(escrow) : null;

  return (
    <main className="min-h-screen bg-[#080B14] text-white">
      <Navbar />

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-6 text-sm text-gray-400 hover:text-white"
        >
          ← Back
        </button>

        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-violet-400">
            Lexo · Agreement
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            Propose an agreement
          </h1>

          <p className="mt-2 text-sm text-gray-400">
            Upload your document and submit its hash on-chain.
          </p>
        </header>

        {loading ? (
          <Panel>Loading escrow details...</Panel>
        ) : !escrow ? (
          <Panel>
            <p className="text-red-300">
              {error || "Escrow not found."}
            </p>

            <button
              type="button"
              onClick={() => void loadEscrow()}
              className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm"
            >
              Retry
            </button>
          </Panel>
        ) : (
          <div className="space-y-5">
            <Panel>
              <h2 className="mb-4 font-semibold">
                Escrow details
              </h2>

              <div className="space-y-4 text-sm">
                <Info
                  label="Escrow ID"
                  value={escrow._id}
                />

                <Info
                  label="Deal ID"
                  value={String(escrow.dealId)}
                />

                <Info
                  label="Agreement ID"
                  value={agreement?._id || "—"}
                />

                <Info
                  label="Status"
                  value={escrow.status}
                />

                {/* Payer */}
                <div className="space-y-1">
                  <Info
                    label="Payer"
                    value={getUserLabel(escrow.payer)}
                  />

                  {getUserEmail(escrow.payer) && (
                    <EmailInfo
                      label="Payer Email"
                      email={getUserEmail(escrow.payer)}
                    />
                  )}
                </div>

                {/* Payee */}
                <div className="space-y-1">
                  <Info
                    label="Payee"
                    value={getUserLabel(escrow.payee)}
                  />

                  {getUserEmail(escrow.payee) && (
                    <EmailInfo
                      label="Payee Email"
                      email={getUserEmail(escrow.payee)}
                    />
                  )}
                </div>

                <Info
                  label="Total amount"
                  value={`${formatAmount(escrow.totalAmount)} ${escrow.token || ""}`.trim()}
                />
              </div>
            </Panel>

            <Panel>
              <h2 className="font-semibold">Your document</h2>

              <p className="mt-1 text-sm text-gray-400">
                PDF, DOC, or DOCX · Maximum 15 MB
              </p>

              <input
                type="file"
                accept=".pdf,.doc,.docx"
                disabled={busy}
                onChange={handleFileChange}
                className="mt-4 block w-full rounded-xl border border-white/10 bg-[#080B14] p-3 text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-3 file:py-2 file:text-white"
              />

              {file && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white/5 p-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm">
                      {file.name}
                    </p>

                    <p className="mt-1 text-xs text-gray-400">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setFile(null)}
                    className="text-sm text-red-300"
                  >
                    Remove
                  </button>
                </div>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-4 break-words text-sm text-red-300"
                >
                  {error}
                </p>
              )}

              {message && (
                <p
                  role="status"
                  className="mt-4 text-sm text-emerald-300"
                >
                  {message}
                </p>
              )}

              {txHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block break-all text-sm text-violet-300 underline"
                >
                  View confirmed transaction
                </a>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  busy ||
                  !file ||
                  !isConnected ||
                  !address ||
                  !isAddress(address) ||
                  chainId !== SEPOLIA_CHAIN_ID ||
                  escrow.status !== "CREATED" ||
                  Boolean(escrow.payee)
                }
                className="mt-5 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy
                  ? signing
                    ? "Signing Document B..."
                    : "Processing..."
                  : "Upload and propose agreement"}
              </button>

              {!isConnected && (
                <p className="mt-3 text-center text-xs text-amber-300">
                  Connect your wallet before submitting.
                </p>
              )}

              <div className="mt-6 border-t border-white/10 pt-5">
                <h3 className="font-semibold">
                  Sign accepted payee document
                </h3>

                <p className="mt-1 text-sm text-gray-400">
                  After the payer accepts your proposal, sign Document B to record your signature on-chain.
                </p>

                {signError && (
                  <p
                    role="alert"
                    className="mt-4 break-words text-sm text-red-300"
                  >
                    {signError}
                  </p>
                )}

                {signMessage && (
                  <p
                    role="status"
                    className="mt-4 text-sm text-emerald-300"
                  >
                    {signMessage}
                  </p>
                )}

                {signTxHash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${signTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 block break-all text-sm text-violet-300 underline"
                  >
                    View signing transaction
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => void handleSignPayeeDocument()}
                  disabled={
                    !isConnected ||
                    !address ||
                    chainId !== SEPOLIA_CHAIN_ID ||
                    signing ||
                    submitting ||
                    chainLoading
                  }
                  className="mt-4 w-full rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm font-semibold text-violet-200 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {signing || chainLoading
                    ? "Signing..."
                    : "Sign Payee Document"}
                </button>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </main>
  );
}

function Panel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#101522] p-5 sm:p-6">
      {children}
    </section>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-gray-400">{label}</span>

      <span className="break-all font-medium sm:text-right">
        {value}
      </span>
    </div>
  );
}

function EmailInfo({
  label,
  email,
}: {
  label: string;
  email: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-xs text-gray-500">
        {label}
      </span>

      <a
        href={`mailto:${email}`}
        className="break-all text-sm text-violet-400 transition hover:text-violet-300 sm:text-right"
      >
        {email}
      </a>
    </div>
  );
}
