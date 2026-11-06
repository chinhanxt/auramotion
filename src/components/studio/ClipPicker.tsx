"use client";

import { useEffect, useState } from "react";
import { api, type JobItem } from "@/lib/api-client";

export type PickedClip = { jobId: string; index: number; kind: "image" | "video"; url: string };

type Page = { items: JobItem[]; nextCursor: string | null };

const TABS = [
  { kind: "image", label: "Ảnh" },
  { kind: "video", label: "Video" },
] as const;

// Lưới ảnh / video đã tạo xong của user; bấm một ô để thêm vào timeline.
export function ClipPicker({ onAdd }: { onAdd: (clip: PickedClip) => void }) {
  const [kind, setKind] = useState<"image" | "video">("image");
  const [items, setItems] = useState<JobItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ kind, status: "SUCCEEDED" });
      if (cursor) qs.set("cursor", cursor);
      const page = await api<Page>(`/api/jobs?${qs}`);
      setItems((list) => (cursor ? [...list, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    load();
    // Nạp lại khi đổi tab.
  }, [kind]);

  const tiles = items.flatMap((job) => job.resultUrls.map((url, index) => ({ job, url, index })));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700">Chọn clip</span>
        <div className="flex rounded-md border border-neutral-300 bg-white p-0.5">
          {TABS.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => setKind(t.kind)}
              className={`rounded px-3 py-1 text-sm ${t.kind === kind ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!loading && tiles.length === 0 && !error && (
        <p className="text-sm text-neutral-500">Chưa có {kind === "image" ? "ảnh" : "video"} nào tạo xong.</p>
      )}

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {tiles.map(({ job, url, index }) => (
          <button
            key={url}
            type="button"
            title="Thêm vào timeline"
            onClick={() => onAdd({ jobId: job.id, index, kind, url })}
            className="group relative aspect-square overflow-hidden rounded-md border border-neutral-200 bg-neutral-100 hover:border-neutral-900"
          >
            {kind === "image" ? (
              <img src={url} alt={job.prompt} loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-2xl font-semibold text-white opacity-0 group-hover:opacity-100">
              +
            </span>
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-neutral-500">Đang tải...</p>}
      {nextCursor && !loading && (
        <button
          type="button"
          onClick={() => load(nextCursor)}
          className="w-full rounded-md border border-neutral-300 bg-white py-1.5 text-sm hover:bg-neutral-100"
        >
          Xem thêm
        </button>
      )}
    </div>
  );
}
