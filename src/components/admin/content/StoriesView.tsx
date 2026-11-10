"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { STORY_TONE, formatDateTime, timeAgo } from "@/components/admin/format";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { DataList, Meter, Mono, PageHeader, Pager, Progress, UrlFilters, type Col } from "@/components/admin/kit";
import { Badge, Empty, Notice, Skeleton } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { FadeImage, SmartVideo } from "@/components/ui/Media";
import { ConfirmDialog } from "@/components/ui/Overlay";
import {
  STATUS_LABEL,
  STATUS_TONE,
  STORY_STATUS_LABEL,
  api,
  formatCredit,
  isVideoUrl,
  jobErrorText,
  ratioCss,
  type JobStatus,
  type StoryShot,
  type StoryStatus,
} from "@/lib/api-client";

type Row = {
  id: string;
  title: string;
  idea: string;
  status: StoryStatus;
  aspect: string;
  shotCount: number;
  shotDurationSec: number;
  mode: "PARALLEL" | "CHAIN";
  error: string | null;
  finalJobId: string | null;
  createdAt: string;
  user: { id: string; email: string };
  jobCount: number;
  doneCount: number;
  cost: number;
  deletedAt: string | null;
  planner: string;
};

type ShotJob = {
  id: string;
  kind: "IMAGE" | "VIDEO" | "ASSEMBLE";
  status: JobStatus;
  progress: number;
  resultUrls: string[];
  error: string | null;
  shotIndex: number | null;
  cost: string;
  createdAt: string;
};

type Detail = {
  id: string;
  title: string;
  idea: string;
  status: StoryStatus;
  aspect: string;
  shotCount: number;
  shotDurationSec: number;
  mode: "PARALLEL" | "CHAIN";
  autoAssemble: boolean;
  plan: { shots: StoryShot[] } | null;
  error: string | null;
  finalJobId: string | null;
  createdAt: string;
  jobs: ShotJob[];
};

const FINAL: StoryStatus[] = ["DONE", "FAILED", "CANCELED"];
const STATUSES = Object.keys(STORY_STATUS_LABEL) as StoryStatus[];
const SHORT: Record<StoryStatus, string> = {
  PLANNING: "Lập",
  READY: "Sẵn sàng",
  RENDERING: "Quay",
  ASSEMBLING: "Ghép",
  DONE: "Xong",
  FAILED: "Lỗi",
  CANCELED: "Hủy",
};

function StatusBadge({ s }: { s: StoryStatus }) {
  return (
    <Badge tone={STORY_TONE[s]} dot={s === "PLANNING" || s === "RENDERING" || s === "ASSEMBLING"}>
      {STORY_STATUS_LABEL[s]}
    </Badge>
  );
}

export function StoriesView({ data }: { data: { items: Row[]; total: number; page: number; pageSize: number } }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = data.items.filter((s) => !FINAL.includes(s.status)).length;

  const cols: Col<Row>[] = [
    {
      key: "title",
      label: "Story",
      mobile: "title",
      cell: (s) => (
        <div className="min-w-0 max-w-[clamp(180px,22vw,420px)]">
          <p className="truncate font-medium">{s.title || "Chưa đặt tên"}</p>
          <p className="truncate text-xs text-muted">{s.idea}</p>
        </div>
      ),
    },
    { key: "status", label: "Trạng thái", cell: (s) => <StatusBadge s={s.status} /> },
    { key: "user", label: "Người dùng", cell: (s) => <span className="text-[13px] text-fg/80">{s.user.email}</span> },
    {
      key: "shots",
      label: "Cảnh",
      cell: (s) => (
        <div className="ml-auto w-28 md:ml-0">
          <Meter fullTone="ok" used={s.doneCount} limit={s.shotCount} label={<span className="text-dim">{s.mode === "CHAIN" ? "nối" : "song song"}</span>} />
        </div>
      ),
    },
    { key: "cost", label: "Credit", align: "right", cell: (s) => <span className="tabular-nums">{formatCredit(s.cost)}</span> },
    { key: "planner", label: "Lập bởi", mobile: "hide", cell: (s) => <Mono>{s.planner}</Mono> },
    {
      key: "at",
      label: "Tạo",
      align: "right",
      cell: (s) => (
        <span suppressHydrationWarning className="text-xs whitespace-nowrap text-muted" title={formatDateTime(s.createdAt)}>
          {timeAgo(s.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader icon="story" title="Story" sub={`${data.total.toLocaleString("vi-VN")} story · ${active} đang chạy (trang này)`} />
      <UrlFilters
        fields={[
          { name: "status", type: "chips", options: [{ value: "", label: "Tất cả" }, ...STATUSES.map((s) => ({ value: s, label: SHORT[s] }))] },
          { name: "user", type: "search", placeholder: "Email" },
        ]}
      />
      <DataList rows={data.items} cols={cols} rowKey={(s) => s.id} onRowClick={(s) => setOpen(s.id)} empty={<Empty icon="story" title="Chưa có story" className="py-12" />} />
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} />
      <StoryDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Media({ url, aspect }: { url: string; aspect: string }) {
  return (
    <div className="overflow-hidden rounded-m2 bg-s2" style={{ aspectRatio: ratioCss(aspect) }}>
      {isVideoUrl(url) ? <SmartVideo src={url} mode="inview" className="h-full w-full" /> : <FadeImage src={url} alt="" className="h-full w-full" />}
    </div>
  );
}

function StoryDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const router = useRouter();
  const [story, setStory] = useState<Detail | null>(null);
  const [final, setFinal] = useState<ShotJob | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { run, isBusy } = useAction();

  useEffect(() => {
    if (!id) return;
    let live = true;
    setStory(null);
    setFinal(null);
    setError("");
    api<{ story: Detail }>(`/api/admin/stories/${id}`)
      .then(async ({ story: s }) => {
        if (!live) return;
        setStory(s);
        if (s.finalJobId) {
          const inList = s.jobs.find((j) => j.id === s.finalJobId);
          if (inList) setFinal(inList);
          else {
            const r = await api<{ job: ShotJob }>(`/api/admin/jobs/${s.finalJobId}`).catch(() => null);
            if (live && r) setFinal(r.job);
          }
        }
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id]);

  async function cancel() {
    if (!story) return;
    const ok = await run("cancel", () => api(`/api/admin/stories/${story.id}`, jsonInit("DELETE")), { success: "Đã hủy story" });
    setConfirm(false);
    if (ok) {
      setStory((s) => (s ? { ...s, status: "CANCELED" } : s));
      router.refresh();
    }
  }

  const shots = story?.plan?.shots ?? [];
  const shotJobs = (story?.jobs ?? []).filter((j) => j.kind !== "ASSEMBLE" && j.id !== story?.finalJobId);
  // Mỗi cảnh: job mới nhất.
  const latest = new Map<number, ShotJob>();
  for (const j of shotJobs) if (j.shotIndex !== null) latest.set(j.shotIndex, j);

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      size="lg"
      title={story ? story.title || "Chưa đặt tên" : "Story"}
      subtitle={story ? <Mono className="text-[11px] text-dim">{story.id}</Mono> : undefined}
      footer={
        story &&
        !FINAL.includes(story.status) && (
          <div className="flex justify-end">
            <Button variant="danger" size="sm" icon="stop" onClick={() => setConfirm(true)}>
              Hủy story
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-5 p-5">
        {error && <Notice tone="danger">{error}</Notice>}
        {!story && !error && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-16" />
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-m2" />
            ))}
          </div>
        )}
        {story && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge s={story.status} />
              <Badge>
                <Icon name="ratio" size={11} />
                {story.aspect}
              </Badge>
              <Badge>{story.mode === "CHAIN" ? "Nối cảnh" : "Song song"}</Badge>
              <Badge>
                <Icon name="film" size={11} />
                {story.shotCount} × {story.shotDurationSec}s
              </Badge>
              {story.autoAssemble && <Badge tone="info">Tự ghép</Badge>}
              <span className="ml-auto text-xs text-muted">{formatDateTime(story.createdAt)}</span>
            </div>
            <p className="rounded-m2 bg-s2/60 p-3 text-[13.5px] leading-relaxed text-fg/85 hairline">{story.idea}</p>
            {story.error && <Notice tone="danger">{jobErrorText(story.error)}</Notice>}

            {final && final.resultUrls[0] && (
              <section>
                <h3 className="t-label mb-2">Video cuối</h3>
                <video src={final.resultUrls[0]} controls playsInline className="w-full max-w-sm rounded-m2 bg-black" style={{ aspectRatio: ratioCss(story.aspect) }} />
              </section>
            )}

            <section>
              <h3 className="t-label mb-2">Cảnh · {shots.length}</h3>
              {shots.length === 0 ? (
                <p className="text-sm text-dim">{story.status === "PLANNING" ? "Đang lập kịch bản…" : "Chưa có kịch bản"}</p>
              ) : (
                <ol className="space-y-2.5">
                  {shots.map((s) => {
                    const j = latest.get(s.index);
                    const url = j?.resultUrls[0];
                    return (
                      <li key={s.index} className="grid grid-cols-[88px_1fr] gap-3 rounded-m2 bg-s2/50 p-2.5 hairline sm:grid-cols-[110px_1fr]">
                        <div>
                          {url ? (
                            <Media url={url} aspect={story.aspect} />
                          ) : (
                            <Skeleton aura={j?.status === "RUNNING"} className="rounded-m2" style={{ aspectRatio: ratioCss(story.aspect) }} />
                          )}
                        </div>
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-semibold text-dim tabular-nums">#{s.index + 1}</span>
                            <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{s.title}</p>
                            {j && <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>}
                          </div>
                          <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted">{s.prompt}</p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
                            {s.camera && (
                              <span className="flex items-center gap-1">
                                <Icon name="camera" size={12} />
                                {s.camera}
                              </span>
                            )}
                            <span>{s.durationSec}s</span>
                            {j && <span>· {formatCredit(j.cost)} Credit</span>}
                          </div>
                          {j && (j.status === "RUNNING" || j.status === "PENDING") && <Progress value={j.progress} />}
                          {j?.error && <p className="text-xs text-danger">{jobErrorText(j.error)}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
            {shotJobs.length > latest.size && <p className="text-xs text-dim">{shotJobs.length - latest.size} lần quay lại trước đó</p>}
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title="Hủy story?"
        body="Cảnh đang chờ bị hủy, Credit được hoàn."
        danger
        confirmLabel="Hủy story"
        busy={isBusy("cancel")}
        onConfirm={cancel}
        onClose={() => setConfirm(false)}
      />
    </Drawer>
  );
}
