// Đặt tên đẹp + hãng cho model (dùng khi đồng bộ, sắp xếp catalog). Thuần, không I/O.

export const VENDORS = ["muse", "google", "anthropic", "openai", "local"] as const;
export type Vendor = (typeof VENDORS)[number];

const EFFORT_BADGE: Record<string, string> = { low: "Nhanh", medium: "Cân bằng", high: "Kỹ" };
const WORD: Record<string, string> = { gpt: "GPT", gemini: "Gemini", claude: "Claude", muse: "Muse", codex: "Codex" };

// Thứ tự hãng hiển thị: Muse, Google, Anthropic, OpenAI, local, còn lại cuối.
export function vendorRank(vendor: string): number {
  const i = (VENDORS as readonly string[]).indexOf(vendor);
  return i < 0 ? VENDORS.length : i;
}

export function sortByVendor<T extends { vendor: string; sort: number; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => vendorRank(a.vendor) - vendorRank(b.vendor) || a.sort - b.sort || a.name.localeCompare(b.name));
}

// gemini→google, claude→anthropic, gpt/codex/o1…→openai, muse→muse; còn lại theo provider.
export function vendorOf(provider: string, engineModel: string): Vendor {
  const id = engineModel.toLowerCase();
  if (id.startsWith("gemini")) return "google";
  if (id.startsWith("claude")) return "anthropic";
  if (/^(gpt|codex|o\d)/.test(id)) return "openai";
  if (id.startsWith("muse")) return "muse";
  const p = provider.toUpperCase();
  if (p === "MUSE") return "muse";
  if (p === "CODEX") return "openai";
  if (p === "LOCAL") return "local";
  return "google";
}

// Hậu tố effort của id agy (-low/-medium/-high) → nhãn ngắn; không có thì "".
export function effortBadge(engineModel: string): string {
  const m = /-(low|medium|high)$/i.exec(engineModel);
  return m ? EFFORT_BADGE[m[1].toLowerCase()] : "";
}

function word(w: string): string {
  return WORD[w] ?? (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1));
}

// "gemini-3.8-flash-low" → "Gemini 3.8 Flash"; "claude-sonnet-5-5-low" → "Claude Sonnet 5.5";
// "gpt-6.1-sol" → "GPT-6.1 Sol"; "muse-image" → "Muse Image".
export function prettyModelName(engineModel: string): string {
  const parts = engineModel
    .trim()
    .replace(/-(low|medium|high)$/i, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    // Phiên bản tách bằng gạch: 5-5 → 5.5.
    if (/^\d+$/.test(p) && /^\d+$/.test(parts[i + 1] ?? "") && !/^\d/.test(out[out.length - 1] ?? "")) {
      out.push(`${p}.${parts[i + 1]}`);
      i++;
      continue;
    }
    out.push(word(p));
  }
  // GPT dính số phiên bản: "GPT-6.1".
  if (out[0] === "GPT" && /^\d/.test(out[1] ?? "")) out.splice(0, 2, `GPT-${out[1]}`);
  return out.join(" ") || engineModel;
}
