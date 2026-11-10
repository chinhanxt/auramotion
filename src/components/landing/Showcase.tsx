"use client";

import Link from "next/link";
import { memo, useEffect, useState } from "react";
import { PresetCover } from "@/components/studio/PresetGallery";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { FadeImage, SmartVideo } from "@/components/ui/Media";
import { api, isVideoUrl, type ExploreItem, type ThemeItem } from "@/lib/api-client";

// Chủ đề dự phòng khi không gọi được /api/themes (khớp preset seed).
const FALLBACK_THEMES: ThemeItem[] = [
  { id: "f-studio", kind: "STYLE", name: "Studio", promptSuffix: "", thumbnailUrl: null, category: "Sản phẩm", palette: ["#7c5cff", "#2dd4bf"] },
  { id: "f-out", kind: "STYLE", name: "Ngoài trời", promptSuffix: "", thumbnailUrl: null, category: "Đời sống", palette: ["#ffb36b", "#ff4fd8"] },
  { id: "f-hand", kind: "STYLE", name: "Trên tay", promptSuffix: "", thumbnailUrl: null, category: "Sản phẩm", palette: ["#ff5c6c", "#ffb36b"] },
  { id: "f-life", kind: "STYLE", name: "Lifestyle", promptSuffix: "", thumbnailUrl: null, category: "Đời sống", palette: ["#60a5fa", "#a78bfa"] },
  { id: "f-orbit", kind: "CAMERA", name: "Xoay 360", promptSuffix: "", thumbnailUrl: null, category: "Camera", palette: ["#d4ff3a", "#2dd4bf"] },
  { id: "f-pan", kind: "CAMERA", name: "Pan chậm", promptSuffix: "", thumbnailUrl: null, category: "Camera", palette: ["#f472b6", "#6366f1"] },
  { id: "f-dolly", kind: "CAMERA", name: "Đẩy vào", promptSuffix: "", thumbnailUrl: null, category: "Camera", palette: ["#7c5cff", "#ff4fd8"] },
  { id: "f-static", kind: "CAMERA", name: "Tĩnh", promptSuffix: "", thumbnailUrl: null, category: "Camera", palette: ["#2dd4bf", "#60a5fa"] },
];

// Một lần tải cho cả trang (ExploreGrid + ThemeStrip dùng chung).
let themesPromise: Promise<ThemeItem[]> | null = null;
function loadThemes(): Promise<ThemeItem[]> {
  // /api/themes trả { styles, cameras }: phong cách trước, camera sau.
  themesPromise ??= api<{ styles?: ThemeItem[]; cameras?: ThemeItem[] }>("/api/themes")
    .then((r) => [...(r.styles ?? []), ...(r.cameras ?? [])])
    .catch(() => FALLBACK_THEMES);
  return themesPromise;
}

function useThemes() {
  const [themes, setThemes] = useState<ThemeItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadThemes().then((t) => alive && setThemes(t));
    return () => {
      alive = false;
    };
  }, []);
  return themes;
}

const ExploreTile = memo(function ExploreTile({ item, order }: { item: ExploreItem; order: number }) {
  const url = item.resultUrls[0];
  const video = item.kind !== "IMAGE" || isVideoUrl(url);
  const ratio = video ? (order % 3 === 0 ? "9 / 16" : "4 / 5") : order % 4 === 1 ? "3 / 4" : "1 / 1";
  return (
    <figure className="reveal group relative overflow-hidden rounded-m2 bg-s2 hairline" style={{ "--i": order % 12, aspectRatio: ratio } as React.CSSProperties}>
      {video ? <SmartVideo src={url} mode="inview" className="absolute inset-0" /> : <FadeImage src={url} alt={item.prompt} className="absolute inset-0" />}
      <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10 text-[12px] leading-snug text-white/85 opacity-0 transition-opacity duration-[260ms] group-hover:opacity-100">
        <span className="line-clamp-2">{item.prompt}</span>
        {item.presetName && <span className="mt-1 inline-block rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">{item.presetName}</span>}
      </figcaption>
    </figure>
  );
});

// Lưới tác phẩm nổi bật (/api/explore); trống / chưa có route thì dựng lưới bìa chủ đề.
export function ExploreGrid({ limit = 24 }: { limit?: number }) {
  const [items, setItems] = useState<ExploreItem[] | null>(null);
  const themes = useThemes();
  useEffect(() => {
    api<{ items: ExploreItem[] }>("/api/explore")
      .then((r) => setItems((r.items ?? []).filter((i) => i.resultUrls?.length).slice(0, limit)))
      .catch(() => setItems([]));
  }, [limit]);

  if (items === null || (items.length === 0 && themes === null)) {
    return (
      <div className="masonry">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="skel rounded-m2" style={{ aspectRatio: ["4 / 5", "1 / 1", "9 / 16", "3 / 4"][i % 4] }} />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    const list = (themes ?? FALLBACK_THEMES).slice(0, 8);
    return (
      <div className="masonry">
        {list.map((t, i) => (
          <PresetCover key={`${t.id}-${i}`} preset={t} className="reveal rounded-m2 hairline" >
            <span className="block" style={{ aspectRatio: ["4 / 5", "1 / 1", "3 / 4", "1 / 1"][i % 4] }} />
            <span className="absolute bottom-3 left-3 text-sm font-semibold text-white/90">{t.name}</span>
          </PresetCover>
        ))}
      </div>
    );
  }
  return (
    <div className="masonry">
      {items.map((it, i) => (
        <ExploreTile key={it.id} item={it} order={i} />
      ))}
    </div>
  );
}

// Dải chủ đề chạy ngang chậm (dừng khi rê chuột).
export function ThemeStrip() {
  const themes = useThemes();
  const list = themes ?? FALLBACK_THEMES;
  const loop = [...list, ...list];
  if (themes && themes.length === 0) return null;
  return (
    <div className="marquee group relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]">
      <div className={cx("marquee-track flex w-max gap-3 py-1", !themes && "opacity-0")}>
        {loop.map((t, i) => (
          <Link
            key={`${t.id}-${i}`}
            href={t.kind === "CAMERA" ? "/studio/video" : "/studio/image"}
            aria-hidden={i >= list.length || undefined}
            tabIndex={i >= list.length ? -1 : undefined}
            className="press group/t relative w-[168px] shrink-0 overflow-hidden rounded-m3 hairline sm:w-[200px]"
          >
            <PresetCover preset={t} className="aspect-[4/5] transition-transform duration-[700ms] ease-[var(--ease-out)] group-hover/t:scale-[1.05]" />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
              <span className="block text-[11px] font-medium text-white/60">{t.kind === "CAMERA" ? "Camera" : (t.category ?? "Phong cách")}</span>
              <span className="block text-sm font-semibold text-white">{t.name}</span>
            </span>
            <span className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition-opacity group-hover/t:opacity-100">
              <Icon name="arrowRight" size={14} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
