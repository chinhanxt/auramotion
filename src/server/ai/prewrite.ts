import { createHash } from "node:crypto";
import type { PromptSkill } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { redis } from "@/lib/redis";
import type { GatewayDeps } from "@/server/ai/gateway";
import { getAiRoles } from "@/server/ai/roles";
import { db } from "@/lib/db";
import { loadSkill, writePrompt, type WritePromptInput, type WritePromptResult } from "@/server/engines/prompt-writer";

// Viết trước (prewrite): người dùng còn gõ thì đã viết prompt; bấm Tạo lấy ngay từ cache Redis.
// Khóa = sha256(skill id + updatedAt — hoặc "auto" + phiên bản bộ skill khi tự chọn —, ý tưởng, style, camera,
// tỷ lệ, thời lượng, có ảnh, loại). Cache giữ cả skill bộ chọn đã chọn (route) và các sửa của guard.

export type PrewriteInput = {
  idea: string;
  kind: "image" | "video";
  skillId?: string;
  styleId?: string;
  cameraId?: string;
  aspect?: string;
  durationSec?: number;
  hasRef?: boolean;
  planRank?: number;
};

export type CachedWrite = {
  prompt: string;
  provider: string;
  model?: string;
  ms?: number;
  skill?: { id: string; slug: string; name: string };
  route?: WritePromptResult["route"];
  guard?: WritePromptResult["guard"];
  at: number;
};

export type PrewriteReply =
  | { key: string; status: "ready"; prompt: string; skill?: CachedWrite["skill"]; provider: string; model?: string }
  | { key: string; status: "pending" }
  | { key: string; status: "error"; message: string }
  | { key: string; status: "disabled" };

const prefix = () => (process.env.NODE_ENV === "test" ? "am:test:" : "am:");
const doneKey = (k: string) => `${prefix()}pw:done:${k}`;
const pendingKey = (k: string) => `${prefix()}pw:pending:${k}`;
const errorKey = (k: string) => `${prefix()}pw:err:${k}`;
const ERROR_TTL_SEC = 30;
const WAIT_POLL_MS = 300;

// `skill`: skill chỉ định (id + updatedAt) hoặc chuỗi phiên bản bộ skill khi tự chọn.
export function prewriteKey(input: PrewriteInput, skill?: Pick<PromptSkill, "id" | "updatedAt"> | string | null): string {
  const parts = [
    typeof skill === "string" ? skill : skill ? `${skill.id}@${new Date(skill.updatedAt).getTime()}` : "",
    input.idea.trim(),
    input.styleId ?? "",
    input.cameraId ?? "",
    input.aspect ?? "",
    input.durationSec ?? "",
    input.hasRef ? 1 : 0,
    input.kind,
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function writeInput(input: PrewriteInput): WritePromptInput {
  return { ...input, autoSkill: !input.skillId };
}

// Phiên bản bộ skill tự chọn (số skill + lần sửa gần nhất): đổi skill thì khóa cũ hết hiệu lực.
async function skillSetVersion(input: PrewriteInput): Promise<string> {
  const kind = input.kind === "image" ? "IMAGE" : "VIDEO";
  const agg = await db.promptSkill.aggregate({
    where: { kind, enabled: true, ...(input.planRank !== undefined ? { minPlanRank: { lte: input.planRank } } : {}) },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return `auto:${agg._count._all}@${agg._max.updatedAt?.getTime() ?? 0}`;
}

// Khóa + skill chỉ định (không gọi AI: bộ chọn skill chạy lúc viết, kết quả nằm trong cache).
export async function resolvePrewrite(input: PrewriteInput): Promise<{ key: string; skill?: PromptSkill }> {
  if (input.skillId) {
    const skill = await loadSkill(input.skillId, input.kind === "image" ? "IMAGE" : "VIDEO", input.planRank);
    return { key: prewriteKey(input, skill), skill };
  }
  return { key: prewriteKey(input, await skillSetVersion(input)) };
}

export async function getCachedWrite(key: string): Promise<CachedWrite | null> {
  const raw = await redis.get(doneKey(key)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedWrite;
  } catch {
    return null;
  }
}

export async function isWritePending(key: string): Promise<boolean> {
  return (await redis.exists(pendingKey(key)).catch(() => 0)) === 1;
}

export async function storeWrite(key: string, res: WritePromptResult, cacheHours: number): Promise<CachedWrite | null> {
  if (!res.prompt) return null;
  const entry: CachedWrite = {
    prompt: res.prompt,
    provider: res.provider,
    ...(res.model ? { model: res.model } : {}),
    ...(res.ms !== undefined ? { ms: res.ms } : {}),
    ...(res.skill ? { skill: res.skill } : {}),
    ...(res.route ? { route: res.route } : {}),
    ...(res.guard ? { guard: res.guard } : {}),
    at: Date.now(),
  };
  const ttl = Math.round(cacheHours * 3600);
  if (ttl > 0) await redis.set(doneKey(key), JSON.stringify(entry), "EX", ttl).catch(() => null);
  return entry;
}

// Chờ lần viết đang chạy (cùng khóa) xong; quá giờ / lỗi → null.
export async function waitCachedWrite(key: string, timeoutMs: number, signal?: AbortSignal): Promise<CachedWrite | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !signal?.aborted) {
    const hit = await getCachedWrite(key);
    if (hit) return hit;
    if (!(await isWritePending(key))) return getCachedWrite(key);
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }
  return null;
}

export type PrewriteDeps = {
  gateway?: GatewayDeps;
  writePrompt?: typeof writePrompt;
  // false = người gọi đã có quá nhiều lần viết đang chạy.
  canStart?: () => boolean;
  // Lần viết nền vừa bắt đầu (test chờ, route đếm số lần viết của người dùng).
  onStart?: (p: Promise<void>) => void;
};

function toReply(key: string, hit: CachedWrite): PrewriteReply {
  return { key, status: "ready", prompt: hit.prompt, ...(hit.skill ? { skill: hit.skill } : {}), provider: hit.provider, ...(hit.model ? { model: hit.model } : {}) };
}

// Có sẵn → ready; đang viết (cùng khóa) → pending, không viết lần hai; chưa có → bắt đầu viết nền, trả pending.
export async function prewrite(input: PrewriteInput, deps: PrewriteDeps = {}): Promise<PrewriteReply> {
  const roles = await getAiRoles();
  const { key, skill } = await resolvePrewrite(input);
  if (!roles.prewrite) return { key, status: "disabled" };
  const hit = await getCachedWrite(key);
  if (hit) return toReply(key, hit);
  const failed = await redis.get(errorKey(key)).catch(() => null);
  if (failed) return { key, status: "error", message: failed };
  if (deps.canStart && !deps.canStart()) throw new AppError("CONCURRENCY_LIMIT", "AI đang viết trước cho bạn, vui lòng chờ");
  const lockSec = roles.writer.timeoutSec * Math.max(roles.writer.chain.length, 1) + 30;
  const won = await redis.set(pendingKey(key), "1", "EX", lockSec, "NX").catch(() => null);
  if (won !== "OK") return { key, status: "pending" };
  const job = (async () => {
    try {
      const res = await (deps.writePrompt ?? writePrompt)(writeInput(input), deps.gateway ?? {}, skill);
      if (!res.skill && skill) res.skill = { id: skill.id, slug: skill.slug, name: skill.name };
      if (!(await storeWrite(key, res, roles.cacheHours))) throw new Error("AI không trả prompt");
    } catch (err) {
      console.warn(`[prewrite] ${key.slice(0, 12)} lỗi: ${(err as Error).message.slice(0, 200)}`);
      await redis.set(errorKey(key), "AI chưa viết được, vui lòng thử lại", "EX", ERROR_TTL_SEC).catch(() => null);
    } finally {
      await redis.del(pendingKey(key)).catch(() => 0);
    }
  })();
  deps.onStart?.(job);
  return { key, status: "pending" };
}
