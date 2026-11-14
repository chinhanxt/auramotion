"use client";

import { useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/Icon";

// Khung chọn / kéo-thả 1 file. Không tự tải lên: trả File cho bên gọi xử lý.
export function FileDrop({
  accept,
  onFile,
  busy,
  disabled,
  icon = "upload",
  title,
  hint,
  className,
}: {
  accept: string;
  onFile: (f: File) => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  title: string;
  hint?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const off = disabled || busy;
  const take = (f?: File | null) => {
    if (f && !off) onFile(f);
    if (input.current) input.current.value = "";
  };
  return (
    <button
      type="button"
      disabled={off}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!off) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
      className={cx(
        "press group flex w-full flex-col items-center justify-center gap-2 rounded-m3 border border-dashed px-4 py-6 text-center transition-colors disabled:cursor-wait disabled:opacity-70",
        over ? "border-accent bg-accent/[.07]" : "border-line2 bg-white/[.02] hover:bg-white/[.05]",
        className,
      )}
    >
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => take(e.target.files?.[0])} />
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[.06] text-muted transition-colors group-hover:text-fg">
        <Icon name={busy ? "refresh" : icon} size={18} className={busy ? "animate-spin" : undefined} />
      </span>
      <span className="text-sm font-medium">{busy ? "Đang tải lên…" : title}</span>
      {hint && !busy && <span className="text-xs text-dim">{hint}</span>}
    </button>
  );
}
