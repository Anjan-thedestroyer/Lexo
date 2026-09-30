"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import Navbar from "@/component/Navbar";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    setLoading(true);

    try {
      // Connect your registration API here
      console.log({ name, email, password });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#080B14] text-white">
      <Navbar transparent={false} />

      <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 pt-[76px]">
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.025] blur-3xl" />

        <div className="relative z-10 w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-xl font-bold text-[#080B14]">
              L
            </div>

            <h1 className="text-3xl font-semibold tracking-tight">
              Create your Lexo account
            </h1>

            <p className="mt-3 text-sm leading-6 text-white/50">
              Build, verify, and manage programmable legal deals.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur-xl">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block text-sm font-medium text-white/80"
                >
                  Full name
                </label>

                <input
                  id="name"
                  type="text"
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-12 w-full rounded-lg border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.04]"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-white/80"
                >
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 w-full rounded-lg border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.04]"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-white/80"
                >
                  Password
                </label>

                <input
                  id="password"
                  type="password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="h-12 w-full rounded-lg border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.04]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-lg bg-white text-sm font-semibold text-[#080B14] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Creating account..." : "Create Account"}
              </button>
            </form>

            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-white/30">OR</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
            <p className="mt-6 text-center text-sm text-white/45">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-white transition hover:text-white/70"
              >
                Login
              </Link>
            </p>
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-white/25">
            Your identity and wallet information can be verified before
            participating in deals.
          </p>
        </div>
      </section>
    </main>
  );
}