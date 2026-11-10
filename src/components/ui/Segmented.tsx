"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "./cx";

export type SegmentOption<T extends string | number> = { value: T; label: React.ReactNode; disabled?: boolean; title?: string };

// Nút chọn một trong nhiều, nền "thumb" trượt theo lựa chọn.
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  block = false,
  className,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  block?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLButtonElement>(`[data-active="true"]`);
    if (!el || !wrap.current) return setThumb(null);
    const measure = () => setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [value, options.length]);

  return (
    <div
      ref={wrap}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(
        "relative isolate shrink-0 items-center rounded-m1 bg-white/[.04] p-[3px] shadow-[inset_0_0_0_1px_var(--color-line)]",
        block ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      {thumb && (
        <span
          aria-hidden="true"
          className="absolute top-[3px] bottom-[3px] left-0 -z-10 rounded-[8px] bg-white/[.1] shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)] transition-[transform,width] duration-[260ms] ease-[var(--ease-out)]"
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              "press relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3.5 text-[13px]",
              block && "flex-1",
              active ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
