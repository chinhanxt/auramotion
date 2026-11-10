"use client";

import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export function Chip({
  active,
  onClick,
  children,
  icon,
  className,
  disabled,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  icon?: IconName;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cx(
        "press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap disabled:opacity-40",
        active
          ? "bg-fg text-bg"
          : "bg-white/[.05] text-fg/80 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white/[.09] hover:text-fg",
        className,
      )}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  icon,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="press group flex w-full items-center gap-3 rounded-m1 px-1 py-1.5 text-left disabled:opacity-40"
    >
      {icon && <Icon name={icon} size={18} className="shrink-0 text-muted" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-fg/90">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span
        className={cx(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-[260ms]",
          checked ? "bg-accent" : "bg-white/[.12]",
        )}
      >
        <span
          className={cx(
            "absolute top-[3px] left-[3px] h-[18px] w-[18px] rounded-full shadow transition-transform duration-[260ms] ease-[var(--ease-spring)]",
            checked ? "translate-x-4 bg-accent-ink" : "bg-fg",
          )}
        />
      </span>
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  ariaLabel?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="inline-flex h-9 items-center rounded-m1 bg-white/[.04] shadow-[inset_0_0_0_1px_var(--color-line)]" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        aria-label="Giảm"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
        className="press flex h-9 w-9 items-center justify-center text-muted hover:text-fg disabled:opacity-30"
      >
        <Icon name="minus" size={16} />
      </button>
      <span className="min-w-10 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
        {suffix}
      </span>
      <button
        type="button"
        aria-label="Tăng"
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
        className="press flex h-9 w-9 items-center justify-center text-muted hover:text-fg disabled:opacity-30"
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  ariaLabel?: string;
}) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[#d4ff3a]"
      style={{ background: `linear-gradient(90deg,#d4ff3a ${pct}%,rgba(255,255,255,.12) ${pct}%)` }}
    />
  );
}
