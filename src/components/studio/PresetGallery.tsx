"use client";

import { memo, useMemo, useState } from "react";
import { Chip } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { FadeImage, SmartVideo } from "@/components/ui/Media";
import { Modal } from "@/components/ui/Overlay";
import type { CatalogPreset } from "@/lib/api-client";

const FALLBACK = [
  ["#7c5cff", "#ff4fd8"],
  ["#ff4fd8", "#ffb36b"],
  ["#2dd4bf", "#7c5cff"],
  ["#ffb36b", "#ff5c6c"],
  ["#60a5fa", "#a78bfa"],
  ["#d4ff3a", "#2dd4bf"],
  ["#f472b6", "#6366f1"],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const isCss = (v: string) => /^(linear|radial|conic|repeating)-gradient\(/.test(v.trim());
const isVideo = (v: string) => /\.(mp4|webm)(\?|#|$)/i.test(v);

type CoverSource = Pick<CatalogPreset, "name" | "cover" | "thumbnailUrl" | "palette">;

// Bìa preset: `cover` là CSS gradient → dùng thẳng; là URL ảnh / video (.mp4/.webm) → phủ lên gradient palette
// (gradient làm nền khi đang tải hoặc file lỗi); không có gì → gradient sinh từ palette / tên.
export function coverStyle(p: CoverSource): { background: string; image?: string; video?: string } {
  const cover = p.cover?.trim();
  if (cover && isCss(cover)) return { background: cover };
  const pal = p.palette && p.palette.length >= 2 ? p.palette : FALLBACK[hash(p.name) % FALLBACK.length];
  const a = hash(p.name) % 360;
  const background = `radial-gradient(120% 90% at 20% 15%, color-mix(in srgb, ${pal[0]} 80%, transparent) 0%, transparent 55%), radial-gradient(90% 90% at 85% 90%, color-mix(in srgb, ${pal[1]} 72%, transparent) 0%, transparent 60%), linear-gradient(${a}deg, #111116, #1d1d25)`;
  const url = cover || p.thumbnailUrl?.trim();
  if (!url) return { background };
  return isVideo(url) ? { background, video: url } : { background, image: url };
}

// Lớp media của bìa: video lặp tắt tiếng chỉ phát khi trong màn hình, ảnh hiện dần; lỗi thì ẩn để lộ nền.
export function CoverMedia({ image, video }: { image?: string; video?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = video ?? image;
  if (!src || failed === src) return null;
  return video ? (
    <SmartVideo key={video} src={video} mode="inview" preload="none" plain className="absolute inset-0" onError={() => setFailed(video)} />
  ) : (
    <FadeImage key={src} src={src} alt="" skeleton={false} className="absolute inset-0" onError={() => setFailed(src)} />
  );
}

export const PresetCover = memo(function PresetCover({ preset, className, children }: { preset: CoverSource; className?: string; children?: React.ReactNode }) {
  const c = coverStyle(preset);
  return (
    <span className={cx("relative block overflow-hidden bg-s3", className)} style={{ background: c.background }}>
      <CoverMedia image={c.image} video={c.video} />
      <span className="grain absolute inset-0" />
      {children}
    </span>
  );
});

// Lưới chọn phong cách / chuyển động camera, có tab theo nhóm.
export function PresetGallery({
  open,
  onClose,
  presets,
  value,
  onChange,
  title,
}: {
  open: boolean;
  onClose: () => void;
  presets: CatalogPreset[];
  value: string;
  onChange: (id: string) => void;
  title: string;
}) {
  const categories = useMemo(() => [...new Set(presets.map((p) => p.category).filter((c): c is string => Boolean(c)))], [presets]);
  const [cat, setCat] = useState("");
  const shown = cat ? presets.filter((p) => p.category === cat) : presets;

  function pick(id: string) {
    onChange(id);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      {categories.length > 1 && (
        <div className="no-scrollbar -mx-5 mb-4 flex gap-1.5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <Chip active={!cat} onClick={() => setCat("")}>
            Tất cả
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {c}
            </Chip>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        <button
          type="button"
          onClick={() => pick("")}
          className={cx(
            "press group relative flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-m2 bg-s2 text-muted hairline hover:text-fg",
            value === "" && "ring-2 ring-accent",
          )}
        >
          <Icon name="close" size={22} />
          <span className="text-sm font-medium">Không dùng</span>
        </button>
        {shown.map((p, i) => {
          const active = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p.id)}
              className={cx("press reveal group relative overflow-hidden rounded-m2 text-left hairline", active && "ring-2 ring-accent")}
              style={{ "--i": i } as React.CSSProperties}
            >
              <PresetCover preset={p} className="aspect-[4/5] transition-transform duration-[700ms] ease-[var(--ease-out)] group-hover:scale-[1.04]" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-3 pt-10">
                <span className="block text-sm font-semibold text-white">{p.name}</span>
                {p.description && <span className="mt-0.5 line-clamp-2 block text-xs text-white/65">{p.description}</span>}
              </span>
              {active && (
                <span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-ink">
                  <Icon name="check" size={14} strokeWidth={2.2} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
