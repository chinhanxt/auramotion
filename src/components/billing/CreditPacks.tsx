"use client";

import { formatCredit } from "@/lib/api-client";
import { formatVnd, type CreditPack } from "./labels";
import { useBuy } from "./useBuy";

export function CreditPacks({ packs, returnTo }: { packs: CreditPack[]; returnTo: string }) {
  const { buy, busy, error } = useBuy(returnTo);
  if (packs.length === 0) return <p className="text-sm text-neutral-500">Chưa có gói Credit lẻ.</p>;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {packs.map((p) => {
          const key = `credit-${p.credits}`;
          return (
            <div key={p.credits} className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
              <div>
                <p className="text-lg font-semibold">{formatCredit(p.credits)} Credit</p>
                <p className="text-sm text-neutral-600">{formatVnd(p.price)}</p>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => buy(key, { type: "CREDIT", credits: p.credits })}
                className="mt-auto rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {busy === key ? "Đang tạo đơn..." : "Mua"}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
