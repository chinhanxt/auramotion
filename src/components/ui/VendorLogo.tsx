import { cx } from "./cx";

// Dấu monogram theo hãng model (màu gần nhận diện hãng, không dùng logo thật).
type Mark = { text: string; bg: string; fg: string; ring: string; glow: string };

export const VENDOR_MARK: Record<string, Mark> = {
  muse: { text: "M", bg: "linear-gradient(140deg,#ff4fd8 0%,#b45cff 55%,#7c5cff 100%)", fg: "#fff", ring: "rgba(255,255,255,.22)", glow: "rgba(200,90,255,.55)" },
  google: { text: "G", bg: "linear-gradient(140deg,#4285f4 0%,#3b9bf0 45%,#34a853 100%)", fg: "#fff", ring: "rgba(255,255,255,.22)", glow: "rgba(66,133,244,.5)" },
  anthropic: { text: "A", bg: "linear-gradient(140deg,#e08a64 0%,#d97757 50%,#b85c3e 100%)", fg: "#fff6ee", ring: "rgba(255,240,225,.25)", glow: "rgba(217,119,87,.5)" },
  openai: { text: "O", bg: "radial-gradient(120% 120% at 30% 20%,#1d1d22 0%,#050506 70%)", fg: "#f5f5f7", ring: "rgba(16,163,127,.75)", glow: "rgba(16,163,127,.45)" },
  local: { text: "ff", bg: "linear-gradient(140deg,#3a3a46,#5c5c6a)", fg: "#e9e9ef", ring: "rgba(255,255,255,.16)", glow: "rgba(160,160,180,.3)" },
};
const OTHER: Mark = { text: "•", bg: "linear-gradient(140deg,#2a2a33,#3a3a46)", fg: "#e9e9ef", ring: "rgba(255,255,255,.14)", glow: "rgba(160,160,180,.25)" };

export function VendorLogo({ vendor, size = 28, className }: { vendor: string; size?: number; className?: string }) {
  const m = VENDOR_MARK[vendor] ?? { ...OTHER, text: (vendor[0] ?? "•").toUpperCase() };
  return (
    <span
      aria-hidden="true"
      className={cx("relative inline-flex shrink-0 items-center justify-center font-bold tracking-[-0.04em] select-none", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: m.bg,
        color: m.fg,
        fontSize: size * (m.text.length > 1 ? 0.36 : 0.46),
        boxShadow: `0 6px 16px -8px ${m.glow}, inset 0 0 0 ${vendor === "openai" ? 1.5 : 1}px ${m.ring}`,
      }}
    >
      {m.text}
    </span>
  );
}
