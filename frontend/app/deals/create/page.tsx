
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useAccount } from "wagmi";
import {
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import axiosInstance from "../../../lib/axios";
import { useCreateEscrow } from "@/hooks/useCreateEscrow";
import { useAgreementRegistry } from "@/hooks/useAgreementRegistry";
import Navbar from "@/component/Navbar";

const SEPOLIA_CHAIN_ID = 11155111;

const TOKEN_DECIMALS = Number(
  process.env.NEXT_PUBLIC_TOKEN_DECIMALS ?? "6"
);

type Milestone = {
  title: string;
  description: string;
  amount: string;
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

type BackendSyncPayload = {
  dealId: string;
  transactionHash: Hex;
  payerWallet: Address;
  title: string;
  contentHash: Hex;
  contentLink: string;
  totalAmount: string;
  milestones: Milestone[];
  invitedPayees: Address[];
};

const initialMilestone: Milestone = {
  title: "",
  description: "",
  amount: "",
};

export default function CreateDealPage() {
  const { address, isConnected } = useAccount();

  const {
    createEscrow,
    hash: txHash,
    dealId,
    transactionSucceeded,
    isPending,
    isConfirming,
    isConfirmed,
    error,
    reset,
  } = useCreateEscrow(SEPOLIA_CHAIN_ID);

  // This hook must expose signDocument from your first hook implementation.
  const {
    signDocument,
    loading: isSigning,
    error: signingError,
    success: signingSuccess,
  } = useAgreementRegistry();

  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [milestones, setMilestones] = useState<Milestone[]>([
    { ...initialMilestone },
  ]);
  const [invitedPayeesInput, setInvitedPayeesInput] = useState("");

  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [preparedDocument, setPreparedDocument] =
    useState<PreparedDocument | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const [uploadError, setUploadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [pageError, setPageError] = useState("");

  const [createdDealId, setCreatedDealId] = useState<string | null>(null);
  const [payerSignature, setPayerSignature] = useState<Hex | null>(null);
  const [signatureTxHash, setSignatureTxHash] = useState<Hex | null>(null);

  const savedTransactionRef = useRef<string | null>(null);
  const pendingSyncPayloadRef = useRef<BackendSyncPayload | null>(null);

  const invitedPayees: Address[] = invitedPayeesInput
    .split(/[\n,;]+/)
    .map((wallet) => wallet.trim())
    .filter(Boolean)
    .map((wallet) => wallet as Address);

  const validInvitedPayees = invitedPayees.every(isAddress);

  const validMilestones =
    milestones.length > 0 &&
    milestones.every((milestone) => {
      if (
        !milestone.title.trim() ||
        !milestone.amount.trim() ||
        !Number.isFinite(Number(milestone.amount)) ||
        Number(milestone.amount) <= 0
      ) {
        return false;
      }

      try {
        parseUnits(milestone.amount, TOKEN_DECIMALS);
        return true;
      } catch {
        return false;
      }
    });

  const totalAmountInUnits = (() => {
    try {
      return milestones.reduce(
        (total, milestone) =>
          total + parseUnits(milestone.amount || "0", TOKEN_DECIMALS),
        0n
      );
    } catch {
      return 0n;
    }
  })();

  const totalAmount = formatUnits(
    totalAmountInUnits,
    TOKEN_DECIMALS
  );

  const updateMilestone = (
    index: number,
    field: keyof Milestone,
    value: string
  ) => {
    setMilestones((current) =>
      current.map((milestone, i) =>
        i === index ? { ...milestone, [field]: value } : milestone
      )
    );
  };

  const addMilestone = () => {
    if (milestones.length >= 15) {
      setPageError("You can create a maximum of 15 milestones.");
      return;
    }

    setPageError("");
    setMilestones((current) => [
      ...current,
      { ...initialMilestone },
    ]);
  };

  const removeMilestone = (index: number) => {
    if (milestones.length <= 1) {
      setPageError("An escrow must have at least one milestone.");
      return;
    }

    setMilestones((current) =>
      current.filter((_, i) => i !== index)
    );
  };

  const handleFileChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0] ?? null;

    setDocumentFile(file);
    setPreparedDocument(null);
    setUploadError("");
    setPayerSignature(null);
    setSignatureTxHash(null);
    setPageError("");
  };

  // Step 1: Upload the payer's agreement.
  const uploadDocument = async () => {
    if (!documentFile) {
      setUploadError("Please select an agreement document first.");
      return;
    }

    setIsUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("document", documentFile);

      const response = await axiosInstance.post(
        "/agreement/payer/document",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );

      const data = response.data?.data;

      if (!data?.documentHash || !data?.file?.url) {
        throw new Error(
          "Upload response is missing documentHash or file URL."
        );
      }

      setPreparedDocument({
        documentHash: data.documentHash as Hex,
        file: {
          name: data.file.name ?? documentFile.name,
          size: data.file.size ?? documentFile.size,
          mimeType: data.file.mimeType ?? documentFile.type,
          url: data.file.url,
        },
      });

      setStep(2);
    } catch (err: unknown) {
      const uploadErr = err as {
        message?: string;
        response?: {
          data?: {
            message?: string;
            error?: string;
          };
        };
      };

      setUploadError(
        uploadErr.response?.data?.message ??
          uploadErr.response?.data?.error ??
          uploadErr.message ??
          "Failed to upload the agreement."
      );
    } finally {
      setIsUploading(false);
    }
  };

  // Step 2: Create the escrow on-chain.
  const handleCreateDeal = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setPageError("");
    setSyncError("");

    if (!isConnected || !address) {
      setPageError("Connect your wallet before creating the escrow.");
      return;
    }

    if (!title.trim()) {
      setPageError("Enter an agreement title.");
      return;
    }

    if (!preparedDocument) {
      setPageError("Upload the agreement first.");
      setStep(1);
      return;
    }

    if (!validMilestones) {
      setPageError(
        "Every milestone needs a title and a valid positive amount. " +
          `Amounts may have at most ${TOKEN_DECIMALS} decimal places.`
      );
      return;
    }

    if (!validInvitedPayees) {
      setPageError("One or more invited payee addresses are invalid.");
      return;
    }

    try {
      setIsSaved(false);
      setCreatedDealId(null);
      setPayerSignature(null);
      setSignatureTxHash(null);
      pendingSyncPayloadRef.current = null;
      savedTransactionRef.current = null;

      reset();

      await createEscrow({
        descriptions: milestones.map((milestone) => {
          const description = milestone.description.trim();

          return description
            ? `${milestone.title.trim()}: ${description}`
            : milestone.title.trim();
        }),
        amounts: milestones.map((milestone) =>
          milestone.amount.trim()
        ),
        invitedPayees,
        documentHash: preparedDocument.documentHash,
        tokenDecimals: TOKEN_DECIMALS,
      });
    } catch (err: unknown) {
      setPageError(
        err instanceof Error
          ? err.message
          : "Failed to submit the escrow transaction."
      );
    }
  };

  // Step 3: Synchronize the successful escrow transaction with MongoDB.
  const syncDealWithBackend = useCallback(
    async (payload: BackendSyncPayload) => {
      if (savedTransactionRef.current === payload.transactionHash) {
        return;
      }

      savedTransactionRef.current = payload.transactionHash;
      setIsSaving(true);
      setSyncError("");

      try {
        const response = await axiosInstance.post("/agreement/sync", {
          dealId: payload.dealId,
          documentUrl: payload.contentLink,
          documentHash: payload.contentHash,
          transactionHash: payload.transactionHash,
          payerWallet: payload.payerWallet,
          title: payload.title,
          totalAmount: payload.totalAmount,
          milestones: payload.milestones,
          invitedPayees: payload.invitedPayees,
        });

        if (response.data?.success === false) {
          throw new Error(
            response.data?.message ??
              "The backend could not save the escrow."
          );
        }

        setIsSaved(true);
        setCreatedDealId(payload.dealId);
        pendingSyncPayloadRef.current = null;
      } catch (err: unknown) {
        const syncErr = err as {
          message?: string;
          response?: {
            data?: {
              message?: string;
            };
          };
        };

        savedTransactionRef.current = null;

        setSyncError(
          syncErr.response?.data?.message ??
            syncErr.message ??
            "Escrow created, but backend synchronization failed."
        );
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  // Synchronize only after the escrow transaction succeeds.
  useEffect(() => {
    if (
      !transactionSucceeded ||
      !txHash ||
      dealId == null ||
      !address ||
      !preparedDocument
    ) {
      return;
    }

    const payload: BackendSyncPayload = {
      dealId: String(dealId),
      transactionHash: txHash,
      payerWallet: address,
      title: title.trim(),
      contentHash: preparedDocument.documentHash,
      contentLink: preparedDocument.file.url,
      totalAmount,
      milestones: milestones.map((milestone) => ({
        title: milestone.title.trim(),
        description: milestone.description.trim(),
        amount: milestone.amount.trim(),
      })),
      invitedPayees,
    };

    pendingSyncPayloadRef.current = payload;
    setCreatedDealId(String(dealId));

    void syncDealWithBackend(payload);
  }, [
    transactionSucceeded,
    txHash,
    dealId,
    address,
    preparedDocument,
    title,
    totalAmount,
    milestones,
    invitedPayeesInput,
    syncDealWithBackend,
  ]);

  const retryBackendSync = () => {
    const payload = pendingSyncPayloadRef.current;

    if (!payload) {
      setSyncError("There is no pending escrow to synchronize.");
      return;
    }

    void syncDealWithBackend(payload);
  };

  // Sign Document A using EIP-712, then record the signature on-chain.
  const handleSignPayerAgreement = async () => {
    if (!transactionSucceeded || dealId == null) {
      setPageError("Wait until the escrow transaction succeeds.");
      return;
    }

    if (!address || !isConnected) {
      setPageError("Connect the payer's wallet first.");
      return;
    }

    if (!preparedDocument) {
      setPageError("The payer's agreement document is missing.");
      return;
    }

    if (payerSignature) {
      return;
    }

    setPageError("");

    try {
      const result = await signDocument({
        dealId: BigInt(dealId),
        docIndex: 0,
        contentHash: preparedDocument.documentHash,
      });

      setPayerSignature(result.signature);
      setSignatureTxHash(result.txHash);
    } catch (err: unknown) {
      setPageError(
        err instanceof Error
          ? err.message
          : "Failed to sign the payer's agreement."
      );
    }
  };

  const goToReview = () => {
    setPageError("");

    if (!title.trim()) {
      setPageError("Enter an agreement title.");
      return;
    }

    if (!validMilestones) {
      setPageError("Enter valid titles and amounts for all milestones.");
      return;
    }

    if (!validInvitedPayees) {
      setPageError("One or more invited payee addresses are invalid.");
      return;
    }

    if (!preparedDocument) {
      setPageError("Upload the agreement first.");
      setStep(1);
      return;
    }

    setStep(3);
  };

  const handleReset = () => {
    setStep(1);
    setTitle("");
    setMilestones([{ ...initialMilestone }]);
    setInvitedPayeesInput("");
    setDocumentFile(null);
    setPreparedDocument(null);
    setCreatedDealId(null);
    setIsSaved(false);
    setPayerSignature(null);
    setSignatureTxHash(null);
    setUploadError("");
    setSyncError("");
    setPageError("");
    setIsSaving(false);
    savedTransactionRef.current = null;
    pendingSyncPayloadRef.current = null;
    reset();
  };

  return (
    <main className="min-h-screen bg-[#080B14] px-4 py-10 text-white sm:px-6">
      <Navbar />

      <div className="mx-auto mt-15 max-w-3xl">
        <header className="mb-8">
          <p className="text-sm font-medium text-indigo-400">
            LEXO · ESCROW
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Create an agreement
          </h1>

          <p className="mt-2 text-sm text-gray-400">
            Upload your agreement, define payment milestones, create
            the escrow, and sign the payer document on-chain.
          </p>
        </header>

        <div className="mb-8 grid grid-cols-3 gap-3">
          {[
            { number: 1, label: "Agreement" },
            { number: 2, label: "Details" },
            { number: 3, label: "Review & sign" },
          ].map((item) => (
            <div
              key={item.number}
              className={`rounded-xl border p-3 ${
                step === item.number
                  ? "border-indigo-500 bg-indigo-500/10"
                  : step > item.number
                    ? "border-emerald-700 bg-emerald-500/5"
                    : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <p className="text-xs text-gray-400">
                Step {item.number}
              </p>
              <p className="mt-1 text-sm font-medium">
                {item.label}
              </p>
            </div>
          ))}
        </div>

        <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-medium">Connected payer wallet</p>
          <p className="mt-1 break-all text-xs text-gray-400">
            {address ?? "No wallet connected"}
          </p>
          <p
            className={`mt-2 text-xs ${
              isConnected ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {isConnected ? "Connected" : "Not connected"}
          </p>
        </section>

        {pageError && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
          >
            {pageError}
          </div>
        )}

        {/* STEP 1: UPLOAD AGREEMENT */}
        {step === 1 && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
            <h2 className="text-xl font-semibold">
              Upload the payer agreement
            </h2>

            <p className="mt-2 text-sm text-gray-400">
              The document hash will be used for the escrow and the
              payer's EIP-712 signature.
            </p>

            <div className="mt-6">
              <label
                htmlFor="agreement"
                className="mb-2 block text-sm font-medium"
              >
                Agreement document
              </label>

              <input
                id="agreement"
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleFileChange}
                className="block w-full rounded-xl border border-white/10 bg-[#0D1220] p-3 text-sm text-gray-300"
              />

              {documentFile && (
                <p className="mt-3 break-all text-sm text-gray-300">
                  {documentFile.name} ·{" "}
                  {(documentFile.size / 1024).toFixed(1)} KB
                </p>
              )}

              {preparedDocument && (
                <div className="mt-4 rounded-xl border border-emerald-500/30 p-4">
                  <p className="font-medium text-emerald-400">
                    Agreement uploaded
                  </p>

                  <p className="mt-2 break-all text-xs text-gray-400">
                    Hash: {preparedDocument.documentHash}
                  </p>

                  <a
                    href={preparedDocument.file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-sm text-indigo-400 underline"
                  >
                    View agreement
                  </a>
                </div>
              )}

              {uploadError && (
                <p role="alert" className="mt-3 text-sm text-red-400">
                  {uploadError}
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={uploadDocument}
                disabled={isUploading || !documentFile}
                className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
              >
                {isUploading ? "Uploading..." : "Upload agreement"}
              </button>
            </div>
          </section>
        )}

        {/* STEP 2: ESCROW DETAILS */}
        {step === 2 && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
            <h2 className="text-xl font-semibold">Escrow details</h2>

            <div className="mt-6">
              <label
                htmlFor="title"
                className="mb-2 block text-sm font-medium"
              >
                Agreement title
              </label>

              <input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Website development"
                className="w-full rounded-xl border border-white/10 bg-[#0D1220] px-4 py-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <div className="mt-6">
              <label
                htmlFor="payees"
                className="mb-2 block text-sm font-medium"
              >
                Invited payee wallets (optional)
              </label>

              <textarea
                id="payees"
                value={invitedPayeesInput}
                onChange={(event) =>
                  setInvitedPayeesInput(event.target.value)
                }
                placeholder="One address per line"
                rows={3}
                className="w-full rounded-xl border border-white/10 bg-[#0D1220] px-4 py-3 text-sm outline-none focus:border-indigo-500"
              />

              {invitedPayeesInput.trim() && !validInvitedPayees && (
                <p className="mt-2 text-xs text-red-400">
                  Check the invited wallet addresses.
                </p>
              )}
            </div>

            <div className="mt-8 flex items-center justify-between">
              <h3 className="font-semibold">Payment milestones</h3>

              <button
                type="button"
                onClick={addMilestone}
                disabled={milestones.length >= 15}
                className="rounded-lg border border-indigo-500/40 px-3 py-2 text-sm text-indigo-300 disabled:opacity-40"
              >
                + Add milestone
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {milestones.map((milestone, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-white/10 bg-[#0D1220] p-4"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-sm font-semibold">
                      Milestone {index + 1}
                    </h4>

                    {milestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMilestone(index)}
                        className="text-xs text-red-400"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor={`milestone-title-${index}`}
                        className="mb-2 block text-sm text-gray-300"
                      >
                        Title
                      </label>

                      <input
                        id={`milestone-title-${index}`}
                        value={milestone.title}
                        onChange={(event) =>
                          updateMilestone(index, "title", event.target.value)
                        }
                        className="w-full rounded-lg border border-white/10 bg-[#080B14] px-3 py-2.5 text-sm"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`milestone-description-${index}`}
                        className="mb-2 block text-sm text-gray-300"
                      >
                        Description
                      </label>

                      <textarea
                        id={`milestone-description-${index}`}
                        value={milestone.description}
                        onChange={(event) =>
                          updateMilestone(
                            index,
                            "description",
                            event.target.value
                          )
                        }
                        rows={2}
                        className="w-full rounded-lg border border-white/10 bg-[#080B14] px-3 py-2.5 text-sm"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`milestone-amount-${index}`}
                        className="mb-2 block text-sm text-gray-300"
                      >
                        Amount (USDT)
                      </label>

                      <input
                        id={`milestone-amount-${index}`}
                        type="number"
                        min="0"
                        step="any"
                        value={milestone.amount}
                        onChange={(event) =>
                          updateMilestone(index, "amount", event.target.value)
                        }
                        placeholder="100"
                        className="w-full rounded-lg border border-white/10 bg-[#080B14] px-3 py-2.5 text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-between rounded-xl border border-white/10 p-4">
              <span className="text-sm text-gray-400">Total amount</span>
              <span className="font-semibold">{totalAmount} USDT</span>
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Token decimals configured: {TOKEN_DECIMALS}
            </p>

            <div className="mt-7 flex justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-xl border border-white/15 px-5 py-3 text-sm"
              >
                Back
              </button>

              <button
                type="button"
                onClick={goToReview}
                className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold"
              >
                Review escrow
              </button>
            </div>
          </section>
        )}

        {/* STEP 3: CREATE, SYNC, AND SIGN */}
        {step === 3 && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
            <h2 className="text-xl font-semibold">Review and create</h2>

            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-white/10 p-4">
                <p className="text-xs text-gray-500">Agreement title</p>
                <p className="mt-1 font-medium">{title}</p>
              </div>

              <div className="rounded-xl border border-white/10 p-4">
                <p className="text-xs text-gray-500">Payer document</p>
                <p className="mt-1 break-all text-sm">
                  {preparedDocument?.file.name}
                </p>

                <p className="mt-2 break-all text-xs text-gray-400">
                  {preparedDocument?.documentHash}
                </p>

                {preparedDocument?.file.url && (
                  <a
                    href={preparedDocument.file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm text-indigo-400 underline"
                  >
                    Open document before signing
                  </a>
                )}
              </div>

              <div className="rounded-xl border border-white/10 p-4">
                <p className="mb-3 text-sm font-medium">Milestones</p>

                {milestones.map((milestone, index) => (
                  <div
                    key={index}
                    className="flex justify-between gap-4 border-b border-white/5 py-3 last:border-0"
                  >
                    <div>
                      <p className="text-sm">
                        {index + 1}. {milestone.title}
                      </p>
                      {milestone.description && (
                        <p className="mt-1 text-xs text-gray-400">
                          {milestone.description}
                        </p>
                      )}
                    </div>

                    <p className="shrink-0 text-sm font-semibold">
                      {milestone.amount} USDT
                    </p>
                  </div>
                ))}

                <div className="mt-3 flex justify-between border-t border-white/10 pt-3">
                  <span className="text-sm text-gray-400">Total</span>
                  <span className="font-semibold">{totalAmount} USDT</span>
                </div>
              </div>
            </div>

            {(isPending || isConfirming || isConfirmed || txHash) && (
              <div className="mt-6 rounded-xl border border-white/10 p-4">
                <p className="font-medium">Escrow transaction</p>

                <p className="mt-2 text-sm text-gray-400">
                  {isPending
                    ? "Waiting for wallet confirmation..."
                    : isConfirming
                      ? "Waiting for blockchain confirmation..."
                      : transactionSucceeded
                        ? "Escrow transaction succeeded."
                        : isConfirmed
                          ? "Transaction receipt received."
                          : "Transaction submitted."}
                </p>

                {txHash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block break-all text-sm text-indigo-400 underline"
                  >
                    View escrow transaction
                  </a>
                )}

                {dealId != null && (
                  <p className="mt-3 text-sm">
                    Deal ID: {String(dealId)}
                  </p>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 text-sm text-red-400">
                {error.message}
              </p>
            )}

            {isSaving && (
              <p className="mt-4 rounded-xl border border-amber-500/30 p-4 text-sm text-amber-300">
                Escrow succeeded. Synchronizing the escrow with the backend...
              </p>
            )}

            {isSaved && (
              <p className="mt-4 rounded-xl border border-emerald-500/30 p-4 text-sm text-emerald-400">
                Escrow details synchronized successfully.
                {createdDealId && ` Deal ID: ${createdDealId}`}
              </p>
            )}

            {syncError && (
              <div className="mt-4 rounded-xl border border-red-500/30 p-4">
                <p className="text-sm text-red-300">{syncError}</p>

                <button
                  type="button"
                  onClick={retryBackendSync}
                  disabled={isSaving}
                  className="mt-3 rounded-lg border border-red-400/30 px-4 py-2 text-sm disabled:opacity-50"
                >
                  Retry backend sync
                </button>
              </div>
            )}

            {/* PAYER DOCUMENT SIGNATURE */}
            {transactionSucceeded && preparedDocument && (
              <div className="mt-6 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
                <h3 className="font-semibold">Sign your agreement</h3>

                <p className="mt-2 text-sm text-gray-400">
                  Review the uploaded document, then sign its hash using
                  your connected payer wallet. The signature is recorded
                  on-chain through AgreementRegistry.
                </p>

                {signingError && (
                  <p role="alert" className="mt-3 text-sm text-red-400">
                    {signingError}
                  </p>
                )}

                {signingSuccess && payerSignature && (
                  <div className="mt-4">
                    <p className="font-medium text-emerald-400">
                      Payer agreement signed and recorded
                    </p>

                    <p className="mt-2 text-xs text-gray-400">
                      EIP-712 signature
                    </p>

                    <p className="mt-1 break-all text-xs text-gray-300">
                      {payerSignature}
                    </p>

                    {signatureTxHash && (
                      <a
                        href={`https://sepolia.etherscan.io/tx/${signatureTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block break-all text-sm text-indigo-400 underline"
                      >
                        View signature transaction
                      </a>
                    )}
                  </div>
                )}

                {!payerSignature && (
                  <button
                    type="button"
                    onClick={handleSignPayerAgreement}
                    disabled={isSigning || !isConnected}
                    className="mt-4 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSigning
                      ? "Signing and recording..."
                      : "Sign payer agreement"}
                  </button>
                )}
              </div>
            )}

            <div className="mt-7 flex flex-col-reverse justify-between gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={isPending || isConfirming || transactionSucceeded}
                className="rounded-xl border border-white/15 px-5 py-3 text-sm disabled:opacity-40"
              >
                Back
              </button>

              {!transactionSucceeded && (
                <button
                  type="button"
                  onClick={() => {
                    const form = document.getElementById(
                      "create-deal-form"
                    ) as HTMLFormElement | null;

                    form?.requestSubmit();
                  }}
                  disabled={isPending || isConfirming || isUploading}
                  className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold disabled:opacity-50"
                >
                  {isPending
                    ? "Confirm in wallet..."
                    : isConfirming
                      ? "Confirming..."
                      : "Create escrow"}
                </button>
              )}

              {payerSignature && signingSuccess && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold"
                >
                  Create another escrow
                </button>
              )}
            </div>

            <form
              id="create-deal-form"
              onSubmit={handleCreateDeal}
              className="hidden"
            >
              <button type="submit">Create</button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
