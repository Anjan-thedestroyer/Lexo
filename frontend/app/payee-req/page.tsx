
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Inbox,
  Layers3,
  LoaderCircle,
  MailPlus,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";
import { isAddress, isHex, type Hex } from "viem";
import axios from "axios";

import axiosInstance from "@/lib/axios";
import Navbar from "@/component/Navbar";
import { useAgreementRegistry } from "@/hooks/useAgreementRegistryPayer";

type UserInfo = {
  _id?: string;
  name?: string;
  email?: string;
  walletAddress?: string;
  address?: string;
};

type Milestone = {
  _id?: string;
  title?: string;
  description?: string;
  amount?: string | number;
  status?: string;
  dueDate?: string | null;
};

type Agreement = {
  _id: string;
  payerContentLink?: string | null;
  payeeContentLink?: string | null;
  payerContentHash?: string | null;
  payeeContentHash?: string | null;
  status?: string;
  payerAddress?: string;
  payeeAddress?: string;
  dealId?: number | string;
  payerSigned?: boolean;
  payeeSigned?: boolean;
};

type Escrow = {
  _id: string;
  id?: string;
  dealId?: number | string;
  payer?: UserInfo | string | null;
  payee?: UserInfo | string | null;
  totalAmount?: string | number;
  token?: string;
  status?: string;
  milestones?: Milestone[];
  agreement?: Agreement | null;
  createdAt?: string;
};

type PayeeRequest = {
  _id: string;
  agreementId: string | Agreement;
  agreement?: Agreement | null;
  escrow?: Escrow | null;
  dealId?: number | string;
  payer?: UserInfo | null;
  payee?: UserInfo | null;
  payeeAddress?: string;
  documentHash?: string;
  payerContentLink?: string | null;
  payeeContentLink?: string | null;
  status: string;
  txHash?: string | null;
  createdAt?: string;
};

type ApiResponse = {
  success: boolean;
  data?: PayeeRequest[];
  message?: string;
};

type RequestWithEscrow = {
  request: PayeeRequest;
  escrow: Escrow;
};

const REQUESTS_ENDPOINT = "/req/payee-req";

const statusStyles: Record<string, string> = {
  PENDING: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  ACCEPTED: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  REJECTED: "border-red-500/20 bg-red-500/10 text-red-400",
  CREATED: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  ACTIVE: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  COMPLETED: "border-blue-500/20 bg-blue-500/10 text-blue-400",
  CANCELLED: "border-red-500/20 bg-red-500/10 text-red-400",
};

function formatDate(date?: string | null) {
  if (!date) return "Not available";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return "Not available";

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getStatusClass(status?: string) {
  return (
    statusStyles[(status || "PENDING").toUpperCase()] ||
    "border-white/10 bg-white/5 text-gray-400"
  );
}

function displayStatus(status?: string) {
  return (status || "PENDING").replaceAll("_", " ");
}

function getUserName(user?: UserInfo | string | null) {
  if (!user) return "Unknown user";
  if (typeof user === "string") return user;

  return user.name || user.email || user._id || "Unknown user";
}

function getCandidatePayeeAddress(request: PayeeRequest, escrow: Escrow) {
  return (
    request.payeeAddress ||
    request.payee?.walletAddress ||
    request.payee?.address ||
    escrow.agreement?.payeeAddress ||
    ""
  );
}

function getCandidateDocumentHash(request: PayeeRequest, escrow: Escrow) {
  return (
    request.documentHash ||
    escrow.agreement?.payeeContentHash ||
    ""
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    return (
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      fallback
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "shortMessage" in error &&
    typeof error.shortMessage === "string"
  ) {
    return error.shortMessage;
  }

  if (error instanceof Error) return error.message;

  return fallback;
}

function getDealId(request: PayeeRequest, escrow: Escrow) {
  const rawDealId = request.dealId ?? escrow.dealId;
  const dealId = Number(rawDealId);

  if (!Number.isSafeInteger(dealId) || dealId <= 0) {
    throw new Error("A valid on-chain deal ID is missing.");
  }

  return dealId;
}

function validateCandidate(request: PayeeRequest, escrow: Escrow) {
  const candidatePayee = getCandidatePayeeAddress(request, escrow);

  if (!isAddress(candidatePayee)) {
    throw new Error(
      "The candidate payee wallet address is missing or invalid.",
    );
  }

  return candidatePayee;
}

function validateDocumentHash(
  request: PayeeRequest,
  escrow: Escrow,
): Hex {
  const hash = getCandidateDocumentHash(request, escrow);

  if (!isHex(hash, { strict: true }) || hash.length !== 66) {
    throw new Error(
      "The candidate agreement document hash is missing or invalid.",
    );
  }

  return hash as Hex;
}

/**
 * The backend returns each request with:
 * {
 *   ...request,
 *   agreement: Agreement | null,
 *   escrow: Escrow | null,
 *   payeeAddress: string
 * }
 *
 * Convert this to the shape expected by RequestCard.
 */
function mapRequestsToEscrows(
  requests: PayeeRequest[],
): RequestWithEscrow[] {
  return requests.flatMap((request) => {
    if (!request.escrow) {
      console.warn(
        "Skipping payee request because its escrow was not found:",
        {
          requestId: request._id,
          agreementId:
            typeof request.agreementId === "string"
              ? request.agreementId
              : request.agreementId?._id,
          dealId: request.dealId,
        },
      );

      return [];
    }

    const escrow: Escrow = {
      ...request.escrow,

      // The controller returns agreement separately on the request.
      // Attach it to the escrow for the existing card UI.
      agreement:
        request.agreement ??
        request.escrow.agreement ??
        (typeof request.agreementId === "object"
          ? request.agreementId
          : null),

      // Prefer request-level dealId when available.
      dealId: request.dealId ?? request.escrow.dealId,

      // Use populated payer details from the request if present.
      payer: request.payer ?? request.escrow.payer,
    };

    return [{ request, escrow }];
  });
}

function RequestCard({
  request,
  escrow,
  onActionComplete,
}: {
  request: PayeeRequest;
  escrow: Escrow;
  onActionComplete: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    "accept" | "reject" | null
  >(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const {
    acceptPayeeAgreement,
    rejectPayeeAgreement,
    isConfirming,
  } = useAgreementRegistry();

  const requestStatus = (request.status || "PENDING").toUpperCase();
  const escrowStatus = (escrow.status || "CREATED").toUpperCase();
  const milestones = escrow.milestones ?? [];

  const payerDocument =
    request.payerContentLink ||
    escrow.agreement?.payerContentLink ||
    null;

  const payeeDocument =
    request.payeeContentLink ||
    escrow.agreement?.payeeContentLink ||
    null;

  const candidatePayee = getCandidatePayeeAddress(request, escrow);

  const syncBackend = async (
    action: "accept" | "reject",
    txHash: Hex,
  ) => {
    const endpoint =
      action === "accept" ? "/req/accept" : "/req/reject";

    await axiosInstance.post(endpoint, {
      requestId: request._id,
      txHash,
    });
  };

  const handleAction = async (action: "accept" | "reject") => {
    setActionError("");
    setActionMessage("");

    let txHash: Hex;

    try {
      const dealId = getDealId(request, escrow);
      const payeeAddress = validateCandidate(request, escrow);

      setActionLoading(action);

      if (action === "accept") {
        const contentHash = validateDocumentHash(request, escrow);

        txHash = await acceptPayeeAgreement({
          dealId,
          candidatePayee: payeeAddress,
          contentHash,
        });
      } else {
        txHash = await rejectPayeeAgreement(dealId, payeeAddress);
      }
    } catch (error: unknown) {
      setActionError(
        getErrorMessage(error, `Failed to ${action} this request.`),
      );
      setActionLoading(null);
      return;
    }

    // The chain hook should return only after the receipt is confirmed.
    try {
      await syncBackend(action, txHash);

      setActionMessage(
        action === "accept"
          ? "Agreement accepted and backend updated."
          : "Request rejected and backend updated.",
      );

      await onActionComplete();
    } catch (error: unknown) {
      setActionError(
        `The blockchain transaction succeeded (${txHash}), but the backend update failed: ${getErrorMessage(
          error,
          "Unknown backend error.",
        )} Refresh the page and reconcile the request before submitting another transaction.`,
      );
    } finally {
      setActionLoading(null);
    }
  };

  const actionInProgress = actionLoading !== null || isConfirming;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#101522] transition hover:border-indigo-400/30">
      <div className="flex items-start justify-between gap-4 p-5 sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-400/10 bg-indigo-500/10 text-indigo-400">
            <MailPlus size={21} />
          </div>

          <div className="min-w-0">
            <h2 className="break-words font-semibold text-white">
              Payee Request
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Escrow #{escrow.dealId ?? escrow._id}
            </p>
            <p className="mt-2 text-sm text-gray-400">
              From{" "}
              <span className="font-medium text-gray-200">
                {getUserName(request.payer || escrow.payer)}
              </span>
            </p>
          </div>
        </div>

        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${getStatusClass(
            requestStatus,
          )}`}
        >
          {displayStatus(requestStatus)}
        </span>
      </div>

      <div className="mx-5 rounded-xl border border-white/5 bg-[#0c101a] p-4 sm:mx-6">
        <p className="text-xs font-medium text-gray-500">
          Proposed escrow amount
        </p>
        <p className="mt-2 break-words text-2xl font-bold tracking-tight text-white">
          {escrow.totalAmount ?? "—"}
          <span className="ml-2 text-sm font-medium text-indigo-400">
            {escrow.token || "USDT"}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 px-5 py-5 sm:px-6">
        <div>
          <div className="flex items-center gap-2 text-gray-500">
            <Layers3 size={15} />
            <span className="text-xs">Milestones</span>
          </div>
          <p className="mt-2 text-sm font-medium text-gray-200">
            {milestones.length}
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-gray-500">
            <CalendarDays size={15} />
            <span className="text-xs">Requested on</span>
          </div>
          <p className="mt-2 text-sm font-medium text-gray-200">
            {formatDate(request.createdAt)}
          </p>
        </div>
      </div>

      <div className="mx-5 border-t border-white/10 pt-4 sm:mx-6">
        <p className="text-xs text-gray-500">Payer</p>
        <p className="mt-1 break-words text-sm font-medium text-gray-200">
          {getUserName(request.payer || escrow.payer)}
        </p>

        {(request.payer || escrow.payer) &&
          typeof (request.payer || escrow.payer) !== "string" &&
          (request.payer || escrow.payer)?.email && (
            <p className="mt-1 break-all text-xs text-gray-500">
              {(request.payer || escrow.payer as UserInfo)?.email}
            </p>
          )}
      </div>

      <div className="mx-5 mt-5 space-y-3 border-t border-white/10 pt-4 sm:mx-6">
        <p className="text-xs font-medium text-gray-500">
          Agreement Documents
        </p>

        {payerDocument ? (
          <a
            href={payerDocument}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200"
          >
            <FileText size={16} />
            View Payer Agreement
            <ArrowUpRight size={14} />
          </a>
        ) : (
          <p className="text-xs text-gray-500">
            Payer agreement document is not available.
          </p>
        )}

        {payeeDocument ? (
          <a
            href={payeeDocument}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200"
          >
            <FileText size={16} />
            View Payee Agreement
            <ArrowUpRight size={14} />
          </a>
        ) : (
          <p className="text-xs text-gray-500">
            Payee agreement document is not available.
          </p>
        )}
      </div>

      <div className="mx-5 mt-5 border-t border-white/10 pt-4 sm:mx-6">
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 text-sm font-medium text-gray-300 hover:text-white"
        >
          <span>
            {expanded ? "Hide escrow details" : "View escrow details"}
          </span>
          <ChevronDown
            size={18}
            className={`transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>

        {expanded && (
          <div className="mt-4 space-y-4 pb-5">
            <div className="rounded-xl border border-white/10 bg-[#0c101a] p-4">
              <div className="flex items-center gap-2 text-gray-400">
                <Wallet size={16} />
                <span className="text-xs">Escrow status</span>
              </div>

              <span
                className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs ${getStatusClass(
                  escrowStatus,
                )}`}
              >
                {displayStatus(escrowStatus)}
              </span>

              {escrow.agreement?._id && (
                <p className="mt-3 break-all text-xs text-gray-500">
                  Agreement ID: {escrow.agreement._id}
                </p>
              )}

              {request.documentHash && (
                <p className="mt-3 break-all text-xs text-gray-500">
                  Document hash: {request.documentHash}
                </p>
              )}

              {request.txHash && (
                <p className="mt-3 break-all text-xs text-gray-500">
                  Transaction: {request.txHash}
                </p>
              )}

              {candidatePayee && (
                <p className="mt-3 break-all text-xs text-gray-500">
                  Candidate wallet: {candidatePayee}
                </p>
              )}
            </div>

            {milestones.length > 0 ? (
              milestones.map((milestone, index) => (
                <div
                  key={
                    milestone._id ||
                    `${request._id}-milestone-${index}`
                  }
                  className="rounded-xl border border-white/10 bg-[#0c101a] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">
                        Milestone {index + 1}
                      </p>
                      <h3 className="mt-1 break-words text-sm font-semibold text-white">
                        {milestone.title || `Milestone ${index + 1}`}
                      </h3>
                    </div>

                    <span
                      className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${getStatusClass(
                        milestone.status,
                      )}`}
                    >
                      {displayStatus(milestone.status)}
                    </span>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-400">
                    {milestone.description || "No description provided."}
                  </p>

                  <div className="mt-3 border-t border-white/5 pt-3">
                    <p className="text-xs text-gray-500">
                      Milestone amount
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {milestone.amount ?? "—"}{" "}
                      <span className="text-indigo-400">
                        {escrow.token || "USDT"}
                      </span>
                    </p>

                    {milestone.dueDate && (
                      <p className="mt-2 text-xs text-gray-500">
                        Due: {formatDate(milestone.dueDate)}
                      </p>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-white/10 bg-[#0c101a] p-4 text-sm text-gray-500">
                No milestone details available.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-white/10 bg-[#0c101a]/60 px-5 py-4 sm:px-6">
        <Clock3 size={15} className="shrink-0 text-gray-500" />
        <p className="text-xs leading-5 text-gray-400">
          Review the agreement and escrow details before responding.
        </p>
      </div>

      {requestStatus === "PENDING" && (
        <div className="border-t border-white/10 bg-[#0c101a]/60 px-5 py-5 sm:px-6">
          {actionError && (
            <p
              role="alert"
              className="mb-4 break-words rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-400"
            >
              {actionError}
            </p>
          )}

          {actionMessage && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm leading-5 text-emerald-400"
            >
              {actionMessage}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void handleAction("accept")}
              disabled={actionInProgress}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading === "accept" ? (
                <LoaderCircle size={17} className="animate-spin" />
              ) : (
                <Check size={17} />
              )}
              {actionLoading === "accept"
                ? "Accepting..."
                : "Accept Agreement"}
            </button>

            <button
              type="button"
              onClick={() => void handleAction("reject")}
              disabled={actionInProgress}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/5 px-5 py-3 text-sm font-semibold text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading === "reject" ? (
                <LoaderCircle size={17} className="animate-spin" />
              ) : (
                <X size={17} />
              )}
              {actionLoading === "reject"
                ? "Rejecting..."
                : "Reject Agreement"}
            </button>
          </div>

          <p className="mt-3 text-center text-xs leading-5 text-gray-500">
            Backend state is updated after the blockchain transaction
            succeeds.
          </p>
        </div>
      )}
    </article>
  );
}

export default function PayeeRequestsPage() {
  const [requests, setRequests] = useState<RequestWithEscrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axiosInstance.get<ApiResponse>(
        REQUESTS_ENDPOINT,
      );

      if (!response.data.success) {
        throw new Error(
          response.data.message || "Failed to fetch payee requests.",
        );
      }

      // Backend data is PayeeRequest[], not Escrow[].
      const requestItems = response.data.data ?? [];
      console.log("Payee request API response:", requestItems);

      // Convert { request, agreement, escrow } into card data.
      const mappedRequests = mapRequestsToEscrows(requestItems);

      console.log("Mapped payee requests:", mappedRequests);

      setRequests(mappedRequests);
    } catch (err: unknown) {
      setError(
        getErrorMessage(
          err,
          "Unable to load payee requests. Please try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const pendingCount = requests.filter(
    ({ request }) => request.status.toUpperCase() === "PENDING",
  ).length;

  return (
    <main className="min-h-screen bg-[#080B14] px-4 pb-16 pt-28 text-white sm:px-8">
      <Navbar />

      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Payee Requests
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-gray-400">
              Review escrow invitations and inspect agreement documents
              before responding.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void fetchRequests()}
            disabled={loading}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-white/10 px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:border-indigo-400/30 hover:bg-white/5 hover:text-white disabled:opacity-50 sm:self-auto"
          >
            <RefreshCw
              size={16}
              className={loading ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 bg-[#101522] p-5">
            <p className="text-sm text-gray-400">Total requests</p>
            <p className="mt-2 text-3xl font-bold">
              {loading ? "—" : requests.length}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-500/10 bg-[#101522] p-5">
            <p className="text-sm text-gray-400">Awaiting response</p>
            <p className="mt-2 text-3xl font-bold text-amber-400">
              {loading ? "—" : pendingCount}
            </p>
          </div>
        </div>

        <section className="mt-8">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              Payee requests for your agreements
            </h2>

            {!loading && (
              <span className="text-xs text-gray-500">
                {requests.length}{" "}
                {requests.length === 1 ? "request" : "requests"}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#101522] px-6 py-16 text-center">
              <LoaderCircle
                size={30}
                className="animate-spin text-indigo-400"
              />
              <p className="mt-4 text-sm font-medium text-gray-300">
                Loading payee requests...
              </p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/20 bg-[#101522] p-6 text-center">
              <p className="text-sm text-red-400">{error}</p>
              <button
                type="button"
                onClick={() => void fetchRequests()}
                className="mt-4 rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
              >
                Try again
              </button>
            </div>
          ) : requests.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#101522] px-6 py-16 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-400/10 bg-indigo-500/10 text-indigo-400">
                <Inbox size={26} />
              </div>

              <h3 className="mt-5 text-lg font-semibold">
                No payee requests yet
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-gray-400">
                When someone submits a payee request for one of your
                agreements, it will appear here.
              </p>

              <Link
                href="/deals"
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-[#080B14] hover:bg-white/90"
              >
                View agreements
                <ArrowUpRight size={16} />
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              {requests.map(({ escrow, request }) => (
                <RequestCard
                  key={request._id}
                  escrow={escrow}
                  request={request}
                  onActionComplete={fetchRequests}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
