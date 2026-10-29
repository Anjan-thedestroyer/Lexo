
import type { Escrow } from "./escrow";
import EscrowCard from "./EscrowCard";
import { FolderOpen } from "lucide-react";

export default function MyEscrows({
  escrows,
}: {
  escrows: Escrow[];
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">
          My Escrows
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          Escrows you have created.
        </p>
      </div>

      {escrows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0d111b] px-5 py-10 text-center">
          <FolderOpen className="mb-3 text-gray-500" size={28} />
          <p className="text-sm font-medium text-gray-300">
            No escrows created yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Your created escrows will appear here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {escrows.map((escrow) => (
            <EscrowCard key={escrow.id} escrow={escrow} />
          ))}
        </div>
      )}
    </section>
  );
}
