"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/component/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";

export default function VerificationSite() {
      const router = useRouter();
    const { user, loading, isAuthenticated } = useAuth();
    const { address, isConnected } = useAccount();

    const [acceptedTerms, setAcceptedTerms] = useState(false);
    useEffect(()=>{
        if(!loading)
        console.log(user);

    },[loading])
    if (loading) {
        return (
            <div className="min-h-screen bg-[#080B14] text-white">
                <Navbar />
            </div>
        );
    }
    function handleSubmit(){
        router.push(`/verify/${user.userId}`)
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
                                <p className="text-white/60">
                                    Phone:{" "}
                                    <span className="text-white">
                                        {user?.phone}
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
                        {/* Submit */}
                        <button
                            type="button"
                            onClick={handleSubmit}
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
