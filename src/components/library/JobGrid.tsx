"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_STATUSES, STATUS_LABEL, api, type GenKind, type JobItem, type JobStatus } from "@/lib/api-client";
import { JobCard } from "./JobCard";

const POLL_MS = 3000;

const TABS: { kind: GenKind; label: string }[] = [
  { kind: "image", label: "Ảnh" },
  { kind: "video", label: "Video" },
  { kind: "assemble", label: "Video ghép" },
];

const STATUSES: JobStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"];

type Page = { items: JobItem[]; nextCursor: string | null };

// fixedKind: dùng trong trang tạo (một loại, không có tab / bộ lọc).
export function JobGrid({ fixedKind, refreshKey = 0 }: { fixedKind?: GenKind; refreshKey?: number }) {
  const router = useRouter();
  const [kind, setKind] = useState<GenKind>(fixedKind ?? "image");
  const [status, setStatus] = useState<JobStatus | "">("");
  const [items, setItems] = useState<JobItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const itemsRef = useRef<JobItem[]>([]);
  itemsRef.current = items;

  const query = useCallback(
    (cursor?: string) => {
      const qs = new URLSearchParams({ kind });
      if (status) qs.set("status", status);
      if (cursor) qs.set("cursor", cursor);
      return api<Page>(`/api/jobs?${qs}`);
    },
    [kind, status],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    query()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, refreshKey]);

  // Poll các job đang chờ / đang chạy; job vừa xong thì làm mới số dư ở header.
  useEffect(() => {
    const timer = setInterval(async () => {
      const active = itemsRef.current.filter((j) => ACTIVE_STATUSES.includes(j.status));
      if (active.length === 0) return;
      try {
        const { items: fresh } = await api<Page>(`/api/jobs?ids=${active.map((j) => j.id).join(",")}`);
        const byId = new Map(fresh.map((j) => [j.id, j]));
        setItems((list) => list.map((j) => byId.get(j.id) ?? j));
        if (fresh.some((f) => !ACTIVE_STATUSES.includes(f.status))) router.refresh();
      } catch {
        // lỗi mạng tạm thời: lần poll sau thử lại
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const page = await query(nextCursor);
      setItems((list) => [...list, ...page.items.filter((j) => !list.some((x) => x.id === j.id))]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {!fixedKind && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-neutral-300 bg-white p-0.5">
            {TABS.map((t) => (
              <button
                key={t.kind}
                type="button"
                onClick={() => setKind(t.kind)}
                className={`rounded px-3 py-1.5 text-sm ${t.kind === kind ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as JobStatus | "")}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            aria-label="Lọc trạng thái"
          >
            <option value="">Mọi trạng thái</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!loading && items.length === 0 && !error && <p className="text-sm text-neutral-500">Chưa có kết quả nào.</p>}

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${fixedKind ? "lg:grid-cols-2 xl:grid-cols-3" : "xl:grid-cols-4"}`}>
        {items.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>

      {loading && <p className="text-sm text-neutral-500">Đang tải...</p>}
      {nextCursor && !loading && (
        <button
          type="button"
          onClick={loadMore}
          className="w-full rounded-md border border-neutral-300 bg-white py-2 text-sm hover:bg-neutral-100"
        >
          Xem thêm
        </button>
      )}
    </div>
  );
}
