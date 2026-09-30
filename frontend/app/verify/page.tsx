"use client";

import { useState } from "react";
import Link from "next/link";
import Navbar from "@/component/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { useAccount } from "wagmi";

export default function VerificationSite() {
    const { user, loading, isAuthenticated } = useAuth();
    const { address, isConnected } = useAccount();

    const [acceptedTerms, setAcceptedTerms] = useState(false);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#080B14] text-white">
                <Navbar />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#080B14] text-white">
            <Navbar />

            <main className="mx-auto max-w-4xl px-8 pb-20 pt-32">
                {!isAuthenticated ? (
                    <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
                        <h1 className="text-2xl font-semibold">
                            Login Required
                        </h1>

                        <p className="mt-3 text-white/60">
                            You need to log in before starting identity
                            verification.
                        </p>

                        <Link
                            href="/login"
                            className="mt-6 inline-flex rounded-lg bg-white px-6 py-3 text-sm font-semibold text-[#080B14] transition hover:bg-white/90"
                        >
                            Login
                        </Link>

                        <p className="mt-4 text-sm text-white/50">
                            Don't have an account?{" "}
                            <Link
                                href="/signup"
                                className="text-white hover:underline"
                            >
                                Create one
                            </Link>
                        </p>
                    </div>
                ) : (
                    <div>
                        <div className="mb-10">
                            <h1 className="text-3xl font-semibold">
                                Identity Verification
                            </h1>

                            <p className="mt-2 text-white/60">
                                Complete the verification process to register
                                your identity with Lexo.
                            </p>
                        </div>

                        {/* Account */}
                        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                            <h2 className="text-lg font-semibold">
                                Account
                            </h2>

                            <div className="mt-4 space-y-2 text-sm">
                                <p className="text-white/60">
                                    Name:{" "}
                                    <span className="text-white">
                                        {user?.name}
                                    </span>
                                </p>

                                <p className="text-white/60">
                                    Email:{" "}
                                    <span className="text-white">
                                        {user?.email}
                                    </span>
                                </p>
                            </div>
                        </section>

                        {/* Identity Information */}
                        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                            <h2 className="text-lg font-semibold">
                                Identity Information
                            </h2>

                            <p className="mt-2 text-sm text-white/60">
                                Your identity information will be verified
                                before the identity attestation is submitted
                                on-chain.
                            </p>

                            {/* Your identity form goes here */}
                        </section>

                        {/* Terms */}
                        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                            <h2 className="text-lg font-semibold">
                                Terms & Conditions
                            </h2>

                            <label className="mt-4 flex cursor-pointer items-start gap-3">
                                <input
                                    type="checkbox"
                                    checked={acceptedTerms}
                                    onChange={(e) =>
                                        setAcceptedTerms(e.target.checked)
                                    }
                                    className="mt-1"
                                />

                                <span className="text-sm text-white/60">
                                    I have read and agree to the Lexo terms
                                    and conditions.
                                </span>
                            </label>
                        </section>

                        {/* Wallet */}
                        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                            <h2 className="text-lg font-semibold">
                                Root Wallet
                            </h2>

                            {isConnected && address ? (
                                <div className="mt-4">
                                    <p className="text-sm text-green-400">
                                        Wallet connected
                                    </p>

                                    <p className="mt-2 break-all text-sm text-white/60">
                                        {address}
                                    </p>
                                </div>
                            ) : (
                                <p className="mt-4 text-sm text-yellow-400">
                                    Connect your wallet to continue.
                                </p>
                            )}
                        </section>

                        {/* Rarimo */}
                        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                            <h2 className="text-lg font-semibold">
                                Identity Verification
                            </h2>

                            <p className="mt-2 text-sm text-white/60">
                                Complete the Rarimo verification step using
                                the QR code provided below.
                            </p>

                            {/* Rarimo QR component goes here */}
                        </section>

                        {/* Submit */}
                        <button
                            type="button"
                            disabled={!acceptedTerms || !isConnected}
                            className="mt-8 w-full rounded-lg bg-white px-6 py-3 text-sm font-semibold text-[#080B14] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Continue Verification
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}
