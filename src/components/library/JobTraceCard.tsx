"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ProviderLogo } from "@/components/ui/VendorLogo";
import { api, isNotFound, toTrace, type JobTrace } from "@/lib/api-client";
import { aiLabel } from "@/lib/providers";

type StepState = "done" | "current" | "pending" | "failed";
type Step = { key: string; icon: IconName; title: string; detail?: React.ReactNode; ms?: number; badge?: string; state: StepState };

const sec = (ms?: number) => (ms === undefined ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
// Logo hãng (theo model) + "Google · Flash 3.8 · Nhanh".
function AiTag({ ai }: { ai?: { provider: string; model?: string | null } }) {
  if (!ai?.provider) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle" title={ai.model ?? undefined}>
      <ProviderLogo provider={ai.provider} model={ai.model} size={14} plain />
      <span className="min-w-0 truncate">{aiLabel(ai.provider, ai.model)}</span>
    </span>
  );
}

function steps(t: JobTrace): Step[] {
  const failed = Boolean(t.failedAt && !t.doneAt);
  const wrote = t.writeStart !== undefined || Boolean(t.writer);
  const writing = wrote && t.writeEnd === undefined;
  const engineStart = t.submitAt ?? t.slotAt;
  const engineDone = Boolean(t.doneAt);
  const st = (done: boolean, current: boolean): StepState => (done ? "done" : current ? (failed ? "failed" : "current") : "pending");
  const out: Step[] = [{ key: "idea", icon: "edit", title: "Ý tưởng", state: "done" }];
  if (wrote) {
    const r = t.router;
    const rms = r?.method === "ai" ? (r.ms ?? 0) : 0;
    if (r || t.writer?.skill) {
      out.push({
        key: "skill",
        icon: "wand",
        title: "Chọn skill",
        detail: (
          <>
            {r?.chosen ?? t.writer?.skill}
            {r?.candidates?.length ? <span className="text-dim"> · {r.method === "ai" ? "AI chọn" : "luật"} / {r.candidates.length}</span> : null}
          </>
        ),
        ms: r?.ms,
        state: st(!writing || Boolean(r), writing),
      });
    }
    out.push({
      key: "write",
      icon: "sparkle",
      title: "AI viết",
      detail: t.writer?.provider ? <AiTag ai={t.writer} /> : undefined,
      ms: t.writeEnd !== undefined && t.writeStart !== undefined ? Math.max(0, t.writeEnd - t.writeStart - rms) : undefined,
      badge: t.writer?.cache ? "cache" : undefined,
      state: st(!writing, writing),
    });
    if (t.guard) {
      const n = t.guard.fixes?.length ?? 0;
      out.push({ key: "guard", icon: "shield", title: "Kiểm prompt", detail: n ? `Tự sửa ${n}: ${t.guard.fixes!.join(", ")}` : "Không cần sửa", state: st(!writing, false) });
    }
  }
  out.push({
    key: "engine",
    icon: "cpu",
    title: engineStart === undefined && !writing && !engineDone ? "Chờ engine" : "Engine",
    detail: t.engine?.provider ? <AiTag ai={t.engine} /> : undefined,
    ms: engineDone && engineStart !== undefined ? t.doneAt! - engineStart : undefined,
    state: st(engineDone, !writing),
  });
  const total = t.createdAt !== undefined && (t.doneAt ?? t.failedAt) ? (t.doneAt ?? t.failedAt)! - t.createdAt : undefined;
  out.push({ key: "end", icon: failed ? "alert" : "check", title: failed ? "Lỗi" : "Xong", ms: total, state: engineDone ? "done" : failed ? "failed" : "pending" });
  return out;
}

// "Luồng xử lý" của 1 job: đường ống dọc, mốc thật từ trace.
export function JobTraceCard({ jobId, initial, active }: { jobId: string; initial?: unknown; active: boolean }) {
  const [trace, setTrace] = useState<JobTrace | null>(() => toTrace(initial));
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (gone) return;
    if (trace && !active) return;
    let off = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const t = toTrace(await api<unknown>(`/api/jobs/${encodeURIComponent(jobId)}/trace`, { cache: "no-store" }));
        if (off) return;
        if (t) setTrace(t);
        if (t?.doneAt || t?.failedAt) return;
      } catch (e) {
        if (off) return;
        if (isNotFound(e)) return setGone(true);
      }
      if (active) timer = setTimeout(load, 3000);
    };
    void load();
    return () => {
      off = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, active, gone]);

  if (!trace) return null;
  const list = steps(trace);
  return (
    <section className="space-y-3">
      <h2 className="t-label">Luồng xử lý</h2>
      <ol className="relative">
        {list.map((s, i) => {
          const last = i === list.length - 1;
          return (
            <li key={s.key} className="reveal relative flex gap-3 pb-3.5 last:pb-0" style={{ "--i": i } as React.CSSProperties}>
              {!last && (
                <span className="absolute top-7 bottom-0 left-[13px] w-px overflow-hidden bg-white/[.08]" aria-hidden="true">
                  <span
                    className={cx("trace-fill absolute inset-0 origin-top", s.state === "done" ? "bg-[linear-gradient(180deg,#7c5cff,#ff4fd8)]" : s.state === "current" ? "trace-flow" : "scale-y-0")}
                    style={{ animationDelay: `${i * 90}ms` }}
                  />
                </span>
              )}
              <span
                className={cx(
                  "relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                  s.state === "done" && "bg-white/[.08] text-fg shadow-[inset_0_0_0_1px_rgba(255,255,255,.14)]",
                  s.state === "current" && "bg-accent text-accent-ink shadow-[0_0_18px_rgba(212,255,58,.5)]",
                  s.state === "pending" && "bg-white/[.03] text-dim shadow-[inset_0_0_0_1px_var(--color-line)]",
                  s.state === "failed" && "bg-danger/20 text-danger shadow-[inset_0_0_0_1px_rgba(255,92,108,.5)]",
                )}
              >
                {s.state === "current" && <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" aria-hidden="true" />}
                <Icon name={s.icon} size={14} className="relative" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className={cx(s.state === "pending" && "text-muted")}>{s.title}</span>
                  {s.badge && <span className="rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-bold text-accent">{s.badge}</span>}
                  {s.ms !== undefined && <span className="ml-auto text-[12px] font-medium text-muted tabular-nums">{sec(s.ms)}</span>}
                </p>
                {s.detail && <p className="mt-0.5 text-[12px] break-words text-muted">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
