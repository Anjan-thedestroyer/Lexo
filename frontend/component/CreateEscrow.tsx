
import Link from "next/link";
import { Plus, ShieldCheck, ArrowRight } from "lucide-react";

export default function CreateEscrow() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#101522] p-6 md:p-8">
      <div className="relative z-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
            <ShieldCheck size={25} />
          </div>

          <h2 className="text-xl font-semibold text-white">
            Create an escrow
          </h2>

          <p className="mt-2 max-w-lg text-sm leading-6 text-gray-400">
            Create an agreement, define payment terms, and
            secure the transaction with programmable escrow.
          </p>
        </div>

        <Link
          href="/deals/create"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
        >
          <Plus size={18} />
          Create escrow
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
