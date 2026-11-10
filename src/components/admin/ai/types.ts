// Kiểu dữ liệu `/api/admin/ai` (docs/v2-ai-runtime.md). Mọi trường tùy chọn: backend có thể chưa trả đủ.
import type { ProviderHealth } from "../engine/live";

export type AiProvider = "agy" | "codex" | "muse";
export const AI_PROVIDERS: AiProvider[] = ["agy", "codex", "muse"];

export type ChainStep = { provider: AiProvider; model?: string; effort?: string };
export type Strategy = "fallback" | "race";

export type AiRoles = {
  writer: { chain: ChainStep[]; strategy?: Strategy; timeoutSec?: number };
  story: { chain: ChainStep[] };
  prewrite?: boolean;
  cacheHours?: number;
  agy?: { transport?: "acp" | "cli"; proxy?: boolean };
  codex?: { profile?: string };
};

export type Quota = { group: string; pct: number; resetAt?: string | number | null };
export type AgyAccount = { id: string; email: string; active?: boolean; quota?: Quota[] };
export type AiModel = { id: string; name?: string; efforts?: string[]; defaultEffort?: string };

export type AgyInfo = {
  installed?: boolean;
  version?: string | null;
  transport?: "acp" | "cli";
  acp?: { alive?: boolean; processes?: number; sessions?: number };
  accounts?: AgyAccount[];
  proxy?: { enabled?: boolean; port?: number; running?: boolean };
  models?: AiModel[];
};
export type CodexProfile = { name: string; loggedIn?: boolean; method?: string | null; active?: boolean };
export type CodexInfo = { installed?: boolean; version?: string | null; profiles?: CodexProfile[]; models?: AiModel[] };
export type MuseInfo = { ok?: boolean; accounts?: number | unknown[] | null };

export type AiData = {
  roles?: Partial<AiRoles>;
  providers?: { agy?: AgyInfo; codex?: CodexInfo; muse?: MuseInfo };
  health?: Partial<Record<AiProvider, ProviderHealth>>;
  cooldowns?: Partial<Record<AiProvider, string | number | null>>;
};

export type TestResult = {
  text: string;
  prompt?: string;
  ms: number;
  breakdown?: { startMs?: number; sessionMs?: number; modelMs?: number };
  provider: string;
  model?: string;
};

export const DEFAULT_ROLES: AiRoles = {
  writer: {
    chain: [{ provider: "agy", model: "gemini-3.8-flash-low" }, { provider: "codex", model: "gpt-6-luna", effort: "low" }, { provider: "muse" }],
    strategy: "fallback",
    timeoutSec: 60,
  },
  story: { chain: [{ provider: "muse" }, { provider: "agy", model: "claude-sonnet-5-5-low" }] },
  prewrite: true,
  cacheHours: 72,
  agy: { transport: "acp", proxy: false },
  codex: { profile: "default" },
};

// Ghép roles từ API với mặc định (đọc tương thích khi backend trả thiếu).
export function normalizeRoles(r?: Partial<AiRoles> | null): AiRoles {
  const d = DEFAULT_ROLES;
  return {
    writer: {
      chain: r?.writer?.chain?.length ? r.writer.chain : d.writer.chain,
      strategy: r?.writer?.strategy ?? d.writer.strategy,
      timeoutSec: r?.writer?.timeoutSec ?? d.writer.timeoutSec,
    },
    story: { chain: r?.story?.chain?.length ? r.story.chain : d.story.chain },
    prewrite: r?.prewrite ?? d.prewrite,
    cacheHours: r?.cacheHours ?? d.cacheHours,
    agy: { ...d.agy, ...r?.agy },
    codex: { ...d.codex, ...r?.codex },
  };
}

export function stepLabel(s: { provider: string; model?: string | null; effort?: string | null }): string {
  return [s.provider, s.model, s.effort].filter(Boolean).join(" · ");
}

export function toTime(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
