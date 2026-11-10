"use client";

import { useEffect, useState } from "react";
import { KIND_LABEL, timeAgo } from "@/components/admin/format";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { PageHeader, Pager, UrlFilters } from "@/components/admin/kit";
import { Badge, Empty } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { FadeImage, SmartVideo } from "@/components/ui/Media";
import { api, isVideoUrl, jobAspect, ratioCss } from "@/lib/api-client";

type Item = {
  id: string;
  kind: "IMAGE" | "VIDEO" | "ASSEMBLE";
  prompt: string;
  resultUrls: string[];
  params: unknown;
  featured: boolean;
  deletedAt: string | null;
  createdAt: string;
  user: { id: string; email: string };
  model: { id: string; name: string };
};

export function FeaturedView({ data, featuredTotal }: { data: { items: Item[]; total: number; page: number; pageSize: number }; featuredTotal: number }) {
  const [items, setItems] = useState(data.items);
  const [count, setCount] = useState(featuredTotal);
  useEffect(() => setItems(data.items), [data.items]);
  useEffect(() => setCount(featuredTotal), [featuredTotal]);
  const { run, isBusy } = useAction();

  async function toggle(j: Item) {
    const featured = !j.featured;
    const flip = (v: boolean) => {
      setItems((l) => l.map((x) => (x.id === j.id ? { ...x, featured: v } : x)));
      setCount((c) => c + (v ? 1 : -1));
    };
    flip(featured);
    const ok = await run(j.id, () => api(`/api/admin/jobs/${j.id}`, jsonInit("PATCH", { featured })), {
      success: featured ? "Đã ghim nổi bật" : "Đã bỏ nổi bật",
    });
    if (!ok) flip(!featured);
  }

  return (
    <>
      <PageHeader
        icon="star"
        title="Nổi bật"
        sub={
          <span className="flex items-center gap-1.5">
            <Icon name="star" size={13} className="text-accent" />
            {count.toLocaleString("vi-VN")} đang hiện ở Khám phá · {data.total.toLocaleString("vi-VN")} kết quả
          </span>
        }
      />
      <UrlFilters
        fields={[
          {
            name: "kind",
            type: "chips",
            options: [
              { value: "", label: "Tất cả" },
              { value: "IMAGE", label: "Ảnh" },
              { value: "VIDEO", label: "Video" },
              { value: "ASSEMBLE", label: "Ghép" },
            ],
          },
          {
            name: "featured",
            type: "chips",
            options: [
              { value: "", label: "Mọi job" },
              { value: "1", label: "Đang nổi bật" },
              { value: "0", label: "Chưa" },
            ],
          },
        ]}
      />
      {items.length === 0 ? (
        <Empty icon="star" title="Trống" />
      ) : (
        <div className="masonry">
          {items.map((j, i) => {
            const url = j.resultUrls[0];
            const aspect = ratioCss(jobAspect({ kind: j.kind, params: (j.params ?? {}) as Record<string, unknown> }));
            return (
              <Tile key={j.id} job={j} url={url} aspect={aspect} i={i} busy={isBusy(j.id)} onToggle={() => toggle(j)} />
            );
          })}
        </div>
      )}
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} />
    </>
  );
}

function Tile({ job, url, aspect, i, busy, onToggle }: { job: Item; url?: string; aspect: string; i: number; busy: boolean; onToggle: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <figure
      className={cx("reveal group relative overflow-hidden rounded-m3 bg-s1 hairline", job.featured && "ring-2 ring-accent/70")}
      style={{ "--i": i } as React.CSSProperties}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative" style={{ aspectRatio: aspect }}>
        {!url ? (
          <div className="flex h-full items-center justify-center text-dim">
            <Icon name="image" size={22} />
          </div>
        ) : isVideoUrl(url) ? (
          <SmartVideo src={url} mode="hover" hovering={hover} className="absolute inset-0" />
        ) : (
          <FadeImage src={url} alt="" className="absolute inset-0" />
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge className="bg-black/55 text-white backdrop-blur">{KIND_LABEL[job.kind]}</Badge>
          {job.deletedAt && <Badge tone="warn">Đã xóa</Badge>}
        </div>
        <button
          type="button"
          aria-pressed={job.featured}
          aria-label={job.featured ? "Bỏ nổi bật" : "Ghim nổi bật"}
          disabled={busy}
          onClick={onToggle}
          className={cx(
            "press absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur transition-colors",
            job.featured ? "bg-accent text-accent-ink" : "bg-black/55 text-white/85 hover:bg-black/75 hover:text-white",
          )}
        >
          <Icon name="star" size={17} strokeWidth={job.featured ? 2.2 : 1.6} />
        </button>
      </div>
      <figcaption className="space-y-1 p-3">
        <p className="line-clamp-2 text-[12.5px] leading-snug text-fg/85">{job.prompt || "—"}</p>
        <p className="flex items-center gap-1.5 truncate text-[11px] text-dim">
          <span className="truncate">{job.user.email}</span>
          <span>·</span>
          <span className="shrink-0">{timeAgo(job.createdAt)}</span>
        </p>
      </figcaption>
    </figure>
  );
}
