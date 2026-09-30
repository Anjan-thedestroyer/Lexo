"use client";

import Navbar from "@/component/Navbar";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#080B14] text-white">
      <Navbar />

      {/* Hero */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
        <div className="mx-auto max-w-6xl px-8 pt-20 text-center">
          <p className="mb-6 text-sm font-medium uppercase tracking-[0.25em] text-white/50">
            Programmable Legal Infrastructure
          </p>

          <h1 className="mx-auto max-w-5xl text-6xl font-bold leading-tight tracking-tight">
            Legal agreements that
            <span className="text-white/50"> execute with trust.</span>
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-white/60">
            Lexo combines legal agreements, verified identity, blockchain
            infrastructure, and programmable escrow into one trusted system.
          </p>

          <div className="mt-10 flex items-center justify-center gap-4">
            <button className="rounded-xl bg-white px-6 py-3 font-semibold text-[#080B14] transition hover:bg-white/90">
              Create Deal
            </button>

            <button className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 font-semibold text-white transition hover:bg-white/10">
              Explore Lexo
            </button>
          </div>
        </div>
      </section>

      {/* What is Lexo */}
      <section className="border-t border-white/10 px-8 py-32">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm uppercase tracking-[0.2em] text-white/40">
            What is Lexo?
          </p>

          <h2 className="mt-4 max-w-3xl text-4xl font-bold">
            A programmable layer between legal agreements and blockchain
            execution.
          </h2>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/60">
            Lexo turns agreements into verifiable digital workflows. Identity,
            wallet verification, signatures, escrow can
            be connected to the same agreement lifecycle.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-white/10 px-8 py-32">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm uppercase tracking-[0.2em] text-white/40">
            How it works
          </p>

          <h2 className="mt-4 text-4xl font-bold">
            From agreement to execution.
          </h2>

          <div className="mt-16 grid gap-6 md:grid-cols-4">
            {[
              {
                number: "01",
                title: "Identity",
                description:
                  "Verify the participants and establish a trusted identity.",
              },
              {
                number: "02",
                title: "Agreement",
                description:
                  "Create and sign the legal terms that define the relationship.",
              },
              {
                number: "03",
                title: "Verification",
                description:
                  "Connect verified wallets and compliance signals to the agreement.",
              },
              {
                number: "04",
                title: "Execution",
                description:
                  "Use programmable escrow and blockchain infrastructure to execute.",
              },
            ].map((item) => (
              <div
                key={item.number}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
              >
                <span className="text-sm text-white/30">
                  {item.number}
                </span>

                <h3 className="mt-8 text-xl font-semibold">
                  {item.title}
                </h3>

                <p className="mt-3 leading-7 text-white/50">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Technology */}
      <section className="border-t border-white/10 px-8 py-32">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm uppercase tracking-[0.2em] text-white/40">
            Infrastructure
          </p>

          <h2 className="mt-4 text-4xl font-bold">
            Built for verifiable execution.
          </h2>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
              <h3 className="text-xl font-semibold">
                Blockchain
              </h3>

              <p className="mt-4 leading-7 text-white/50">
                Agreements, identities, wallets, and escrow states can be
                anchored and verified on-chain.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
              <h3 className="text-xl font-semibold">
                Chainlink CRE
              </h3>

              <p className="mt-4 leading-7 text-white/50">
                Compliance and external verification workflows can be
                orchestrated through verifiable computation.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
              <h3 className="text-xl font-semibold">
                Programmable Escrow
              </h3>

              <p className="mt-4 leading-7 text-white/50">
                Agreement conditions can determine how funds are held,
                released, refunded, or disputed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 px-8 py-32">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-4xl font-bold">
            Make agreements programmable.
          </h2>

          <p className="mx-auto mt-5 max-w-xl text-white/50">
            Create a verifiable agreement and connect it to real-world
            execution.
          </p>

          <button className="mt-8 rounded-xl bg-white px-7 py-3 font-semibold text-[#080B14]">
            Create Deal
          </button>
        </div>
      </section>
    </main>
  );
}