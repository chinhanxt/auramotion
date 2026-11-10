"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyEvent } from "@/components/library/useJobFeed";
import { useCreditBalance, useJobEvents, useRealtime, useStoryEvents } from "@/components/realtime/Events";
import { useErrorToast } from "@/components/studio/errors";
import { AuraBar, Badge, Empty, Notice } from "@/components/ui/Bits";
import { Button, IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { SmartVideo } from "@/components/ui/Media";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import {
  ACTIVE_STATUSES,
  STATUS_LABEL,
  STORY_ACTIVE,
  STORY_STATUS_LABEL,
  api,
  formatCredit,
  isNotFound,
  jobErrorText,
  patchJson,
  postJson,
  ratioCss,
  type JobItem,
  type StoryDetail,
  type StoryShot,
} from "@/lib/api-client";
import { STORY_TONE } from "./StoryGrid";
import { useShotQuote, useStoryCatalog } from "./useStoryCatalog";

const POLL_MS = 3000;
const LANES = 3;

// Job mới nhất của mỗi cảnh (cảnh quay lại sẽ có nhiều job).
function jobsByShot(jobs: JobItem[]): Map<number, JobItem> {
  const m = new Map<number, JobItem>();
  for (const j of [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (typeof j.shotIndex === "number") m.set(j.shotIndex, j);
  }
  return m;
}

const ShotCard = memo(function ShotCard({
  index,
  shot,
  job,
  aspect,
  editable,
  planning,
  mode,
  order,
  onEdit,
  onRetry,
  retrying,
}: {
  index: number;
  shot?: StoryShot;
  job?: JobItem;
  aspect: string;
  editable: boolean;
  planning: boolean;
  mode: "PARALLEL" | "CHAIN";
  order: number;
  onEdit: (index: number, patch: Partial<StoryShot>) => void;
  onRetry: (index: number) => void;
  retrying: boolean;
}) {
  const url = job?.status === "SUCCEEDED" ? job.resultUrls[0] : undefined;
  const active = job ? ACTIVE_STATUSES.includes(job.status) : false;
  const failed = job?.status === "FAILED" || job?.status === "CANCELED";
  const lane = mode === "CHAIN" ? "Nối tiếp" : `Luồng ${(index % LANES) + 1}`;

  return (
    <article className="reveal relative flex w-[78vw] max-w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-m3 bg-s1 hairline sm:w-[280px]" style={{ "--i": order } as React.CSSProperties}>
      <div className="relative overflow-hidden bg-s2" style={{ aspectRatio: ratioCss(aspect) }}>
        {url ? (
          <SmartVideo src={url} mode="inview" className="blur-in absolute inset-0" />
        ) : active ? (
          <div className="skel skel-aura absolute inset-0 flex flex-col justify-end p-3">
            <div className="relative space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-fg/85">
                <span>{job ? STATUS_LABEL[job.status] : ""}</span>
                {typeof job?.progress === "number" && job.progress > 0 && <span className="tabular-nums text-muted">{Math.round(job.progress)}%</span>}
              </div>
              <AuraBar value={job?.progress} />
            </div>
          </div>
        ) : failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <Icon name="alert" size={22} className="text-danger" />
            <p className="text-xs text-muted">{job?.error ? jobErrorText(job.error) : "Cảnh lỗi"}</p>
            <Button size="sm" variant="subtle" icon="refresh" loading={retrying} onClick={() => onRetry(index)}>
              Quay lại
            </Button>
          </div>
        ) : planning ? (
          <div className="skel absolute inset-0" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(80%_70%_at_30%_20%,rgba(124,92,255,.18),transparent_60%),radial-gradient(70%_70%_at_80%_90%,rgba(255,179,107,.12),transparent_60%)]">
            <span className="text-[44px] font-extrabold tracking-tighter text-white/10 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
          </div>
        )}
        <span className="absolute top-2.5 left-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-md">Cảnh {index + 1}</span>
        <span className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white/75 backdrop-blur-md">
          <span className={cx("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : url ? "bg-ok" : "bg-white/40")} />
          {lane}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {planning && !shot ? (
          <>
            <div className="skel h-4 w-1/2 rounded-full" />
            <div className="skel h-3 w-full rounded-full" />
            <div className="skel h-3 w-4/5 rounded-full" />
          </>
        ) : shot ? (
          editable ? (
            <>
              <input
                defaultValue={shot.title}
                onBlur={(e) => e.target.value !== shot.title && onEdit(index, { title: e.target.value })}
                aria-label={`Tên cảnh ${index + 1}`}
                className="-mx-1 rounded-md bg-transparent px-1 text-sm font-semibold outline-none hover:bg-white/[.04] focus:bg-white/[.06]"
              />
              <textarea
                defaultValue={shot.prompt}
                rows={4}
                onBlur={(e) => e.target.value !== shot.prompt && onEdit(index, { prompt: e.target.value })}
                aria-label={`Prompt cảnh ${index + 1}`}
                className="-mx-1 flex-1 resize-none rounded-md bg-transparent px-1 text-[13px] leading-snug text-muted outline-none hover:bg-white/[.04] focus:bg-white/[.06] focus:text-fg"
              />
            </>
          ) : (
            <>
              <p className="text-in text-sm font-semibold" style={{ "--i": order } as React.CSSProperties}>
                {shot.title}
              </p>
              <p className="text-in line-clamp-4 text-[13px] leading-snug text-muted" style={{ "--i": order + 1 } as React.CSSProperties}>
                {shot.prompt}
              </p>
            </>
          )
        ) : null}
      </div>
    </article>
  );
});

export function StoryView({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const showError = useErrorToast();
  const { live } = useRealtime();
  const { refresh: refreshCredit } = useCreditBalance();
  const cat = useStoryCatalog();
  const [story, setStory] = useState<StoryDetail | null>(null);
  const [missing, setMissing] = useState<"" | "story" | "api">("");
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "render" | "assemble" | "delete">("");
  const [retrying, setRetrying] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const storyRef = useRef(story);
  storyRef.current = story;
  const lastLoad = useRef(0);

  const load = useCallback(
    () =>
      api<{ story: StoryDetail }>(`/api/stories/${id}`)
        .then(({ story: s }) => setStory({ ...s, jobs: s.jobs ?? [] }))
        .catch((e) => {
          if (isNotFound(e)) setMissing(storyRef.current ? "" : "story");
          else if (!storyRef.current) toast.error((e as Error).message);
        }),
    [id, toast],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Route /api/stories chưa có trên server: 404 cả danh sách → báo "sắp có" thay vì "không tìm thấy".
  useEffect(() => {
    if (missing !== "story") return;
    api("/api/stories")
      .then(() => {})
      .catch((e) => isNotFound(e) && setMissing("api"));
  }, [missing]);

  useStoryEvents((e) => {
    if (e.id !== id) return;
    setStory((s) => (s ? { ...s, status: e.status, plan: e.plan ?? s.plan, error: e.error ?? s.error } : s));
    if (e.status === "DONE" || e.status === "RENDERING" || e.status === "READY") load();
  });
  useJobEvents((e) => {
    if (e.storyId && e.storyId !== id) return;
    const known = storyRef.current?.jobs.some((j) => j.id === e.id);
    if (!known) {
      // Job mới của story (vừa bấm quay / quay lại): nạp lại, tối đa 1 lần / 1.5 s.
      if (e.storyId === id && Date.now() - lastLoad.current > 1500) {
        lastLoad.current = Date.now();
        load();
      }
      return;
    }
    setStory((s) => s && { ...s, jobs: s.jobs.map((j) => (j.id === e.id ? applyEvent(j, e) : j)) });
  });

  // Không có SSE: poll khi story đang chạy.
  useEffect(() => {
    if (live) return;
    const t = setInterval(() => {
      const s = storyRef.current;
      if (!s || document.visibilityState === "hidden") return;
      if (STORY_ACTIVE.includes(s.status) || s.jobs.some((j) => ACTIVE_STATUSES.includes(j.status))) load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [live, load]);

  useEffect(() => {
    if (!story?.finalJobId) return setFinalUrl(null);
    api<{ items: JobItem[] }>(`/api/jobs?ids=${story.finalJobId}`)
      .then(({ items }) => setFinalUrl(items[0]?.status === "SUCCEEDED" ? (items[0].resultUrls[0] ?? null) : null))
      .catch(() => {});
  }, [story?.finalJobId, story?.status]);

  const byShot = useMemo(() => jobsByShot(story?.jobs ?? []), [story?.jobs]);
  const shots = story?.plan?.shots ?? [];
  const total = useShotQuote(cat?.videoModel ?? null, story?.aspect ?? "", story?.shotDurationSec ?? 5, story?.shotCount ?? 0);

  const onEdit = useCallback(
    async (index: number, patch: Partial<StoryShot>) => {
      const s = storyRef.current;
      if (!s?.plan) return;
      const next = s.plan.shots.map((sh, k) => (k === index ? { ...sh, ...patch } : sh));
      setStory({ ...s, plan: { shots: next } });
      try {
        await patchJson(`/api/stories/${id}`, { plan: { shots: next } });
      } catch (e) {
        showError(e);
      }
    },
    [id, showError],
  );

  async function saveTitle(title: string) {
    if (!story || title === story.title) return;
    setStory({ ...story, title });
    await patchJson(`/api/stories/${id}`, { title }).catch(showError);
  }

  async function action(kind: "render" | "assemble") {
    setBusy(kind);
    try {
      await postJson(`/api/stories/${id}/${kind}`, {});
      toast.success(kind === "render" ? "Bắt đầu quay" : "Đang ghép video");
      refreshCredit();
      await load();
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }

  const onRetry = useCallback(
    async (index: number) => {
      setRetrying(index);
      try {
        await postJson(`/api/stories/${id}/shots/${index}/retry`, {});
        refreshCredit();
        await load();
      } catch (e) {
        showError(e);
      } finally {
        setRetrying(null);
      }
    },
    [id, load, refreshCredit, showError],
  );

  async function onDelete() {
    setBusy("delete");
    try {
      await api(`/api/stories/${id}`, { method: "DELETE" });
      toast.success("Đã xóa story");
      router.push("/studio/story");
    } catch (e) {
      showError(e);
      setBusy("");
    }
  }

  if (missing === "api") return <Empty icon="story" title="Story sắp có" hint="Máy chủ chưa bật tính năng Story." className="min-h-[60vh]" />;
  if (missing === "story") return <Empty icon="story" title="Không tìm thấy story" action={<Link href="/studio/story" className="text-sm font-medium text-accent">Về Story</Link>} className="min-h-[60vh]" />;
  if (!story) return <StoryViewSkeleton />;

  const planning = story.status === "PLANNING";
  const ready = story.status === "READY";
  const count = Math.max(story.shotCount, shots.length);
  const doneShots = [...byShot.values()].filter((j) => j.status === "SUCCEEDED").length;
  const blocked = cat?.videoUnavailable === true;
  const canAssemble = doneShots > 0 && !STORY_ACTIVE.includes(story.status) && story.status !== "READY";

  return (
    <div className="px-3 pt-3 pb-16 sm:px-5 lg:px-6">
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <IconButton icon="arrowLeft" label="Story" variant="glass" onClick={() => router.push("/studio/story")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STORY_TONE[story.status]} dot={STORY_ACTIVE.includes(story.status)}>
              {STORY_STATUS_LABEL[story.status]}
            </Badge>
            <span className="text-xs text-muted">
              {count} cảnh · {story.shotDurationSec}s · {story.aspect} · {story.mode === "CHAIN" ? "Nối cảnh" : "Song song"}
            </span>
          </div>
          {/* textarea 1 dòng logic để tên dài xuống dòng trên mobile; Enter = lưu */}
          <textarea
            key={story.title}
            defaultValue={story.title}
            placeholder="Story chưa đặt tên"
            rows={1}
            maxLength={120}
            onBlur={(e) => saveTitle(e.target.value.replace(/\s+/g, " ").trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-label="Tên story"
            className="t-h2 -mx-1 mt-1 block w-full resize-none rounded-m1 bg-transparent px-1 outline-none [field-sizing:content] placeholder:text-dim hover:bg-white/[.03] focus:bg-white/[.05]"
          />
          <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-muted">{story.idea}</p>
        </div>
        {(ready || canAssemble) && (
        <div className="order-last flex w-full flex-wrap items-center gap-2 sm:order-none sm:w-auto">
          {ready && (
            <Button variant="primary" size="lg" icon="video" loading={busy === "render"} disabled={blocked} onClick={() => action("render")}>
              Quay tất cả{total !== null && <span className="inline-flex items-center gap-0.5 rounded-[8px] bg-black/10 px-1.5 py-0.5 text-[13px]"><Icon name="coin" size={14} />{formatCredit(total)}</span>}
            </Button>
          )}
          {canAssemble && (
            <Button variant={story.status === "DONE" ? "outline" : "primary"} size="lg" icon="cut" loading={busy === "assemble"} onClick={() => action("assemble")}>
              Ghép lại
            </Button>
          )}
        </div>
        )}
        <IconButton icon="trash" label="Xóa story" variant="ghost" onClick={() => setConfirmDelete(true)} className="sm:order-last" />
      </div>

      {blocked && (ready || story.status === "RENDERING") && (
        <Notice tone="warn" className="mb-4">
          Video Muse tạm không khả dụng — chưa thể quay, không trừ Credit.
        </Notice>
      )}
      {story.error && (
        <Notice tone="danger" className="mb-4">
          {jobErrorText(story.error)}
        </Notice>
      )}

      {(finalUrl || story.status === "ASSEMBLING") && (
        <section className="relative mb-6 overflow-hidden rounded-m4 bg-black hairline">
          {/* Nền: chính khung đầu của video, phóng to + làm mờ để lấp hai bên khung dọc */}
          {finalUrl && (
            <video
              aria-hidden
              tabIndex={-1}
              src={`${finalUrl}#t=0.5`}
              muted
              playsInline
              preload="metadata"
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl"
            />
          )}
          <div className="relative mx-auto max-h-[70vh]" style={{ aspectRatio: ratioCss(story.aspect), maxWidth: `min(100%, calc(70vh * ${story.aspect.split(":").map(Number).reduce((w, h) => w / h)}))` }}>
            {finalUrl ? (
              <video src={`${finalUrl}#t=0.1`} controls playsInline preload="metadata" className="blur-in relative h-full w-full shadow-[0_0_80px_rgba(0,0,0,.6)]" />
            ) : (
              <div className="skel skel-aura absolute inset-0 flex items-end p-5">
                <div className="relative w-full space-y-2">
                  <p className="text-sm font-medium">Đang ghép video…</p>
                  <AuraBar />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="t-label">Kịch bản</h2>
        {story.status !== "PLANNING" && shots.length > 0 && (
          <span className="text-xs text-muted tabular-nums">
            {doneShots}/{count} cảnh xong
          </span>
        )}
      </div>
      <div className="no-scrollbar -mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-stretch">
            <ShotCard
              index={i}
              shot={shots[i]}
              job={byShot.get(i)}
              aspect={story.aspect}
              editable={ready}
              planning={planning}
              mode={story.mode}
              order={i}
              onEdit={onEdit}
              onRetry={onRetry}
              retrying={retrying === i}
            />
            {story.mode === "CHAIN" && i < count - 1 && (
              <span className="flex w-3 items-center justify-center text-dim" aria-hidden="true">
                <Icon name="chevronRight" size={14} />
              </span>
            )}
          </div>
        ))}
      </div>
      {ready && <p className="mt-3 text-xs text-muted">Bấm vào chữ để sửa từng cảnh trước khi quay.</p>}

      <ConfirmDialog
        open={confirmDelete}
        title="Xóa story này?"
        body="Các cảnh đang chờ sẽ bị hủy."
        confirmLabel="Xóa"
        danger
        busy={busy === "delete"}
        onConfirm={onDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function StoryViewSkeleton() {
  return (
    <div className="px-3 pt-3 sm:px-5 lg:px-6">
      <div className="mb-6 flex items-start gap-3">
        <div className="skel h-10 w-10 rounded-m1" />
        <div className="flex-1 space-y-2.5">
          <div className="skel h-5 w-28 rounded-full" />
          <div className="skel h-8 w-1/2 rounded-m1" />
          <div className="skel h-4 w-2/3 rounded-full" />
        </div>
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="w-[78vw] max-w-[300px] shrink-0 overflow-hidden rounded-m3 bg-s1 hairline sm:w-[280px]">
            <div className="skel" style={{ aspectRatio: "9 / 16" }} />
            <div className="space-y-2 p-3">
              <div className="skel h-4 w-1/2 rounded-full" />
              <div className="skel h-3 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
