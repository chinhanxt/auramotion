"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Badge, Empty } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { formatCredit, jobErrorText } from "@/lib/api-client";
import type { getOpsSnapshot } from "@/server/services/admin-ops";
import type { Stats, StatsRange } from "@/server/services/admin";
import { Chart } from "../Chart";
import { KIND_ICON, KIND_LABEL, formatNumber, formatVnd, timeAgo } from "../format";
import { usePoll } from "../hooks";
import { PageHeader, Panel, Stat } from "../kit";
import type { Plain } from "../plain";
import { HealthPanel, LiveDot, QueueStrip, SlotMeters, type MuseSlots, type QueuesData } from "./live";

type Ops = Plain<Awaited<ReturnType<typeof getOpsSnapshot>>>;

const RANGE_OPTS: { value: StatsRange; label: string }[] = [
  { value: "1d", label: "Hôm nay" },
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
];

function compactVnd(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}tr`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

export function DashboardView({ range, stats, ops, slots }: { range: StatsRange; stats: Stats; ops: Ops; slots: MuseSlots }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const queues = usePoll<QueuesData>("/api/admin/queues", 5000);
  const daily = stats.daily.map((d) => ({ ...d, label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}` }));
  const totalSubs = stats.usersByPlan.reduce((s, p) => s + p.users, 0);
  const maxCredits = Math.max(1, ...stats.creditsByModel.map((m) => m.credits));
  const rate = ops.successRate;

  return (
    <div className={cx("space-y-4 transition-opacity", pending && "opacity-70")}>
      <PageHeader
        icon="gauge"
        title="Tổng quan"
        actions={
          <Segmented size="sm" ariaLabel="Khoảng thời gian" options={RANGE_OPTS} value={range} onChange={(v) => start(() => router.push(`/admin?range=${v}`, { scroll: false }))} />
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
        <Stat i={0} icon="users" label="Người dùng" value={formatNumber(ops.users)} hint={`+${formatNumber(stats.newUsers)} mới`} href="/admin/users" />
        <Stat i={1} icon="layers" label="Tác vụ hôm nay" value={formatNumber(ops.jobsToday)} hint={`${ops.activeNow} đang chạy`} href="/admin/jobs" />
        <Stat
          i={2}
          icon="check"
          label="Thành công"
          value={rate === null ? "—" : `${rate.toLocaleString("vi-VN")}%`}
          tone={rate === null ? undefined : rate >= 90 ? "ok" : rate >= 70 ? "warn" : "danger"}
          hint={`${ops.failedToday} lỗi hôm nay`}
        />
        <Stat i={3} icon="card" label="Doanh thu" value={formatVnd(stats.revenue)} hint={RANGE_OPTS.find((r) => r.value === range)?.label} href="/admin/payments" />
        <Stat i={4} icon="bolt" label="Credit đã tiêu" value={formatCredit(stats.creditsSpent)} hint={`${formatNumber(stats.images)} ảnh · ${formatNumber(stats.videos)} video`} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="t-label text-[10px]">Hàng đợi</p>
          <LiveDot at={queues.at} />
        </div>
        <QueueStrip data={queues.data} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Lượt tạo" icon="sparkle" actions={<Legend items={[["Ảnh", "#d4ff3a"], ["Video", "#7c5cff"], ["Ghép", "#ff4fd8"]]} />}>
          <Chart
            data={daily}
            xKey="label"
            series={[
              { key: "images", label: "Ảnh", color: "#d4ff3a" },
              { key: "videos", label: "Video", color: "#7c5cff" },
              { key: "assembles", label: "Ghép", color: "#ff4fd8" },
            ]}
            height={330}
          />
        </Panel>
        <HealthPanel />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Doanh thu" icon="card" actions={<span className="text-sm font-semibold tabular-nums">{formatVnd(stats.revenue)}</span>}>
          <Chart data={daily} xKey="label" series={[{ key: "revenue", label: "Doanh thu", color: "#ffb36b" }]} height={196} format={compactVnd} />
        </Panel>
        <Panel title="Slot Muse" icon="bolt" actions={<Link href="/admin/muse" className="text-xs text-muted hover:text-fg">Sửa</Link>}>
          <SlotMeters used={queues.data?.museSlots} limits={slots} />
        </Panel>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Lỗi gần đây" icon="alert" pad={false} actions={<Link href="/admin/jobs?status=FAILED" className="text-xs text-muted hover:text-fg">Tất cả</Link>}>
          {ops.recentFailed.length === 0 ? (
            <Empty icon="check" title="Không có lỗi" className="py-10" />
          ) : (
            <ul className="divide-y divide-line">
              {ops.recentFailed.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-m1 bg-danger/10 text-danger">
                    <Icon name={KIND_ICON[j.kind]} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{j.prompt || KIND_LABEL[j.kind]}</span>
                    <span className="block truncate text-xs text-muted">
                      {j.model.name} · {j.user.email}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right sm:block">
                    <Badge tone="danger">{j.error ? jobErrorText(j.error) : "Lỗi"}</Badge>
                    <span suppressHydrationWarning className="mt-1 block text-[11px] text-dim">{timeAgo(j.finishedAt ?? j.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="grid gap-4">
          <Panel title="Thuê bao" icon="tag">
            <ul className="space-y-3">
              {stats.usersByPlan.map((p) => {
                const pct = totalSubs ? Math.round((p.users / totalSubs) * 100) : 0;
                return (
                  <li key={p.code}>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-muted">{p.name}</span>
                      <span className="font-semibold tabular-nums">
                        {formatNumber(p.users)} <span className="text-dim">· {pct}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[.07]">
                      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: "var(--aura)" }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Panel title="Credit theo engine" icon="cpu">
            {stats.creditsByModel.length === 0 ? (
              <p className="text-sm text-muted">—</p>
            ) : (
              <ul className="space-y-2.5">
                {stats.creditsByModel.slice(0, 6).map((m) => {
                  const avg = stats.avgSecondsByModel.find((a) => a.modelId === m.modelId);
                  return (
                    <li key={m.modelId} className="text-xs">
                      <div className="mb-1 flex justify-between gap-2">
                        <span className="truncate text-fg/85">{m.name}</span>
                        <span className="shrink-0 tabular-nums">
                          {formatCredit(m.credits)}
                          {avg && <span className="text-dim"> · {avg.seconds}s</span>}
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
                        <div className="h-full rounded-full bg-aura1" style={{ width: `${(m.credits / maxCredits) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <span className="flex gap-3 text-[11px] text-muted">
      {items.map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: c }} />
          {l}
        </span>
      ))}
    </span>
  );
}
