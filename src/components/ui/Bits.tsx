import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type Tone = "neutral" | "accent" | "aura" | "ok" | "warn" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-white/[.07] text-fg/80",
  accent: "bg-accent text-accent-ink",
  aura: "bg-[linear-gradient(110deg,rgba(124,92,255,.25),rgba(255,79,216,.22),rgba(255,179,107,.22))] text-fg",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/12 text-warn",
  danger: "bg-danger/14 text-danger",
  info: "bg-aura1/18 text-[#b7a6ff]",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap", TONE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Avatar({ name, url, size = 32, className }: { name: string; url?: string | null; size?: number; className?: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return url ? (
    <img src={url} alt="" width={size} height={size} className={cx("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />
  ) : (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: "linear-gradient(135deg,#7c5cff,#ff4fd8 60%,#ffb36b)" }}
    >
      {letter}
    </span>
  );
}

export function Skeleton({ className, style, aura }: { className?: string; style?: React.CSSProperties; aura?: boolean }) {
  return <div aria-hidden="true" className={cx("skel rounded-m1", aura && "skel-aura", className)} style={style} />;
}

export function AuraBar({ value, className }: { value?: number | null; className?: string }) {
  const known = typeof value === "number" && value > 0;
  return (
    <div
      className={cx("aura-bar", className)}
      data-indeterminate={known ? undefined : ""}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? value : undefined}
    >
      <i style={known ? { width: "100%", transform: `scaleX(${Math.min(100, value) / 100})` } : undefined} />
    </div>
  );
}

export function Empty({
  icon = "sparkle",
  title,
  hint,
  action,
  className,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      <span className="relative flex h-14 w-14 items-center justify-center rounded-m3 bg-s2 text-fg/80 hairline">
        <span className="absolute inset-0 rounded-m3 opacity-40 blur-xl" style={{ background: "var(--aura)" }} />
        <Icon name={icon} size={22} className="relative" />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function Card({ className, children, as: As = "div" }: { className?: string; children: React.ReactNode; as?: "div" | "section" | "aside" }) {
  return <As className={cx("rounded-m3 bg-s1 hairline", className)}>{children}</As>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-white/[.08] px-1 font-sans text-[11px] text-muted">{children}</kbd>;
}

// Thông báo nằm trong trang (banner), dùng cho trạng thái hệ thống thay vì toast.
export function Notice({ tone = "warn", icon = "info", children, className }: { tone?: "warn" | "danger" | "info"; icon?: IconName; children: React.ReactNode; className?: string }) {
  const color = tone === "danger" ? "text-danger bg-danger/[.08]" : tone === "info" ? "text-[#c4b8ff] bg-aura1/[.1]" : "text-warn bg-warn/[.08]";
  return (
    <div className={cx("flex items-start gap-2.5 rounded-m2 px-3.5 py-2.5 text-sm hairline", color, className)}>
      <Icon name={icon} size={18} className="mt-px shrink-0" />
      <div className="min-w-0 text-fg/85">{children}</div>
    </div>
  );
}
