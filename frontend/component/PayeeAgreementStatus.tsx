
"use client";

import { usePayeeAgreementSigning } from "@/hooks/usePayeeAgreementSigning";

export default function PayeeAgreementStatus({
  dealId,
}: {
  dealId: bigint;
}) {
  const {
    documentA,
    documentB,
    bothSigned,
    isSelectedPayee,
    canSign,
    checking,
    signing,
    error,
    success,
    refreshStatus,
    signAsPayee,
  } = usePayeeAgreementSigning({ dealId });

  if (checking && !documentA && !documentB) {
    return (
      <p className="text-sm text-gray-400">
        Checking agreement signatures...
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-[#0c101a] p-4">
      <h4 className="text-sm font-semibold text-white">
        Agreement signing status
      </h4>

      <div className="space-y-2 text-sm">
        <p className="text-gray-300">
          Payer agreement:{" "}
          {!documentA?.exists
            ? "Not registered"
            : documentA.payeeSigned
              ? "Payee signed"
              : "Payee signature pending"}
        </p>

        <p className="text-gray-300">
          Payee agreement:{" "}
          {!documentB?.exists
            ? "Awaiting payer acceptance"
            : documentB.payeeSigned
              ? "Payee signed"
              : "Payee signature pending"}
        </p>

        {bothSigned && (
          <p className="font-medium text-emerald-400">
            Both parties have signed both documents.
          </p>
        )}
      </div>

      {!bothSigned && isSelectedPayee && canSign && (
        <button
          type="button"
          onClick={() => void signAsPayee()}
          disabled={signing || checking}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {signing ? "Signing..." : "Sign agreement as payee"}
        </button>
      )}

      {!bothSigned && !isSelectedPayee && (
        <p className="text-xs leading-5 text-gray-500">
          The signing action is available to the selected payee after the
          payer accepts the payee.
        </p>
      )}

      {error && (
        <p className="break-words text-xs text-red-400">{error}</p>
      )}

      {success && (
        <p className="text-xs text-emerald-400">{success}</p>
      )}

      <button
        type="button"
        onClick={() => void refreshStatus()}
        disabled={checking || signing}
        className="text-xs text-gray-400 underline hover:text-white disabled:opacity-50"
      >
        Refresh status
      </button>
    </div>
  );
}
