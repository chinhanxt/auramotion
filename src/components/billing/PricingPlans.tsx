"use client";

import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { formatCredit } from "@/lib/api-client";
import { formatVnd, type Period, type PlanCode } from "./labels";
import { useBuy } from "./useBuy";

export type PricingPlan = {
  code: PlanCode;
  name: string;
  priceMonth: number;
  priceYear: number;
  monthlyCredits: number;
  maxConcurrent: number;
  maxDurationSec: number;
  unlocks: string[];
};

export function PricingPlans({ plans, currentCode }: { plans: PricingPlan[]; currentCode: PlanCode | null }) {
  const [period, setPeriod] = useState<Period>("MONTH");
  const { buy, busy } = useBuy("/pricing");
  const maxSaving = Math.max(0, ...plans.map((p) => (p.priceMonth > 0 ? Math.round((1 - p.priceYear / (p.priceMonth * 12)) * 100) : 0)));

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <Segmented
          ariaLabel="Chu kỳ"
          options={[
            { value: "MONTH" as const, label: "Theo tháng" },
            {
              value: "YEAR" as const,
              label: (
                <>
                  Theo năm{maxSaving > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-ink">−{maxSaving}%</span>}
                </>
              ),
            },
          ]}
          value={period}
          onChange={setPeriod}
        />
      </div>

      <div className="grid items-stretch gap-3 md:grid-cols-3 lg:gap-4">
        {plans.map((plan, i) => {
          const price = period === "YEAR" ? plan.priceYear : plan.priceMonth;
          const saving = plan.priceMonth > 0 ? Math.round((1 - plan.priceYear / (plan.priceMonth * 12)) * 100) : 0;
          const isCurrent = plan.code === currentCode;
          const key = `${plan.code}-${period}`;
          const highlight = plan.code === "pro";
          const features = [
            `${formatCredit(plan.monthlyCredits)} Credit mỗi tháng`,
            `${plan.maxConcurrent} tác vụ cùng lúc`,
            `Video tối đa ${plan.maxDurationSec} giây`,
            ...plan.unlocks.map((n) => `Dùng ${n}`),
            ...(plan.code === "free" ? ["Kết quả lưu 30 ngày"] : []),
          ];
          return (
            <div
              key={plan.code}
              className={cx(
                "reveal relative flex flex-col gap-6 overflow-hidden rounded-m4 p-6 lg:p-7",
                highlight ? "aura-ring bg-[linear-gradient(180deg,rgba(124,92,255,.14),rgba(13,13,16,1)_55%)] md:-my-3 md:py-9" : "bg-s1 hairline",
              )}
              style={{ "--i": i } as React.CSSProperties}
            >
              {highlight && <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-64 -translate-x-1/2 rounded-full opacity-40 blur-3xl" style={{ background: "var(--aura)" }} />}
              <div className="relative space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold tracking-tight">{plan.name}</h2>
                  {isCurrent ? (
                    <span className="rounded-full bg-white/[.08] px-2.5 py-0.5 text-[11px] font-semibold">Đang dùng</span>
                  ) : highlight ? (
                    <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-accent-ink">Phổ biến</span>
                  ) : null}
                </div>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-[clamp(2rem,1.5rem+1.6vw,2.75rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{price === 0 ? "0đ" : formatVnd(price)}</span>
                  {price > 0 && <span className="text-sm text-muted">/ {period === "YEAR" ? "năm" : "tháng"}</span>}
                </p>
                <p className="h-4 text-xs text-ok">{period === "YEAR" && saving > 0 ? `Tiết kiệm ${saving}%` : ""}</p>
              </div>

              <ul className="relative space-y-2.5 text-sm">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-fg/85">
                    <Icon name="check" size={16} strokeWidth={2} className={cx("mt-0.5 shrink-0", highlight ? "text-accent" : "text-muted")} />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="relative mt-auto">
                {plan.code === "free" ? (
                  <LinkButton href={currentCode ? "/studio/image" : "/register"} variant="outline" block size="lg">
                    {currentCode ? "Vào Studio" : "Bắt đầu miễn phí"}
                  </LinkButton>
                ) : (
                  <Button
                    variant={highlight ? "primary" : "outline"}
                    block
                    size="lg"
                    disabled={busy !== null && busy !== key}
                    loading={busy === key}
                    onClick={() => buy(key, { type: "PLAN", planCode: plan.code as "pro" | "ultra", period })}
                  >
                    {isCurrent ? "Gia hạn" : `Chọn ${plan.name}`}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
