"use client";

import { useEffect, useState } from "react";
import { Badge, Skeleton } from "@/components/ui/Bits";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { api } from "@/lib/api-client";
import { PROVIDER_LABEL, formatMs, timeAgo } from "../format";
import { jsonInit, useAction, usePoll } from "../hooks";
import { FieldRow, NumberInput, PageHeader, Panel, SaveBar, TextInput } from "../kit";
import { LiveDot, providerState, type GatewayData, type GatewaySetting, type Provider, type ProviderHealth } from "./live";

const ALL: Provider[] = ["agy", "codex", "muse"];
const MODEL_KEY = { agy: "agyModel", codex: "codexModel", muse: "museModel" } as const;
const MODEL_HINT = { agy: "claude-sonnet-5-5-low", codex: "mặc định", muse: "mặc định" } as const;

type Draft = { order: Provider[]; off: Provider[]; agyModel: string; codexModel: string; museModel: string; timeoutSec: number };

function toDraft(s: GatewaySetting): Draft {
  return {
    order: [...s.order, ...ALL.filter((p) => !s.order.includes(p))],
    off: ALL.filter((p) => !s.order.includes(p)),
    agyModel: s.agyModel ?? "",
    codexModel: s.codexModel ?? "",
    museModel: s.museModel ?? "",
    timeoutSec: s.timeoutSec,
  };
}

function toSetting(d: Draft): GatewaySetting {
  return {
    order: d.order.filter((p) => !d.off.includes(p)),
    ...(d.agyModel.trim() ? { agyModel: d.agyModel.trim() } : {}),
    ...(d.codexModel.trim() ? { codexModel: d.codexModel.trim() } : {}),
    ...(d.museModel.trim() ? { museModel: d.museModel.trim() } : {}),
    timeoutSec: d.timeoutSec,
  };
}

function HealthLine({ h }: { h?: ProviderHealth }) {
  const st = providerState(h);
  if (!h) return <Skeleton className="h-4 w-40" />;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <Badge tone={st === "ok" ? "ok" : st === "danger" ? "danger" : "neutral"} dot>
        {st === "ok" ? "OK" : st === "danger" ? "Lỗi" : "Chưa chạy"}
      </Badge>
      <span className="text-muted tabular-nums">
        <Icon name="clock" size={12} className="mr-1 inline -translate-y-px" />
        {formatMs(h.lastMs)}
      </span>
      {h.lastOkAt && <span suppressHydrationWarning className="text-dim">ok {timeAgo(h.lastOkAt)}</span>}
      {h.lastErrAt && st === "danger" && <span suppressHydrationWarning className="text-dim">lỗi {timeAgo(h.lastErrAt)}</span>}
    </span>
  );
}

export function GatewayView({ initial }: { initial: GatewayData }) {
  const live = usePoll<GatewayData>("/api/admin/gateway", 10_000, initial);
  const [saved, setSaved] = useState<Draft>(() => toDraft(initial.setting));
  const [d, setD] = useState<Draft>(saved);
  const [drag, setDrag] = useState<Provider | null>(null);
  const [over, setOver] = useState<Provider | null>(null);
  const { run, isBusy } = useAction();
  const dirty = JSON.stringify(toSetting(d)) !== JSON.stringify(toSetting(saved));
  const health = live.data?.health;

  function move(p: Provider, to: number) {
    setD((x) => {
      const order = x.order.filter((q) => q !== p);
      order.splice(Math.max(0, Math.min(order.length, to)), 0, p);
      return { ...x, order };
    });
  }

  function toggle(p: Provider, on: boolean) {
    setD((x) => {
      const off = on ? x.off.filter((q) => q !== p) : [...x.off, p];
      return off.length >= ALL.length ? x : { ...x, off };
    });
  }

  async function save() {
    const r = await run("save", () => api<GatewayData>("/api/admin/gateway", jsonInit("PUT", toSetting(d))), { success: "Đã lưu gateway" });
    if (r) {
      const nd = toDraft(r.setting);
      setSaved(nd);
      setD(nd);
      live.setData(r);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader icon="route" title="AI Gateway" sub={<LiveDot at={live.at} />} actions={<SaveBar dirty={dirty} busy={isBusy("save")} onSave={() => void save()} onReset={() => setD(saved)} />} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Thứ tự" icon="list" pad={false} actions={<span className="text-xs text-dim">Kéo để đổi</span>}>
          <ol className="divide-y divide-line">
            {d.order.map((p, i) => {
              const off = d.off.includes(p);
              const rank = d.order.filter((q) => !d.off.includes(q)).indexOf(p);
              return (
                <li
                  key={p}
                  draggable
                  onDragStart={(e) => {
                    setDrag(p);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (over !== p) setOver(p);
                  }}
                  onDragLeave={() => setOver((o) => (o === p ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag && drag !== p) move(drag, i);
                    setDrag(null);
                    setOver(null);
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  className={cx(
                    "flex flex-col gap-3 px-4 py-4 transition-[background-color,opacity] duration-200 sm:flex-row sm:items-center sm:px-5",
                    drag === p && "opacity-40",
                    over === p && drag !== p && "bg-accent/[.06]",
                    off && "opacity-55",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="hidden cursor-grab text-dim active:cursor-grabbing sm:block" aria-hidden="true">
                      <Icon name="drag" size={18} />
                    </span>
                    <span
                      className={cx(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                        off ? "bg-white/[.04] text-dim" : rank === 0 ? "bg-accent text-accent-ink" : "bg-white/[.08] text-fg",
                      )}
                    >
                      {off ? "–" : rank + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{PROVIDER_LABEL[p]}</span>
                      <span className="mt-1 block">
                        <HealthLine h={health?.[p]} />
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <IconButton icon="chevronUp" label="Lên" size="sm" disabled={i === 0} onClick={() => move(p, i - 1)} />
                      <IconButton icon="chevronDown" label="Xuống" size="sm" disabled={i === d.order.length - 1} onClick={() => move(p, i + 1)} />
                      <span className="ml-1 w-11">
                        <Switch label={<span className="sr-only">Bật {p}</span>} checked={!off} onChange={(v) => toggle(p, v)} />
                      </span>
                    </span>
                  </div>
                  <div className="sm:w-60">
                    <TextInput
                      aria-label={`Model ${p}`}
                      value={d[MODEL_KEY[p]]}
                      placeholder={MODEL_HINT[p]}
                      onChange={(e) => setD((x) => ({ ...x, [MODEL_KEY[p]]: e.target.value }))}
                      className="font-mono !text-[12.5px]"
                    />
                  </div>
                  {health?.[p]?.lastError && providerState(health[p]) === "danger" && (
                    <p className="text-xs break-words text-danger/85 sm:hidden">{health[p].lastError}</p>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
            <span className="flex items-center gap-2 text-sm">
              <Icon name="clock" size={16} className="text-muted" />
              Hết giờ
            </span>
            <NumberInput className="w-32" value={d.timeoutSec} min={10} max={600} step="1" suffix="giây" onChange={(v) => setD((x) => ({ ...x, timeoutSec: Number(v) }))} />
          </div>
          {ALL.some((p) => health?.[p]?.lastError && providerState(health[p]) === "danger") && (
            <div className="hidden space-y-1.5 border-t border-line px-5 py-3 sm:block">
              {ALL.filter((p) => health?.[p]?.lastError && providerState(health[p]) === "danger").map((p) => (
                <p key={p} className="text-xs break-words text-danger/85">
                  <b className="font-semibold">{PROVIDER_LABEL[p]}:</b> {health![p].lastError}
                </p>
              ))}
            </div>
          )}
        </Panel>

        <TestBox onDone={() => void live.refresh()} />
      </div>
    </div>
  );
}

function TestBox({ onDone }: { onDone: () => void }) {
  const [prompt, setPrompt] = useState("Viết 1 câu chào ngắn bằng tiếng Việt.");
  const [provider, setProvider] = useState<"auto" | Provider>("auto");
  const [res, setRes] = useState<{ text: string; provider: Provider; ms: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { run, isBusy } = useAction();
  const busy = isBusy("test");
  useEffect(() => setErr(null), [prompt, provider]);

  async function test() {
    setRes(null);
    setErr(null);
    const r = await run(
      "test",
      async () => {
        try {
          return await api<{ text: string; provider: Provider; ms: number }>(
            "/api/admin/gateway/test",
            jsonInit("POST", { prompt, ...(provider === "auto" ? {} : { provider }) }),
          );
        } catch (e) {
          setErr((e as Error).message);
          throw e;
        }
      },
      { silent: true },
    );
    if (r) setRes(r);
    onDone();
  }

  return (
    <Panel title="Chạy thử" icon="play">
      <div className="space-y-3">
        <Segmented
          size="sm"
          ariaLabel="Provider"
          value={provider}
          onChange={setProvider}
          options={[{ value: "auto", label: "Tự động" }, ...ALL.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))]}
        />
        <FieldRow label="Nội dung">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy && void test()}
            className="w-full resize-y rounded-m1 bg-white/[.04] px-3.5 py-2.5 text-[14px] shadow-[inset_0_0_0_1px_var(--color-line2)] outline-none focus:shadow-[inset_0_0_0_1px_rgba(212,255,58,.7)]"
          />
        </FieldRow>
        <Button variant="primary" size="sm" icon="play" loading={busy} disabled={!prompt.trim()} onClick={() => void test()}>
          Chạy
        </Button>
        <div className="min-h-24 rounded-m2 bg-black/25 p-3.5 hairline">
          {busy ? (
            <div className="space-y-2">
              <Skeleton aura className="h-3.5 w-11/12" />
              <Skeleton aura className="h-3.5 w-9/12" />
              <Skeleton aura className="h-3.5 w-10/12" />
            </div>
          ) : err ? (
            <p className="text-sm text-danger">{err}</p>
          ) : res ? (
            <div className="text-in">
              <div className="mb-2 flex gap-2">
                <Badge tone="aura">{PROVIDER_LABEL[res.provider]}</Badge>
                <Badge>{formatMs(res.ms)}</Badge>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg/90">{res.text}</p>
            </div>
          ) : (
            <p className="text-sm text-dim">Kết quả hiện ở đây</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
