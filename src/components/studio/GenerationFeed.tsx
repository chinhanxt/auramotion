"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobTile, type TileAction } from "@/components/library/JobTile";
import { useInfiniteSentinel } from "@/components/library/useJobFeed";
import type { LightboxEntry } from "@/components/library/Lightbox";
import { Spinner } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { Stage } from "./Stage";
import { ACTIVE_STATUSES, api, jobAspect, type JobItem } from "@/lib/api-client";

const Lightbox = dynamic(() => import("@/components/library/Lightbox"), { ssr: false });

type Feed = {
  items: JobItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  remove: (id: string) => void;
};

function ratioNum(r: string) {
  const [w, h] = r.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 1;
}

type Tile = { job: JobItem; index: number; key: string };

export function expandTiles(items: JobItem[]): Tile[] {
  return items.flatMap((job) => {
    if (job.status === "SUCCEEDED" && job.resultUrls.length > 0) return job.resultUrls.map((_, index) => ({ job, index, key: `${job.id}:${index}` }));
    const n = ACTIVE_STATUSES.includes(job.status) && job.kind === "IMAGE" ? Number((job.params as { imageCount?: number })?.imageCount ?? 1) || 1 : 1;
    return Array.from({ length: n }, (_, index) => ({ job, index, key: `${job.id}:${index}` }));
  });
}

// Bảng kết quả dạng hàng "justified": mỗi ô giữ đúng tỷ lệ, mọi ô trong một hàng cao bằng nhau, lấp đầy chiều ngang.
export function JustifiedSkeleton({ ratio = "1:1", count = 8 }: { ratio?: string; count?: number }) {
  const a = ratioNum(ratio);
  return (
    <div className="justified">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ flexGrow: a, flexBasis: `calc(var(--row-h) * ${a})` }}>
          <div className="skel rounded-m2" style={{ aspectRatio: `${a}` }} />
        </div>
      ))}
      <span className="justified-fill" />
    </div>
  );
}

export function GenerationFeed({
  feed,
  actions,
  onUseRef,
  empty,
  skeletonRatio,
  stage = false,
}: {
  feed: Feed;
  actions: TileAction[];
  onUseRef?: (url: string) => void;
  empty: React.ReactNode;
  skeletonRatio?: string;
  // Màn xem giữa trang cho job vừa tạo (đang chạy → xong).
  stage?: boolean;
}) {
  const toast = useToast();
  const tiles = useMemo(() => expandTiles(feed.items), [feed.items]);
  const viewable = useMemo<LightboxEntry[]>(() => tiles.filter((t) => t.job.status === "SUCCEEDED" && t.job.resultUrls[t.index]).map(({ job, index }) => ({ job, index })), [tiles]);
  const [open, setOpen] = useState<{ start: number; origin: DOMRect } | null>(null);
  const [confirm, setConfirm] = useState<JobItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const sentinel = useInfiniteSentinel(feed.loadMore, Boolean(feed.nextCursor) && !feed.loadingMore, feed.items.length);

  const [focusId, setFocusId] = useState<string | null>(null);
  const dismissed = useRef(new Set<string>());
  useEffect(() => {
    if (!stage) return;
    const a = feed.items.find((j) => ACTIVE_STATUSES.includes(j.status) && !dismissed.current.has(j.id));
    if (a) setFocusId((cur) => (cur === a.id ? cur : a.id));
  }, [stage, feed.items]);
  const focus = stage && focusId ? feed.items.find((j) => j.id === focusId) : undefined;

  // Giữ danh sách trong ref để hàm mở ổn định: cập nhật một ô không làm render lại cả lưới.
  const listRef = useRef(viewable);
  listRef.current = viewable;
  const onOpen = useCallback((job: JobItem, index: number, el: HTMLElement) => {
    const start = listRef.current.findIndex((e) => e.job.id === job.id && e.index === index);
    if (start >= 0) setOpen({ start, origin: el.getBoundingClientRect() });
  }, []);

  const onDelete = useCallback((job: JobItem) => setConfirm(job), []);
  const { remove } = feed;

  async function doDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api(`/api/jobs/${confirm.id}`, { method: "DELETE" });
      remove(confirm.id);
      toast.success("Đã xóa");
      setConfirm(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  if (feed.loading && feed.items.length === 0) return <JustifiedSkeleton ratio={skeletonRatio} />;
  if (!feed.loading && feed.items.length === 0) return <>{empty}</>;

  return (
    <>
      {focus && (
        <Stage
          key={focus.id}
          job={focus}
          onOpen={onOpen}
          onClose={() => {
            dismissed.current.add(focus.id);
            setFocusId(null);
          }}
        />
      )}
      <div className="justified">
        {tiles.map((t, i) => {
          const a = ratioNum(jobAspect(t.job));
          return (
            <div key={t.key} style={{ flexGrow: a, flexBasis: `calc(var(--row-h) * ${a})` }} className="min-w-0">
              <JobTile job={t.job} index={t.index} order={i} actions={actions} onOpen={onOpen} onDelete={onDelete} onUseRef={onUseRef} />
            </div>
          );
        })}
        <span className="justified-fill" />
      </div>
      <div ref={sentinel} className="flex h-16 items-center justify-center text-muted">
        {feed.loadingMore && <Spinner />}
      </div>
      {open && (
        <Lightbox entries={viewable} start={open.start} origin={open.origin} onClose={() => setOpen(null)} onDeleted={remove} />
      )}
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
