import { redis } from "@/lib/redis";
import { AcpUnavailable, acpText } from "@/server/ai/acp/runtime";
import { codexProfileHome } from "@/server/ai/codex-profiles";
import {
  AI_PROVIDERS,
  DEFAULT_AGY_MODEL,
  chainFromLegacy,
  getAiRoles,
  type AiProvider,
  type AiRoles,
  type ChainStep,
  type RoleName,
  type RoleSetting,
} from "@/server/ai/roles";
import { getMuse } from "@/server/engines";
import { agyText } from "@/server/engines/agy";
import { codexText } from "@/server/engines/codex";
import { getScheduler, type MuseScheduler } from "@/server/engines/muse-scheduler";
import type { ChatMessage, HttpMuseClient } from "@/server/engines/muse";
import { EngineError } from "@/server/engines/types";

// AI Gateway: viết chữ bằng agy | codex | Muse chat theo chuỗi mắt xích (provider + model + effort) của vai
// trong setting `ai_roles` (writer: viết prompt, story: lập kịch bản). `fallback`: lần lượt; `race`: 2 mắt xích
// đầu chạy song song, lấy kết quả hợp lệ đầu tiên, hủy cái còn lại.

export { AI_PROVIDERS, DEFAULT_AGY_MODEL, type AiProvider, type ChainStep };

// Dạng setting cũ `ai_gateway` (test / API cũ vẫn truyền được).
export type GatewaySetting = {
  order: AiProvider[];
  agyModel?: string;
  codexModel?: string;
  museModel?: string;
  timeoutSec: number;
};

export type AiTextInput = {
  prompt: string;
  system?: string;
  // true: kết quả phải chứa 1 đối tượng JSON, không có thì coi như provider lỗi.
  json?: boolean;
  // Vai lấy chuỗi mắt xích (mặc định writer).
  role?: RoleName;
  // Provider ưu tiên: mắt xích của provider này lên đầu chuỗi; lỗi thì vẫn thử các mắt xích còn lại.
  provider?: AiProvider;
  // Muse: khóa hội thoại (chat chính), cùng khóa = cùng thread.
  threadKey?: string;
  signal?: AbortSignal;
  // Kiểm / đọc chữ AI trả (ném lỗi = chưa đạt). Kết quả trả về ở `data`.
  validate?: (text: string) => unknown;
  // Muse (có threadKey): chưa đạt thì nhắn thêm 1 câu trong CÙNG thread trước khi chuyển provider.
  followUp?: string;
};

export type Breakdown = { startMs?: number; sessionMs?: number; modelMs?: number };

export type AiTextResult = {
  text: string;
  data?: unknown;
  provider: AiProvider;
  model?: string;
  ms: number;
  breakdown?: Breakdown;
};

export type RunOutput = { text: string; model?: string; breakdown?: Breakdown };

export type ProviderRun = (args: {
  prompt: string;
  system?: string;
  threadKey?: string;
  signal: AbortSignal;
  // Dạng cũ (order + model theo provider), dựng từ chuỗi đang chạy.
  setting: GatewaySetting;
  step: ChainStep;
  roles: AiRoles;
  timeoutMs: number;
}) => Promise<string | RunOutput>;

export type GatewayDeps = {
  runners?: Partial<Record<AiProvider, ProviderRun>>;
  // Setting dạng cũ: thay chuỗi của vai bằng `order` + model.
  setting?: GatewaySetting;
  // Ghi đè chuỗi / strategy / timeout của vai.
  role?: Partial<RoleSetting>;
  roles?: AiRoles;
  muse?: HttpMuseClient;
  scheduler?: MuseScheduler;
  // agy hết quota (proxy tắt): đổi tài khoản agy, true = đã đổi → chạy lại mắt xích agy 1 lần.
  agySwitch?: () => Promise<boolean>;
};

export type ProviderHealth = { lastOkAt: string | null; lastErrAt: string | null; lastError: string | null; lastMs: number | null };

function keyPrefix(): string {
  return process.env.NODE_ENV === "test" ? "am:test:" : "am:";
}

function healthKey(p: AiProvider): string {
  return `${keyPrefix()}ai:health:${p}`;
}

// Dạng cũ của chuỗi writer (Admin cũ, prompt-writer cũ).
export function legacyView(role: RoleSetting): GatewaySetting {
  const order = [...new Set(role.chain.map((s) => s.provider))];
  const first = (p: AiProvider) => role.chain.find((s) => s.provider === p)?.model;
  return { order, agyModel: first("agy"), codexModel: first("codex"), museModel: first("muse"), timeoutSec: role.timeoutSec };
}

export async function getGatewaySetting(): Promise<GatewaySetting> {
  return legacyView((await getAiRoles()).writer);
}

export function agyTransport(roles: AiRoles): "acp" | "cli" {
  const env = process.env.AGY_TRANSPORT;
  return env === "acp" || env === "cli" ? env : roles.agy.transport;
}

function joinText(prompt: string, system?: string): string {
  return system ? `${system}\n\n${prompt}` : prompt;
}

const INVALID_MODEL = /invalid model selection|not recognized as a known model/i;

function defaultRunners(deps: GatewayDeps): Record<AiProvider, ProviderRun> {
  return {
    agy: async ({ prompt, system, signal, step, roles, timeoutMs }) => {
      const model = step.model || DEFAULT_AGY_MODEL;
      const text = joinText(prompt, system);
      if (agyTransport(roles) === "acp") {
        try {
          const r = await acpText({ text, model, fallbackModels: [DEFAULT_AGY_MODEL], signal, timeoutMs });
          return { text: r.text, model: r.model, breakdown: r.breakdown };
        } catch (err) {
          if (!(err instanceof AcpUnavailable)) throw err;
          console.warn(`[ai] agy ACP chưa sẵn sàng, dùng CLI: ${err.message.slice(0, 200)}`);
        }
      }
      const started = Date.now();
      try {
        return { text: await agyText(text, model, signal), model, breakdown: { modelMs: Date.now() - started } };
      } catch (err) {
        // Model cũ (Admin/setting cũ) không còn trong agy: thử lại 1 lần với model mặc định.
        if (model !== DEFAULT_AGY_MODEL && INVALID_MODEL.test((err as Error).message)) {
          console.warn(`[ai] agy không nhận model "${model}", dùng ${DEFAULT_AGY_MODEL}`);
          return { text: await agyText(text, DEFAULT_AGY_MODEL, signal), model: DEFAULT_AGY_MODEL };
        }
        throw err;
      }
    },
    codex: async ({ prompt, system, signal, step, roles }) => {
      const started = Date.now();
      // Mắt xích ghi profile riêng thì dùng profile đó, không thì profile đang bật.
      const profile = step.profile || roles.codex.profile;
      const text = await codexText(joinText(prompt, system), step.effort || "low", {
        model: step.model || undefined,
        signal,
        ...(profile !== "default" ? { home: codexProfileHome(profile) } : {}),
      });
      return { text, model: step.model, breakdown: { modelMs: Date.now() - started } };
    },
    muse: async ({ prompt, system, threadKey, signal, step, timeoutMs }) => {
      const scheduler = deps.scheduler ?? getScheduler();
      const t0 = Date.now();
      const lease = await scheduler.acquire("chat", { timeoutMs, signal });
      const done = scheduler.hold(lease);
      const t1 = Date.now();
      try {
        const messages: ChatMessage[] = [...(system ? [{ role: "system" as const, content: system }] : []), { role: "user", content: prompt }];
        const text = await (deps.muse ?? getMuse()).chat(messages, { user: threadKey, model: step.model, timeoutMs, signal });
        return { text, model: step.model ?? "muse-chat", breakdown: { sessionMs: t1 - t0, modelMs: Date.now() - t1 } };
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
const cooldownKey = (p: AiProvider) => `${keyPrefix()}gw:cooldown:${p}`;

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

// Chuỗi của vai: setting cũ truyền vào > ghi đè `deps.role` > ai_roles; provider ưu tiên lên đầu.
export function resolveChain(role: RoleSetting, preferred?: AiProvider): ChainStep[] {
  if (!preferred) return role.chain;
  const own = role.chain.filter((s) => s.provider === preferred);
  return [...(own.length ? own : [{ provider: preferred }]), ...role.chain.filter((s) => s.provider !== preferred)];
}

class LostRace extends Error {}

export async function aiText(input: AiTextInput, deps: GatewayDeps = {}): Promise<AiTextResult> {
  const roles = deps.roles ?? (await getAiRoles());
  const base: RoleSetting = deps.setting
    ? { chain: chainFromLegacy(deps.setting), strategy: "fallback", timeoutSec: deps.setting.timeoutSec }
    : roles[input.role ?? "writer"];
  const role: RoleSetting = { ...base, ...deps.role };
  const runners = { ...defaultRunners(deps), ...deps.runners };
  const preferred = resolveChain(role, input.provider);
  // Provider đang hết quota xuống cuối hàng (vẫn dùng nếu mọi provider khác đều lỗi).
  const cooling = deps.runners ? {} : await getCooldowns();
  const chain = [...preferred.filter((s) => !cooling[s.provider]), ...preferred.filter((s) => cooling[s.provider])];
  const setting = legacyView({ ...role, chain });
  const timeoutMs = role.timeoutSec * 1000;
  const agySwitch =
    deps.agySwitch ??
    (deps.runners
      ? undefined
      : async () => {
          const { switchAgyAccount } = await import("@/server/ai/agy/accounts");
          return (await switchAgyAccount({ auto: true })).switched;
        });
  let switched = false;
  const errors: string[] = [];

  // Chạy 1 mắt xích: kiểm kết quả, ghi health. `race`: tín hiệu hủy khi mắt xích khác đã thắng.
  const attempt = async (step: ChainStep, race?: AbortSignal): Promise<AiTextResult> => {
    const provider = step.provider;
    const started = Date.now();
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(input.signal ? [input.signal] : []), ...(race ? [race] : [])]);
    const run = (prompt: string) =>
      runners[provider]({ prompt, system: input.system, threadKey: input.threadKey, signal, setting, step, roles, timeoutMs });
    try {
      let out = normalize(await run(input.prompt));
      let data: unknown;
      if (input.validate) {
        try {
          data = input.validate(out.text);
        } catch (first) {
          if (!(input.followUp && provider === "muse" && input.threadKey)) throw first;
          console.warn(`[ai] muse trả chưa đạt, nhắn lại trong thread ${input.threadKey}: ${(first as Error).message.slice(0, 200)}`);
          out = normalize(
            await runners.muse({ prompt: input.followUp, threadKey: input.threadKey, signal, setting, step, roles, timeoutMs }),
          );
          data = input.validate(out.text);
        }
      } else if (input.json) {
        data = extractJson(out.text);
        if (data === undefined || data === null || typeof data !== "object") {
          throw new EngineError("BAD_OUTPUT", `${provider} không trả JSON: ${out.text.slice(0, 200)}`);
        }
      }
      if (race?.aborted) throw new LostRace();
      const ms = Date.now() - started;
      await recordHealth(provider, true, ms);
      if (cooling[provider]) await redis.del(cooldownKey(provider)).catch(() => 0);
      return {
        text: out.text,
        ...(input.json || input.validate ? { data } : {}),
        provider,
        ...(out.model ? { model: out.model } : step.model ? { model: step.model } : {}),
        ms,
        ...(out.breakdown ? { breakdown: out.breakdown } : {}),
      };
    } catch (err) {
      // Thua cuộc đua (bị hủy vì mắt xích khác đã xong): không tính là lỗi của provider.
      if (race?.aborted && !input.signal?.aborted) throw new LostRace();
      const ms = Date.now() - started;
      const message = (err as Error).message ?? String(err);
      await recordHealth(provider, false, ms, message);
      console.warn(`[ai] ${provider}${step.model ? `/${step.model}` : ""} lỗi sau ${ms} ms: ${message.slice(0, 300)}`);
      throw err;
    }
  };

  // Lỗi quota: agy (proxy tắt) đổi tài khoản 1 lần rồi chạy lại; vẫn lỗi thì tạm bỏ qua provider tới lúc reset.
  const attemptStep = async (step: ChainStep, race?: AbortSignal): Promise<AiTextResult> => {
    try {
      return await attempt(step, race);
    } catch (err) {
      if (err instanceof LostRace) throw err;
      const message = (err as Error).message ?? String(err);
      const cool = quotaCooldownSec(message);
      if (cool && step.provider === "agy" && !roles.agy.proxy && !switched && agySwitch && !input.signal?.aborted && !race?.aborted) {
        switched = true;
        const ok = await agySwitch().catch((e: Error) => {
          console.warn(`[ai] không đổi được tài khoản agy: ${e.message.slice(0, 200)}`);
          return false;
        });
        if (ok) {
          console.warn("[ai] agy hết quota: đã đổi tài khoản, chạy lại");
          try {
            return await attempt(step, race);
          } catch (again) {
            if (again instanceof LostRace) throw again;
            const cool2 = quotaCooldownSec((again as Error).message ?? "");
            if (cool2) await redis.set(cooldownKey("agy"), "1", "EX", cool2).catch(() => null);
            throw again;
          }
        }
      }
      if (cool) await redis.set(cooldownKey(step.provider), "1", "EX", cool).catch(() => null);
      throw err;
    }
  };

  const fail = (step: ChainStep, err: unknown) => {
    if (err instanceof LostRace) return;
    errors.push(`${step.provider}${step.model ? `/${step.model}` : ""}: ${((err as Error).message ?? String(err)).slice(0, 200)}`);
  };

  let rest = chain;
  if (role.strategy === "race" && chain.length >= 2) {
    const pair = chain.slice(0, 2);
    rest = chain.slice(2);
    if (input.signal?.aborted) throw new EngineError("CANCELED", "Đã hủy");
    const winner = await raceSteps(pair, attemptStep, fail);
    if (winner) return winner;
  }
  for (const step of rest) {
    if (input.signal?.aborted) throw new EngineError("CANCELED", "Đã hủy");
    try {
      return await attemptStep(step);
    } catch (err) {
      fail(step, err);
    }
  }
  if (input.signal?.aborted) throw new EngineError("CANCELED", "Đã hủy");
  throw new EngineError("AI_GATEWAY", `Mọi AI đều lỗi: ${errors.join(" | ")}`);
}

function normalize(out: string | RunOutput): RunOutput {
  return typeof out === "string" ? { text: out } : out;
}

// Chạy song song; cái đầu tiên hợp lệ thắng, các cái còn lại bị hủy (AbortSignal riêng). Đều lỗi → null.
async function raceSteps(
  steps: ChainStep[],
  run: (step: ChainStep, race: AbortSignal) => Promise<AiTextResult>,
  fail: (step: ChainStep, err: unknown) => void,
): Promise<AiTextResult | null> {
  const controllers = steps.map(() => new AbortController());
  return new Promise((resolve) => {
    let left = steps.length;
    let done = false;
    steps.forEach((step, i) => {
      run(step, controllers[i].signal).then(
        (res) => {
          if (done) return;
          done = true;
          controllers.forEach((c, j) => j !== i && c.abort());
          resolve(res);
        },
        (err: unknown) => {
          fail(step, err);
          if (--left === 0 && !done) resolve(null);
        },
      );
    });
  });
}
