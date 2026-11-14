"use client";

import { useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { Slider } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import type { PickedClip } from "./ClipPicker";
import { posterUrl, thumbUrl } from "@/lib/media-url";

export type TimelineClip = PickedClip & {
  key: string;
  // Ảnh: số giây hiển thị (1–10).
  duration: number;
  // Video: cắt từ giây `in` tới giây `out` (null = tới hết clip).
  in: number;
  out: number | null;
};

export const MAX_CLIPS = 12;

export function clipError(c: TimelineClip): string | null {
  if (c.kind === "image") return c.duration >= 1 && c.duration <= 10 ? null : "Số giây ảnh từ 1 đến 10";
  if (!(c.in >= 0)) return "Điểm bắt đầu không hợp lệ";
  if (c.out !== null && !(c.out > c.in)) return "Điểm kết thúc phải lớn hơn điểm bắt đầu";
  return null;
}

// Độ dài hiển thị trên timeline (video chưa biết độ dài thì coi 5 giây).
export function clipSeconds(c: TimelineClip): number {
  if (c.kind === "image") return c.duration;
  return Math.max(0.5, (c.out ?? Math.max(c.in + 5, 5)) - c.in);
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Dải clip theo thứ tự ghép: kéo thả (chuột) hoặc nút ◀ ▶ (cảm ứng); thả clip từ kho vào để thêm.
export function ClipStrip({
  clips,
  selected,
  onSelect,
  onChange,
  onDropNew,
  onAddClick,
}: {
  clips: TimelineClip[];
  selected: string | null;
  onSelect: (key: string) => void;
  onChange: (clips: TimelineClip[]) => void;
  onDropNew: (clip: PickedClip, at: number) => void;
  onAddClick: () => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const total = clips.reduce((s, c) => s + clipSeconds(c), 0);

  function drop(e: React.DragEvent, at: number) {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-am-clip");
    if (raw) {
      try {
        onDropNew(JSON.parse(raw) as PickedClip, at);
      } catch {
        // dữ liệu kéo lạ
      }
    } else if (drag !== null) {
      onChange(moveItem(clips, drag, Math.min(at, clips.length - 1)));
    }
    setDrag(null);
    setOver(null);
  }

  return (
    <div className="rounded-m3 bg-s1 p-3 hairline">
      <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <span className="t-label">Timeline</span>
        <span className="text-xs text-muted tabular-nums">
          {clips.length}/{MAX_CLIPS} clip · ~{Math.round(total)}s
        </span>
      </div>
      <div
        className="no-scrollbar flex min-h-[104px] items-stretch gap-1.5 overflow-x-auto pb-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => drop(e, clips.length)}
      >
        {clips.map((c, i) => {
          const err = clipError(c);
          const sec = clipSeconds(c);
          const active = c.key === selected;
          return (
            <div
              key={c.key}
              draggable
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOver(i);
              }}
              onDragLeave={() => setOver((v) => (v === i ? null : v))}
              onDrop={(e) => {
                e.stopPropagation();
                drop(e, i);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onClick={() => onSelect(c.key)}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-label={`Clip ${i + 1}`}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" && e.altKey) onChange(moveItem(clips, i, i - 1));
                else if (e.key === "ArrowRight" && e.altKey) onChange(moveItem(clips, i, i + 1));
                else if (e.key === "Enter" || e.key === " ") onSelect(c.key);
              }}
              className={cx(
                "reveal group relative shrink-0 cursor-grab overflow-hidden rounded-[12px] bg-s3 transition-[box-shadow,opacity,transform] duration-[260ms] active:cursor-grabbing",
                active ? "shadow-[0_0_0_2px_var(--color-accent)]" : err ? "shadow-[0_0_0_1.5px_var(--color-danger)]" : "shadow-[inset_0_0_0_1px_var(--color-line2)]",
                drag === i && "opacity-40",
                over === i && drag !== i && "translate-x-1.5",
              )}
              style={{ width: `clamp(76px, ${sec * 22}px, 220px)`, "--i": i } as React.CSSProperties}
            >
              {c.kind === "image" ? (
                <img src={thumbUrl(c.url, 240)} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
              ) : (
                <img src={posterUrl(c.url, 240)} alt="" loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
              )}
              <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
              <span className="absolute top-1.5 left-2 text-[11px] font-bold text-white tabular-nums">{i + 1}</span>
              <span className="absolute right-2 bottom-1.5 flex items-center gap-1 text-[11px] font-medium text-white/90 tabular-nums">
                <Icon name={c.kind === "image" ? "image" : "video"} size={11} />
                {sec % 1 ? sec.toFixed(1) : sec}s
              </span>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAddClick}
          disabled={clips.length >= MAX_CLIPS}
          className="press flex w-[76px] shrink-0 flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-white/15 text-xs text-muted hover:border-white/30 hover:text-fg disabled:opacity-30"
        >
          <Icon name="plus" size={20} />
          Thêm
        </button>
        {clips.length === 0 && <p className="self-center px-3 text-sm text-muted">Chọn hoặc kéo clip từ kho vào đây</p>}
      </div>
    </div>
  );
}

// Bảng chỉnh clip đang chọn.
export function ClipInspector({
  clip,
  index,
  count,
  onPatch,
  onMove,
  onRemove,
}: {
  clip: TimelineClip;
  index: number;
  count: number;
  onPatch: (patch: Partial<TimelineClip>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const err = clipError(clip);
  const num = "h-10 w-20 rounded-m1 bg-white/[.04] px-3 text-sm tabular-nums shadow-[inset_0_0_0_1px_var(--color-line2)] outline-none focus:shadow-[inset_0_0_0_1px_var(--color-accent)]";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Clip {index + 1} <span className="font-normal text-muted">· {clip.kind === "image" ? "Ảnh" : "Video"}</span>
        </p>
        <div className="flex gap-1">
          <IconButton icon="chevronLeft" label="Đưa lên trước" size="sm" variant="subtle" disabled={index === 0} onClick={() => onMove(index - 1)} />
          <IconButton icon="chevronRight" label="Đưa ra sau" size="sm" variant="subtle" disabled={index === count - 1} onClick={() => onMove(index + 1)} />
          <IconButton icon="trash" label="Bỏ clip" size="sm" variant="danger" onClick={onRemove} />
        </div>
      </div>
      {clip.kind === "image" ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-fg/80">Hiển thị</span>
            <span className="font-semibold tabular-nums">{clip.duration}s</span>
          </div>
          <Slider value={clip.duration} onChange={(v) => onPatch({ duration: v })} min={1} max={10} step={0.5} ariaLabel="Số giây hiển thị ảnh" />
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5">
            <span className="block text-xs text-muted">Từ giây</span>
            <input type="number" min={0} step={0.5} value={clip.in} onChange={(e) => onPatch({ in: Number(e.target.value) })} className={num} aria-label="Bắt đầu (giây)" />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs text-muted">Đến giây</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={clip.out ?? ""}
              placeholder="hết"
              onChange={(e) => onPatch({ out: e.target.value === "" ? null : Number(e.target.value) })}
              className={num}
              aria-label="Kết thúc (giây)"
            />
          </label>
        </div>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
      <p className="text-xs text-dim">Alt + ←/→ để đổi thứ tự bằng bàn phím.</p>
    </div>
  );
}
