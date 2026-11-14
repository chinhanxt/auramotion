"use client";

import { useEffect, useRef, useState } from "react";
import { Empty, Notice } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SmartVideo } from "@/components/ui/Media";
import { thumbUrl } from "@/lib/media-url";
import { Segmented } from "@/components/ui/Segmented";
import { api, type JobItem } from "@/lib/api-client";

export type PickedClip = { jobId: string; index: number; kind: "image" | "video"; url: string };

type Page = { items: JobItem[]; nextCursor: string | null };

// Kho ảnh / video đã tạo xong; bấm một ô để thêm vào timeline.
export function ClipPicker({ onAdd, columns = "grid-cols-3 sm:grid-cols-4 lg:grid-cols-3" }: { onAdd: (clip: PickedClip) => void; columns?: string }) {
  const [kind, setKind] = useState<"image" | "video">("video");
  const [items, setItems] = useState<JobItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hover, setHover] = useState("");
  const seq = useRef(0);

  async function load(cursor?: string) {
    const id = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ kind, status: "SUCCEEDED" });
      if (cursor) qs.set("cursor", cursor);
      const page = await api<Page>(`/api/jobs?${qs}`);
      if (id !== seq.current) return;
      setItems((list) => (cursor ? [...list, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (id === seq.current) setError((err as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    load();
    // Nạp lại khi đổi tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const tiles = items.flatMap((job) =>
    job.resultUrls.map((url, index) => ({ job, url, index, clipKind: job.kind === "IMAGE" ? ("image" as const) : ("video" as const) })),
  );

  return (
    <div className="space-y-3">
      <Segmented
        block
        size="sm"
        ariaLabel="Loại clip"
        options={[
          { value: "video" as const, label: "Video" },
          { value: "image" as const, label: "Ảnh" },
        ]}
        value={kind}
        onChange={setKind}
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {!loading && tiles.length === 0 && !error && <Empty icon={kind === "image" ? "image" : "video"} title={`Chưa có ${kind === "image" ? "ảnh" : "video"} nào`} className="py-8" />}
      <div className={`grid gap-1.5 ${columns}`}>
        {tiles.map(({ job, url, index, clipKind }, i) => (
          <button
            key={url}
            type="button"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/x-am-clip", JSON.stringify({ jobId: job.id, index, kind: clipKind, url }))}
            title="Thêm vào timeline"
            aria-label={`Thêm ${clipKind === "image" ? "ảnh" : "video"} vào timeline`}
            onClick={() => onAdd({ jobId: job.id, index, kind: clipKind, url })}
            onPointerEnter={() => setHover(url)}
            onPointerLeave={() => setHover("")}
            className="press reveal group relative aspect-square overflow-hidden rounded-[10px] bg-s2 hairline"
            style={{ "--i": i % 18 } as React.CSSProperties}
          >
            {clipKind === "image" ? (
              <img src={thumbUrl(url, 320)} alt={job.prompt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <SmartVideo src={url} hovering={hover === url} className="h-full w-full" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Icon name="plus" size={22} />
            </span>
          </button>
        ))}
        {loading && Array.from({ length: 6 }, (_, i) => <div key={`s${i}`} className="skel aspect-square rounded-[10px]" />)}
      </div>
      {nextCursor && !loading && (
        <Button variant="ghost" size="sm" block onClick={() => load(nextCursor)}>
          Xem thêm
        </Button>
      )}
    </div>
  );
}
