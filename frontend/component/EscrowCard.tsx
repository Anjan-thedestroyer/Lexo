
"use client";

import { useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  FileText,
  Layers3,
  Wallet,
} from "lucide-react";

import type { Escrow } from "./escrow";

const statusStyles: Record<string, string> = {
  PENDING: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  CREATED: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  ACTIVE: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  FUNDED: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  IN_PROGRESS: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  COMPLETED: "border-blue-500/20 bg-blue-500/10 text-blue-400",
  CANCELLED: "border-red-500/20 bg-red-500/10 text-red-400",
  DISPUTED: "border-orange-500/20 bg-orange-500/10 text-orange-400",
  REFUNDED: "border-purple-500/20 bg-purple-500/10 text-purple-400",
  SUBMITTED: "border-sky-500/20 bg-sky-500/10 text-sky-400",
  APPROVED: "border-indigo-500/20 bg-indigo-500/10 text-indigo-400",
  RELEASED: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
};

function formatDate(date?: string | null) {
  if (!date) return "Not set";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return "Not set";

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function hasCounterparty(counterparty?: string) {
  return Boolean(
    counterparty &&
      counterparty !== "Not assigned" &&
      counterparty !== "Unknown",
  );
}

export default function EscrowCard({
  escrow,
}: {
  escrow: Escrow;
}) {
  const [expanded, setExpanded] = useState(false);

  const status = (escrow.status || "PENDING").toUpperCase();

  const statusClass =
    statusStyles[status] ??
    "border-white/10 bg-white/5 text-gray-400";

  const milestones = escrow.milestones ?? [];

  const counterpartyExists = hasCounterparty(escrow.counterparty);

  const payerDocument =
    escrow.payerDocumentUrl || escrow.documentUrl || null;

  const payeeDocument = escrow.payeeDocumentUrl || null;

  const showPayeeDocument =
    counterpartyExists && Boolean(payeeDocument);

  return (
    <article className="rounded-2xl border border-white/10 bg-[#101522] p-5 transition duration-200 hover:border-indigo-400/30 hover:bg-[#121827] sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-400/10 bg-indigo-500/10 text-indigo-400">
            <Wallet size={21} />
          </div>

          <div className="min-w-0">
            <h3 className="break-words font-semibold text-white">
              {escrow.title}
            </h3>

            <p className="mt-1 text-xs text-gray-500">
              Escrow #{escrow.dealId ?? escrow.id.slice(-8)}
            </p>
          </div>
        </div>

        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${statusClass}`}
        >
          {status.replaceAll("_", " ")}
        </span>
      </div>

      {/* Amount */}
      <div className="mt-6 rounded-xl border border-white/5 bg-[#0c101a] p-4">
        <p className="text-xs font-medium text-gray-500">
          Total escrow amount
        </p>

        <p className="mt-2 break-words text-2xl font-bold tracking-tight text-white">
          {escrow.amount}
          <span className="ml-2 text-sm font-medium text-indigo-400">
            {escrow.token}
          </span>
        </p>
      </div>

      {/* Details */}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-gray-500">
            <Layers3 size={15} />
            <span className="text-xs">Milestones</span>
          </div>

          <p className="mt-2 text-sm font-medium text-gray-200">
            {milestones.length || escrow.milestoneCount || 0}
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 text-gray-500">
            <CalendarDays size={15} />
            <span className="text-xs">Created</span>
          </div>

          <p className="mt-2 text-sm font-medium text-gray-200">
            {formatDate(escrow.createdAt)}
          </p>
        </div>
      </div>

      {/* Milestones */}
      <button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        aria-expanded={expanded}
        className="mt-5 flex w-full items-center justify-between border-t border-white/10 pt-4 text-sm font-medium text-gray-300 transition hover:text-white"
      >
        <span>
          {expanded ? "Hide milestones" : "View milestones"}
        </span>

        <ChevronDown
          size={18}
          className={`transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {milestones.length > 0 ? (
            milestones.map((milestone, index) => {
              const milestoneStatus = (
                milestone.status || "PENDING"
              ).toUpperCase();

              return (
                <div
                  key={`${escrow.id}-milestone-${index}`}
                  className="rounded-xl border border-white/10 bg-[#0c101a] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">
                        Milestone {index + 1}
                      </p>

                      <h4 className="mt-1 break-words text-sm font-semibold text-white">
                        {milestone.title || `Milestone ${index + 1}`}
                      </h4>
                    </div>

                    <span
                      className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${
                        statusStyles[milestoneStatus] ??
                        "border-white/10 bg-white/5 text-gray-400"
                      }`}
                    >
                      {milestoneStatus.replaceAll("_", " ")}
                    </span>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-400">
                    {milestone.description?.trim() ||
                      "No description provided."}
                  </p>

                  <div className="mt-4 border-t border-white/5 pt-3">
                    <p className="text-xs text-gray-500">
                      Milestone amount
                    </p>

                    <p className="mt-1 text-sm font-semibold text-white">
                      {milestone.amount}{" "}
                      <span className="text-indigo-400">
                        {escrow.token}
                      </span>
                    </p>

                    {milestone.dueDate && (
                      <p className="mt-2 text-xs text-gray-400">
                        Due: {formatDate(milestone.dueDate)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="rounded-xl border border-white/10 bg-[#0c101a] p-4 text-sm text-gray-500">
              No milestone details available.
            </p>
          )}
        </div>
      )}

      {/* Counterparty */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-xs text-gray-500">Counterparty</p>

        <p className="mt-1 break-all text-sm font-medium text-gray-300">
          {escrow.counterparty || "Not assigned"}
        </p>

        {escrow.counterpartyEmail && (
          <a
            href={`mailto:${escrow.counterpartyEmail}`}
            className="mt-1 block break-all text-sm text-indigo-400 transition hover:text-indigo-300"
          >
            {escrow.counterpartyEmail}
          </a>
        )}
      </div>

      {/* Agreement documents */}
      <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
        <p className="text-xs font-medium text-gray-500">
          Agreement Documents
        </p>

        {payerDocument && (
          <a
            href={payerDocument}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-300 transition hover:text-blue-200"
          >
            <FileText size={16} />
            View Payer Agreement
          </a>
        )}

        {showPayeeDocument && (
          <a
            href={payeeDocument!}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-300 transition hover:text-blue-200"
          >
            <FileText size={16} />
            View Payee Agreement
          </a>
        )}

        {!payerDocument && !showPayeeDocument && (
          <p className="text-xs text-gray-600">
            No agreement documents available.
          </p>
        )}

        {counterpartyExists && payerDocument && !payeeDocument && (
          <p className="text-xs text-gray-500">
            The payee agreement document is not available yet.
          </p>
        )}
      </div>
    </article>
  );
}
