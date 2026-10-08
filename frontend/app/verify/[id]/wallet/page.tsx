"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";

import Navbar from "@/component/Navbar";
import { useVerification } from "../layout";
import { useCoreAgreement } from "@/hooks/coreAgreement";
import { useBackgroundImage } from "@/hooks/background";

export default function WalletPage() {
    const params = useParams();
    const router = useRouter();
    useBackgroundImage();

    const userId = params.id as string;

    const { address, isConnected } = useAccount();

    const {
        connectors,
        connect,
        isPending,
    } = useConnect();

    const {
        updateVerificationData,
    } = useVerification();

    const {
        hasSigned,
        isCheckingSigned,
    } = useCoreAgreement();

    const injectedConnector = connectors.find(
        (connector) => connector.type === "injected"
    );

    useEffect(() => {
        if (
            isConnected &&
            address &&
            !isCheckingSigned &&
            hasSigned
        ) {
            updateVerificationData({
                walletAddress: address,
                agreementSigned: true,
            });

            router.replace(`/verify/${userId}/identity`);
        }
    }, [
        isConnected,
        address,
        isCheckingSigned,
        hasSigned,
        userId,
        router,
        updateVerificationData,
    ]);

    function handleConnect() {
        if (!injectedConnector) {
            return;
        }

        connect({
            connector: injectedConnector,
        });
    }

    function handleContinue() {
        if (!address) return;

        updateVerificationData({
            walletAddress: address,
        });

        router.push(`/verify/${userId}/agreement`);
    }

    if (isConnected && isCheckingSigned) {
        return (
            <div className="min-h-screen bg-transparent text-white">
                <Navbar />

                <main className="mx-auto max-w-2xl px-6 pb-20 pt-32">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-sm">
                        <p className="text-sm text-white/50">
                            Checking wallet agreement...
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-transparent text-white">
            <Navbar />

            <main className="mx-auto flex max-w-2xl justify-center px-6 pb-20 pt-32">
                <div className="w-full max-w-lg">
                    <div className="mb-8 text-center">
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/40">
                            Identity Verification
                        </p>

                        <h1 className="mt-3 text-3xl font-semibold">
                            Connect Wallet
                        </h1>

                        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/50">
                            Connect your wallet to continue with your
                            Lexo identity verification.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
                        {!isConnected ? (
                            <div>
                                <div className="rounded-xl border border-white/10 bg-black/10 p-5">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                                            <span className="text-lg">
                                                ◇
                                            </span>
                                        </div>

                                        <div>
                                            <p className="text-sm font-medium">
                                                Browser Wallet
                                            </p>

                                            <p className="mt-1 text-xs text-white/40">
                                                MetaMask or another installed
                                                wallet
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleConnect}
                                    disabled={
                                        isPending ||
                                        !injectedConnector
                                    }
                                    className="mt-5 w-full rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-[#080B14] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {isPending
                                        ? "Connecting..."
                                        : "Connect Wallet"}
                                </button>

                                {!injectedConnector && (
                                    <p className="mt-4 text-center text-xs text-white/40">
                                        No browser wallet detected. Please
                                        install MetaMask or another
                                        compatible wallet.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div>
                                <div className="flex items-center justify-between">
                                    <p className="text-xs uppercase tracking-wider text-white/40">
                                        Connected Wallet
                                    </p>

                                    <span className="flex items-center gap-2 text-xs text-white/50">
                                        <span className="h-2 w-2 rounded-full bg-white/70" />
                                        Connected
                                    </span>
                                </div>

                                <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-4">
                                    <p className="break-all font-mono text-sm text-white/80">
                                        {address}
                                    </p>
                                </div>

                                {hasSigned ? (
                                    <div className="mt-5 text-center">
                                        <p className="text-sm text-white/60">
                                            Agreement already signed.
                                        </p>

                                        <p className="mt-1 text-xs text-white/35">
                                            Redirecting to Rarimo verification...
                                        </p>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleContinue}
                                        className="mt-5 w-full rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-[#080B14] transition hover:bg-white/90"
                                    >
                                        Continue
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <p className="mt-6 text-center text-xs text-white/30">
                        Lexo never takes custody of your wallet or private
                        keys.
                    </p>
                </div>
            </main>
        </div>
    );
}
