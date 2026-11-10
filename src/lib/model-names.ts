// Tên model ngắn (dùng chung server + client). Thuần, không I/O.
// Bỏ tiền tố hãng; còn "dòng + phiên bản", và bỏ phiên bản khi dòng đó chỉ có 1 phiên bản trong danh sách model đã biết:
// gpt-6.1-sol → "Sol 6.1", gpt-6-astra → "Astra", gemini-3.8-flash-low → "Flash 3.8", claude-sonnet-5-5-low → "Sonnet".

export type Effort = "low" | "medium" | "high";
export const EFFORT_BADGE: Record<Effort, string> = { low: "Nhanh", medium: "Cân bằng", high: "Kỹ" };
export const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2 };

// Model đã biết (agy ACP, codex, Muse) — mặc định để đếm phiên bản khi không có danh sách thật (vd trace ở client).
export const KNOWN_MODEL_IDS: readonly string[] = [
  "gemini-3.8-flash",
  "gemini-3.8-pro",
  "gemini-4-argon",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "gpt-oss-120b",
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-5.6-sol",
  "gpt-6.1-terra",
  "gpt-5.6-terra",
  "gpt-6-luna",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-6-chat-thinking",
  "gpt-daybreak-blue-latest",
  "muse-image",
  "muse-video",
  "muse-chat",
];

const PREFIXES = new Set(["gemini", "claude", "gpt", "muse"]);
const PREFIX_WORD: Record<string, string> = { gemini: "Gemini", claude: "Claude", gpt: "GPT", muse: "Muse" };
// Tên hạng chung chung: một mình "Flash" / "Pro" không đủ nghĩa → luôn giữ phiên bản.
const TIERS = new Set(["flash", "pro", "lite", "flash lite", "nano", "mini", "ultra"]);
// Dòng giữ tiền tố hãng: "GPT OSS 120B".
const KEEP_PREFIX = new Set(["oss"]);
const UPPER = new Set(["oss"]);

const NUM = /^\d+(\.\d+)*$/;

// Hậu tố effort của id (-low / -medium / -high); không có thì null.
export function effortOf(id: string | null | undefined): Effort | null {
  const m = /[-_ ](low|medium|high)$/i.exec((id ?? "").trim());
  return m ? (m[1].toLowerCase() as Effort) : null;
}

// Nhãn effort ngắn ("Nhanh" / "Cân bằng" / "Kỹ"); không có thì "".
export function effortBadge(id: string | null | undefined): string {
  const e = effortOf(id);
  return e ? EFFORT_BADGE[e] : "";
}

type Parsed = { prefix: string; family: string[]; version: string };

function parse(id: string): Parsed {
  const s = id
    .trim()
    .toLowerCase()
    .replace(/\s*·.*$/, "")
    .replace(/[-_ ](low|medium|high|xhigh|minimal)$/, "")
    .replace(/[-_ ]latest$/, "");
  const tokens = s.split(/[-_\s]+/).filter(Boolean);
  const prefix = PREFIXES.has(tokens[0] ?? "") ? tokens.shift()! : "";
  const family: string[] = [];
  let version = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Phiên bản đầu tiên; số tách bằng gạch (5-5) → 5.5.
    if (!version && NUM.test(t)) {
      const run = [t];
      while (/^\d+$/.test(tokens[i + 1] ?? "") && /^\d+$/.test(run[run.length - 1])) run.push(tokens[++i]);
      version = run.join(".");
      continue;
    }
    family.push(t);
  }
  return { prefix, family, version };
}

function word(t: string): string {
  if (UPPER.has(t)) return t.toUpperCase();
  if (/^\d+[a-z]$/.test(t)) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Tên ngắn của 1 id model. `known`: danh sách id thật của hãng (đếm số phiên bản mỗi dòng); mặc định KNOWN_MODEL_IDS.
export function shortModelName(id: string | null | undefined, known: readonly string[] = KNOWN_MODEL_IDS): string {
  const raw = (id ?? "").trim();
  if (!raw) return "";
  const p = parse(raw);
  const fam = p.family.map(word);
  const pre = PREFIX_WORD[p.prefix] ?? (p.prefix ? word(p.prefix) : "");
  if (p.prefix === "muse") return ["Muse", ...fam, p.version].filter(Boolean).join(" ");
  if (!fam.length) return [pre, p.version].filter(Boolean).join(" ") || raw;
  if (KEEP_PREFIX.has(p.family[0])) return [pre, ...fam, p.version].filter(Boolean).join(" ");
  const name = fam.join(" ");
  if (!p.version) return name;
  const key = p.family.join(" ");
  if (TIERS.has(key)) return `${name} ${p.version}`;
  const versions = new Set([p.version]);
  for (const k of known) {
    const q = parse(k);
    if (q.prefix === p.prefix && q.family.join(" ") === key && q.version) versions.add(q.version);
  }
  return versions.size > 1 ? `${name} ${p.version}` : name;
}

// Tên ngắn kèm effort khi có: "Flash 3.8 · Nhanh" (dùng ở chỗ không có ô badge riêng).
export function shortModelLabel(id: string | null | undefined, known?: readonly string[]): string {
  const name = shortModelName(id, known);
  const b = effortBadge(id);
  return b && name ? `${name} · ${b}` : name;
}
