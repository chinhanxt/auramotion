import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma, type AiModel, type Job, type JobKind, type JobStatus, type ModelProvider, type Plan } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { PLAN_PRIORITY, queueFor, queues, storyQueue, type QueueName } from "@/lib/queue";
import { deleteByUrls, putFile, putFromUrl, storagePath } from "@/lib/storage";
import { buildPrompt, getFileEngine, getMuse, type FileProvider } from "@/server/engines";
import { mediaKindOf, validateMedia } from "@/server/engines/media";
import type { HttpMuseClient } from "@/server/engines/muse";
import { getVideoBlocked, setVideoBlocked } from "@/server/engines/muse-block";
import { getScheduler, SlotBusyError, type Lease, type MuseScheduler } from "@/server/engines/muse-scheduler";
import { loadSkill, writePrompt } from "@/server/engines/prompt-writer";
import { EngineError, type FileEngine, type MediaRequest } from "@/server/engines/types";
import { assembleErrorCode, runAssembleJob } from "@/server/services/assemble";
import { charge, hold, publishCredit, refund } from "@/server/services/credit";
import { getActivePlan } from "@/server/services/plan";
import {
  generationParamsSchema,
  quote,
  validateParams,
  type AssembleParams,
  type GenerationParams,
} from "@/server/services/pricing";
import { getSetting } from "@/server/services/settings";

export { SlotBusyError };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const FREE_RESULT_TTL_MS = 30 * DAY;
const PAGE_SIZE = 24;
const DEFAULT_POLL_MS = 5000;
const PROGRESS_WRITE_MS = 3000;
const MEDIA_PREFIX = "/media/";

const KIND: Record<GenerationParams["kind"], JobKind> = { image: "IMAGE", video: "VIDEO", assemble: "ASSEMBLE" };
const PRESET_KIND = { image: "STYLE", video: "CAMERA" } as const;
const INPUT_EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const RESULT_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"];

// Job RUNNING quá thời hạn này (tính từ startedAt) bị sweeper đánh FAILED (TIMEOUT).
// MUSE: muse2api tự hủy video sau 15 phút (MUSE2API_VIDEO_TIMEOUT=900), chừa thêm thời gian tải file.
export const QUEUE_TIMEOUT_MS: Record<QueueName, number> = { muse: 20 * MINUTE, cli: 12 * MINUTE, post: 20 * MINUTE };
// Job PENDING quá thời hạn này (tính từ lúc vào hàng đợi): Muse chờ slot chat phụ nên được chờ lâu hơn.
export const PENDING_TIMEOUT_MS: Record<QueueName, number> = { muse: 90 * MINUTE, cli: 30 * MINUTE, post: 60 * MINUTE };
// Cảnh CHAIN chưa vào hàng đợi (chờ cảnh trước) quá lâu: đánh lỗi để hoàn Credit.
const UNQUEUED_TIMEOUT_MS = DAY;

const ACTIVE: JobStatus[] = ["PENDING", "RUNNING"];

type MuseClient = Pick<HttpMuseClient, "submit" | "getTask" | "authHeaders">;

export type ProcessDeps = {
  muse?: MuseClient;
  engines?: Partial<Record<string, FileEngine>>;
  pollMs?: number;
  scheduler?: MuseScheduler;
  // Test thay AI Gateway viết prompt.
  writePrompt?: typeof writePrompt;
};
export type JobListFilter = {
  kind?: "image" | "video" | "assemble";
  status?: JobStatus;
  cursor?: string;
  ids?: string[];
  storyId?: string;
};

export type CreateJobOptions = {
  // Job thuộc story: cả story chỉ tính là 1 tác vụ đồng thời.
  storyId?: string;
  shotIndex?: number;
  // false: tạo + giữ Credit nhưng chưa đưa vào hàng đợi (cảnh CHAIN chờ cảnh trước).
  enqueue?: boolean;
  // Admin tự chạy (bìa preset): không trừ Credit, không tính giới hạn đồng thời.
  free?: boolean;
  // Trường nội bộ ghi thêm vào params (không nhận từ request người dùng).
  extraParams?: Record<string, string | number | boolean>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mediaKey(url: string): string | null {
  return url.startsWith(MEDIA_PREFIX) ? url.slice(MEDIA_PREFIX.length) : null;
}

async function isMaintenance(): Promise<boolean> {
  return getSetting<boolean>("maintenance").then(
    (v) => v === true,
    () => false,
  );
}

// ---------- Sự kiện realtime ----------

export function jobEventData(job: Job, extra: { stage?: "writing" | "rendering" } = {}) {
  const params = (job.params ?? {}) as { autoWrite?: unknown; written?: unknown };
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    prompt: job.prompt,
    ...(extra.stage ? { stage: extra.stage } : params.autoWrite && !params.written && (job.status === "PENDING" || job.status === "RUNNING") ? { stage: "writing" as const } : {}),
    resultUrls: job.resultUrls,
    error: job.error,
    storyId: job.storyId,
    shotIndex: job.shotIndex,
    kind: job.kind,
  };
}

export async function emitJob(jobId: string): Promise<Job | null> {
  const job = await db.job.findUnique({ where: { id: jobId } }).catch(() => null);
  if (job) await publishEvent(job.userId, "job", jobEventData(job));
  return job;
}

// Job thuộc story xong / lỗi / hủy: báo hàng đợi story để đẩy cảnh kế tiếp hoặc ghép.
async function notifyStory(job: Pick<Job, "storyId"> | null): Promise<void> {
  if (!job?.storyId) return;
  try {
    await storyQueue.add("advance", { storyId: job.storyId, action: "advance" });
  } catch (err) {
    console.error(`[job] không báo được story ${job.storyId}`, err);
  }
}

async function afterSettled(jobId: string): Promise<void> {
  const job = await emitJob(jobId);
  if (!job) return;
  await publishCredit(job.userId);
  await notifyStory(job);
}

// ---------- Tạo job ----------

// Ảnh đầu vào: upload của chính user, hoặc kết quả của một job SUCCEEDED của chính user.
async function checkInputUrl(userId: string, url: string): Promise<void> {
  const key = mediaKey(url);
  if (!key) throw new AppError("VALIDATION", "Ảnh tham chiếu không hợp lệ");
  const filePath = storagePath(key);
  if (!INPUT_EXTS.includes(path.extname(key).toLowerCase())) {
    throw new AppError("VALIDATION", "Ảnh tham chiếu phải là PNG, JPEG hoặc WebP");
  }
  if (key.startsWith("uploads/")) {
    if (!key.startsWith(`uploads/${userId}/`)) throw new AppError("FORBIDDEN", "Không được dùng file của người khác");
  } else {
    const owner = await db.job.findFirst({
      where: { resultUrls: { has: url }, status: "SUCCEEDED", deletedAt: null },
      select: { userId: true },
    });
    if (!owner) throw new AppError("VALIDATION", "Ảnh tham chiếu không tồn tại");
    if (owner.userId !== userId) throw new AppError("FORBIDDEN", "Không được dùng file của người khác");
  }
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new AppError("VALIDATION", "Ảnh tham chiếu không tồn tại");
}

async function isFile(filePath: string): Promise<boolean> {
  return (await fs.stat(filePath).catch(() => null))?.isFile() ?? false;
}

// Ghép video: clip phải là ảnh / video SUCCEEDED, chưa xóa, của chính user, `index` có trong resultUrls;
// mẫu giọng phải là upload của chính user; nhạc phải có trong music_tracks. Worker kiểm lại lúc chạy.
async function checkAssembleInputs(userId: string, p: AssembleParams): Promise<void> {
  const rows = await db.job.findMany({
    where: {
      id: { in: p.clips.map((c) => c.jobId) },
      userId,
      status: "SUCCEEDED",
      deletedAt: null,
      kind: { in: ["IMAGE", "VIDEO"] },
    },
    select: { id: true, resultUrls: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const clip of p.clips) {
    const url = byId.get(clip.jobId)?.resultUrls[clip.index ?? 0];
    if (!url) throw new AppError("VALIDATION", "Clip không tồn tại hoặc chưa tạo xong");
  }

  if (p.voice?.refUrl) {
    const prefix = `${MEDIA_PREFIX}uploads/${userId}/`;
    const name = p.voice.refUrl.startsWith(prefix) ? p.voice.refUrl.slice(prefix.length) : "";
    if (!name || name.includes("/") || name.includes("\\") || name === "..") {
      throw new AppError("VALIDATION", "Mẫu giọng không hợp lệ");
    }
    if (!(await isFile(storagePath(`uploads/${userId}/${name}`)))) {
      throw new AppError("VALIDATION", "Không tìm thấy mẫu giọng, vui lòng tải lên lại");
    }
  }

  if (p.musicId) {
    const tracks = await getSetting<{ id: string }[]>("music_tracks").catch(() => []);
    if (!Array.isArray(tracks) || !tracks.some((t) => t.id === p.musicId)) {
      throw new AppError("VALIDATION", "Nhạc nền không tồn tại");
    }
  }
}

async function loadEnabledModel(modelId: string) {
  const model = await db.aiModel.findUnique({ where: { id: modelId } });
  if (!model || !model.enabled) throw new AppError("NOT_FOUND", "Engine không tồn tại hoặc đang tắt");
  return model;
}

export async function assertMuseVideoAvailable(model: Pick<AiModel, "provider" | "kind">): Promise<void> {
  if (model.provider !== "MUSE" || model.kind !== "VIDEO") return;
  const block = await getVideoBlocked();
  if (block) throw new AppError("MUSE_VIDEO_UNAVAILABLE", "Muse tạm không tạo được video, vui lòng thử lại sau");
}

export async function quoteJob(input: GenerationParams): Promise<Prisma.Decimal> {
  const p = generationParamsSchema.parse(input);
  return quote(p, await loadEnabledModel(p.modelId));
}

type Prepared = { p: GenerationParams; model: AiModel; cost: Prisma.Decimal; opts: CreateJobOptions };

// Kiểm tham số, gói, engine, file đầu vào và tính giá (chưa ghi DB).
async function prepareJob(userId: string, input: GenerationParams, plan: Plan, opts: CreateJobOptions): Promise<Prepared> {
  const p = generationParamsSchema.parse(input);
  const model = await loadEnabledModel(p.modelId);
  validateParams(p, model, plan);
  await assertMuseVideoAvailable(model);

  if (p.kind !== "assemble") {
    if (p.presetId) {
      const preset = await db.preset.findUnique({ where: { id: p.presetId } });
      if (!preset || !preset.enabled || preset.kind !== PRESET_KIND[p.kind]) {
        throw new AppError("VALIDATION", "Preset không hợp lệ");
      }
    }
    if (p.inputUrl) await checkInputUrl(userId, p.inputUrl);
    // Skill người dùng chọn cho AI Gateway: kiểm ngay để báo lỗi trước khi giữ Credit.
    if (p.autoWrite && p.skillId) await loadSkill(p.skillId, p.kind === "image" ? "IMAGE" : "VIDEO", plan.rank);
  } else {
    await checkAssembleInputs(userId, p);
  }
  const cost = opts.free ? new Prisma.Decimal(0) : await quote(p, model);
  return { p, model, cost, opts };
}

async function enqueue(job: Job, provider: ModelProvider, plan: Plan): Promise<void> {
  const kind = job.kind === "IMAGE" ? "image" : job.kind === "VIDEO" ? "video" : "assemble";
  await queues[queueFor(provider)].add(kind, { jobId: job.id }, { priority: PLAN_PRIORITY[plan.code], jobId: job.id });
}

// Tạo nhiều job trong 1 transaction (giữ Credit từng job; thiếu Credit thì không tạo job nào), rồi đưa vào hàng đợi.
async function insertJobs(userId: string, plan: Plan, items: Prepared[]): Promise<Job[]> {
  const now = new Date();
  const storyId = items[0]?.opts.storyId;
  const free = items.every((i) => i.opts.free);
  const jobs = await db.$transaction(async (tx) => {
    // Khóa user để hai request song song không cùng vượt giới hạn job đồng thời.
    await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
    if (!free) {
      const active = await tx.job.count({
        where: {
          userId,
          status: { in: ACTIVE },
          deletedAt: null,
          ...(storyId ? { OR: [{ storyId: null }, { storyId: { not: storyId } }] } : {}),
        },
      });
      if (active >= plan.maxConcurrent) {
        throw new AppError("CONCURRENCY_LIMIT", `Bạn đang có ${active} tác vụ chạy, vui lòng chờ`);
      }
    }
    const created: Job[] = [];
    for (const { p, model, cost, opts } of items) {
      const job = await tx.job.create({
        data: {
          userId,
          modelId: model.id,
          kind: KIND[p.kind],
          prompt: p.kind === "assemble" ? p.lines.join("\n") : p.prompt,
          params: { ...p, ...(opts.extraParams ?? {}) } as Prisma.InputJsonObject,
          inputUrl: p.kind === "assemble" ? null : (p.inputUrl ?? null),
          cost,
          expiresAt: plan.code === "free" && !opts.free ? new Date(now.getTime() + FREE_RESULT_TTL_MS) : null,
          storyId: opts.storyId ?? null,
          shotIndex: opts.shotIndex ?? null,
          queuedAt: opts.enqueue === false ? null : now,
        },
      });
      await hold(tx, userId, job.id, cost);
      created.push(job);
    }
    return created;
  });

  for (const [i, job] of jobs.entries()) {
    if (items[i].opts.enqueue === false) continue;
    try {
      await enqueue(job, items[i].model.provider, plan);
    } catch (err) {
      console.error(`[job] không đưa được job ${job.id} vào hàng đợi`, err);
      for (const rest of jobs.slice(i)) await failJob(rest.id, "QUEUE_UNAVAILABLE");
      throw new AppError("INTERNAL", "Không đưa được tác vụ vào hàng đợi, Credit đã được hoàn");
    }
  }
  for (const job of jobs) await publishEvent(userId, "job", jobEventData(job));
  await publishCredit(userId);
  return jobs;
}

export async function createJob(userId: string, input: GenerationParams, opts: CreateJobOptions = {}): Promise<Job> {
  if (await isMaintenance()) throw new AppError("MAINTENANCE", "Hệ thống đang bảo trì, vui lòng quay lại sau");
  const { plan } = await getActivePlan(userId);
  const prepared = await prepareJob(userId, input, plan, opts);
  const [job] = await insertJobs(userId, plan, [prepared]);
  return job;
}

// Nhiều job của 1 story: giữ Credit cho tất cả cùng lúc.
export async function createJobs(
  userId: string,
  storyId: string,
  items: { input: GenerationParams; shotIndex?: number; enqueue?: boolean }[],
): Promise<Job[]> {
  if (await isMaintenance()) throw new AppError("MAINTENANCE", "Hệ thống đang bảo trì, vui lòng quay lại sau");
  const { plan } = await getActivePlan(userId);
  const prepared: Prepared[] = [];
  for (const it of items) {
    prepared.push(await prepareJob(userId, it.input, plan, { storyId, shotIndex: it.shotIndex, enqueue: it.enqueue }));
  }
  return insertJobs(userId, plan, prepared);
}

// Đưa job đã tạo (queuedAt null) vào hàng đợi; chỉ 1 lời gọi thắng.
export async function enqueueCreatedJob(jobId: string, patch: { inputUrl?: string } = {}): Promise<boolean> {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { model: true } });
  if (!job || job.status !== "PENDING" || job.queuedAt) return false;
  const params = patch.inputUrl ? { ...(job.params as Record<string, unknown>), inputUrl: patch.inputUrl } : undefined;
  const claimed = await db.job.updateMany({
    where: { id: jobId, status: "PENDING", queuedAt: null },
    data: {
      queuedAt: new Date(),
      ...(patch.inputUrl ? { inputUrl: patch.inputUrl, params: params as Prisma.InputJsonObject } : {}),
    },
  });
  if (claimed.count === 0) return false;
  const { plan } = await getActivePlan(job.userId);
  try {
    await enqueue(job, job.model.provider, plan);
  } catch (err) {
    console.error(`[job] không đưa được job ${job.id} vào hàng đợi`, err);
    await failJob(job.id, "QUEUE_UNAVAILABLE");
    return false;
  }
  return true;
}

// ---------- Hoàn tất / lỗi ----------

function extOf(file: { url?: string; path?: string }, kind: JobKind): string {
  let ext = "";
  if (file.path) ext = path.extname(file.path).toLowerCase();
  else if (file.url) {
    try {
      ext = path.extname(new URL(file.url).pathname).toLowerCase();
    } catch {
      ext = "";
    }
  }
  if (ext === ".jpeg") ext = ".jpg";
  if (RESULT_EXTS.includes(ext)) return ext;
  return kind === "IMAGE" ? ".webp" : ".mp4";
}

// File engine ghi ra os.tmpdir()/aura-out-*: xóa sau khi đã chép vào storage.
async function removeTempOutput(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("aura-out-")) {
    await fs.rm(resolved, { force: true });
  }
}

// Bìa preset do Admin tạo: job miễn phí có params.coverPresetId.
async function applyCover(job: Job, urls: string[]): Promise<void> {
  const presetId = (job.params as { coverPresetId?: unknown }).coverPresetId;
  if (typeof presetId !== "string" || !urls[0] || !new Prisma.Decimal(job.cost).isZero()) return;
  await db.preset.updateMany({ where: { id: presetId }, data: { cover: urls[0] } });
}

export async function finishJob(
  jobId: string,
  files: { url?: string; path?: string }[],
  headers?: Record<string, string>,
): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") {
    for (const f of files) if (f.path) await removeTempOutput(f.path);
    return;
  }
  const urls: string[] = [];
  let meta: { width: number; height: number; durationSec?: number } | null = null;
  try {
    for (const [i, f] of files.entries()) {
      const key = `results/${job.userId}/${job.id}/${i}${extOf(f, job.kind)}`;
      if (f.path) {
        urls.push(await putFile(f.path, key));
        await removeTempOutput(f.path);
      } else if (f.url) {
        urls.push(await putFromUrl(f.url, key, headers));
      }
      // File tải về hỏng (Muse từng trả mp4 cụt): BAD_MEDIA, BullMQ chạy lại để tải / tạo lại.
      const stored = storagePath(key);
      const kind = mediaKindOf(stored, job.kind === "IMAGE" ? "image" : "video");
      const info = await validateMedia(stored, kind);
      meta ??= {
        width: info.width,
        height: info.height,
        ...(kind === "video" ? { durationSec: Math.round(info.duration * 100) / 100 } : {}),
      };
    }
  } catch (err) {
    await deleteByUrls(urls);
    throw err;
  }
  const done = await db.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        resultUrls: urls,
        finishedAt: new Date(),
        error: null,
        progress: 100,
        // Kích thước / thời lượng thật đo bằng ffprobe (params.result).
        ...(meta ? { params: { ...(job.params as Prisma.JsonObject), result: meta } as Prisma.InputJsonObject } : {}),
      },
    });
    if (updated.count === 0) return false;
    await charge(jobId, tx);
    return true;
  });
  if (done) {
    await applyCover(job, urls).catch((err) => console.error(`[job] không lưu được bìa preset từ job ${jobId}`, err));
    await afterSettled(jobId);
    return;
  }
  // Job đã bị hủy / hết hạn trong lúc lưu file: bỏ file vừa lưu.
  // Lần chạy khác đã SUCCEEDED trước thì file cùng key là của nó: giữ nguyên.
  const current = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (current?.status !== "SUCCEEDED") await deleteByUrls(urls);
}

export async function failJob(jobId: string, error: string): Promise<void> {
  const failed = await db.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: { id: jobId, status: { in: ACTIVE } },
      data: { status: "FAILED", error: error.slice(0, 1000), finishedAt: new Date() },
    });
    if (updated.count > 0) await refund(jobId, tx);
    return updated.count > 0;
  });
  if (failed) await afterSettled(jobId);
}

async function claim(jobId: string): Promise<boolean> {
  const claimed = await db.job.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (claimed.count > 0) await emitJob(jobId);
  return claimed.count > 0;
}

// Lỗi tạm thời trước khi engine nhận việc: trả job về PENDING để BullMQ chạy lại.
async function release(jobId: string): Promise<void> {
  const r = await db.job.updateMany({
    where: { id: jobId, status: "RUNNING", museTaskId: null },
    data: { status: "PENDING", startedAt: null },
  });
  if (r.count > 0) await emitJob(jobId);
}

function isFatal(err: unknown): err is EngineError {
  return err instanceof EngineError && !err.retryable;
}

// Gợi ý khung hình tự nhiên khi không gửi `size` cho Muse video.
const FRAMING_HINT: Record<string, string> = {
  "9:16": "vertical 9:16 framing",
  "16:9": "horizontal 16:9 widescreen framing",
  "1:1": "square 1:1 framing",
  "4:5": "vertical 4:5 framing",
};

async function buildRequest(
  job: Job & { model: { engineModel: string; provider?: ModelProvider; options?: unknown } },
  opts: { omitVideoSize?: boolean } = {},
): Promise<MediaRequest> {
  const p = generationParamsSchema.parse(job.params);
  if (p.kind === "assemble") throw new EngineError("BAD_PARAMS", "Tham số không phải tác vụ ảnh / video");
  const preset = p.presetId ? await db.preset.findUnique({ where: { id: p.presetId } }) : null;
  const inputKey = job.inputUrl ? mediaKey(job.inputUrl) : null;
  const inputPath = inputKey ? storagePath(inputKey) : null;
  // File đầu vào bị xóa sau khi tạo job: chạy lại cũng không được, đánh lỗi luôn.
  if (inputPath) {
    await fs.stat(inputPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") throw new EngineError("BAD_INPUT", "Ảnh tham chiếu không còn tồn tại", false);
      throw err;
    });
  }
  const written = Boolean((job.params as { written?: unknown } | null)?.written);
  let prompt = written ? job.prompt : buildPrompt(job.prompt, preset);
  const omitSize = p.kind === "video" && opts.omitVideoSize === true;
  if (omitSize) prompt = `${prompt}, ${FRAMING_HINT[p.aspectRatio] ?? `${p.aspectRatio} framing`}`;
  return {
    kind: p.kind,
    engineModel: job.model.engineModel,
    prompt,
    aspectRatio: p.aspectRatio,
    ...(p.kind === "image" ? { imageCount: p.imageCount ?? 1 } : { durationSec: p.durationSec ?? 5 }),
    ...(job.inputUrl ? { inputUrl: job.inputUrl } : {}),
    ...(inputPath ? { inputPath } : {}),
    ...(omitSize ? { omitSize: true } : {}),
    ...(museAccountOf(job.model.options) ? { museAccount: museAccountOf(job.model.options) } : {}),
  };
}

// options.museAccount của model: ghim tài khoản Muse (vd tài khoản chỉ dùng tạo ảnh).
export function museAccountOf(options: unknown): string | undefined {
  const v = (options as { museAccount?: unknown } | null)?.museAccount;
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined;
}

async function failMuse(job: Job, kind: "image" | "video", code: string, message?: string): Promise<void> {
  if (code === "REGION_BLOCKED" && kind === "video") await setVideoBlocked(message ?? code);
  await failJob(job.id, code);
}

async function runMuse(job: Job & { model: { engineModel: string; options?: unknown } }, deps: ProcessDeps): Promise<void> {
  const muse = deps.muse ?? getMuse();
  const scheduler = deps.scheduler ?? getScheduler();
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const kind = job.kind === "IMAGE" ? "image" : "video";
  // Model ghim tài khoản riêng: slot đếm riêng theo tài khoản (chat phụ của tài khoản đó).
  const scope = museAccountOf(job.model.options);
  let taskId = job.museTaskId;
  let lease: Lease;

  if (!taskId) {
    // Chưa gửi: phải có slot chat phụ (và đủ giãn cách với video trước) rồi mới nhận job.
    const got = await scheduler.tryAcquire(kind, { scope });
    if ("waitMs" in got) throw new SlotBusyError(kind, got.waitMs);
    lease = got.lease;
    if (!(await claim(job.id))) {
      await scheduler.release(lease);
      return;
    }
    try {
      const slots = await scheduler.getSlots();
      const req = await buildRequest(job, { omitVideoSize: !slots.sendVideoAspect });
      taskId = (await muse.submit(req)).taskId;
    } catch (err) {
      await scheduler.release(lease);
      if (isFatal(err)) return failMuse(job, kind, err.code, err.message);
      await release(job.id);
      throw err;
    }
    await db.job.update({ where: { id: job.id }, data: { museTaskId: taskId } });
  } else {
    // Chạy tiếp task đã gửi (worker khởi động lại): task vẫn chiếm tab, ghi nhận lease bất kể giới hạn.
    const got = await scheduler.tryAcquire(kind, { force: true, scope });
    lease = (got as { lease: Lease }).lease;
  }

  const stop = scheduler.hold(lease);
  let lastProgress = job.progress;
  let lastWrite = 0;
  try {
    for (;;) {
      const current = await db.job.findUnique({ where: { id: job.id }, select: { status: true } });
      if (current?.status !== "RUNNING") return;
      let task: Awaited<ReturnType<HttpMuseClient["getTask"]>>;
      try {
        task = await muse.getTask(kind, taskId);
      } catch (err) {
        if (isFatal(err)) return await failMuse(job, kind, err.code, err.message);
        await sleep(pollMs);
        continue;
      }
      if (task.status === "succeeded") {
        if (task.urls.length === 0) return await failJob(job.id, "NO_RESULT");
        return await finishJob(job.id, task.urls.map((url) => ({ url })), muse.authHeaders);
      }
      if (task.status === "failed" || task.status === "cancelled") {
        if (task.errorCode === "REGION_BLOCKED") return await failMuse(job, kind, "REGION_BLOCKED", task.error);
        return await failJob(job.id, task.error ?? `MUSE_${task.status.toUpperCase()}`);
      }
      const progress = Math.min(99, Math.max(0, task.progress ?? 0));
      if (progress !== lastProgress && Date.now() - lastWrite >= PROGRESS_WRITE_MS) {
        lastProgress = progress;
        lastWrite = Date.now();
        await db.job.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { progress } });
        await emitJob(job.id);
      }
      await sleep(pollMs);
    }
  } finally {
    await stop();
  }
}

// Job không còn RUNNING (sweeper đánh TIMEOUT, bị hủy…) thì abort để runCli kill lệnh đang chạy.
function watchJob(jobId: string, pollMs: number): { signal: AbortSignal; stop: () => void } {
  const ac = new AbortController();
  const timer = setInterval(() => {
    db.job.findUnique({ where: { id: jobId }, select: { status: true } }).then(
      (cur) => {
        if (cur?.status !== "RUNNING") ac.abort();
      },
      () => {},
    );
  }, pollMs);
  timer.unref();
  return { signal: ac.signal, stop: () => clearInterval(timer) };
}

async function runFileEngine(job: Job & { model: { engineModel: string; provider: ModelProvider } }, deps: ProcessDeps) {
  if (!(await claim(job.id))) return;
  const provider = job.model.provider as FileProvider;
  const watch = watchJob(job.id, deps.pollMs ?? DEFAULT_POLL_MS);
  let files: string[] = [];
  try {
    const engine = deps.engines?.[provider] ?? getFileEngine(provider);
    ({ files } = await engine.generate(await buildRequest(job), watch.signal));
    if (files.length === 0) return failJob(job.id, "NO_RESULT");
    await finishJob(job.id, files.map((p) => ({ path: p })));
  } catch (err) {
    if (isFatal(err)) return failJob(job.id, err.code);
    await release(job.id);
    throw err;
  } finally {
    watch.stop();
    // finishJob lỗi giữa chừng: file aura-out-* chưa được xóa.
    for (const f of files) await removeTempOutput(f);
  }
}

// Ghép video: mọi lỗi đều đánh FAILED và hoàn Credit (ghép lại từ đầu tốn tới 20 phút, không để BullMQ tự chạy lại).
async function runLocal(job: Job, deps: ProcessDeps): Promise<void> {
  if (!(await claim(job.id))) return;
  const watch = watchJob(job.id, deps.pollMs ?? DEFAULT_POLL_MS);
  let output: string | null = null;
  try {
    output = await runAssembleJob({ ...job, status: "RUNNING" }, watch.signal);
    await finishJob(job.id, [{ path: output }]);
  } catch (err) {
    const code = assembleErrorCode(err);
    if (code === "INTERNAL" || code === "ASSEMBLE_FAILED") console.error(`[assemble] job ${job.id} lỗi`, err);
    await failJob(job.id, code);
  } finally {
    watch.stop();
    if (output) await removeTempOutput(output);
  }
}

export async function processJob(jobId: string, deps: ProcessDeps = {}): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { model: true } });
  if (!job || job.deletedAt) return;
  const provider = job.model.provider;
  // MUSE đã có museTaskId: poll tiếp, không gửi lại.
  const resumable = job.status === "RUNNING" && provider === "MUSE" && job.museTaskId !== null;
  if (job.status !== "PENDING" && !resumable) return;

  if (provider === "LOCAL") return runLocal(job, deps);
  // Luồng AI Gateway: viết prompt bằng skill trước, rồi mới gửi cho engine người dùng chọn.
  const ready = await ensureWritten(job, deps);
  if (!ready) return;
  if (provider === "MUSE") return runMuse(ready, deps);
  return runFileEngine(ready, deps);
}

export type WrittenInfo = { provider: string; skillSlug: string; skillName: string; ms: number };

// params.autoWrite: `prompt` đang là ý tưởng gốc → AI Gateway (agy → codex → muse) áp skill viết prompt cho engine.
// Đã viết (params.written) thì bỏ qua — an toàn khi BullMQ chạy lại. Lỗi viết: FAILED + hoàn Credit.
async function ensureWritten<J extends Job>(job: J, deps: ProcessDeps): Promise<J | null> {
  const params = (job.params ?? {}) as Record<string, unknown>;
  if (!params.autoWrite || params.written || (job.kind !== "IMAGE" && job.kind !== "VIDEO")) return job;
  await publishEvent(job.userId, "job", jobEventData(job, { stage: "writing" }));
  const kind = job.kind === "IMAGE" ? "image" : "video";
  const { plan } = await getActivePlan(job.userId);
  const idea = typeof params.idea === "string" && params.idea ? params.idea : job.prompt;
  let res: Awaited<ReturnType<typeof writePrompt>>;
  try {
    res = await (deps.writePrompt ?? writePrompt)({
      idea,
      kind,
      skillId: typeof params.skillId === "string" ? params.skillId : undefined,
      autoSkill: true,
      styleId: kind === "image" && typeof params.presetId === "string" ? params.presetId : undefined,
      cameraId: kind === "video" && typeof params.presetId === "string" ? params.presetId : undefined,
      aspect: typeof params.aspectRatio === "string" ? params.aspectRatio : undefined,
      durationSec: typeof params.durationSec === "number" ? params.durationSec : undefined,
      hasRef: Boolean(job.inputUrl),
      planRank: plan.rank,
    });
  } catch (err) {
    console.warn(`[job] ${job.id} AI viết prompt lỗi: ${(err as Error).message.slice(0, 300)}`);
    await failJob(job.id, "WRITE_FAILED");
    return null;
  }
  if (!res.prompt) {
    await failJob(job.id, "WRITE_FAILED");
    return null;
  }
  const written: WrittenInfo = {
    provider: res.provider,
    skillSlug: res.skill?.slug ?? "",
    skillName: res.skill?.name ?? "",
    ms: res.ms ?? 0,
  };
  const updated = await db.job.updateMany({
    where: { id: job.id, status: { in: ["PENDING", "RUNNING"] } },
    data: {
      prompt: res.prompt.slice(0, 2000),
      params: { ...params, idea, written } as Prisma.InputJsonObject,
    },
  });
  if (updated.count === 0) return null;
  const fresh = await db.job.findUnique({ where: { id: job.id }, include: { model: true } });
  if (!fresh) return null;
  await publishEvent(fresh.userId, "job", jobEventData(fresh, { stage: "rendering" }));
  return fresh as unknown as J;
}

export async function sweepStuckJobs(now: Date = new Date()): Promise<number> {
  const providers: Record<QueueName, ModelProvider[]> = { muse: ["MUSE"], cli: ["AGY", "CODEX"], post: ["LOCAL"] };
  let swept = 0;
  for (const [queue, list] of Object.entries(providers) as [QueueName, ModelProvider[]][]) {
    const runCutoff = new Date(now.getTime() - QUEUE_TIMEOUT_MS[queue]);
    const pendCutoff = new Date(now.getTime() - PENDING_TIMEOUT_MS[queue]);
    const stuck = await db.job.findMany({
      where: {
        model: { provider: { in: list } },
        OR: [
          { status: "PENDING", queuedAt: { lt: pendCutoff } },
          { status: "PENDING", queuedAt: null, createdAt: { lt: new Date(now.getTime() - UNQUEUED_TIMEOUT_MS) } },
          { status: "RUNNING", startedAt: { lt: runCutoff } },
          { status: "RUNNING", startedAt: null, createdAt: { lt: runCutoff } },
        ],
      },
      select: { id: true },
    });
    for (const { id } of stuck) {
      await failJob(id, "TIMEOUT");
      swept++;
    }
  }
  return swept;
}

// userId: chỉ thao tác trên job của user này (job người khác → NOT_FOUND). Admin bỏ trống.
export async function cancelJob(jobId: string, userId?: string, opts: { quiet?: boolean } = {}): Promise<void> {
  const where = { id: jobId, ...(userId ? { userId } : {}) };
  const canceled = await db.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: { ...where, status: "PENDING" },
      data: { status: "CANCELED", finishedAt: new Date() },
    });
    if (updated.count > 0) await refund(jobId, tx);
    return updated.count > 0;
  });
  if (canceled) {
    const job = await emitJob(jobId);
    if (job) await publishCredit(job.userId);
    // Hủy cả story thì story tự xử lý, không cần báo.
    if (!opts.quiet) await notifyStory(job);
    return;
  }
  const exists = await db.job.count({ where });
  if (!exists) throw new AppError("NOT_FOUND", "Không tìm thấy tác vụ");
  throw new AppError("CONFLICT", "Chỉ hủy được tác vụ đang chờ");
}

export async function retryJob(jobId: string, userId?: string): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || (userId && job.userId !== userId)) throw new AppError("NOT_FOUND", "Không tìm thấy tác vụ");
  if (job.status !== "FAILED") throw new AppError("CONFLICT", "Chỉ chạy lại được tác vụ lỗi");
  return createJob(job.userId, job.params as GenerationParams);
}

export async function deleteJob(userId: string, jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== userId || job.deletedAt) throw new AppError("NOT_FOUND", "Không tìm thấy tác vụ");
  if (ACTIVE.includes(job.status)) throw new AppError("CONFLICT", "Tác vụ đang chạy, chưa xóa được");
  await db.job.update({ where: { id: jobId }, data: { deletedAt: new Date(), resultUrls: [] } });
  await deleteByUrls(job.resultUrls);
}

export async function getJobParams(userId: string, jobId: string): Promise<GenerationParams> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { userId: true, params: true, deletedAt: true } });
  if (!job || job.userId !== userId || job.deletedAt) throw new AppError("NOT_FOUND", "Không tìm thấy tác vụ");
  return job.params as GenerationParams;
}

export async function listJobs(userId: string, filter: JobListFilter = {}): Promise<{ items: Job[]; nextCursor: string | null }> {
  const rows = await db.job.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(filter.kind ? { kind: KIND[filter.kind] } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.storyId ? { storyId: filter.storyId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, PAGE_SIZE);
  return { items, nextCursor: rows.length > PAGE_SIZE ? items[items.length - 1].id : null };
}

// Kết quả gói Free quá hạn giữ: xóa file và ẩn job.
export async function cleanupExpiredResults(now: Date = new Date()): Promise<number> {
  const expired = await db.job.findMany({
    where: { expiresAt: { lt: now }, deletedAt: null, status: { notIn: ACTIVE } },
    select: { id: true, resultUrls: true },
  });
  for (const job of expired) {
    await db.job.update({ where: { id: job.id }, data: { deletedAt: now, resultUrls: [] } });
    await deleteByUrls(job.resultUrls);
  }
  return expired.length;
}
