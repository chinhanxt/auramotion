"use client";

import Link from "next/link";
import { Badge, Empty, Notice, Skeleton } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api-client";
import { KIND_ICON, KIND_LABEL, timeAgo } from "../format";
import { jsonInit, useAction, usePoll } from "../hooks";
import { DataList, PageHeader, Panel, Progress, type Col } from "../kit";
import { LiveDot, QUEUE_META, SlotMeters, type MuseSlots, type QueueInfo, type QueuesData, type RunningJob } from "./live";

const COUNT_ITEMS: { key: keyof QueueInfo["counts"]; label: string; tone?: string }[] = [
  { key: "active", label: "Chạy", tone: "text-accent" },
  { key: "waiting", label: "Chờ" },
  { key: "delayed", label: "Hẹn" },
  { key: "failed", label: "Lỗi", tone: "text-danger" },
];

function QueueCard({ q, i, onToggle, busy }: { q: QueueInfo; i: number; onToggle: () => void; busy: boolean }) {
  const meta = QUEUE_META[q.name];
  const waiting = q.counts.waiting + q.counts.prioritized;
  return (
    <section className="reveal min-w-0 rounded-m3 bg-s1 p-4 hairline" style={{ "--i": i } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2.5 font-semibold">
          <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-m1", q.counts.active ? "bg-accent/15 text-accent" : "bg-white/[.04] text-muted")}>
            <Icon name={meta.icon} size={17} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px]">{meta.label}</span>
            <span className="block font-mono text-[11px] font-normal text-dim">{q.name}</span>
          </span>
        </h2>
        {q.paused ? <Badge tone="warn" dot>Tạm dừng</Badge> : <Badge tone="ok" dot>Chạy</Badge>}
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {COUNT_ITEMS.map((c) => {
          const v = c.key === "waiting" ? waiting : q.counts[c.key];
          return (
            <div key={c.key} className="min-w-0 rounded-m1 bg-white/[.03] px-2 py-2 text-center">
              <p className={cx("text-xl leading-none font-bold tabular-nums", v > 0 ? (c.tone ?? "text-fg") : "text-dim")}>{v}</p>
              <p className="mt-1 text-[11px] text-muted">{c.label}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-dim tabular-nums">{q.counts.completed} xong</span>
        <Button size="sm" variant={q.paused ? "primary" : "outline"} icon={q.paused ? "play" : "pause"} loading={busy} onClick={onToggle}>
          {q.paused ? "Chạy tiếp" : "Tạm dừng"}
        </Button>
      </div>
    </section>
  );
}

export function QueuesView({ slots }: { slots: MuseSlots }) {
  const poll = usePoll<QueuesData>("/api/admin/queues", 5000);
  const { run, isBusy } = useAction();
  const data = poll.data;

  async function toggle(q: QueueInfo) {
    const action = q.paused ? "resume" : "pause";
    const r = await run(q.name, () => api<{ name: string; paused: boolean }>(`/api/admin/queues/${q.name}/${action}`, jsonInit("POST")), {
      success: q.paused ? `${QUEUE_META[q.name].label}: chạy tiếp` : `${QUEUE_META[q.name].label}: đã dừng`,
    });
    if (r) poll.setData((d) => d && { ...d, queues: d.queues.map((x) => (x.name === q.name ? { ...x, paused: r.paused } : x)) });
  }

  const cols: Col<RunningJob>[] = [
    {
      key: "job",
      label: "Tác vụ",
      mobile: "title",
      cell: (j) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-m1 bg-white/[.04] text-muted">
            <Icon name={KIND_ICON[j.kind]} size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{j.model.name}</span>
            <span className="block truncate text-xs text-muted">
              {KIND_LABEL[j.kind]}
              {j.storyId && (
                <>
                  {" · "}
                  <Link href="/admin/stories" className="hover:text-fg">
                    Story cảnh {(j.shotIndex ?? 0) + 1}
                  </Link>
                </>
              )}
            </span>
          </span>
        </span>
      ),
    },
    { key: "user", label: "Người dùng", cell: (j) => <span className="block max-w-56 truncate text-[13px] text-fg/85">{j.user.email}</span> },
    {
      key: "progress",
      label: "Tiến độ",
      width: "28%",
      mobile: "full",
      cell: (j) => (
        <span className="flex items-center gap-2.5">
          <Progress value={j.progress} />
          <span className="w-9 shrink-0 text-right text-xs text-muted tabular-nums">{j.progress}%</span>
        </span>
      ),
    },
    { key: "started", label: "Bắt đầu", align: "right", cell: (j) => <span className="text-xs text-muted tabular-nums">{timeAgo(j.startedAt)}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader icon="layers" title="Hàng đợi" sub={<LiveDot at={poll.at} />} />
      {poll.error && !data && <Notice tone="danger">{poll.error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data
          ? data.queues.map((q, i) => <QueueCard key={q.name} q={q} i={i} busy={isBusy(q.name)} onToggle={() => void toggle(q)} />)
          : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[186px] rounded-m3" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <p className="t-label text-[10px]">Đang chạy</p>
            <span className="text-xs text-dim tabular-nums">{data?.running.length ?? ""}</span>
          </div>
          {data ? (
            <DataList rows={data.running} cols={cols} rowKey={(j) => j.id} dense empty={<Empty icon="check" title="Không có tác vụ đang chạy" className="py-12" />} />
          ) : (
            <Skeleton className="h-48 rounded-m3" />
          )}
        </div>
        <Panel title="Slot Muse" icon="bolt" actions={<Link href="/admin/muse" className="text-xs text-muted hover:text-fg">Sửa</Link>}>
          <SlotMeters used={data?.museSlots} limits={slots} />
        </Panel>
      </div>
    </div>
  );
}
