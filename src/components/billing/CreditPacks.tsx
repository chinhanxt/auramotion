"use client";

import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { formatCredit } from "@/lib/api-client";
import { formatVnd, type CreditPack } from "./labels";
import { useBuy } from "./useBuy";

export function CreditPacks({ packs, returnTo }: { packs: CreditPack[]; returnTo: string }) {
  const { buy, busy } = useBuy(returnTo);
  if (packs.length === 0) return <p className="text-sm text-muted">Chưa có gói Credit lẻ.</p>;
  const best = packs.reduce((b, p) => (p.price / p.credits < b.price / b.credits ? p : b), packs[0]);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {packs.map((p, i) => {
        const key = `credit-${p.credits}`;
        const isBest = p === best && packs.length > 1;
        return (
          <div key={p.credits} className={cx("reveal relative flex flex-col gap-4 overflow-hidden rounded-m3 bg-s1 p-5 hairline", isBest && "aura-ring")} style={{ "--i": i } as React.CSSProperties}>
            {isBest && <span className="absolute top-4 right-4 rounded-full bg-white/[.08] px-2 py-0.5 text-[11px] font-semibold text-fg/80">Lời nhất</span>}
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-ink">
              <Icon name="bolt" size={17} strokeWidth={2} />
            </span>
            <div>
              <p className="text-2xl font-bold tracking-tight tabular-nums">{formatCredit(p.credits)}</p>
              <p className="text-sm text-muted">{formatVnd(p.price)}</p>
            </div>
            <Button variant={isBest ? "primary" : "subtle"} block className="mt-auto" disabled={busy !== null && busy !== key} loading={busy === key} onClick={() => buy(key, { type: "CREDIT", credits: p.credits })}>
              Mua
            </Button>
          </div>
        );
      })}
    </div>
  );
}
