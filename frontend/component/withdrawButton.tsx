
"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useWithdraw } from "../hooks/withdraw";

const TOKEN_DECIMALS = 6;
const WITHDRAWAL_FEE_BPS = 30;
const BPS_DENOMINATOR = 10000n;

export default function Withdraw() {
  const {
    pendingBalance: rawPendingBalance,
    formattedPendingBalance,
    withdraw,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    isLoadingBalance,
    balanceError,
    error,
    refetch,
  } = useWithdraw();

  const [withdrawError, setWithdrawError] = useState("");

  // Explicit bigint conversion to prevent TypeScript arithmetic errors
  const pendingBalance: bigint =
    typeof rawPendingBalance === "bigint"
      ? rawPendingBalance
      : 0n;

      

  // Fee calculations
  const fee =
    (pendingBalance * BigInt(WITHDRAWAL_FEE_BPS)) /
    BPS_DENOMINATOR;

  const estimatedReceived = pendingBalance - fee;

  const formattedFee = formatUnits(fee, TOKEN_DECIMALS);
  const formattedReceived = formatUnits(
    estimatedReceived,
    TOKEN_DECIMALS
  );

  const isBusy = isPending || isConfirming;

  const formatAmount = (amount: string) =>
    Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });

  const handleWithdraw = async () => {
    setWithdrawError("");

    try {
      await withdraw();
    } catch (err) {
      setWithdrawError(
        err instanceof Error
          ? err.message
          : "Withdrawal failed."
      );
    }
  };

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-[#0D111C] px-6 py-5 shadow-xl">

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Withdraw Funds
          </h2>
          <p className="text-sm text-gray-400">
            Claim your available escrow earnings.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoadingBalance}
          className="text-sm text-blue-400 transition hover:text-blue-300 disabled:opacity-50"
        >
          {isLoadingBalance ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {/* Horizontal content */}
      <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[1.2fr_1fr_1fr_auto]">

        {/* Available balance */}
        <div className="rounded-xl border border-white/10 bg-[#080B14] px-5 py-4">
          <p className="text-xs text-gray-400">
            Available to withdraw
          </p>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">
              {isLoadingBalance
                ? "Loading..."
                : formatAmount(formattedPendingBalance)}
            </span>

            <span className="text-sm font-medium text-green-400">
              USDT
            </span>
          </div>
        </div>

        {/* Withdrawal fee */}
        <div>
          <p className="text-xs text-gray-400">
            Protocol fee (0.3%)
          </p>

          <p className="mt-2 text-lg font-semibold text-red-400">
            -{formatAmount(formattedFee)} USDT
          </p>
        </div>

        {/* Estimated received */}
        <div>
          <p className="text-xs text-gray-400">
            You receive
          </p>

          <p className="mt-2 text-lg font-semibold text-green-400">
            {formatAmount(formattedReceived)} USDT
          </p>
        </div>

        {/* Withdraw button */}
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={
            isBusy ||
            isLoadingBalance ||
            pendingBalance === 0n ||
            Boolean(balanceError)
          }
          className="w-full whitespace-nowrap rounded-xl bg-blue-600 px-7 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40 lg:w-auto"
        >
          {isPending
            ? "Confirm in Wallet..."
            : isConfirming
              ? "Processing..."
              : pendingBalance === 0n
                ? "No Funds"
                : "Withdraw USDT"}
        </button>
      </div>

      {/* Error */}
      {(withdrawError || error || balanceError) && (
        <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
          {withdrawError ||
            error?.message ||
            "Unable to load your withdrawal balance."}
        </div>
      )}

      {/* Transaction */}
      {hash && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#080B14] px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-400">
              Transaction Hash
            </p>
            <p className="mt-1 truncate text-xs text-gray-300">
              {hash}
            </p>
          </div>

          <a
            href={`https://sepolia.etherscan.io/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap text-xs text-blue-400 hover:underline"
          >
            View on Etherscan ↗
          </a>
        </div>
      )}

      {/* Success */}
      {isSuccess && (
        <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          Withdrawal successful! Your pending balance has been refreshed.
        </div>
      )}
    </div>
  );
}
