"use client";

import Link from "next/link";
import { Badge, Skeleton } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/Icon";
import { usePoll } from "../hooks";
import { Dot, Meter, Panel } from "../kit";
import { PROVIDER_LABEL, formatMs, timeAgo } from "../format";

// ───────── Kiểu dữ liệu API ─────────

export type EngineHealth = {
  muse: { ok: boolean; driver: string | null; accounts: number | null };
  agy: { ok: boolean; version?: string };
  codex: { ok: boolean; version?: string };
  vieneu: { ok: boolean };
  ffmpeg: { ok: boolean };
};

export type ProviderHealth = { lastOkAt: string | null; lastErrAt: string | null; lastError: string | null; lastMs: number | null };
export type Provider = "agy" | "codex" | "muse";
export type GatewaySetting = { order: Provider[]; agyModel?: string; codexModel?: string; museModel?: string; timeoutSec: number };
export type GatewayData = { setting: GatewaySetting; health: Record<Provider, ProviderHealth> };

export type QueueCounts = { waiting: number; active: number; delayed: number; failed: number; completed: number; prioritized: number };
export type QueueInfo = { name: "muse" | "cli" | "post" | "story"; paused: boolean; counts: QueueCounts };
export type RunningJob = {
  id: string;
  kind: "IMAGE" | "VIDEO" | "ASSEMBLE";
  userId: string;
  storyId: string | null;
  shotIndex: number | null;
  progress: number;
  startedAt: string | null;
  museTaskId: string | null;
  model: { name: string; provider: string };
  user: { email: string };
};
export type QueuesData = { queues: QueueInfo[]; running: RunningJob[]; museSlots: Record<SlotType, number> };

export type SlotType = "image" | "video" | "chat";
export type MuseSlots = { image: number; video: number; chat: number; gapSec: number; sendVideoAspect: boolean };

export const QUEUE_META: Record<QueueInfo["name"], { label: string; icon: IconName }> = {
  muse: { label: "Muse", icon: "bolt" },
  cli: { label: "agy / Codex", icon: "cpu" },
  post: { label: "Hậu kỳ", icon: "cut" },
  story: { label: "Story", icon: "story" },
};

export const SLOT_LABEL: Record<SlotType, { label: string; icon: IconName }> = {
  image: { label: "Ảnh", icon: "image" },
  video: { label: "Video", icon: "video" },
  chat: { label: "Chat", icon: "text" },
};

// Provider khỏe = lần ok gần hơn lần lỗi.
export function providerState(h: ProviderHealth | undefined): "ok" | "danger" | "neutral" {
  if (!h || (!h.lastOkAt && !h.lastErrAt)) return "neutral";
  if (!h.lastErrAt) return "ok";
  if (!h.lastOkAt) return "danger";
  return new Date(h.lastOkAt) >= new Date(h.lastErrAt) ? "ok" : "danger";
}

// ───────── Sức khỏe engine ─────────

function EngineRow({ name, ok, detail, icon }: { name: string; ok: boolean | null; detail?: React.ReactNode; icon: IconName }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-m1 bg-white/[.04] text-muted">
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{name}</span>
        {detail && <span className="block truncate text-xs text-muted">{detail}</span>}
      </span>
      {ok === null ? <Dot tone="neutral" /> : <Badge tone={ok ? "ok" : "danger"} dot>{ok ? "OK" : "Lỗi"}</Badge>}
    </li>
  );
}

export function HealthPanel({ className }: { className?: string }) {
  const engines = usePoll<EngineHealth>("/api/admin/engines/health", 30_000);
  const gateway = usePoll<GatewayData>("/api/admin/gateway", 15_000);
  const h = engines.data;
  return (
    <Panel
      title="Engine"
      icon="pulse"
      className={className}
      bodyClassName="px-4 pb-2 pt-1 sm:px-5"
      actions={
        <button
          type="button"
          onClick={() => {
            void engines.refresh();
            void gateway.refresh();
          }}
          className="press flex h-7 w-7 items-center justify-center rounded-m1 text-muted hover:bg-white/[.06] hover:text-fg"
          aria-label="Kiểm tra lại"
        >
          <Icon name="refresh" size={15} />
        </button>
      }
    >
      {!h ? (
        engines.error ? (
          <p className="py-4 text-sm text-danger">{engines.error}</p>
        ) : (
          <div className="space-y-3 py-2.5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )
      ) : (
        <ul className="divide-y divide-line">
          <EngineRow icon="bolt" name="MUSE" ok={h.muse.ok} detail={h.muse.ok ? `${h.muse.driver ?? "?"} · ${h.muse.accounts ?? 0} tài khoản` : "Không kết nối"} />
          <EngineRow icon="sparkle" name="agy" ok={h.agy.ok} detail={h.agy.version} />
          <EngineRow icon="cpu" name="Codex" ok={h.codex.ok} detail={h.codex.version} />
          <EngineRow icon="mic" name="VieNeu" ok={h.vieneu.ok} />
          <EngineRow icon="film" name="ffmpeg" ok={h.ffmpeg.ok} />
        </ul>
      )}
      <div className="mt-1 border-t border-line pt-3 pb-2">
        <p className="t-label mb-2 text-[10px]">AI Gateway</p>
        <div className="grid grid-cols-3 gap-2">
          {(["agy", "codex", "muse"] as Provider[]).map((p) => {
            const ph = gateway.data?.health[p];
            const st = providerState(ph);
            return (
              <Link key={p} href="/admin/gateway" className="press min-w-0 rounded-m1 bg-white/[.03] px-2.5 py-2 hairline hover:bg-white/[.06]">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Dot tone={st} />
                  <span className="truncate">{PROVIDER_LABEL[p]}</span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-dim tabular-nums">
                  {gateway.data ? (ph?.lastMs != null ? formatMs(ph.lastMs) : "—") : "…"}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// ───────── Hàng đợi (dải ngang) ─────────

export function QueueStrip({ data, loading }: { data?: QueuesData; loading?: boolean }) {
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className={cx("h-[62px] rounded-m2", loading === false && "opacity-50")} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {data.queues.map((q) => {
        const meta = QUEUE_META[q.name];
        const busy = q.counts.active > 0;
        return (
          <Link
            key={q.name}
            href="/admin/queues"
            className="press flex min-w-0 items-center gap-3 rounded-m2 bg-s1 px-3.5 py-3 hairline hover:bg-s2"
          >
            <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-m1", busy ? "bg-accent/15 text-accent" : "bg-white/[.04] text-muted")}>
              <Icon name={meta.icon} size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <span className="truncate">{meta.label}</span>
                {q.paused && <Badge tone="warn">Dừng</Badge>}
              </span>
              <span className="mt-0.5 flex gap-2.5 text-[11.5px] text-muted tabular-nums">
                <span title="Đang chạy" className={busy ? "text-fg" : undefined}>
                  ▶ {q.counts.active}
                </span>
                <span title="Chờ">◷ {q.counts.waiting + q.counts.prioritized + q.counts.delayed}</span>
                <span title="Lỗi" className={q.counts.failed ? "text-danger" : undefined}>
                  ✕ {q.counts.failed}
                </span>
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ───────── Slot Muse ─────────

export function SlotMeters({ used, limits }: { used?: Record<SlotType, number>; limits: MuseSlots }) {
  return (
    <div className="space-y-3.5">
      {(Object.keys(SLOT_LABEL) as SlotType[]).map((t) => (
        <Meter
          key={t}
          used={used?.[t] ?? 0}
          limit={limits[t]}
          label={
            <span className="inline-flex items-center gap-1.5">
              <Icon name={SLOT_LABEL[t].icon} size={14} />
              {SLOT_LABEL[t].label}
            </span>
          }
        />
      ))}
      <p className="text-xs text-dim">
        Giãn cách video {limits.gapSec}s · {limits.sendVideoAspect ? "gửi tỷ lệ" : "không gửi tỷ lệ"}
      </p>
    </div>
  );
}

export function LiveDot({ at }: { at: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Dot tone="ok" pulse />
      {at ? timeAgo(at) : "…"}
    </span>
  );
}
