
"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useApproveMilestone } from "@/hooks/useApproveMilestone";

export default function ApproveMilestone() {
  const [dealId, setDealId] = useState("");
  const { isConnected } = useAccount();

  const {
    approveMilestone,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  } = useApproveMilestone();

  const handleSubmit = async () => {
    await approveMilestone(dealId);
  };

  return (
    <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#080B14] p-5">
      <h2 className="text-lg font-semibold text-white">
        Approve Milestone
      </h2>

      <p className="mt-1 text-sm text-gray-400">
        Enter the deal ID to approve and release its current milestone.
      </p>

      <form
        className="mt-5 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 focus-within:border-blue-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="shrink-0 text-gray-400"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>

          <input
            type="text"
            inputMode="numeric"
            value={dealId}
            onChange={(event) => setDealId(event.target.value)}
            placeholder="Enter deal ID"
            className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-gray-500"
          />
        </div>

        <button
          type="submit"
          disabled={
            !isConnected ||
            !dealId.trim() ||
            isPending ||
            isConfirming
          }
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending
            ? "Confirm in wallet..."
            : isConfirming
              ? "Processing..."
              : "Approve Milestone"}
        </button>
      </form>

      {!isConnected && (
        <p className="mt-3 text-sm text-amber-400">
          Connect your wallet first.
        </p>
      )}

      {error && (
        <p className="mt-3 break-words text-sm text-red-400">
          {error}
        </p>
      )}

      {isSuccess && (
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
          <p className="text-sm font-medium text-emerald-400">
            Milestone approval confirmed!
          </p>

          {hash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-emerald-300 underline"
            >
              View transaction
            </a>
          )}
        </div>
      )}
    </div>
  );
}
