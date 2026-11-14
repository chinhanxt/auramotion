"use client";

import { useEffect, useState } from "react";
import { Badge, Skeleton } from "@/components/ui/Bits";
import { Icon } from "@/components/ui/Icon";
import { formatMs, timeAgo } from "../format";
import { providerState, type ProviderHealth } from "../engine/live";

// Đồng hồ dùng chung cho đếm ngược (1 s).
export function useNow(ms = 1000, on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)} ngày ${h % 24}g`;
  if (h > 0) return `${h}g ${String(m).padStart(2, "0")}p`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function Countdown({ until, prefix }: { until: number; prefix?: string }) {
  const now = useNow();
  const left = until - now;
  if (left <= 0) return null;
  return (
    <span suppressHydrationWarning className="tabular-nums">
      {prefix}
      {fmtLeft(left)}
    </span>
  );
}

export function HealthLine({ h, loading, ready }: { h?: ProviderHealth; loading?: boolean; ready?: boolean }) {
  if (!h)
    return loading ? (
      <Skeleton className="h-4 w-40" />
    ) : ready ? (
      <Badge tone="ok" dot>
        Sẵn sàng · chưa dùng
      </Badge>
    ) : (
      <span className="text-xs text-dim">Chưa sẵn sàng</span>
    );
  const st = providerState(h);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <Badge tone={st === "ok" ? "ok" : st === "danger" ? "danger" : "neutral"} dot>
        {st === "ok" ? "OK" : st === "danger" ? "Lỗi" : ready ? "Sẵn sàng · chưa dùng" : "Chưa dùng"}
      </Badge>
      <span className="text-muted tabular-nums">
        <Icon name="clock" size={12} className="mr-1 inline -translate-y-px" />
        {formatMs(h.lastMs)}
      </span>
      {h.lastOkAt && (
        <span suppressHydrationWarning className="text-dim">
          ok {timeAgo(h.lastOkAt)}
        </span>
      )}
      {h.lastErrAt && st === "danger" && (
        <span suppressHydrationWarning className="text-dim">
          lỗi {timeAgo(h.lastErrAt)}
        </span>
      )}
    </span>
  );
}
