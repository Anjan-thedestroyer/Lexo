"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { useRouter } from "next/navigation";
import { injected } from "wagmi/connectors";

import axiosInstance from "@/lib/axios";
import { useRegisterIdentityAttestation } from "../../hooks/useRegisterIdentityAttestation";
import Navbar from "@/component/Navbar";

type Attestation = {
  wallet: `0x${string}`;
  identityHash: `0x${string}`;
  nonce: string | number;
  deadline: string | number;
  signature: `0x${string}`;
};

const SEPOLIA_CHAIN_ID = 11155111;

export default function AttestationPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const {
    registerIdentity,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error: transactionError,
  } = useRegisterIdentityAttestation();
    const router = useRouter();
  
  const [attestation, setAttestation] =
    useState<Attestation | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const isBusy =
    loading || requesting || isPending || isConfirming;

  const shortAddress = (value?: string) =>
    value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not connected";

  const loadAttestation = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axiosInstance.get("/verification/status");

      const responseData = response.data?.data;
      const data = responseData?.attestation ?? responseData;

      if (!data || typeof data !== "object") {
        throw new Error("No verification data was returned by the server.");
      }

      const item: Attestation = {
        wallet: data.attestationWallet ?? data.wallet,
        identityHash: data.attestationIdentityHash ?? data.identityHash,
        nonce: data.attestationNonce ?? data.nonce,
        deadline: data.attestationDeadline ?? data.deadline,
        signature: data.attestationSignature ?? data.signature,
      };

      if (
        !item.wallet ||
        !item.identityHash ||
        item.nonce == null ||
        item.deadline == null ||
        !item.signature
      ) {
        throw new Error(
          "No complete attestation was returned. Request a fresh attestation."
        );
      }

      if (
        !/^0x[a-fA-F0-9]{40}$/.test(item.wallet) ||
        !/^0x[a-fA-F0-9]{64}$/.test(item.identityHash) ||
        !/^0x[a-fA-F0-9]+$/.test(item.signature)
      ) {
        throw new Error("The server returned invalid attestation data.");
      }

      if (
        !/^\d+$/.test(String(item.nonce)) ||
        !/^\d+$/.test(String(item.deadline))
      ) {
        throw new Error("The attestation nonce or deadline is invalid.");
      }

      if (
        data.status &&
        !["VERIFIED", "APPROVED"].includes(data.status)
      ) {
        throw new Error(`Identity verification is ${data.status}.`);
      }

      if (
        BigInt(item.deadline) <=
        BigInt(Math.floor(Date.now() / 1000))
      ) {
        throw new Error(
          "Your attestation has expired. Request a fresh attestation."
        );
      }

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

  // Reload when the wallet connection or selected account changes.
  useEffect(() => {
    setAttestation(null);
    setTxHash("");
    setError("");
    console.log(address)
    if (isConnected && address) {
      void loadAttestation();
    } else {
      setLoading(false);
    }
  }, [address, isConnected, loadAttestation]);

  const handleConnectWallet = async () => {
    setError("");

    try {
      await connect({ connector: injected() });
    } catch (err: any) {
      setError(
        err?.shortMessage ||
          err?.message ||
          "Unable to connect your wallet."
      );
    }
  };

  const handleChangeWallet = async () => {
    setError("");
    setAttestation(null);
    setTxHash("");

    try {
      // Disconnect first so the user can reconnect a different account.
      disconnect();
      await connect({ connector: injected() });
    } catch (err: any) {
      setError(
        err?.shortMessage ||
          err?.message ||
          "Unable to change wallet. Select the desired account in MetaMask and reconnect."
      );
    }
  };

  const requestFreshAttestation = async () => {
    setError("");
    setAttestation(null);
    setTxHash("");

    if (!isConnected || !address) {
      setError("Connect a wallet before requesting an attestation.");
      return;
    }

    setRequesting(true);

    try {
      if (chainId !== SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: SEPOLIA_CHAIN_ID });
      }

      // The backend must verify that this address is authorized for
      // the authenticated user's identity before signing an attestation.
      await axiosInstance.post("/verification/re-request", {
        rootWalletAddress: address,
      });

      await loadAttestation();
    } catch (err: any) {
      setAttestation(null);
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "Unable to request a fresh attestation."
      );
    } finally {
      setRequesting(false);
    }
  };

  const handleRegister = async () => {
    setError("");
    setTxHash("");

    if (!isConnected || !address) {
      setError("Connect the wallet associated with this attestation.");
      return;
    }

    if (!attestation) {
      setError("No valid attestation is available.");
      return;
    }

    if (address.toLowerCase() !== attestation.wallet.toLowerCase()) {
      setError(
        "The connected wallet does not match the attested wallet. Connect the correct account or request an attestation for an authorized wallet."
      );
      return;
    }

    if (
      BigInt(attestation.deadline) <=
      BigInt(Math.floor(Date.now() / 1000))
    ) {
      setAttestation(null);
      setError("Your attestation has expired. Request a fresh attestation.");
      return;
    }

    try {
      if (chainId !== SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: SEPOLIA_CHAIN_ID });
      }

      const submittedHash = await registerIdentity(attestation);
      setTxHash(submittedHash);
      router.push("/");
    } catch (err: any) {
      setError(
        err?.shortMessage ||
          err?.message ||
          "Transaction could not be submitted."
      );
    }
  };

  const displayedHash = txHash || hash;

  return (
    <main className="min-h-screen bg-[#080B14] px-5 pb-20 pt-32 text-white">
      <section className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-9">
                  <Navbar/>

        <p className="text-sm font-medium tracking-wide text-white/50">
          LEXO · IDENTITY
        </p>

        <h1 className="mt-3 text-3xl font-bold">
          Identity Attestation
        </h1>

        <p className="mt-3 leading-6 text-white/60">
          Retrieve your approved attestation and register your identity
          on-chain using an authorized wallet.
        </p>

        {/* Wallet controls */}
        <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-wide text-white/40">
            Connected wallet
          </p>

          <p className="mt-2 break-all font-mono text-sm">
            {address ?? "No wallet connected"}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {!isConnected ? (
              <button
                type="button"
                onClick={() => void handleConnectWallet()}
                disabled={isConnecting}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:bg-white/5 disabled:opacity-50"
              >
                {isConnecting ? "Connecting..." : "Connect wallet"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleChangeWallet()}
                  disabled={isConnecting || isBusy}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:bg-white/5 disabled:opacity-50"
                >
                  {isConnecting ? "Connecting..." : "Change wallet"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    disconnect();
                    setAttestation(null);
                    setTxHash("");
                    setError("");
                  }}
                  disabled={isBusy}
                  className="rounded-lg border border-red-400/20 px-4 py-2 text-sm text-red-300 transition hover:bg-red-400/5 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {isConnected && chainId !== SEPOLIA_CHAIN_ID && (
          <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-200">
            Switch to Ethereum Sepolia before registering your identity.
          </p>
        )}

        <div className="my-7 border-t border-white/10" />

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Attestation details</h2>

          <button
            type="button"
            onClick={() => void loadAttestation()}
            disabled={isBusy || !isConnected}
            className="text-sm text-white/60 transition hover:text-white disabled:opacity-40"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="mt-6 animate-pulse text-sm text-white/60">
            Checking your attestation...
          </p>
        ) : attestation ? (
          <>
            <div className="mt-5 space-y-4 rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
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

            <button
              type="button"
              onClick={() => void handleRegister()}
              disabled={
                isBusy ||
                isSuccess ||
                !isConnected ||
                address?.toLowerCase() !== attestation.wallet.toLowerCase()
              }
              className="mt-6 w-full rounded-xl bg-white px-5 py-3 font-semibold text-[#080B14] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {!isConnected
                ? "Connect wallet"
                : address?.toLowerCase() !== attestation.wallet.toLowerCase()
                  ? "Connect the attested wallet"
                  : isPending
                    ? "Confirm in wallet..."
                    : isConfirming
                      ? "Waiting for confirmation..."
                      : isSuccess
                        ? "Transaction confirmed"
                        : "Register on Blockchain"}
            </button>
          </>
        ) : (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-5">
            <p className="text-sm leading-6 text-white/60">
              No usable attestation is available. If your identity
              verification is approved, request a fresh attestation for
              your connected, authorized wallet.
            </p>

            <button
              type="button"
              onClick={() => void requestFreshAttestation()}
              disabled={isBusy || !isConnected}
              className="mt-5 w-full rounded-xl border border-white/20 px-5 py-3 text-sm font-medium transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {requesting
                ? "Requesting fresh attestation..."
                : "Re-request attestation"}
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm leading-6 text-red-300"
          >
            <p>{error}</p>
            

            {(error.toLowerCase().includes("expired") ||
              error.toLowerCase().includes("no complete attestation")) && (
              <button
                type="button"
                onClick={() => void requestFreshAttestation()}
                disabled={isBusy || !isConnected}
                className="mt-3 underline underline-offset-4 disabled:opacity-40"
              >
                Request a fresh attestation
              </button>
            )}
          </div>
        )}

        {(displayedHash || transactionError || isSuccess) && (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
            {isSuccess && (
              <p className="text-sm text-emerald-300">
                Transaction confirmed. Verify the registered identity in
                the contract state before considering registration complete.
              </p>
            )}

            {displayedHash && (
              <div className="mt-2">
                <p className="text-xs uppercase tracking-wide text-white/40">
                  Transaction hash
                </p>

                <a
                  href={`https://sepolia.etherscan.io/tx/${displayedHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all font-mono text-xs text-white/70 underline underline-offset-4 hover:text-white"
                >
                  {displayedHash}
                </a>
              </div>
            )}

            {transactionError && (
              <p className="mt-3 break-words text-sm text-red-300">
                {
                  transactionError.message}
              </p>
            )}
          </div>
        )}

        <p className="mt-6 text-xs leading-5 text-white/40">
          Ethereum Sepolia · Chain ID {SEPOLIA_CHAIN_ID}. The backend
          must authorize the selected wallet and sign an attestation using
          the current on-chain nonce and a valid deadline.
        </p>
      </section>
    </main>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-white/40">
        {label}
      </p>
      <p className="mt-1 break-all text-sm text-white/90">{value}</p>
    </div>
  );
}
