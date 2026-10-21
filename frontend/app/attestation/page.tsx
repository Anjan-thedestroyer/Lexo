
"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import axiosInstance from "@/lib/axios";
import { useRegisterIdentityAttestation } from "../../hooks/useRegisterIdentityAttestation";

type Attestation = {
  wallet: `0x${string}`;
  identityHash: `0x${string}`;
  nonce: string | number;
  deadline: string | number;
  signature: `0x${string}`;
};

export default function AttestationPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();
  const { switchChainAsync } = useSwitchChain();

  const {
    registerIdentity,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error: transactionError,
  } = useRegisterIdentityAttestation();

  const [attestation, setAttestation] =
    useState<Attestation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const loadAttestation = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axiosInstance.get(
        "/verification/status"
      );

const data =
  response.data?.data?.attestation ??
  response.data?.data;
      const item: Attestation = {
        wallet: data.attestationWallet ?? data.wallet,
        identityHash:
            data.attestationIdentityHash ?? data.identityHash,
        nonce: data.attestationNonce ?? data.nonce,
        deadline: data.attestationDeadline ?? data.deadline,
        signature:
            data.attestationSignature ?? data.signature,
        };

      console.log("Attestation data:", item, data);

      if (
        !item.wallet ||
        !item.identityHash ||
        item.nonce == null ||
        item.deadline == null ||
        !item.signature
      ) {
        throw new Error(
          "No complete attestation was returned by the backend."
        );
      }

      if (
        data.status &&
        !["VERIFIED", "APPROVED"].includes(data.status)
      ) {
        throw new Error(
          `Identity verification is ${data.status}.`
        );
      }

    //   if (BigInt(item.deadline) <= BigInt(
    //     Math.floor(Date.now() / 1000)
    //   )) {
    //     throw new Error(
    //       "Your attestation has expired. Request a new one."
    //     );
    //   }

      setAttestation(item);
    } catch (err: any) {
      setAttestation(null);
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "Unable to load your attestation."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAttestation();
  }, [loadAttestation]);

  const handleRegister = async () => {
    if (!attestation) return;

    setError("");
    setTxHash("");

    try {
      if (!isConnected) {
        connect({ connector: injected() });
        return;
      }

      if (chainId !== 11155111) {
        await switchChainAsync({ chainId: 11155111 });
      }

      const hash = await registerIdentity(attestation);
      setTxHash(hash);
    } catch (err: any) {
      setError(
        err?.shortMessage ||
          err?.message ||
          "Transaction could not be submitted."
      );
    }
  };

  return (
    <main className="min-h-screen bg-[#080B14] px-5 pb-20 pt-32 text-white">
      <section className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-9">
        <p className="text-sm font-medium text-white/50">
          LEXO · IDENTITY
        </p>

        <h1 className="mt-3 text-3xl font-bold">
          Identity Attestation
        </h1>

        <p className="mt-3 text-white/60">
          Retrieve your approved attestation and register your
          identity on-chain
        </p>

        {loading ? (
          <p className="mt-8 text-white/60">
            Checking your attestation...
          </p>
        ) : error && !attestation ? (
          <div className="mt-8">
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={() => void loadAttestation()}
              className="mt-4 rounded-lg border border-white/20 px-4 py-2"
            >
              Retry
            </button>
          </div>
        ) : attestation ? (
          <>
            <div className="mt-8 space-y-4 rounded-xl border border-white/10 p-4">
              <Info label="Attested wallet" value={attestation.wallet} />
              <Info
                label="Identity hash"
                value={`${attestation.identityHash.slice(0, 12)}...${attestation.identityHash.slice(-8)}`}
              />
              <Info label="Nonce" value={String(attestation.nonce)} />
              <Info
                label="Expires"
                value={new Date(
                  Number(attestation.deadline) * 1000
                ).toLocaleString()}
              />
              <Info label="Network" value="Ethereum Sepolia" />
            </div>

            {isSuccess && (
              <p className="mt-5 text-green-300">
                Transaction confirmed. Verify the registered state
                on-chain before considering registration complete.
              </p>
            )}

            {(error || transactionError) && (
              <p className="mt-5 break-words text-sm text-red-300">
                {error || transactionError?.message}
              </p>
            )}

            {txHash && (
              <p className="mt-4 break-all text-sm text-white/60">
                Transaction: {txHash}
              </p>
            )}

            <button
              onClick={handleRegister}
              disabled={
                isPending ||
                isConfirming ||
                isSuccess
              }
              className="mt-7 w-full rounded-xl bg-white px-5 py-3 font-semibold text-[#080B14] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {!isConnected
                ? isConnecting
                  ? "Connecting MetaMask..."
                  : "Connect MetaMask"
                : isPending
                  ? "Confirm in MetaMask..."
                  : isConfirming
                    ? "Waiting for confirmation..."
                    : isSuccess
                      ? "Transaction Confirmed"
                      : "Register on Blockchain"}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-white/40">
        {label}
      </p>
      <p className="mt-1 break-all text-sm text-white/90">
        {value}
      </p>
    </div>
  );
}
