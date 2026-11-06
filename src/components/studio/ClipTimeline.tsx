"use client";

import { useState } from "react";
import type { PickedClip } from "./ClipPicker";

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

const inputClass = "w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-900";

// Danh sách clip theo thứ tự ghép: kéo thả để đổi thứ tự, xóa, chỉnh số giây / đoạn cắt.
export function ClipTimeline({ clips, onChange }: { clips: TimelineClip[]; onChange: (clips: TimelineClip[]) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function update(i: number, patch: Partial<TimelineClip>) {
    onChange(clips.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...clips];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700">Timeline</span>
        <span className="text-xs text-neutral-500">
          {clips.length}/{MAX_CLIPS} clip · kéo thả để đổi thứ tự
        </span>
      </div>
      {clips.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500">
          Bấm vào ảnh / video bên dưới để thêm clip
        </p>
      )}
      <ol className="space-y-2">
        {clips.map((c, i) => {
          const err = clipError(c);
          return (
            <li
              key={c.key}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className={`flex cursor-grab items-center gap-3 rounded-md border bg-white p-2 ${
                dragIndex === i ? "border-neutral-900 opacity-60" : "border-neutral-200"
              }`}
            >
              <span className="w-5 text-center text-xs font-semibold text-neutral-500">{i + 1}</span>
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-neutral-100">
                {c.kind === "image" ? (
                  <img src={c.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <video src={c.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {c.kind === "image" ? (
                  <label className="flex items-center gap-2 text-sm text-neutral-700">
                    Ảnh ·
                    <input
                      type="number"
                      min={1}
                      max={10}
                      step={0.5}
                      value={c.duration}
                      onChange={(e) => update(i, { duration: Number(e.target.value) })}
                      className={inputClass}
                    />
                    giây
                  </label>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
                    Video · từ
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={c.in}
                      onChange={(e) => update(i, { in: Number(e.target.value) })}
                      className={inputClass}
                      aria-label="Bắt đầu (giây)"
                    />
                    đến
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={c.out ?? ""}
                      placeholder="hết"
                      onChange={(e) => update(i, { out: e.target.value === "" ? null : Number(e.target.value) })}
                      className={inputClass}
                      aria-label="Kết thúc (giây)"
                    />
                    giây
                  </div>
                )}
                {err && <p className="text-xs text-red-600">{err}</p>}
              </div>
              <button
                type="button"
                onClick={() => onChange(clips.filter((_, j) => j !== i))}
                className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-red-600"
                aria-label="Xóa clip"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
