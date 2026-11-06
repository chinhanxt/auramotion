import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  Prisma,
  type BillingPeriod,
  type JobStatus,
  type PaymentStatus,
  type PlanCode,
  type Subscription,
  type UserStatus,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getMuse } from "@/server/engines";
import { checkCli } from "@/server/engines/cli";
import { expirePlanCredits, getBalance } from "@/server/services/credit";
import { activatePlan, startFree } from "@/server/services/plan";
import { quote, type GenerationParams } from "@/server/services/pricing";
import { getSetting, setSetting } from "@/server/services/settings";

const DAY_MS = 24 * 60 * 60 * 1000;
// Giờ Việt Nam (UTC+7, không có giờ mùa hè): ngày thống kê tính theo giờ địa phương.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const PAGE_SIZE = 20;
const PLAN_ORDER: PlanCode[] = ["free", "pro", "ultra"];
const MUSIC_DIR = path.resolve("public/music");

export type StatsRange = "1d" | "7d" | "30d";
const RANGE_DAYS: Record<StatsRange, number> = { "1d": 1, "7d": 7, "30d": 30 };

export type DailyStat = { date: string; images: number; videos: number; assembles: number; revenue: number };

export type Stats = {
  newUsers: number;
  images: number;
  videos: number;
  assembles: number;
  creditsSpent: number;
  revenue: number;
  usersByPlan: { code: PlanCode; name: string; users: number }[];
  creditsByModel: { modelId: string; name: string; credits: number }[];
  avgSecondsByModel: { modelId: string; name: string; seconds: number }[];
  daily: DailyStat[];
};

function vnDate(date: Date): string {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function vnStartOfDay(date: Date): Date {
  const local = date.getTime() + VN_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - VN_OFFSET_MS);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// 1d = từ 0h hôm nay (giờ VN); 7d / 30d = hôm nay và các ngày trước đó.
export async function getStats(range: StatsRange, now: Date = new Date()): Promise<Stats> {
  const days = RANGE_DAYS[range];
  const since = new Date(vnStartOfDay(now).getTime() - (days - 1) * DAY_MS);
  const window = { gte: since, lte: now };

  const [newUsers, jobs, payments, charges, plans, activeSubs] = await Promise.all([
    db.user.count({ where: { createdAt: window } }),
    db.job.findMany({
      where: { status: "SUCCEEDED", createdAt: window },
      select: { kind: true, createdAt: true, startedAt: true, finishedAt: true, modelId: true, model: { select: { name: true } } },
    }),
    db.payment.findMany({ where: { status: "SUCCEEDED", paidAt: window }, select: { amount: true, paidAt: true } }),
    // Credit đã tiêu = phần đã giữ của các job đã bị trừ (charge) trong khoảng.
    db.creditTransaction.findMany({
      where: { type: "charge", createdAt: window },
      select: {
        job: {
          select: {
            modelId: true,
            model: { select: { name: true } },
            transactions: { where: { type: "hold" }, select: { amount: true } },
          },
        },
      },
    }),
    db.plan.findMany({ select: { id: true, code: true, name: true } }),
    db.subscription.groupBy({ by: ["planId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
  ]);

  const daily: DailyStat[] = [];
  const byDate = new Map<string, DailyStat>();
  for (let i = 0; i < days; i++) {
    const row = { date: vnDate(new Date(since.getTime() + i * DAY_MS)), images: 0, videos: 0, assembles: 0, revenue: 0 };
    daily.push(row);
    byDate.set(row.date, row);
  }

  const durations = new Map<string, { name: string; total: number; count: number }>();
  for (const job of jobs) {
    const row = byDate.get(vnDate(job.createdAt));
    if (row) {
      if (job.kind === "IMAGE") row.images++;
      else if (job.kind === "VIDEO") row.videos++;
      else row.assembles++;
    }
    if (job.startedAt && job.finishedAt) {
      const entry = durations.get(job.modelId) ?? { name: job.model.name, total: 0, count: 0 };
      entry.total += (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000;
      entry.count++;
      durations.set(job.modelId, entry);
    }
  }
  for (const p of payments) {
    const row = p.paidAt ? byDate.get(vnDate(p.paidAt)) : undefined;
    if (row) row.revenue += p.amount;
  }

  const spent = new Map<string, { name: string; credits: Prisma.Decimal }>();
  for (const { job } of charges) {
    if (!job) continue;
    const held = job.transactions.reduce((sum, t) => sum.minus(t.amount), new Prisma.Decimal(0));
    const entry = spent.get(job.modelId) ?? { name: job.model.name, credits: new Prisma.Decimal(0) };
    entry.credits = entry.credits.plus(held);
    spent.set(job.modelId, entry);
  }
  const creditsByModel = [...spent.entries()]
    .map(([modelId, v]) => ({ modelId, name: v.name, credits: v.credits.toNumber() }))
    .sort((a, b) => b.credits - a.credits);

  const usersByPlan = PLAN_ORDER.flatMap((code) => {
    const plan = plans.find((p) => p.code === code);
    if (!plan) return [];
    return [{ code, name: plan.name, users: activeSubs.find((s) => s.planId === plan.id)?._count._all ?? 0 }];
  });

  const sum = (key: keyof Omit<DailyStat, "date">) => daily.reduce((total, d) => total + d[key], 0);
  return {
    newUsers,
    images: sum("images"),
    videos: sum("videos"),
    assembles: sum("assembles"),
    creditsSpent: round2(creditsByModel.reduce((total, m) => total + m.credits, 0)),
    revenue: sum("revenue"),
    usersByPlan,
    creditsByModel,
    avgSecondsByModel: [...durations.entries()].map(([modelId, v]) => ({
      modelId,
      name: v.name,
      seconds: Math.round((v.total / v.count) * 10) / 10,
    })),
    daily,
  };
}

// ---------- Người dùng ----------

export const userListQuery = z.object({
  search: z.string().trim().max(200).optional(),
  plan: z.enum(["free", "pro", "ultra"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listUsers(input: z.input<typeof userListQuery>) {
  const { search, plan, page } = userListQuery.parse(input);
  const where: Prisma.UserWhereInput = {
    ...(search ? { email: { contains: search, mode: "insensitive" } } : {}),
    ...(plan ? { subscriptions: { some: { status: "ACTIVE", plan: { code: plan } } } } : {}),
  };
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        subscriptions: { where: { status: "ACTIVE" }, orderBy: { startAt: "desc" }, take: 1, include: { plan: true } },
      },
    }),
  ]);
  const items = await Promise.all(
    users.map(async ({ subscriptions, passwordHash: _pw, ...user }) => ({
      ...user,
      planCode: subscriptions[0]?.plan.code ?? null,
      available: (await getBalance(user.id)).available.toNumber(),
    })),
  );
  return { items, total, page, pageSize: PAGE_SIZE };
}

export async function getUserDetail(userId: string) {
  const found = await db.user.findUnique({ where: { id: userId } });
  if (!found) throw new AppError("NOT_FOUND", "Không tìm thấy người dùng");
  const { passwordHash: _pw, googleId, ...user } = found;
  const [balance, subscription, transactions, jobs] = await Promise.all([
    getBalance(userId),
    db.subscription.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { startAt: "desc" }, include: { plan: true } }),
    db.creditTransaction.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 }),
    db.job.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      include: { model: { select: { name: true } } },
    }),
  ]);
  return {
    user: { ...user, hasGoogle: Boolean(googleId) },
    balance: {
      available: balance.available.toNumber(),
      plan: balance.plan.toNumber(),
      purchased: balance.purchased.toNumber(),
      held: balance.held.toNumber(),
    },
    subscription,
    transactions,
    jobs,
  };
}

export async function setUserStatus(userId: string, status: UserStatus, actorId: string): Promise<void> {
  if (userId === actorId && status === "LOCKED") throw new AppError("VALIDATION", "Không thể tự khóa tài khoản của mình");
  const updated = await db.user.updateMany({ where: { id: userId }, data: { status } });
  if (updated.count === 0) throw new AppError("NOT_FOUND", "Không tìm thấy người dùng");
}

// Gói trả phí: activatePlan tự đóng thuê bao cũ. Về Free: đóng thuê bao, bỏ credit gói, cấp lại gói Free.
export async function adminChangePlan(userId: string, planCode: PlanCode, period: BillingPeriod): Promise<Subscription> {
  if (planCode !== "free") return activatePlan(userId, planCode, period);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
    if (rows.length === 0) throw new AppError("NOT_FOUND", "Không tìm thấy người dùng");
    const current = await tx.subscription.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { startAt: "desc" },
      include: { plan: true },
    });
    if (current?.plan.code === "free") return current;
    if (current) {
      await tx.subscription.update({ where: { id: current.id }, data: { status: "CANCELED", endAt: new Date() } });
    }
    await expirePlanCredits(userId, tx);
    return startFree(userId, tx);
  });
}

export const userPatchSchema = z.union([
  z.object({ status: z.enum(["ACTIVE", "LOCKED"]) }),
  z.object({ planCode: z.enum(["free", "pro", "ultra"]), period: z.enum(["MONTH", "YEAR"]).default("MONTH") }),
]);

export const creditAdjustSchema = z.object({
  amount: z.coerce.number({ message: "Số Credit không hợp lệ" }).refine((v) => Number.isFinite(v) && v !== 0, {
    message: "Số Credit điều chỉnh phải khác 0",
  }),
  reason: z.string({ message: "Bắt buộc nhập lý do" }).trim().min(1, { message: "Bắt buộc nhập lý do" }).max(500),
});

// ---------- Engine / model ----------

// validateParams từ chối mọi giá trị không có trong options, nên danh sách rỗng / thiếu làm engine không dùng được.
const ratioList = z.array(z.string().trim().min(1)).min(1, { message: "Cần ít nhất 1 tỷ lệ khung hình" });
const maxRefs = z.number().int().min(0).max(10).optional();
const OPTIONS_BY_KIND = {
  IMAGE: z.object({
    aspectRatios: ratioList,
    counts: z
      .array(z.union([z.literal(1), z.literal(2), z.literal(4)], { message: "Số ảnh chỉ gồm 1, 2, 4" }))
      .min(1, { message: "Cần ít nhất 1 lựa chọn số ảnh" }),
    maxRefs,
  }),
  VIDEO: z.object({
    aspectRatios: ratioList,
    durations: z
      .array(z.union([z.literal(5), z.literal(10)], { message: "Thời lượng chỉ gồm 5, 10" }))
      .min(1, { message: "Cần ít nhất 1 lựa chọn thời lượng" }),
    maxRefs,
  }),
  ASSEMBLE: z.object({
    aspectRatios: z
      .array(z.enum(["9:16", "16:9", "1:1"], { message: "Tỷ lệ ghép chỉ gồm 9:16, 16:9, 1:1" }))
      .min(1, { message: "Cần ít nhất 1 tỷ lệ khung hình" }),
  }),
} as const;

function parseModelOptions(kind: keyof typeof OPTIONS_BY_KIND, options: unknown): Prisma.InputJsonObject {
  return OPTIONS_BY_KIND[kind].parse(options);
}

const modelFields = {
  name: z.string().trim().min(1, { message: "Vui lòng nhập tên" }).max(100),
  provider: z.enum(["MUSE", "AGY", "CODEX", "LOCAL"]),
  engineModel: z.string().trim().max(200),
  kind: z.enum(["IMAGE", "VIDEO", "ASSEMBLE"]),
  minPlanRank: z.coerce.number().int().min(0).max(2),
  baseCost: z.coerce.number().min(0, { message: "Giá gốc không được âm" }).max(100000),
  options: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  sort: z.coerce.number().int(),
};

export const modelCreateSchema = z.object({
  ...modelFields,
  engineModel: modelFields.engineModel.default(""),
  minPlanRank: modelFields.minPlanRank.default(0),
  enabled: modelFields.enabled.default(true),
  sort: modelFields.sort.default(0),
});
export const modelUpdateSchema = z.object({ id: z.string().min(1), ...modelFields }).partial().required({ id: true });

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

export function listModels() {
  return db.aiModel.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] });
}

export async function createModel(input: unknown) {
  const data = modelCreateSchema.parse(input);
  const options = parseModelOptions(data.kind, data.options);
  return mapDbErrors(() => db.aiModel.create({ data: { ...data, options } }), "Engine");
}

export async function updateModel(input: unknown) {
  const { id, options, ...data } = modelUpdateSchema.parse(input);
  let checked: Prisma.InputJsonObject | undefined;
  if (options !== undefined || data.kind !== undefined) {
    const current = await db.aiModel.findUnique({ where: { id }, select: { kind: true, options: true } });
    if (!current) throw new AppError("NOT_FOUND", "Không tìm thấy engine");
    checked = parseModelOptions(data.kind ?? current.kind, options ?? current.options);
  }
  return mapDbErrors(() => db.aiModel.update({ where: { id }, data: { ...data, options: checked } }), "Engine");
}

// Model đã có job: chỉ tắt để giữ lịch sử.
export async function deleteModel(id: string): Promise<{ deleted: boolean }> {
  const model = await db.aiModel.findUnique({ where: { id }, select: { _count: { select: { jobs: true } } } });
  if (!model) throw new AppError("NOT_FOUND", "Không tìm thấy engine");
  if (model._count.jobs > 0) {
    await db.aiModel.update({ where: { id }, data: { enabled: false } });
    return { deleted: false };
  }
  await db.aiModel.delete({ where: { id } });
  return { deleted: true };
}

// ---------- Bảng giá Credit ----------

export type CreditPreview = { label: string; cost: number };

function previewParams(model: { id: string; kind: string }): { label: string; params: GenerationParams }[] {
  const base = { modelId: model.id, prompt: "preview" };
  if (model.kind === "IMAGE") {
    return ([1, 2, 4] as const).map((n) => ({
      label: `${n} ảnh`,
      params: { ...base, kind: "image", aspectRatio: "1:1", imageCount: n },
    }));
  }
  if (model.kind === "VIDEO") {
    return ([5, 10] as const).map((d) => ({
      label: `${d} giây`,
      params: { ...base, kind: "video", aspectRatio: "9:16", durationSec: d },
    }));
  }
  return [0, 3, 6].map((n) => ({
    label: `${n} câu`,
    params: {
      kind: "assemble",
      modelId: model.id,
      aspect: "9:16",
      clips: [{ jobId: "preview" }],
      lines: Array.from({ length: n }, () => "preview"),
      subtitles: false,
      keepClipAudio: false,
    },
  }));
}

// Giá gốc từng engine + giá mỗi câu thoại, kèm bảng xem trước tính bằng quote().
export async function getCreditRules() {
  const [models, voiceLineCost] = await Promise.all([listModels(), getSetting<number>("voice_line_cost")]);
  return {
    voiceLineCost: Number(voiceLineCost),
    models: await Promise.all(
      models.map(async (m) => ({
        id: m.id,
        name: m.name,
        kind: m.kind,
        enabled: m.enabled,
        baseCost: m.baseCost.toNumber(),
        previews: await Promise.all(
          previewParams(m).map(async ({ label, params }) => ({ label, cost: (await quote(params, m)).toNumber() })),
        ),
      })),
    ),
  };
}

// ---------- Gói ----------

export const planUpdateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(50),
    priceMonth: z.coerce.number().int().min(0),
    priceYear: z.coerce.number().int().min(0),
    monthlyCredits: z.coerce.number().min(0).max(1_000_000),
    maxConcurrent: z.coerce.number().int().min(1).max(50),
    maxDurationSec: z.coerce.number().int().min(1).max(60),
  })
  .partial()
  .required({ id: true });

export function listPlans() {
  return db.plan.findMany({ orderBy: { rank: "asc" } });
}

export function updatePlan(input: unknown) {
  const { id, ...data } = planUpdateSchema.parse(input);
  return mapDbErrors(() => db.plan.update({ where: { id }, data }), "Gói");
}

// ---------- Preset ----------

const presetFields = {
  kind: z.enum(["STYLE", "CAMERA"]),
  name: z.string().trim().min(1, { message: "Vui lòng nhập tên" }).max(100),
  promptSuffix: z.string().trim().min(1, { message: "Vui lòng nhập đoạn prompt" }).max(1000),
  thumbnailUrl: z.string().trim().max(2000).nullable().transform((v) => v || null),
  enabled: z.boolean(),
};

export const presetCreateSchema = z.object({
  ...presetFields,
  thumbnailUrl: presetFields.thumbnailUrl.optional(),
  enabled: presetFields.enabled.default(true),
});
export const presetUpdateSchema = z.object({ id: z.string().min(1), ...presetFields }).partial().required({ id: true });

export function listPresets() {
  return db.preset.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] });
}

export function createPreset(input: unknown) {
  const data = presetCreateSchema.parse(input);
  return mapDbErrors(() => db.preset.create({ data }), "Preset");
}

export function updatePreset(input: unknown) {
  const { id, ...data } = presetUpdateSchema.parse(input);
  return mapDbErrors(() => db.preset.update({ where: { id }, data }), "Preset");
}

// Preset đã có job dùng (params.presetId): chỉ tắt để "Chạy lại" / "Dùng lại" vẫn báo lỗi rõ và giữ lịch sử.
export async function deletePreset(id: string): Promise<{ deleted: boolean }> {
  const used = await db.job.count({ where: { params: { path: ["presetId"], equals: id } } });
  if (used > 0) {
    await mapDbErrors(() => db.preset.update({ where: { id }, data: { enabled: false } }), "Preset");
    return { deleted: false };
  }
  await mapDbErrors(() => db.preset.delete({ where: { id } }), "Preset");
  return { deleted: true };
}

// ---------- Nhạc nền (setting music_tracks, file trong public/music) ----------

export type MusicTrack = { id: string; name: string; file: string };

export const musicTrackSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,50}$/, { message: "Mã bài chỉ gồm chữ thường, số, dấu gạch ngang" }),
  name: z.string().trim().min(1, { message: "Vui lòng nhập tên" }).max(100),
  file: z
    .string()
    .trim()
    .regex(/^\/music\/[\w.-]+\.mp3$/, { message: "File phải là /music/<tên>.mp3" }),
});
export const musicUpdateSchema = musicTrackSchema.partial().required({ id: true });

async function musicFiles(): Promise<string[]> {
  const names = await fs.readdir(MUSIC_DIR).catch(() => [] as string[]);
  return names.filter((n) => n.toLowerCase().endsWith(".mp3")).sort().map((n) => `/music/${n}`);
}

async function getTracks(): Promise<MusicTrack[]> {
  return getSetting<MusicTrack[]>("music_tracks").catch(() => []);
}

async function assertMusicFile(file: string): Promise<void> {
  if (!(await musicFiles()).includes(file)) throw new AppError("VALIDATION", "Không thấy file nhạc trong public/music");
}

export async function listMusic(): Promise<{ tracks: MusicTrack[]; files: string[] }> {
  const [tracks, files] = await Promise.all([getTracks(), musicFiles()]);
  return { tracks, files };
}

export async function createMusicTrack(input: unknown): Promise<MusicTrack> {
  const track = musicTrackSchema.parse(input);
  await assertMusicFile(track.file);
  const tracks = await getTracks();
  if (tracks.some((t) => t.id === track.id)) throw new AppError("CONFLICT", "Mã bài nhạc đã tồn tại");
  await setSetting("music_tracks", [...tracks, track]);
  return track;
}

export async function updateMusicTrack(input: unknown): Promise<MusicTrack> {
  const patch = musicUpdateSchema.parse(input);
  if (patch.file) await assertMusicFile(patch.file);
  const tracks = await getTracks();
  const index = tracks.findIndex((t) => t.id === patch.id);
  if (index < 0) throw new AppError("NOT_FOUND", "Không tìm thấy bài nhạc");
  const track = { ...tracks[index], ...patch };
  await setSetting(
    "music_tracks",
    tracks.map((t, i) => (i === index ? track : t)),
  );
  return track;
}

export async function deleteMusicTrack(id: string): Promise<void> {
  const tracks = await getTracks();
  if (!tracks.some((t) => t.id === id)) throw new AppError("NOT_FOUND", "Không tìm thấy bài nhạc");
  await setSetting(
    "music_tracks",
    tracks.filter((t) => t.id !== id),
  );
}

// ---------- Job ----------

const JOB_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"] as const;

export const jobListQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  user: z.string().trim().max(200).optional(),
  modelId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listAdminJobs(input: z.input<typeof jobListQuery>) {
  const { status, user, modelId, page } = jobListQuery.parse(input);
  const where: Prisma.JobWhereInput = {
    ...(status ? { status: status as JobStatus } : {}),
    ...(modelId ? { modelId } : {}),
    ...(user ? { user: { email: { contains: user, mode: "insensitive" } } } : {}),
  };
  const [total, items] = await Promise.all([
    db.job.count({ where }),
    db.job.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { id: true, email: true } }, model: { select: { id: true, name: true } } },
    }),
  ]);
  return { items, total, page, pageSize: PAGE_SIZE };
}

// ---------- Thanh toán ----------

export const paymentListQuery = z.object({
  status: z.enum(["PENDING", "SUCCEEDED", "CANCELED"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listPayments(input: z.input<typeof paymentListQuery>) {
  const { status, search, page } = paymentListQuery.parse(input);
  const where: Prisma.PaymentWhereInput = {
    ...(status ? { status: status as PaymentStatus } : {}),
    ...(search
      ? {
          OR: [
            { refCode: { contains: search, mode: "insensitive" } },
            { user: { email: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    db.payment.count({ where }),
    db.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { id: true, email: true } } },
    }),
  ]);
  return { items, total, page, pageSize: PAGE_SIZE };
}

// ---------- Cài đặt ----------

export const settingsSchema = z
  .object({
    maintenance: z.boolean(),
    voice_line_cost: z.coerce.number().min(0, { message: "Giá mỗi câu không được âm" }).max(10000),
    credit_packs: z
      .array(z.object({ credits: z.coerce.number().int().positive(), price: z.coerce.number().int().positive({ message: "Giá gói Credit phải lớn hơn 0" }) }))
      .min(1, { message: "Cần ít nhất 1 gói Credit" })
      .refine((packs) => new Set(packs.map((p) => p.credits)).size === packs.length, {
        message: "Số Credit các gói không được trùng nhau",
      }),
    // agy bắt buộc --model; codex để trống = model mặc định.
    prompt_writer: z
      .object({
        provider: z.enum(["agy", "codex"]),
        model: z.string().trim().max(200),
      })
      .refine((w) => w.provider !== "agy" || w.model.length > 0, { message: "Cần nhập model cho agy", path: ["model"] }),
  })
  .partial();

export type AdminSettings = Required<z.infer<typeof settingsSchema>>;

const SETTING_KEYS = ["maintenance", "voice_line_cost", "credit_packs", "prompt_writer"] as const;

export async function getAdminSettings(): Promise<AdminSettings> {
  const values = await Promise.all(SETTING_KEYS.map((k) => getSetting<unknown>(k).catch(() => null)));
  return Object.fromEntries(SETTING_KEYS.map((k, i) => [k, values[i]])) as AdminSettings;
}

export async function updateAdminSettings(input: unknown): Promise<AdminSettings> {
  const patch = settingsSchema.parse(input);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) await setSetting(key, value);
  }
  return getAdminSettings();
}

// ---------- Trạng thái engine ----------

// Chạy `<bin> <args>` tối đa 5 giây; thoát mã 0 là có cài.
function binaryOk(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 5000 }, (err) => resolve(!err));
  });
}

export async function getEngineHealth() {
  const [muse, { agy, codex }, vieneu, ffmpeg] = await Promise.all([
    getMuse().health(),
    checkCli(),
    binaryOk(process.env.VIENEU_BIN || "vieneu-say", ["--help"]),
    binaryOk("ffmpeg", ["-version"]),
  ]);
  return {
    muse: { ok: muse.ok, driver: muse.driver ?? null, accounts: muse.accounts ?? null },
    agy,
    codex,
    vieneu: { ok: vieneu },
    ffmpeg: { ok: ffmpeg },
  };
}
