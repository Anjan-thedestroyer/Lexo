"use client";

import { useEffect, useState } from "react";

import InvitedEscrows from "@/component/InviteEscrow";
import CreateEscrow from "@/component/CreateEscrow";
import MyEscrows from "@/component/MyEscrows";
import ParticipatedEscrows from "@/component/ParticipatedEscrows";
import type { Escrow } from "@/component/escrow";
import Navbar from "@/component/Navbar";
import axiosInstance from "@/lib/axios";
import ApproveMilestone from "@/component/approveMilestone";
import Withdraw from "@/component/withdrawButton";

type ApiUser = {
  _id?: string;
  name?: string;
  email?: string;
  address?: string;
};

type ApiMilestone = {
  _id?: string;
  title?: string;
  description?: string;
  amount?: string | number;
  status?: string;
  dueDate?: string | null;
};

type ApiAgreement = {
  _id?: string;
  dealId?: string;
  title?: string;
  contentLink?: string | null;
  payerContentLink?: string | null;
  payeeContentLink?: string | null;
  status?: string;
};

type ApiEscrow = {
  _id: string;
  dealId?: number | string;
  payer?: ApiUser | string | null;
  payee?: ApiUser | string | null;
  totalAmount?: string | number;
  token?: string;
  status?: string;
  milestones?: ApiMilestone[];
  agreement?: ApiAgreement | string | null;
  createdAt?: string;
};

type ApiResponse = {
  success: boolean;
  data: ApiEscrow[];
  message?: string;
};

function getUserLabel(user?: ApiUser | string | null): string {
  if (!user) return "Not assigned";
  if (typeof user === "string") return user;

  return user.name || user.email || user.address || user._id || "Unknown";
}

function getEscrowStatus(status?: string): string {
  switch (status?.toUpperCase()) {
    case "CREATED":
      return "PENDING";
    case "FUNDED":
    case "BOTH_SIGNED":
    case "IN_PROGRESS":
      return "ACTIVE";
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return status || "PENDING";
  }
}


function mapEscrow(
  item: ApiEscrow,
  role: "payer" | "payee" | "invited",
): Escrow {
  const agreement =
    item.agreement && typeof item.agreement !== "string"
      ? item.agreement
      : null;

  const counterpartyUser =
    role === "payer" ? item.payee : item.payer;

  const counterparty = getUserLabel(counterpartyUser);

  const counterpartyEmail =
    counterpartyUser && typeof counterpartyUser !== "string"
      ? counterpartyUser.email || null
      : null;

  const milestones = (item.milestones ?? []).map((milestone) => ({
    title: milestone.title,
    description: milestone.description,
    amount: String(milestone.amount ?? "0"),
    status: milestone.status,
    dueDate: milestone.dueDate,
  }));

  const payerDocumentUrl =
    agreement?.payerContentLink || agreement?.contentLink || null;

  const payeeDocumentUrl = agreement?.payeeContentLink || null;

  return {
    id: item._id,
    dealId: item.dealId,
    title:
      agreement?.title ||
      milestones[0]?.title ||
      `Escrow #${item.dealId ?? item._id.slice(-6)}`,
    counterparty,
    counterpartyEmail,
    amount: String(item.totalAmount ?? "0"),
    token: item.token || "USDT",
    status: getEscrowStatus(item.status),
    milestones,
    milestoneCount: milestones.length,
    createdAt: item.createdAt,
    payerDocumentUrl,
    payeeDocumentUrl,
    documentUrl: payerDocumentUrl,
  };
}


export default function DealsPage() {
  const [myEscrows, setMyEscrows] = useState<Escrow[]>([]);
  const [participatedEscrows, setParticipatedEscrows] = useState<Escrow[]>([]);
  const [invitedEscrows, setInvitedEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchEscrows() {
      setLoading(true);
      setError("");

      try {
        const [payerResponse, payeeResponse, invitedResponse] =
          await Promise.all([
            axiosInstance.get<ApiResponse>("/agreement/created"),
            axiosInstance.get<ApiResponse>("/agreement/payee"),
            axiosInstance.get<ApiResponse>("/agreement/invited"),
          ]);

        if (cancelled) return;

        setMyEscrows(
          (payerResponse.data.data ?? []).map((item) =>
            mapEscrow(item, "payer"),
          ),
        );

        setParticipatedEscrows(
          (payeeResponse.data.data ?? []).map((item) =>
            mapEscrow(item, "payee"),
          ),
        );

        setInvitedEscrows(
          (invitedResponse.data.data ?? []).map((item) =>
            mapEscrow(item, "invited"),
          ),
        );
      } catch (err: unknown) {
        if (cancelled) return;

        const message =
          typeof err === "object" && err !== null && "response" in err
            ? (
                err as {
                  response?: { data?: { message?: string } };
                }
              ).response?.data?.message
            : undefined;

        setError(message || "Failed to load your escrows. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchEscrows();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#080B14] px-1 py-8 text-white md:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl space-y-10">
        <Navbar />

        <header>
          <br />
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Deals</h1>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            Create agreements and manage your escrow activity in one place.
          </p>
        </header>

        <CreateEscrow />

        {loading && (
          <p className="text-sm text-gray-400">Loading your escrows...</p>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 text-sm text-white underline"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            <Withdraw/>
            <ApproveMilestone />
            <MyEscrows escrows={myEscrows} />
            <ParticipatedEscrows escrows={participatedEscrows} />
            <InvitedEscrows escrows={invitedEscrows} />
          </>
        )}
      </div>
    </main>
  );
}