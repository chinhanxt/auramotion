"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { StoryGrid } from "@/components/story/StoryGrid";
import { Empty, Notice } from "@/components/ui/Bits";
import { LinkButton, Spinner } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { STATUS_LABEL, api, type GenKind, type JobItem, type JobStatus } from "@/lib/api-client";
import { JobTile } from "./JobTile";
import type { LightboxEntry } from "./Lightbox";
import { useInfiniteSentinel, useJobFeed } from "./useJobFeed";

const Lightbox = dynamic(() => import("./Lightbox"), { ssr: false });

type Filter = "all" | GenKind | "story";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "image", label: "Ảnh" },
  { value: "video", label: "Video" },
  { value: "assemble", label: "Ghép" },
  { value: "story", label: "Story" },
];
const STATUSES: JobStatus[] = ["RUNNING", "PENDING", "SUCCEEDED", "FAILED", "CANCELED"];

export function MasonrySkeleton({ count = 12 }: { count?: number }) {
  const ratios = ["1 / 1", "9 / 16", "4 / 5", "16 / 9", "1 / 1", "9 / 16"];
  return (
    <div className="masonry">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel rounded-m2" style={{ aspectRatio: ratios[i % ratios.length] }} />
      ))}
    </div>
  );
}

function JobMasonry({ kind, status }: { kind?: GenKind; status: JobStatus | "" }) {
  const toast = useToast();
  const feed = useJobFeed({ kind, status });
  const [open, setOpen] = useState<{ start: number; origin: DOMRect } | null>(null);
  const [confirm, setConfirm] = useState<JobItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const sentinel = useInfiniteSentinel(feed.loadMore, Boolean(feed.nextCursor) && !feed.loadingMore, feed.items.length);

  const entries = useMemo<LightboxEntry[]>(
    () => feed.items.filter((j) => j.status === "SUCCEEDED").flatMap((job) => job.resultUrls.map((_, index) => ({ job, index }))),
    [feed.items],
  );
  const onOpen = useCallback(
    (job: JobItem, index: number, el: HTMLElement) => {
      const start = entries.findIndex((e) => e.job.id === job.id && e.index === index);
      if (start >= 0) setOpen({ start, origin: el.getBoundingClientRect() });
    },
    [entries],
  );
  const onDelete = useCallback((job: JobItem) => setConfirm(job), []);

  async function doDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api(`/api/jobs/${confirm.id}`, { method: "DELETE" });
      feed.remove(confirm.id);
      toast.success("Đã xóa");
      setConfirm(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  if (feed.error && feed.items.length === 0) return <Notice tone="danger">{feed.error}</Notice>;
  if (feed.loading && feed.items.length === 0) return <MasonrySkeleton />;
  if (feed.items.length === 0)
    return (
      <Empty
        icon="library"
        title="Chưa có kết quả nào"
        className="min-h-[50vh]"
        action={
          <LinkButton href="/studio/image" variant="primary" icon="sparkle" className="mt-2">
            Bắt đầu tạo
          </LinkButton>
        }
      />
    );

  return (
    <>
      <div className="masonry">
        {feed.items.map((job, i) => (
          <JobTile key={job.id} job={job} order={i % 24} showCount actions={["download", "remake", "details", "delete"]} onOpen={onOpen} onDelete={onDelete} />
        ))}
      </div>
      <div ref={sentinel} className="flex h-20 items-center justify-center text-muted">
        {feed.loadingMore && <Spinner />}
      </div>
      {open && <Lightbox entries={entries} start={open.start} origin={open.origin} onClose={() => setOpen(null)} onDeleted={feed.remove} />}
      <ConfirmDialog
        open={confirm !== null}
        title="Xóa kết quả này?"
        body="Không khôi phục được."
        confirmLabel="Xóa"
        danger
        busy={deleting}
        onConfirm={doDelete}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}

export function LibraryView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [status, setStatus] = useState<JobStatus | "">("");

  return (
    <div className="px-3 pt-3 pb-10 sm:px-5 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="t-h2">Thư viện</h1>
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="no-scrollbar overflow-x-auto">
          <Segmented options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Loại" />
        </div>
        {filter !== "story" && (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto sm:ml-auto">
            <Chip active={status === ""} onClick={() => setStatus("")}>
              Mọi trạng thái
            </Chip>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </Chip>
            ))}
          </div>
        )}
      </div>
      {filter === "story" ? <StoryGrid /> : <JobMasonry key={`${filter}-${status}`} kind={filter === "all" ? undefined : filter} status={status} />}
    </div>
  );
}
