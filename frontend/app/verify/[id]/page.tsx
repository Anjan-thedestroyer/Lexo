"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "@/component/Navbar";
import { useVerification } from "./layout";

export default function VerifyPage() {
  const params = useParams();
  const router = useRouter();

  const userId = params.id as string;

  const { verificationData, updateVerificationData } = useVerification();

  const [password, setPassword] = useState(verificationData.password);

  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    updateVerificationData({
      password,
    });

    router.push(`/verify/${userId}/wallet`);
  }

  return (
    <div className="min-h-screen bg-[#080B14] text-white">
      <Navbar />

      <main className="mx-auto max-w-lg px-6 pb-20 pt-32">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          <h1 className="text-2xl font-semibold">Confirm Your Account</h1>

          <p className="mt-2 text-sm text-white/60">
            Enter your password to continue with identity verification.
          </p>

          <form onSubmit={handleSubmit} className="mt-8">
            <label className="text-sm text-white/70">Password</label>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.05] px-4 py-3 text-sm outline-none focus:border-white/30"
            />

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              className="mt-6 w-full rounded-lg bg-white px-6 py-3 text-sm font-semibold text-[#080B14] transition hover:bg-white/90"
            >
              Continue
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
