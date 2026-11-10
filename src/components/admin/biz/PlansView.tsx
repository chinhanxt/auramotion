"use client";

import { useMemo } from "react";
import { jsonInit, useAction, useDraft } from "@/components/admin/hooks";
import { FieldRow, NumberInput, PageHeader, Panel, SaveBar, TextInput } from "@/components/admin/kit";
import { formatVnd } from "@/components/admin/format";
import type { Plain } from "@/components/admin/plain";
import { Badge } from "@/components/ui/Bits";
import { api, formatCredit } from "@/lib/api-client";
import type { listPlans } from "@/server/services/admin";

type PlanRow = Plain<Awaited<ReturnType<typeof listPlans>>>[number];
type Draft = { name: string; priceMonth: string; priceYear: string; monthlyCredits: string; maxConcurrent: string; maxDurationSec: string };

const TONE = { free: "neutral", pro: "info", ultra: "aura" } as const;

function PlanCard({ plan, i }: { plan: PlanRow; i: number }) {
  const { run, isBusy } = useAction();
  const source = useMemo<Draft>(
    () => ({
      name: plan.name,
      priceMonth: String(plan.priceMonth),
      priceYear: String(plan.priceYear),
      monthlyCredits: String(Number(plan.monthlyCredits)),
      maxConcurrent: String(plan.maxConcurrent),
      maxDurationSec: String(plan.maxDurationSec),
    }),
    [plan],
  );
  const { draft, set, dirty, reset, commit } = useDraft(source);

  async function save() {
    const body = {
      id: plan.id,
      name: draft.name,
      priceMonth: Number(draft.priceMonth),
      priceYear: Number(draft.priceYear),
      monthlyCredits: Number(draft.monthlyCredits),
      maxConcurrent: Number(draft.maxConcurrent),
      maxDurationSec: Number(draft.maxDurationSec),
    };
    const ok = await run("save", () => api(`/api/admin/plans`, jsonInit("PATCH", body)), { success: `Đã lưu ${draft.name}` });
    if (ok) commit(draft);
  }

  return (
    <Panel
      className="reveal"
      title={
        <span className="flex items-center gap-2">
          {draft.name || plan.code}
          <Badge tone={TONE[plan.code]}>{plan.code}</Badge>
        </span>
      }
      icon="tag"
    >
      <div className="mb-4 flex items-baseline gap-2" style={{ "--i": i } as React.CSSProperties}>
        <span className="text-[26px] font-bold tracking-[-0.03em] tabular-nums">{formatVnd(Number(draft.priceMonth) || 0)}</span>
        <span className="text-xs text-muted">/ tháng · {formatCredit(Number(draft.monthlyCredits) || 0)} Credit</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Tên" className="col-span-2">
          <TextInput value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </FieldRow>
        <FieldRow label="Giá tháng">
          <NumberInput value={draft.priceMonth} onChange={(v) => set("priceMonth", v)} step="1000" min={0} suffix="₫" />
        </FieldRow>
        <FieldRow label="Giá năm">
          <NumberInput value={draft.priceYear} onChange={(v) => set("priceYear", v)} step="1000" min={0} suffix="₫" />
        </FieldRow>
        <FieldRow label="Credit / tháng">
          <NumberInput value={draft.monthlyCredits} onChange={(v) => set("monthlyCredits", v)} min={0} />
        </FieldRow>
        <FieldRow label="Cùng lúc">
          <NumberInput value={draft.maxConcurrent} onChange={(v) => set("maxConcurrent", v)} step="1" min={1} suffix="job" />
        </FieldRow>
        <FieldRow label="Video tối đa" className="col-span-2">
          <NumberInput value={draft.maxDurationSec} onChange={(v) => set("maxDurationSec", v)} step="1" min={1} suffix="giây" />
        </FieldRow>
      </div>
      <div className="mt-4">
        <SaveBar dirty={dirty} busy={isBusy("save")} onSave={save} onReset={reset} />
      </div>
    </Panel>
  );
}

export function PlansView({ plans }: { plans: PlanRow[] }) {
  return (
    <>
      <PageHeader icon="tag" title="Gói" sub="Free · Pro · Ultra" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p, i) => (
          <PlanCard key={p.id} plan={p} i={i} />
        ))}
      </div>
    </>
  );
}
