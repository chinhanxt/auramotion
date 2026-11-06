"use client";

import Link from "next/link";
import { useState } from "react";
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
  const { buy, busy, error } = useBuy("/pricing");

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="flex rounded-md border border-neutral-300 bg-white p-0.5">
          {(["MONTH", "YEAR"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded px-4 py-1.5 text-sm ${p === period ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
            >
              {p === "MONTH" ? "Theo tháng" : "Theo năm"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const price = period === "YEAR" ? plan.priceYear : plan.priceMonth;
          const saving = plan.priceMonth > 0 ? Math.round((1 - plan.priceYear / (plan.priceMonth * 12)) * 100) : 0;
          const isCurrent = plan.code === currentCode;
          const key = `${plan.code}-${period}`;
          const highlight = plan.code === "pro";
          return (
            <div
              key={plan.code}
              className={`flex flex-col gap-4 rounded-xl border bg-white p-5 ${highlight ? "border-neutral-900 shadow-sm" : "border-neutral-200"}`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{plan.name}</h2>
                  {isCurrent && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">Gói hiện tại</span>
                  )}
                </div>
                <p className="text-2xl font-semibold">
                  {price === 0 ? "Miễn phí" : formatVnd(price)}
                  {price > 0 && <span className="text-sm font-normal text-neutral-500"> / {period === "YEAR" ? "năm" : "tháng"}</span>}
                </p>
                {period === "YEAR" && saving > 0 && <p className="text-xs text-green-700">Tiết kiệm {saving}% so với trả theo tháng</p>}
              </div>

              <ul className="space-y-1.5 text-sm text-neutral-700">
                <li>{formatCredit(plan.monthlyCredits)} Credit mỗi tháng</li>
                <li>{plan.maxConcurrent} tác vụ chạy cùng lúc</li>
                <li>Video tối đa {plan.maxDurationSec} giây</li>
                {plan.unlocks.map((name) => (
                  <li key={name}>Dùng được {name}</li>
                ))}
                {plan.code === "free" && <li>Kết quả lưu 30 ngày</li>}
              </ul>

              <div className="mt-auto">
                {plan.code === "free" ? (
                  <Link
                    href={currentCode ? "/studio/image" : "/register"}
                    className="block rounded-md border border-neutral-300 px-3 py-2 text-center text-sm font-medium hover:bg-neutral-100"
                  >
                    {currentCode ? "Vào Studio" : "Đăng ký miễn phí"}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => buy(key, { type: "PLAN", planCode: plan.code as "pro" | "ultra", period })}
                    className={`w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                      highlight ? "bg-neutral-900 text-white hover:bg-neutral-800" : "border border-neutral-900 hover:bg-neutral-100"
                    }`}
                  >
                    {busy === key ? "Đang tạo đơn..." : isCurrent ? "Gia hạn" : `Mua gói ${plan.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}
    </div>
  );
}
