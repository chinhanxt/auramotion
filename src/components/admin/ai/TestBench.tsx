"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WritingLines } from "@/components/library/JobPrompt";
import { Badge } from "@/components/ui/Bits";
import { Button, Spinner } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { PROVIDER_LABEL, formatMs } from "../format";
import { jsonInit } from "../hooks";
import { FieldRow, Panel } from "../kit";
import type { Call } from "./Accounts";
import { useNow } from "./bits";
import { EffortPicker, ModelSelect } from "./ModelSelect";
import { Monogram } from "./Monogram";
import type { ModelLists } from "./Roles";
import { AI_PROVIDERS, stepLabel, type AiProvider, type ChainStep, type TestResult } from "./types";

type Skill = { id: string; name: string; kind: string; enabled?: boolean };
type Kind = "image" | "video";
type Body = { provider: AiProvider; model?: string; effort?: string; skillId?: string; kind: Kind; idea: string };

const SEG = [
  { key: "startMs", label: "Khởi động", color: "#5c7cff" },
  { key: "sessionMs", label: "Phiên", color: "#b06bff" },
  { key: "modelMs", label: "Model", color: "#d4ff3a" },
] as const;

function Breakdown({ r }: { r: TestResult }) {
  const b = r.breakdown ?? {};
  const parts = SEG.map((s) => ({ ...s, v: b[s.key] ?? 0 })).filter((p) => p.v > 0);
  const total = parts.reduce((a, p) => a + p.v, 0) || r.ms;
  if (parts.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[.06]">
        {parts.map((p, i) => (
          <span
            key={p.key}
            className="bench-grow h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${Math.max(1.5, (p.v / total) * 100)}%`, background: p.color, animationDelay: `${i * 120}ms` }}
            title={`${p.label} ${formatMs(p.v)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 tabular-nums">
            <i className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label} <b className="font-semibold text-fg/90">{formatMs(p.v)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const now = useNow(100);
  return <span className="tabular-nums">{((now - since) / 1000).toFixed(1)} s</span>;
}

type BenchRow = { key: string; step: ChainStep; status: "wait" | "run" | "ok" | "err"; ms?: number; error?: string };

export function TestBench({ models, call, chain, testFn }: { models: ModelLists; call: Call; chain: ChainStep[]; testFn: (b: Body, signal?: AbortSignal) => Promise<TestResult> }) {
  const [provider, setProvider] = useState<AiProvider>(chain[0]?.provider ?? "agy");
  const [model, setModel] = useState(chain[0]?.model ?? "");
  const [effort, setEffort] = useState(chain[0]?.effort ?? "");
  const [kind, setKind] = useState<Kind>("image");
  const [skillId, setSkillId] = useState("");
  const [idea, setIdea] = useState("Ly cà phê sữa đá trên bàn gỗ, nắng sớm");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [res, setRes] = useState<TestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [mode, setMode] = useState<"one" | "bench">("one");
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    call<Skill[] | { items: Skill[] }>("/api/admin/skills")
      .then((r) => setSkills(Array.isArray(r) ? r : (r.items ?? [])))
      .catch(() => setSkills([]));
  }, [call]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const kindSkills = skills.filter((s) => s.kind === (kind === "image" ? "IMAGE" : "VIDEO") && s.enabled !== false);
  const list = models[provider];
  const cur = list.find((m) => m.id === model);

  const candidates = useMemo(() => {
    const out: ChainStep[] = [
      ...models.agy.map((m) => ({ provider: "agy" as const, model: m.id })),
      ...models.codex.map((m) => ({ provider: "codex" as const, model: m.id, effort: m.defaultEffort ?? m.efforts?.[0] })),
      { provider: "muse" as const },
    ];
    for (const s of chain) if (!out.some((o) => stepLabel(o) === stepLabel(s))) out.unshift(s);
    return out;
  }, [models, chain]);
  const sel = picked ?? new Set(chain.map(stepLabel));

  const body = (s: ChainStep): Body => ({ provider: s.provider, ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), ...(skillId ? { skillId } : {}), kind, idea: idea.trim() });
  const busy = since !== null;

  async function runOne() {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setRes(null);
    setErr(null);
    setSince(Date.now());
    try {
      setRes(await testFn(body({ provider, model: provider === "muse" ? undefined : model || undefined, effort: provider === "codex" ? effort || undefined : undefined }), c.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      if (ctrl.current === c) setSince(null);
    }
  }

  async function runBench() {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const steps = candidates.filter((s) => sel.has(stepLabel(s)));
    setRows(steps.map((s) => ({ key: stepLabel(s), step: s, status: "wait" })));
    setSince(Date.now());
    // Chạy lần lượt: đo độ trễ thật, không tranh tài nguyên với nhau.
    for (const s of steps) {
      if (c.signal.aborted) break;
      const key = stepLabel(s);
      setRows((rs) => rs.map((r) => (r.key === key ? { ...r, status: "run" } : r)));
      try {
        const r = await testFn(body(s), c.signal);
        setRows((rs) => rs.map((x) => (x.key === key ? { ...x, status: "ok", ms: r.ms } : x)));
      } catch (e) {
        if ((e as Error).name === "AbortError") break;
        setRows((rs) => rs.map((x) => (x.key === key ? { ...x, status: "err", error: (e as Error).message } : x)));
      }
    }
    if (ctrl.current === c) setSince(null);
  }

  return (
    <Panel
      title="Chạy thử"
      icon="play"
      actions={<Segmented size="sm" ariaLabel="Chế độ" value={mode} onChange={setMode} options={[{ value: "one", label: "Một model" }, { value: "bench", label: "Đo nhanh" }]} />}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="Loại">
            <Segmented size="sm" block ariaLabel="Loại" value={kind} onChange={(k) => (setKind(k), setSkillId(""))} options={[{ value: "image", label: "Ảnh" }, { value: "video", label: "Video" }]} />
          </FieldRow>
          <FieldRow label="Skill">
            <Select inputSize="sm" value={skillId} onChange={(e) => setSkillId(e.target.value)} aria-label="Skill">
              <option value="">Tự chọn</option>
              {kindSkills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FieldRow>
        </div>
        {mode === "one" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              ariaLabel="Provider"
              value={provider}
              onChange={(p) => {
                setProvider(p);
                const m = models[p][0];
                setModel(p === "muse" ? "" : (m?.id ?? ""));
                setEffort(m?.defaultEffort ?? m?.efforts?.[0] ?? "");
              }}
              options={AI_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
            />
            {provider !== "muse" && <ModelSelect models={list} value={model} onChange={setModel} className="min-w-44 flex-1" />}
            {provider === "codex" && cur?.efforts && <EffortPicker efforts={cur.efforts} value={effort} onChange={setEffort} />}
          </div>
        ) : (
          <div className="no-scrollbar -mx-1 flex flex-wrap gap-1.5 px-1">
            {candidates.map((s) => {
              const k = stepLabel(s);
              const on = sel.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const n = new Set(sel);
                    if (on) n.delete(k);
                    else n.add(k);
                    setPicked(n);
                  }}
                  className={cx(
                    "press inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-1 text-[12px] font-medium",
                    on ? "bg-white/[.1] text-fg shadow-[inset_0_0_0_1px_rgba(212,255,58,.45)]" : "bg-white/[.04] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-fg",
                  )}
                >
                  <Monogram provider={s.provider} size={22} className="!rounded-full" />
                  <span className="font-mono">{s.model ?? "muse-chat"}</span>
                  {s.effort && <span className="text-dim">{s.effort}</span>}
                </button>
              );
            })}
          </div>
        )}
        <FieldRow label="Ý tưởng">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={2}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy && void (mode === "one" ? runOne() : runBench())}
            className="w-full resize-y rounded-m1 bg-white/[.04] px-3.5 py-2.5 text-[14px] shadow-[inset_0_0_0_1px_var(--color-line2)] outline-none focus:shadow-[inset_0_0_0_1px_rgba(212,255,58,.7)]"
          />
        </FieldRow>
        <div className="flex items-center gap-2">
          {mode === "one" ? (
            <Button variant="primary" size="sm" icon="play" loading={busy} disabled={idea.trim().length < 3} onClick={() => void runOne()}>
              Chạy
            </Button>
          ) : (
            <Button variant="primary" size="sm" icon="gauge" loading={busy} disabled={idea.trim().length < 3 || sel.size === 0} onClick={() => void runBench()}>
              Đo {sel.size} model
            </Button>
          )}
          {busy && (
            <Button variant="ghost" size="sm" icon="stop" onClick={() => (ctrl.current?.abort(), setSince(null))}>
              Dừng
            </Button>
          )}
          {busy && (
            <span className="ml-auto text-xs text-muted">
              <Elapsed since={since} />
            </span>
          )}
        </div>

        {mode === "one" ? (
          <div className="min-h-28 rounded-m2 bg-black/25 p-3.5 hairline">
            {busy ? (
              <div className="space-y-3">
                <span className="flex items-center gap-2 text-xs text-muted">
                  <Monogram provider={provider} size={18} className="!rounded-[6px]" />
                  {model || PROVIDER_LABEL[provider]} đang viết…
                </span>
                <WritingLines />
              </div>
            ) : err ? (
              <p className="text-sm text-danger">{err}</p>
            ) : res ? (
              <div className="text-in space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="aura">
                    {PROVIDER_LABEL[res.provider] ?? res.provider}
                    {res.model ? ` · ${res.model}` : ""}
                  </Badge>
                  <Badge tone="accent">{formatMs(res.ms)}</Badge>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg/90">{res.text}</p>
                <Breakdown r={res} />
              </div>
            ) : (
              <p className="text-sm text-dim">Kết quả hiện ở đây</p>
            )}
          </div>
        ) : (
          <BenchTable rows={rows} />
        )}
      </div>
    </Panel>
  );
}

function BenchTable({ rows }: { rows: BenchRow[] }) {
  if (rows.length === 0) return <div className="rounded-m2 bg-black/25 p-3.5 text-sm text-dim hairline">Chọn model rồi bấm Đo — xếp hạng nhanh → chậm</div>;
  const done = rows.filter((r) => r.status === "ok").sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
  const rest = rows.filter((r) => r.status !== "ok").sort((a, b) => Number(a.status === "err") - Number(b.status === "err"));
  const max = Math.max(1, ...done.map((r) => r.ms ?? 0));
  const best = done[0]?.ms;
  return (
    <ol className="space-y-1.5" aria-label="Xếp hạng độ trễ">
      {[...done, ...rest].map((r, i) => {
        const top = r.status === "ok" && i === 0;
        return (
          <li
            key={r.key}
            className={cx(
              "grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-m2 px-3 py-2.5 transition-[background-color,box-shadow] duration-300",
              top ? "bg-accent/[.07] shadow-[inset_0_0_0_1px_rgba(212,255,58,.35)]" : "bg-white/[.025] hairline",
            )}
          >
            <span className={cx("text-center text-[13px] font-bold tabular-nums", top ? "text-accent" : "text-dim")}>{r.status === "ok" ? i + 1 : "–"}</span>
            <span className="flex min-w-0 items-center gap-2">
              <Monogram provider={r.step.provider} size={22} className="!rounded-[7px]" />
              <span className="truncate font-mono text-[12.5px]">{r.step.model ?? "muse-chat"}</span>
              {r.step.effort && <span className="text-[11px] text-dim">{r.step.effort}</span>}
              {top && rows.length > 1 && <Badge tone="accent" className="!h-5">Nhanh nhất</Badge>}
            </span>
            <span className="text-right text-[13px] font-semibold tabular-nums">
              {r.status === "ok" ? (
                <>
                  {formatMs(r.ms)}
                  {best && r.ms && r.ms > best && <span className="ml-1.5 text-[11px] font-medium text-dim">×{(r.ms / best).toFixed(1)}</span>}
                </>
              ) : r.status === "run" ? (
                <Spinner className="ml-auto h-3.5 w-3.5 text-muted" />
              ) : r.status === "err" ? (
                <span className="text-xs text-danger">Lỗi</span>
              ) : (
                <span className="text-xs text-dim">chờ</span>
              )}
            </span>
            <span className="col-span-3 col-start-1 h-1.5 overflow-hidden rounded-full bg-white/[.05] sm:col-span-2 sm:col-start-2">
              {r.status === "ok" ? (
                <span className="bench-grow block h-full rounded-full" style={{ width: `${Math.max(3, ((r.ms ?? 0) / max) * 100)}%`, background: top ? "var(--color-accent)" : "linear-gradient(90deg,#7c5cff,#ff4fd8)" }} />
              ) : r.status === "run" ? (
                <span className="block h-full w-1/3 animate-pulse rounded-full bg-white/20" />
              ) : null}
            </span>
            {r.status === "err" && r.error && <span className="col-span-3 truncate text-xs text-danger/85">{r.error}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// Gọi API thật (demo dùng testFn khác).
export function makeTestFn(call: Call) {
  return (b: Body, signal?: AbortSignal) => call<TestResult>("/api/admin/ai/test", { ...jsonInit("POST", b), signal });
}
