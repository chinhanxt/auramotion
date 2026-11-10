import { cx } from "@/components/ui/cx";

// Dấu nhận diện gọn cho provider / thành phần (không dùng logo thật).
export const MONO: Record<string, { text: string; bg: string; glow: string }> = {
  agy: { text: "ag", bg: "linear-gradient(135deg,#4f8cff,#7c5cff 60%,#b06bff)", glow: "rgba(96,130,255,.55)" },
  codex: { text: "cx", bg: "linear-gradient(135deg,#19c39c,#0e9f8c 55%,#2e6cff)", glow: "rgba(25,195,156,.5)" },
  muse: { text: "M", bg: "linear-gradient(135deg,#ff4fd8,#ff7a9c 55%,#ffb36b)", glow: "rgba(255,79,216,.5)" },
  gemini: { text: "G", bg: "linear-gradient(135deg,#4f8cff,#38c8ff 60%,#9b8cff)", glow: "rgba(79,140,255,.5)" },
  local: { text: "ff", bg: "linear-gradient(135deg,#3a3a46,#5c5c6a)", glow: "rgba(160,160,180,.35)" },
};

export function monoFor(provider?: string | null) {
  const p = (provider ?? "").toLowerCase();
  if (p.startsWith("agy") || p === "antigravity") return MONO.agy;
  if (p.startsWith("codex") || p === "openai") return MONO.codex;
  if (p.startsWith("muse")) return MONO.muse;
  if (p.startsWith("gemini")) return MONO.gemini;
  return null;
}

export function Monogram({ provider, size = 32, className, fallback }: { provider?: string | null; size?: number; className?: string; fallback?: React.ReactNode }) {
  const m = monoFor(provider);
  if (!m) {
    return (
      <span className={cx("inline-flex shrink-0 items-center justify-center rounded-[10px] bg-white/[.06] text-fg/80 hairline", className)} style={{ width: size, height: size }}>
        {fallback}
      </span>
    );
  }
  return (
    <span
      className={cx("relative inline-flex shrink-0 items-center justify-center rounded-[10px] font-bold tracking-[-0.04em] text-white", className)}
      style={{ width: size, height: size, background: m.bg, fontSize: size * 0.42, boxShadow: `0 6px 18px -8px ${m.glow}, inset 0 0 0 1px rgba(255,255,255,.18)` }}
      aria-hidden="true"
    >
      {m.text}
    </span>
  );
}
