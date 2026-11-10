import path from "node:path";
import { z } from "zod";
import { getSetting, setSetting } from "@/server/services/settings";

// Setting `ai_roles`: chuỗi provider (kèm model / effort) cho từng vai AI, thay `ai_gateway` + `prompt_writer` cũ.

export const AI_PROVIDERS = ["agy", "codex", "muse"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_AGY_MODEL = "gemini-3.8-flash-low";
// Model agy của setting cũ (`ai_gateway` không ghi agyModel).
export const LEGACY_AGY_MODEL = "claude-sonnet-5-5-low";
// Tên profile codex tạo từ web (data/codex/<name>).
export const CODEX_PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
// Tên profile đọc được (gồm thư mục có sẵn trong ~/.codex_profiles, có thể có dấu cách: "acc 6").
export const CODEX_PROFILE_NAME_RE = /^(?!.*\.\.)[\w][\w .-]{0,39}$/;

const optText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : undefined));

export const chainStepSchema = z.object({
  provider: z.enum(AI_PROVIDERS, { message: "Provider chỉ gồm Google, OpenAI, Muse" }),
  model: optText,
  effort: z
    .string()
    .trim()
    .regex(/^[a-z]{0,12}$/, { message: "Effort không hợp lệ" })
    .optional()
    .transform((v) => (v ? v : undefined)),
  // codex: profile riêng cho mắt xích này (bỏ trống = profile đang bật).
  profile: z
    .string()
    .trim()
    .regex(CODEX_PROFILE_NAME_RE, { message: "Tên profile OpenAI không hợp lệ" })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type ChainStep = { provider: AiProvider; model?: string; effort?: string; profile?: string };

// Kiểu ra của chainStepSchema có các trường optional (transform làm zod suy ra `model: string | undefined` bắt buộc).
const chainSchema = z
  .array(chainStepSchema)
  .min(1, { message: "Cần ít nhất 1 mắt xích" })
  .max(6, { message: "Tối đa 6 mắt xích" }) as unknown as z.ZodType<ChainStep[], ChainStep[]>;

const strategySchema = z.enum(["fallback", "race"], { message: "strategy chỉ gồm fallback, race" });

function roleSchema(timeoutSec: number) {
  return z.object({
    chain: chainSchema,
    strategy: strategySchema.default("fallback"),
    timeoutSec: z.coerce.number().int().min(10).max(600).default(timeoutSec),
  });
}

export const DEFAULT_AI_ROLES = {
  writer: {
    chain: [
      { provider: "agy", model: DEFAULT_AGY_MODEL },
      { provider: "codex", model: "gpt-6-luna", effort: "low" },
      { provider: "muse" },
    ] as ChainStep[],
    strategy: "fallback" as "fallback" | "race",
    timeoutSec: 60,
  },
  story: {
    chain: [{ provider: "muse" }, { provider: "agy", model: LEGACY_AGY_MODEL }] as ChainStep[],
    strategy: "fallback" as "fallback" | "race",
    timeoutSec: 120,
  },
  // Bộ chọn skill (tầng AI): đầu ra rất ngắn, chạy model nhanh qua ACP (~1–2 s).
  router: {
    chain: [
      { provider: "agy", model: DEFAULT_AGY_MODEL },
      { provider: "codex", model: "gpt-6-luna", effort: "low" },
    ] as ChainStep[],
    strategy: "fallback" as "fallback" | "race",
    timeoutSec: 20,
  },
  prewrite: true,
  cacheHours: 72,
  agy: { transport: "acp" as "acp" | "cli", proxy: false },
  codex: { profile: "default" },
};

export const aiRolesSchema = z.object({
  writer: roleSchema(DEFAULT_AI_ROLES.writer.timeoutSec).default(DEFAULT_AI_ROLES.writer),
  story: roleSchema(DEFAULT_AI_ROLES.story.timeoutSec).default(DEFAULT_AI_ROLES.story),
  router: roleSchema(DEFAULT_AI_ROLES.router.timeoutSec).default(DEFAULT_AI_ROLES.router),
  prewrite: z.boolean().default(true),
  cacheHours: z.coerce.number().min(0).max(24 * 30).default(72),
  agy: z
    .object({ transport: z.enum(["acp", "cli"]).default("acp"), proxy: z.boolean().default(false) })
    .default(DEFAULT_AI_ROLES.agy),
  codex: z
    .object({ profile: z.string().trim().regex(CODEX_PROFILE_NAME_RE, { message: "Tên profile OpenAI không hợp lệ" }).default("default") })
    .default(DEFAULT_AI_ROLES.codex),
});
export type AiRoles = z.infer<typeof aiRolesSchema>;
export type RoleName = "writer" | "story" | "router";
export type RoleSetting = AiRoles["writer"];

// Setting cũ.
export type LegacyGateway = { order?: unknown; agyModel?: string; codexModel?: string; museModel?: string; timeoutSec?: unknown };
export type LegacyWriter = { provider?: unknown; model?: string };

function isProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

// `order` + model của `ai_gateway` cũ → chuỗi mắt xích.
export function chainFromLegacy(g: LegacyGateway): ChainStep[] {
  const order = Array.isArray(g.order) ? [...new Set(g.order.filter(isProvider))] : [];
  return (order.length ? order : (["agy", "codex", "muse"] as AiProvider[])).map((provider): ChainStep => {
    if (provider === "agy") return { provider, model: g.agyModel?.trim() || LEGACY_AGY_MODEL };
    if (provider === "codex") return { provider, model: g.codexModel?.trim() || undefined, effort: "low" };
    return { provider, model: g.museModel?.trim() || undefined };
  });
}

// Đọc tương thích ngược: chưa có `ai_roles` thì dựng từ `ai_gateway` (thứ tự, model, timeout) + `prompt_writer`
// (provider viết prompt lên đầu chuỗi writer, model agy riêng). Không có gì thì dùng mặc định.
export function migrateLegacy(gateway: LegacyGateway | null, writer: LegacyWriter | null): AiRoles {
  if (!gateway && !writer) return aiRolesSchema.parse({});
  const chain = chainFromLegacy(gateway ?? {});
  const timeout = Number(gateway?.timeoutSec);
  const timeoutSec = Number.isFinite(timeout) && timeout >= 10 ? Math.min(Math.round(timeout), 600) : undefined;
  let writerChain = chain.map((s) => ({ ...s }));
  if (writer && isProvider(writer.provider)) {
    const first = writer.provider;
    const own = writerChain.find((s) => s.provider === first) ?? { provider: first };
    if (first === "agy" && writer.model?.trim()) own.model = writer.model.trim();
    if (first === "codex" && writer.model?.trim()) own.model = writer.model.trim();
    writerChain = [own, ...writerChain.filter((s) => s !== own)];
  }
  return aiRolesSchema.parse({
    writer: { chain: writerChain, ...(timeoutSec ? { timeoutSec } : {}) },
    story: { chain, ...(timeoutSec ? { timeoutSec } : {}) },
  });
}

export async function getAiRoles(): Promise<AiRoles> {
  const raw = await getSetting<unknown>("ai_roles").catch(() => null);
  if (raw && typeof raw === "object") {
    const parsed = aiRolesSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    console.warn(`[ai] setting ai_roles lỗi, dùng mặc định: ${parsed.error.issues[0]?.message}`);
  }
  const [gateway, writer] = await Promise.all([
    getSetting<LegacyGateway>("ai_gateway").catch(() => null),
    getSetting<LegacyWriter>("prompt_writer").catch(() => null),
  ]);
  return migrateLegacy(gateway && typeof gateway === "object" ? gateway : null, writer && typeof writer === "object" ? writer : null);
}

export async function saveAiRoles(input: unknown): Promise<AiRoles> {
  const roles = aiRolesSchema.parse(input);
  await setSetting("ai_roles", roles);
  return roles;
}

// Thư mục dữ liệu chạy của AuraMotion (pool ACP, profile codex, pid proxy).
export function runtimeDir(...parts: string[]): string {
  return path.resolve(process.env.AURA_DATA_DIR || "data", ...parts);
}
