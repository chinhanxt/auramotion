"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useJobEvents, useRealtime } from "@/components/realtime/Events";
import { ACTIVE_STATUSES, api, type GenKind, type JobEvent, type JobItem, type JobStatus } from "@/lib/api-client";

type Page = { items: JobItem[]; nextCursor: string | null };

const POLL_MS = 3000;

export function toEvent(j: JobItem): JobEvent {
  return {
    id: j.id,
    status: j.status,
    progress: j.progress,
    resultUrls: j.resultUrls,
    error: j.error,
    storyId: j.storyId ?? null,
    shotIndex: j.shotIndex ?? null,
    kind: j.kind,
  };
}

export function applyEvent(j: JobItem, e: JobEvent): JobItem {
  if (j.status === e.status && j.progress === e.progress && (e.resultUrls === undefined || e.resultUrls.length === j.resultUrls.length)) return j;
  return {
    ...j,
    status: e.status,
    progress: e.progress ?? j.progress,
    resultUrls: e.resultUrls ?? j.resultUrls,
    error: e.error !== undefined ? e.error : j.error,
  };
}

function changed(a: JobItem, b: JobItem) {
  return a.status !== b.status || a.progress !== b.progress || a.resultUrls.length !== b.resultUrls.length;
}

// Poll job đang chạy khi SSE chưa sẵn: kết quả phát qua bus để toast + mọi danh sách cùng cập nhật.
export function useActivePolling(jobs: JobItem[]) {
  const { live, emit } = useRealtime();
  const ref = useRef(jobs);
  ref.current = jobs;
  useEffect(() => {
    if (live) return;
    let busy = false;
    const t = setInterval(async () => {
      const active = ref.current.filter((j) => ACTIVE_STATUSES.includes(j.status));
      if (active.length === 0 || busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const { items } = await api<Page>(`/api/jobs?ids=${active.map((j) => j.id).join(",")}`);
        const before = new Map(active.map((j) => [j.id, j]));
        for (const f of items) {
          const old = before.get(f.id);
          if (old && changed(old, f)) emit("job", toEvent(f));
        }
      } catch {
        // lỗi mạng tạm thời
      } finally {
        busy = false;
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [live, emit]);
}

export function useJobFeed({ kind, status }: { kind?: GenKind; status?: JobStatus | "" }) {
  const [items, setItems] = useState<JobItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const query = useCallback(
    (cursor?: string) => {
      const qs = new URLSearchParams();
      if (kind) qs.set("kind", kind);
      if (status) qs.set("status", status);
      if (cursor) qs.set("cursor", cursor);
      return api<Page>(`/api/jobs?${qs}`);
    },
    [kind, status],
  );

  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError("");
    query()
      .then((p) => {
        if (id !== seq.current) return;
        setItems(p.items);
        setNextCursor(p.nextCursor);
      })
      .catch((e: Error) => id === seq.current && setError(e.message))
      .finally(() => id === seq.current && setLoading(false));
  }, [query]);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const id = seq.current;
    setLoadingMore(true);
    try {
      const p = await query(nextCursor);
      if (id !== seq.current) return;
      setItems((list) => {
        const seen = new Set(list.map((j) => j.id));
        return [...list, ...p.items.filter((j) => !seen.has(j.id))];
      });
      setNextCursor(p.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, query]);

  useJobEvents((e) => {
    setItems((list) => {
      const i = list.findIndex((j) => j.id === e.id);
      if (i < 0) return list;
      const next = applyEvent(list[i], e);
      if (next === list[i]) return list;
      const copy = list.slice();
      copy[i] = next;
      return copy;
    });
  });
  useActivePolling(items);

  const prepend = useCallback((job: JobItem) => setItems((l) => [job, ...l.filter((j) => j.id !== job.id)]), []);
  const remove = useCallback((id: string) => setItems((l) => l.filter((j) => j.id !== id)), []);

  return { items, nextCursor, loading, loadingMore, error, loadMore, reload, prepend, remove };
}

// Gọi `onHit` khi phần tử cuối danh sách vào gần màn hình (cuộn vô hạn).
export function useInfiniteSentinel(onHit: () => void, enabled: boolean, dep?: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const fn = useRef(onHit);
  fn.current = onHit;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const io = new IntersectionObserver((es) => es[0]?.isIntersecting && fn.current(), { rootMargin: "800px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [enabled, dep]);
  return ref;
}
