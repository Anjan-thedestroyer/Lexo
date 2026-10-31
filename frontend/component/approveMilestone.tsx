
"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import axios from "axios";

import axiosInstance from "@/lib/axios";
import { useApproveMilestone } from "@/hooks/useApproveMilestone";

export default function ApproveMilestone() {
  const [dealId, setDealId] = useState("");
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendMessage, setBackendMessage] = useState("");
  const [backendError, setBackendError] = useState("");

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
    setBackendMessage("");
    setBackendError("");

    try {
      await approveMilestone(dealId);
    } catch (err) {
      console.error("Milestone approval failed:", err);
    }
  };

  // Update the backend only after blockchain confirmation.
  const handleBackendUpdate = async () => {
    if (!hash || !dealId.trim() || backendLoading) return;

    setBackendLoading(true);
    setBackendError("");
    setBackendMessage("");

    try {
      const response = await axiosInstance.post("/escrow/approve-milestone", {
        dealId: Number(dealId),
        txHash: hash,
      });

      if (!response.data?.success) {
        throw new Error(
          response.data?.message ||
            "Blockchain approval succeeded, but backend update failed.",
        );
      }

      setBackendMessage(
        response.data.message || "Milestone updated successfully.",
      );
    } catch (err: unknown) {
      console.error("Backend milestone update failed:", err);

      if (axios.isAxiosError(err)) {
        setBackendError(
          err.response?.data?.message ||
            err.message ||
            "Failed to update milestone in the backend.",
        );
      } else {
        setBackendError(
          err instanceof Error
            ? err.message
            : "Failed to update milestone in the backend.",
        );
      }
    } finally {
      setBackendLoading(false);
    }
  };

  // Run the backend update once the on-chain transaction succeeds.
  // The backend update is deliberately separate from the wallet transaction.
  const [updatedHash, setUpdatedHash] = useState("");

  if (isSuccess && hash && updatedHash !== hash && !backendLoading) {
    setUpdatedHash(hash);
    void handleBackendUpdate();
  }

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
            onChange={(event) => {
              setDealId(event.target.value);
              setBackendMessage("");
              setBackendError("");
              setUpdatedHash("");
            }}
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
            isConfirming ||
            backendLoading
          }
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending
            ? "Confirm in wallet..."
            : isConfirming
              ? "Processing..."
              : backendLoading
                ? "Updating backend..."
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
          {error.message}
        </p>
      )}

      {isSuccess && (
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
          <p className="text-sm font-medium text-emerald-400">
            Milestone approval confirmed on-chain!
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

          {backendLoading && (
            <p className="mt-3 text-sm text-amber-300">
              Updating milestone in the database...
            </p>
          )}

          {backendMessage && (
            <p className="mt-3 text-sm text-emerald-300">
              {backendMessage}
            </p>
          )}

          {backendError && (
            <div className="mt-3">
              <p className="text-sm text-red-400">
                {backendError}
              </p>

              <button
                type="button"
                onClick={() => void handleBackendUpdate()}
                disabled={backendLoading}
                className="mt-2 rounded-lg border border-red-400/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                Retry backend update
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
