"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { DataList, NumberInput, PageHeader, Panel } from "@/components/admin/kit";
import { KIND_ICON, KIND_LABEL } from "@/components/admin/format";
import { Badge } from "@/components/ui/Bits";
import { Spinner } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api, formatCredit } from "@/lib/api-client";
import type { getCreditRules } from "@/server/services/admin";

type Data = Awaited<ReturnType<typeof getCreditRules>>;
type Row = Data["models"][number];

// Ô số lưu khi rời ô / Enter.
function InlineNumber({ value, onSave, busy, suffix, label }: { value: number; onSave: (n: number) => Promise<unknown>; busy?: boolean; suffix?: string; label: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (v === "" || !Number.isFinite(n) || n === value) return setV(String(value));
    void onSave(n);
  };
  return (
    <span className="relative inline-flex w-32 items-center">
      <NumberInput
        value={v}
        onChange={setV}
        min={0}
        suffix={suffix}
        aria-label={label}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="w-full"
      />
      {busy && <Spinner className="absolute -right-6 text-muted" />}
    </span>
  );
}

export function CreditRulesView({ data }: { data: Data }) {
  const router = useRouter();
  const { run, isBusy } = useAction();

  async function saveVoice(n: number) {
    const ok = await run("voice", () => api("/api/admin/settings", jsonInit("PATCH", { voice_line_cost: n })), { success: `Mỗi câu ${formatCredit(n)} Credit` });
    if (ok) router.refresh();
  }

  async function saveBase(m: Row, n: number) {
    const ok = await run(m.id, () => api("/api/admin/models", jsonInit("PATCH", { id: m.id, baseCost: n })), { success: `${m.name}: ${formatCredit(n)} Credit` });
    if (ok) router.refresh();
  }

  return (
    <>
      <PageHeader
        icon="coin"
        title="Giá Credit"
        sub={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <span>Ảnh = gốc × số ảnh</span>
            <span>Video = gốc × giây / 5</span>
            <span>Ghép = gốc + câu × giá câu</span>
          </span>
        }
      />
      <Panel title="Giá mỗi câu thoại (ghép)" icon="mic" className="mb-4">
        <div className="flex items-center gap-3">
          <InlineNumber label="Credit mỗi câu" value={data.voiceLineCost} onSave={saveVoice} busy={isBusy("voice")} suffix="Cr" />
          <span className="text-xs text-muted">Credit / câu</span>
        </div>
      </Panel>
      <DataList<Row>
        rows={data.models}
        rowKey={(m) => m.id}
        cols={[
          {
            key: "model",
            label: "Model",
            mobile: "title",
            cell: (m) => (
              <span className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-m1 bg-s3">
                  <Icon name={KIND_ICON[m.kind]} size={16} className="text-muted" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block text-xs font-normal text-muted">
                    {KIND_LABEL[m.kind]}
                    {!m.enabled && " · tắt"}
                  </span>
                </span>
              </span>
            ),
          },
          {
            key: "base",
            label: "Giá gốc",
            cell: (m) => <InlineNumber label={`Giá gốc ${m.name}`} value={m.baseCost} onSave={(n) => saveBase(m, n)} busy={isBusy(m.id)} suffix="Cr" />,
          },
          {
            key: "preview",
            label: "Xem trước",
            mobile: "full",
            cell: (m) => (
              <span className="flex flex-wrap gap-1.5">
                {m.previews.map((p) => (
                  <Badge key={p.label} className="h-6 gap-1 px-2.5">
                    <span className="font-normal text-muted">{p.label}</span>
                    <span className="tabular-nums">{formatCredit(p.cost)}</span>
                  </Badge>
                ))}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
