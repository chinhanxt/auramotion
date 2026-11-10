"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useJobEvents, useRealtime } from "@/components/realtime/Events";
import { ACTIVE_STATUSES, api, isWriting, writeParams, type GenKind, type JobEvent, type JobItem, type JobStatus } from "@/lib/api-client";

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
    prompt: j.prompt,
    stage: j.stage,
    written: writeParams(j).written,
  };
}

export function applyEvent(j: JobItem, e: JobEvent): JobItem {
  const prompt = e.prompt ?? j.prompt;
  const stage = e.stage ?? j.stage;
  const newWritten = e.written && !writeParams(j).written;
  if (
    j.status === e.status &&
    j.progress === e.progress &&
    (e.resultUrls === undefined || e.resultUrls.length === j.resultUrls.length) &&
    prompt === j.prompt &&
    stage === j.stage &&
    !newWritten
  )
    return j;
  return {
    ...j,
    status: e.status,
    progress: e.progress ?? j.progress,
    resultUrls: e.resultUrls ?? j.resultUrls,
    error: e.error !== undefined ? e.error : j.error,
    prompt,
    stage,
    params: newWritten ? { ...j.params, written: e.written } : j.params,
  };
}

function changed(a: JobItem, b: JobItem) {
  return (
    a.status !== b.status ||
    a.progress !== b.progress ||
    a.resultUrls.length !== b.resultUrls.length ||
    a.prompt !== b.prompt ||
    Boolean(writeParams(a).written) !== Boolean(writeParams(b).written)
  );
}

// Job autoWrite đã viết xong nhưng sự kiện chưa kèm `written` → tải lại job một lần để có skill · người viết.
function needsWritten(j: JobItem) {
  const p = writeParams(j);
  return Boolean(p.autoWrite && !p.written && !isWriting(j) && j.status !== "FAILED" && j.status !== "CANCELED");
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

  // Bổ sung params.written cho job vừa viết xong (mỗi job một lần).
  const fetchedWritten = useRef(new Set<string>());
  useEffect(() => {
    const ids = items.filter((j) => needsWritten(j) && !fetchedWritten.current.has(j.id)).map((j) => j.id);
    if (ids.length === 0) return;
    ids.forEach((id) => fetchedWritten.current.add(id));
    api<Page>(`/api/jobs?ids=${ids.join(",")}`)
      .then(({ items: fresh }) => {
        const map = new Map(fresh.map((f) => [f.id, f]));
        setItems((list) =>
          list.map((j) => {
            const f = map.get(j.id);
            const written = f && writeParams(f).written;
            return written ? { ...j, prompt: f.prompt, params: { ...j.params, ...f.params, written } } : j;
          }),
        );
      })
      .catch(() => {});
  }, [items]);

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
