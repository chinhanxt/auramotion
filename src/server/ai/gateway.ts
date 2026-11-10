import { redis } from "@/lib/redis";
import { getMuse } from "@/server/engines";
import { agyText } from "@/server/engines/agy";
import { codexText } from "@/server/engines/codex";
import { getScheduler, type MuseScheduler } from "@/server/engines/muse-scheduler";
import type { ChatMessage, HttpMuseClient } from "@/server/engines/muse";
import { EngineError } from "@/server/engines/types";
import { getSetting } from "@/server/services/settings";

// AI Gateway: viết chữ bằng agy | codex | Muse chat, theo thứ tự trong setting `ai_gateway`, lỗi thì thử provider kế.

export const AI_PROVIDERS = ["agy", "codex", "muse"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export type GatewaySetting = {
  order: AiProvider[];
  agyModel?: string;
  codexModel?: string;
  museModel?: string;
  timeoutSec: number;
};

export const DEFAULT_AGY_MODEL = "claude-sonnet-5-5-low";
export const DEFAULT_GATEWAY: GatewaySetting = { order: ["agy", "codex", "muse"], agyModel: DEFAULT_AGY_MODEL, timeoutSec: 120 };

export type AiTextInput = {
  prompt: string;
  system?: string;
  // true: kết quả phải chứa 1 đối tượng JSON, không có thì coi như provider lỗi.
  json?: boolean;
  // Provider ưu tiên; lỗi thì vẫn thử các provider còn lại theo `order`.
  provider?: AiProvider;
  // Muse: khóa hội thoại (chat chính), cùng khóa = cùng thread.
  threadKey?: string;
  signal?: AbortSignal;
  // Kiểm / đọc chữ AI trả (ném lỗi = chưa đạt). Kết quả trả về ở `data`.
  validate?: (text: string) => unknown;
  // Muse (có threadKey): chưa đạt thì nhắn thêm 1 câu trong CÙNG thread trước khi chuyển provider.
  followUp?: string;
};

export type AiTextResult = { text: string; data?: unknown; provider: AiProvider; ms: number };

export type ProviderRun = (args: {
  prompt: string;
  system?: string;
  threadKey?: string;
  signal: AbortSignal;
  setting: GatewaySetting;
}) => Promise<string>;

export type GatewayDeps = {
  runners?: Partial<Record<AiProvider, ProviderRun>>;
  setting?: GatewaySetting;
  muse?: HttpMuseClient;
  scheduler?: MuseScheduler;
};

export type ProviderHealth = { lastOkAt: string | null; lastErrAt: string | null; lastError: string | null; lastMs: number | null };

function healthKey(p: AiProvider): string {
  return `${process.env.NODE_ENV === "test" ? "am:test:" : "am:"}ai:health:${p}`;
}

function isProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

export async function getGatewaySetting(): Promise<GatewaySetting> {
  const raw = await getSetting<Partial<GatewaySetting>>("ai_gateway").catch(() => null);
  if (!raw || typeof raw !== "object") return DEFAULT_GATEWAY;
  const order = Array.isArray(raw.order) ? [...new Set(raw.order.filter(isProvider))] : [];
  const timeoutSec = Number(raw.timeoutSec);
  return {
    ...raw,
    order: order.length ? order : DEFAULT_GATEWAY.order,
    timeoutSec: Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : DEFAULT_GATEWAY.timeoutSec,
  };
}

function joinText(prompt: string, system?: string): string {
  return system ? `${system}\n\n${prompt}` : prompt;
}

function defaultRunners(deps: GatewayDeps): Record<AiProvider, ProviderRun> {
  return {
    agy: async ({ prompt, system, signal, setting }) => {
      const model = setting.agyModel || DEFAULT_AGY_MODEL;
      try {
        return await agyText(joinText(prompt, system), model, signal);
      } catch (err) {
        // Model cũ (Admin/setting cũ) không còn trong agy: thử lại 1 lần với model mặc định.
        if (model !== DEFAULT_AGY_MODEL && /invalid model selection|not recognized as a known model/i.test((err as Error).message)) {
          console.warn(`[ai] agy không nhận model "${model}", dùng ${DEFAULT_AGY_MODEL}`);
          return agyText(joinText(prompt, system), DEFAULT_AGY_MODEL, signal);
        }
        throw err;
      }
    },
    codex: ({ prompt, system, signal, setting }) =>
      codexText(joinText(prompt, system), "low", { model: setting.codexModel || undefined, signal }),
    muse: async ({ prompt, system, threadKey, signal, setting }) => {
      const scheduler = deps.scheduler ?? getScheduler();
      const lease = await scheduler.acquire("chat", { timeoutMs: setting.timeoutSec * 1000, signal });
      const done = scheduler.hold(lease);
      try {
        const messages: ChatMessage[] = [...(system ? [{ role: "system" as const, content: system }] : []), { role: "user", content: prompt }];
        return await (deps.muse ?? getMuse()).chat(messages, {
          user: threadKey,
          model: setting.museModel,
          timeoutMs: setting.timeoutSec * 1000,
          signal,
        });
      } finally {
        await done();
      }
    },
  };
}

// Lấy đối tượng JSON đầu tiên trong chữ AI trả (bỏ ```json, chữ thừa trước/sau, dấu phẩy thừa).
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "").replace(/[“”]/g, '"');
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  const body = unfenced.slice(start, end + 1);
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // thử cách sửa kế
    }
  }
  return undefined;
}

async function recordHealth(p: AiProvider, ok: boolean, ms: number, error?: string): Promise<void> {
  const now = new Date().toISOString();
  const fields: Record<string, string> = { lastMs: String(ms) };
  if (ok) fields.lastOkAt = now;
  else {
    fields.lastErrAt = now;
    fields.lastError = (error ?? "").slice(0, 300);
  }
  await redis.hset(healthKey(p), fields).catch(() => 0);
}

export async function getGatewayHealth(): Promise<Record<AiProvider, ProviderHealth>> {
  const out = {} as Record<AiProvider, ProviderHealth>;
  for (const p of AI_PROVIDERS) {
    const h = await redis.hgetall(healthKey(p)).catch(() => ({}) as Record<string, string>);
    out[p] = {
      lastOkAt: h.lastOkAt ?? null,
      lastErrAt: h.lastErrAt ?? null,
      lastError: h.lastError ?? null,
      lastMs: h.lastMs ? Number(h.lastMs) : null,
    };
  }
  return out;
}

// Provider báo hết quota: tạm bỏ qua tới lúc reset (đọc "Resets in 2h34m33s", không có thì 15 phút).
const QUOTA_RE = /quota|exhausted your capacity|resource[_ ]exhausted|rate limit|usage limit|\b429\b/i;
const cooldownKey = (p: AiProvider) => `am:gw:cooldown:${p}`;

export function quotaCooldownSec(message: string): number | null {
  if (!QUOTA_RE.test(message)) return null;
  const m = /resets? in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i.exec(message);
  const sec = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
  return Math.min(Math.max(sec || 15 * 60, 60), 24 * 3600);
}

export async function getCooldowns(): Promise<Partial<Record<AiProvider, number>>> {
  const out: Partial<Record<AiProvider, number>> = {};
  for (const p of AI_PROVIDERS) {
    const ttl = await redis.ttl(cooldownKey(p)).catch(() => -2);
    if (ttl > 0) out[p] = ttl;
  }
  return out;
}

export async function aiText(input: AiTextInput, deps: GatewayDeps = {}): Promise<AiTextResult> {
  const setting = deps.setting ?? (await getGatewaySetting());
  const runners = { ...defaultRunners(deps), ...deps.runners };
  const preferred = input.provider ? [input.provider, ...setting.order.filter((p) => p !== input.provider)] : setting.order;
  // Provider đang hết quota xuống cuối hàng (vẫn dùng nếu mọi provider khác đều lỗi).
  const cooling = deps.runners ? {} : await getCooldowns();
  const order = [...preferred.filter((p) => !cooling[p]), ...preferred.filter((p) => cooling[p])];
  const errors: string[] = [];

  for (const provider of order) {
    if (input.signal?.aborted) throw new EngineError("CANCELED", "Đã hủy");
    const started = Date.now();
    const timeout = AbortSignal.timeout(setting.timeoutSec * 1000);
    const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
    try {
      let text = await runners[provider]({ prompt: input.prompt, system: input.system, threadKey: input.threadKey, signal, setting });
      let data: unknown;
      if (input.validate) {
        try {
          data = input.validate(text);
        } catch (first) {
          if (!(input.followUp && provider === "muse" && input.threadKey)) throw first;
          console.warn(`[ai] muse trả chưa đạt, nhắn lại trong thread ${input.threadKey}: ${(first as Error).message.slice(0, 200)}`);
          text = await runners.muse({ prompt: input.followUp, threadKey: input.threadKey, signal, setting });
          data = input.validate(text);
        }
      } else if (input.json) {
        data = extractJson(text);
        if (data === undefined || data === null || typeof data !== "object") {
          throw new EngineError("BAD_OUTPUT", `${provider} không trả JSON: ${text.slice(0, 200)}`);
        }
      }
      const ms = Date.now() - started;
      await recordHealth(provider, true, ms);
      if (cooling[provider]) await redis.del(cooldownKey(provider)).catch(() => 0);
      return { text, ...(input.json || input.validate ? { data } : {}), provider, ms };
    } catch (err) {
      const ms = Date.now() - started;
      const message = (err as Error).message ?? String(err);
      await recordHealth(provider, false, ms, message);
      const cool = quotaCooldownSec(message);
      if (cool) await redis.set(cooldownKey(provider), "1", "EX", cool).catch(() => null);
      errors.push(`${provider}: ${message.slice(0, 200)}`);
      console.warn(`[ai] ${provider} lỗi sau ${ms} ms: ${message.slice(0, 300)}`);
    }
  }
  throw new EngineError("AI_GATEWAY", `Mọi AI đều lỗi: ${errors.join(" | ")}`);
}
