import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ALL_QUEUE_NAMES, anyQueue, type AnyQueueName } from "@/lib/queue";
import { aiText, extractJson, getCooldowns, getGatewayHealth, getGatewaySetting, type GatewayDeps } from "@/server/ai/gateway";
import { getAiRoles, saveAiRoles, type ChainStep } from "@/server/ai/roles";
import { renderTemplate } from "@/server/ai/template";
import { getMuse } from "@/server/engines";
import { clearVideoBlocked, getVideoBlocked } from "@/server/engines/muse-block";
import { getScheduler } from "@/server/engines/muse-scheduler";
import { EngineError } from "@/server/engines/types";
import { gatewaySettingSchema } from "@/server/services/admin";
import { createJob } from "@/server/services/job";
import { setSetting } from "@/server/services/settings";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

async function mapDbErrors<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", `${what} đã tồn tại`);
    if (isNotFound(err)) throw new AppError("NOT_FOUND", `Không tìm thấy ${what.toLowerCase()}`);
    throw err;
  }
}

// ---------- Skill ----------

const skillFields = {
  slug: z.string().trim().regex(/^[a-z0-9-]{2,60}$/, { message: "Slug chỉ gồm chữ thường, số, dấu gạch ngang" }),
  name: z.string().trim().min(1, { message: "Vui lòng nhập tên" }).max(100),
  kind: z.enum(["IMAGE", "VIDEO", "STORY", "SCRIPT"]),
  description: z.string().trim().max(500),
  instructions: z.string().trim().min(1, { message: "Vui lòng nhập hướng dẫn" }).max(20000),
  template: z.string().trim().min(1, { message: "Vui lòng nhập template" }).max(10000),
  minPlanRank: z.coerce.number().int().min(0).max(2),
  enabled: z.boolean(),
  sort: z.coerce.number().int(),
};

export const skillCreateSchema = z.object({
  ...skillFields,
  description: skillFields.description.default(""),
  minPlanRank: skillFields.minPlanRank.default(0),
  enabled: skillFields.enabled.default(true),
  sort: skillFields.sort.default(0),
});
export const skillUpdateSchema = z.object(skillFields).partial();

export function listSkills() {
  return db.promptSkill.findMany({ orderBy: [{ kind: "asc" }, { sort: "asc" }, { name: "asc" }] });
}

export function createSkill(input: unknown) {
  const data = skillCreateSchema.parse(input);
  return mapDbErrors(() => db.promptSkill.create({ data }), "Skill");
}

export function updateSkill(id: string, input: unknown) {
  const data = skillUpdateSchema.parse(input);
  return mapDbErrors(() => db.promptSkill.update({ where: { id }, data }), "Skill");
}

// Story cũ trỏ tới skill đã xóa thì lập kịch bản bằng hướng dẫn mặc định.
export async function deleteSkill(id: string): Promise<{ deleted: boolean }> {
  await mapDbErrors(() => db.promptSkill.delete({ where: { id } }), "Skill");
  return { deleted: true };
}

export const skillTestSchema = z.object({
  idea: z.string().trim().min(1, { message: "Hãy nhập ý tưởng" }).max(2000),
  provider: z.enum(["agy", "codex", "muse"]).optional(),
});

export async function testSkill(id: string, input: unknown, deps: GatewayDeps = {}) {
  const { idea, provider } = skillTestSchema.parse(input);
  const skill = await db.promptSkill.findUnique({ where: { id } });
  if (!skill) throw new AppError("NOT_FOUND", "Không tìm thấy skill");
  const prompt = renderTemplate(skill.template, { idea, aspect: "9:16", duration: 5, shots: 3 });
  try {
    const res = await aiText({ prompt, system: skill.instructions, provider }, deps);
    return { text: res.text, data: extractJson(res.text) ?? null, provider: res.provider, ms: res.ms, prompt };
  } catch (err) {
    if (err instanceof EngineError) throw new AppError("ENGINE", `AI chưa trả lời được: ${err.message.slice(0, 300)}`);
    throw err;
  }
}

// ---------- Bìa preset ----------

// Tạo 1 job ảnh Muse làm bìa preset: Admin chịu, không trừ Credit; xong thì preset.cover = ảnh.
export async function createPresetCover(adminId: string, presetId: string) {
  const preset = await db.preset.findUnique({ where: { id: presetId } });
  if (!preset) throw new AppError("NOT_FOUND", "Không tìm thấy preset");
  const model = await db.aiModel.findFirst({
    where: { kind: "IMAGE", provider: "MUSE", enabled: true },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
  });
  if (!model) throw new AppError("NOT_FOUND", "Chưa có engine ảnh Muse nào đang bật");
  const ratios = ((model.options ?? {}) as { aspectRatios?: string[] }).aspectRatios ?? [];
  const aspectRatio = ratios.includes("4:5") ? "4:5" : ratios.includes("1:1") ? "1:1" : (ratios[0] ?? "1:1");
  const subject =
    preset.kind === "CAMERA"
      ? `a cinematic still that clearly suggests this camera move: ${preset.promptSuffix}`
      : `an iconic cover image in this style: ${preset.promptSuffix}`;
  const prompt = `${subject}. ${preset.description}. Simple striking composition, rich colour, no text, no letters, no logos, no watermark.`.slice(0, 2000);
  const job = await createJob(
    adminId,
    { kind: "image", modelId: model.id, prompt, aspectRatio, imageCount: 1 },
    { free: true, extraParams: { coverPresetId: preset.id } },
  );
  return { job };
}

// ---------- Job nổi bật ----------

export const featuredSchema = z.object({ featured: z.boolean({ message: "featured phải là true/false" }) });

export async function setJobFeatured(id: string, input: unknown) {
  const { featured } = featuredSchema.parse(input);
  return mapDbErrors(() => db.job.update({ where: { id }, data: { featured } }), "Tác vụ");
}

// ---------- AI Gateway ----------

export async function getGatewayAdmin() {
  const [setting, health, cooldowns] = await Promise.all([getGatewaySetting(), getGatewayHealth(), getCooldowns()]);
  // cooldowns (dạng cũ theo provider): số giây nghỉ lâu nhất trong các model của provider; `cooldownsByModel` đầy đủ.
  const byProvider: Record<string, number> = {};
  for (const [id, ttl] of Object.entries(cooldowns)) {
    const p = id.split(":")[0];
    byProvider[p] = Math.max(byProvider[p] ?? 0, ttl);
  }
  return { setting, health, cooldowns: byProvider, cooldownsByModel: cooldowns };
}

// API cũ (order + model theo provider): đổi sang chuỗi writer của ai_roles, giữ model / effort đã có của từng provider.
export async function putGatewayAdmin(input: unknown) {
  const setting = gatewaySettingSchema.parse(input);
  await setSetting("ai_gateway", setting);
  const roles = await getAiRoles();
  const model = { agy: setting.agyModel, codex: setting.codexModel, muse: setting.museModel };
  const chain = setting.order.map((provider): ChainStep => {
    const own = roles.writer.chain.find((s) => s.provider === provider) ?? { provider };
    return { ...own, ...(model[provider] ? { model: model[provider] } : {}) };
  });
  await saveAiRoles({ ...roles, writer: { ...roles.writer, chain, timeoutSec: setting.timeoutSec } });
  return getGatewayAdmin();
}

export const gatewayTestSchema = z.object({
  prompt: z.string().trim().min(1, { message: "Hãy nhập nội dung thử" }).max(4000),
  provider: z.enum(["agy", "codex", "muse"]).optional(),
});

// Chạy thử 1 câu qua gateway (provider chọn trước, lỗi thì thử provider kế theo `order`).
export async function testGateway(input: unknown, deps: GatewayDeps = {}) {
  const { prompt, provider } = gatewayTestSchema.parse(input);
  try {
    const res = await aiText({ prompt, provider }, deps);
    return { text: res.text, provider: res.provider, ms: res.ms };
  } catch (err) {
    if (err instanceof EngineError) throw new AppError("ENGINE", `AI chưa trả lời được: ${err.message.slice(0, 300)}`);
    throw err;
  }
}

// ---------- Tổng quan (dashboard) ----------

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Số liệu nhanh cho dashboard: tổng người dùng, job hôm nay (giờ VN) theo trạng thái, job lỗi gần nhất.
export async function getOpsSnapshot(now: Date = new Date()) {
  const local = now.getTime() + VN_OFFSET_MS;
  const today = new Date(local - (local % DAY_MS) - VN_OFFSET_MS);
  const [users, byStatus, recentFailed] = await Promise.all([
    db.user.count(),
    db.job.groupBy({ by: ["status"], where: { createdAt: { gte: today, lte: now } }, _count: { _all: true } }),
    db.job.findMany({
      where: { status: "FAILED" },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: { id: true, kind: true, prompt: true, error: true, createdAt: true, finishedAt: true, user: { select: { email: true } }, model: { select: { name: true, displayName: true } } },
    }),
  ]);
  const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const succeeded = count("SUCCEEDED");
  const failed = count("FAILED");
  const done = succeeded + failed;
  return {
    users,
    jobsToday: byStatus.reduce((sum, r) => sum + r._count._all, 0),
    succeededToday: succeeded,
    failedToday: failed,
    activeNow: count("PENDING") + count("RUNNING"),
    successRate: done ? Math.round((succeeded / done) * 1000) / 10 : null,
    recentFailed,
  };
}

// ---------- Hàng đợi ----------

const COUNT_TYPES = ["waiting", "active", "delayed", "failed", "completed", "prioritized"] as const;

export async function getQueuesAdmin() {
  const queues = await Promise.all(
    ALL_QUEUE_NAMES.map(async (name) => {
      const q = anyQueue(name);
      const [counts, paused] = await Promise.all([q.getJobCounts(...COUNT_TYPES), q.isPaused()]);
      return { name, paused, counts };
    }),
  );
  const [running, slots] = await Promise.all([
    db.job.findMany({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "asc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        userId: true,
        storyId: true,
        shotIndex: true,
        progress: true,
        startedAt: true,
        museTaskId: true,
        model: { select: { name: true, displayName: true, provider: true } },
        user: { select: { email: true } },
      },
    }),
    getScheduler().counts(),
  ]);
  return { queues, running, museSlots: slots };
}

export const queueNameSchema = z.enum(ALL_QUEUE_NAMES, { message: "Hàng đợi không tồn tại" });

export async function setQueuePaused(name: string, action: string) {
  const queue = anyQueue(queueNameSchema.parse(name) as AnyQueueName);
  if (action === "pause") await queue.pause();
  else if (action === "resume") await queue.resume();
  else throw new AppError("VALIDATION", "Thao tác chỉ gồm pause, resume");
  return { name, paused: await queue.isPaused() };
}

// ---------- muse2api (proxy /admin/*) ----------

async function muse<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  try {
    return await getMuse().admin<T>(method, path, body);
  } catch (err) {
    if (err instanceof EngineError) {
      if (err.code === "MUSE_NOT_FOUND") throw new AppError("NOT_FOUND", "muse2api không tìm thấy tài khoản");
      if (err.code === "MUSE_REJECTED") throw new AppError("VALIDATION", err.message.slice(0, 300));
      throw new AppError("ENGINE", err.message.slice(0, 300));
    }
    throw err;
  }
}

const accountId = z.string().regex(/^[\w.-]{1,100}$/, { message: "Mã tài khoản không hợp lệ" });

// Cookie: dict, chuỗi "Cookie", hoặc danh sách cookie xuất từ trình duyệt; hoặc nhiều tài khoản { accounts: [...] }.
const cookies = z.union([z.record(z.string(), z.string()), z.string().min(1).max(100_000), z.array(z.record(z.string(), z.unknown())).min(1).max(500)]);
const accountCreate = z.object({ label: z.string().trim().max(100).default(""), cookies, enabled: z.boolean().optional() });
export const museImportSchema = z.union([z.object({ accounts: z.array(accountCreate).min(1).max(50) }), accountCreate]);
// kinds: loại việc tài khoản nhận ("image" | "video" | "chat"); [] = mọi loại.
export const museAccountPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    label: z.string().trim().max(100).optional(),
    kinds: z
      .array(z.enum(["image", "video", "chat"], { message: "Loại việc chỉ gồm image, video, chat" }))
      .max(3)
      .transform((k) => [...new Set(k)])
      .optional(),
  })
  .refine((v) => v.enabled !== undefined || v.label !== undefined || v.kinds !== undefined, { message: "Không có gì để sửa" });

export function listMuseAccounts() {
  return muse<{ data: unknown[] }>("GET", "/admin/accounts");
}

export async function importMuseAccounts(input: unknown) {
  const body = museImportSchema.parse(input);
  const res = "accounts" in body ? await muse("POST", "/admin/accounts/import", body) : await muse("POST", "/admin/accounts", body);
  // Có cookie mới: cho video thử lại.
  await clearVideoBlocked();
  return res;
}

export function updateMuseAccount(id: string, input: unknown) {
  return muse("PATCH", `/admin/accounts/${encodeURIComponent(accountId.parse(id))}`, museAccountPatchSchema.parse(input));
}

export function deleteMuseAccount(id: string) {
  return muse("DELETE", `/admin/accounts/${encodeURIComponent(accountId.parse(id))}`);
}

export async function renewMuseAccount(id: string) {
  const res = await muse("POST", `/admin/accounts/${encodeURIComponent(accountId.parse(id))}/renew`);
  await clearVideoBlocked();
  return res;
}

export function museAccountQuota(id: string, refresh: boolean) {
  return muse("GET", `/admin/accounts/${encodeURIComponent(accountId.parse(id))}/quota${refresh ? "?refresh=true" : ""}`);
}

export async function getMuseStatus() {
  const [status, ready, tasks, videoBlocked, slots] = await Promise.all([
    muse<Record<string, unknown>>("GET", "/admin/status").catch((err: Error) => ({ error: err.message })),
    muse<Record<string, unknown>>("GET", "/readyz").catch((err: Error) => ({ ready: false, error: err.message })),
    muse<{ data?: { status?: string }[] }>("GET", "/admin/tasks?limit=100").catch(() => ({ data: [] })),
    getVideoBlocked(),
    getScheduler().counts(),
  ]);
  const active = (tasks.data ?? []).filter((t) => t.status === "queued" || t.status === "running");
  return { status, ready, tasks: active, videoBlocked, slots };
}

export async function clearMuseVideoBlock() {
  await clearVideoBlocked();
  return { videoBlocked: null };
}
