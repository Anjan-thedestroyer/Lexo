"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import axiosInstance from "@/lib/axios";
import EscrowCard from "@/component/EscrowCard";
import Navbar from "@/component/Navbar";
import type { Escrow as CardEscrow } from "@/component/escrow";
import { useBackgroundImage } from "@/hooks/background";

type ApiUser = {
  _id: string;
  name?: string;
  email?: string;
};

type ApiMilestone = {
  _id?: string;
  title?: string;
  description?: string;
  amount: string | number;
  status?: string;
  dueDate?: string | null;
};

type ApiAgreement = {
  _id: string;
  title?: string;
  contentLink?: string | null;
  payerContentLink?: string | null;
  payeeContentLink?: string | null;
  status?: string;
};

type ApiEscrow = {
  _id: string;
  dealId: number;
  totalAmount: string | number;
  token?: string;
  status: string;
  payer?: ApiUser | string | null;
  payee?: ApiUser | string | null;
  milestones?: ApiMilestone[];
  agreement?: ApiAgreement | string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ApiResponse = {
  success?: boolean;
  message?: string;
  data?: ApiEscrow[] | { escrows?: ApiEscrow[] };
  escrows?: ApiEscrow[];
};

function getUserLabel(user?: ApiUser | string | null): string {
  if (!user) return "Not assigned";
  if (typeof user === "string") return user;

  return user.name || user.email || user._id || "Unknown";
}

function mapActiveEscrow(item: ApiEscrow): CardEscrow {
  const agreement =
    item.agreement && typeof item.agreement !== "string"
      ? item.agreement
      : null;

  const milestones = (item.milestones ?? []).map((milestone) => ({
    title: milestone.title,
    description: milestone.description,
    amount: String(milestone.amount ?? "0"),
    status: milestone.status,
    dueDate: milestone.dueDate,
  }));

  // Preserve support for both the previous and current document-link fields.
  const payerDocumentUrl =
    agreement?.payerContentLink || agreement?.contentLink || null;

  const payeeDocumentUrl = agreement?.payeeContentLink || null;

  return {
    id: item._id,
    dealId: item.dealId,
    title:
      agreement?.title ||
      milestones[0]?.title ||
      `Escrow #${item.dealId}`,
    counterparty: getUserLabel(item.payee),
    amount: String(item.totalAmount ?? "0"),
    token: item.token || "USDT",
    status: item.status,
    milestones,
    milestoneCount: milestones.length,
    createdAt: item.createdAt,
    payerDocumentUrl,
    payeeDocumentUrl,
    documentUrl: payerDocumentUrl,
  };
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = error.response;

    if (
      typeof response === "object" &&
      response !== null &&
      "data" in response
    ) {
      const data = response.data;

      if (
        typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        return data.message;
      }
    }
  }

  return "Failed to load active agreements.";
}

export default function ActiveEscrowsPage() {
  const router = useRouter();

  const [escrows, setEscrows] = useState<CardEscrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useBackgroundImage();


  const fetchActiveEscrows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response =
        await axiosInstance.get<ApiResponse>("/escrow/active");

      const payload = response.data;

      const list: ApiEscrow[] = Array.isArray(payload.data)
        ? payload.data
        : payload.data?.escrows ?? payload.escrows ?? [];

      setEscrows(list.map(mapActiveEscrow));
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchActiveEscrows();
  }, [fetchActiveEscrows]);

  const handleProposeAgreement = (escrow: CardEscrow) => {
    router.push(`/escrow/${escrow.id}`);
  };

  return (
    <main className="min-h-screen bg-transparent px-4 py-8 text-white sm:px-6 lg:px-10">
      <Navbar />

      <div className="mx-auto mt-20 max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Active Agreements
            </h1>

            <p className="mt-2 text-sm text-gray-400">
              Browse escrow agreements, view available documents, and propose
              your agreement.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void fetchActiveEscrows()}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {/* Loading */}
        {loading && escrows.length === 0 && (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-64 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]"
              />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6">
            <p className="text-sm text-red-300">{error}</p>

            <button
              type="button"
              onClick={() => void fetchActiveEscrows()}
              className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && escrows.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
            <h2 className="text-lg font-semibold">No active agreements</h2>

            <p className="mt-2 text-sm text-gray-400">
              There are currently no available escrows to propose an agreement
              for.
            </p>
          </div>
        )}

        {/* Escrow cards */}
        {!error && escrows.length > 0 && (
          <>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm text-gray-400">
                {escrows.length}{" "}
                {escrows.length === 1 ? "agreement" : "agreements"}
              </p>

              {loading && (
                <span className="text-xs text-gray-500">Updating...</span>
              )}
            </div>

            <div className="grid items-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {escrows.map((escrow) => (
                <div key={escrow.id} className="flex flex-col gap-3">
                  <EscrowCard escrow={escrow} />

                  <button
                    type="button"
                    onClick={() => handleProposeAgreement(escrow)}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-[#080B14]"
                  >
                    Propose Agreement
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}