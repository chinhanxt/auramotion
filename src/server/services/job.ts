import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma, type Job, type JobKind, type JobStatus, type ModelProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { PLAN_PRIORITY, queueFor, queues, type QueueName } from "@/lib/queue";
import { deleteByUrls, putFile, putFromUrl, storagePath } from "@/lib/storage";
import { buildPrompt, getFileEngine, getMuse, type FileProvider } from "@/server/engines";
import type { HttpMuseClient } from "@/server/engines/muse";
import { EngineError, type FileEngine, type MediaRequest } from "@/server/engines/types";
import { charge, hold, refund } from "@/server/services/credit";
import { getActivePlan } from "@/server/services/plan";
import { generationParamsSchema, quote, validateParams, type GenerationParams } from "@/server/services/pricing";
import { getSetting } from "@/server/services/settings";
import { processAssemble } from "../../../worker/processors/assemble";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const FREE_RESULT_TTL_MS = 30 * DAY;
const PAGE_SIZE = 24;
const DEFAULT_POLL_MS = 5000;
const MEDIA_PREFIX = "/media/";

const KIND: Record<GenerationParams["kind"], JobKind> = { image: "IMAGE", video: "VIDEO", assemble: "ASSEMBLE" };
const PRESET_KIND = { image: "STYLE", video: "CAMERA" } as const;
const INPUT_EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const RESULT_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"];

// Job PENDING / RUNNING quá thời hạn này bị sweeper đánh FAILED (TIMEOUT).
export const QUEUE_TIMEOUT_MS: Record<QueueName, number> = { muse: 15 * MINUTE, cli: 12 * MINUTE, post: 20 * MINUTE };

const ACTIVE: JobStatus[] = ["PENDING", "RUNNING"];

export type ProcessDeps = { muse?: HttpMuseClient; engines?: Partial<Record<string, FileEngine>>; pollMs?: number };
export type JobListFilter = { kind?: "image" | "video" | "assemble"; status?: JobStatus; cursor?: string; ids?: string[] };

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

async function loadEnabledModel(modelId: string) {
  const model = await db.aiModel.findUnique({ where: { id: modelId } });
  if (!model || !model.enabled) throw new AppError("NOT_FOUND", "Engine không tồn tại hoặc đang tắt");
  return model;
}

export async function quoteJob(input: GenerationParams): Promise<Prisma.Decimal> {
  const p = generationParamsSchema.parse(input);
  return quote(p, await loadEnabledModel(p.modelId));
}

export async function createJob(userId: string, input: GenerationParams): Promise<Job> {
  const p = generationParamsSchema.parse(input);
  if (await isMaintenance()) throw new AppError("MAINTENANCE", "Hệ thống đang bảo trì, vui lòng quay lại sau");
  const model = await loadEnabledModel(p.modelId);
  const { plan } = await getActivePlan(userId);
  validateParams(p, model, plan);

  if (p.kind !== "assemble") {
    if (p.presetId) {
      const preset = await db.preset.findUnique({ where: { id: p.presetId } });
      if (!preset || !preset.enabled || preset.kind !== PRESET_KIND[p.kind]) {
        throw new AppError("VALIDATION", "Preset không hợp lệ");
      }
    }
    if (p.inputUrl) await checkInputUrl(userId, p.inputUrl);
  }

  const cost = await quote(p, model);
  const now = new Date();
  const job = await db.$transaction(async (tx) => {
    // Khóa user để hai request song song không cùng vượt giới hạn job đồng thời.
    await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
    const active = await tx.job.count({ where: { userId, status: { in: ACTIVE }, deletedAt: null } });
    if (active >= plan.maxConcurrent) {
      throw new AppError("CONCURRENCY_LIMIT", `Bạn đang có ${active} tác vụ chạy, vui lòng chờ`);
    }
    const created = await tx.job.create({
      data: {
        userId,
        modelId: model.id,
        kind: KIND[p.kind],
        prompt: p.kind === "assemble" ? p.lines.join("\n") : p.prompt,
        params: p as Prisma.InputJsonObject,
        inputUrl: p.kind === "assemble" ? null : (p.inputUrl ?? null),
        cost,
        expiresAt: plan.code === "free" ? new Date(now.getTime() + FREE_RESULT_TTL_MS) : null,
      },
    });
    await hold(tx, userId, created.id, cost);
    return created;
  });

  try {
    await queues[queueFor(model.provider)].add(p.kind, { jobId: job.id }, { priority: PLAN_PRIORITY[plan.code], jobId: job.id });
  } catch (err) {
    console.error(`[job] không đưa được job ${job.id} vào hàng đợi`, err);
    await failJob(job.id, "QUEUE_UNAVAILABLE");
    throw new AppError("INTERNAL", "Không đưa được tác vụ vào hàng đợi, Credit đã được hoàn");
  }
  return job;
}

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
  try {
    for (const [i, f] of files.entries()) {
      const key = `results/${job.userId}/${job.id}/${i}${extOf(f, job.kind)}`;
      if (f.path) {
        urls.push(await putFile(f.path, key));
        await removeTempOutput(f.path);
      } else if (f.url) {
        urls.push(await putFromUrl(f.url, key, headers));
      }
    }
  } catch (err) {
    await deleteByUrls(urls);
    throw err;
  }
  const done = await db.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: { status: "SUCCEEDED", resultUrls: urls, finishedAt: new Date(), error: null },
    });
    if (updated.count === 0) return false;
    await charge(jobId, tx);
    return true;
  });
  if (done) return;
  // Job đã bị hủy / hết hạn trong lúc lưu file: bỏ file vừa lưu.
  // Lần chạy khác đã SUCCEEDED trước thì file cùng key là của nó: giữ nguyên.
  const current = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (current?.status !== "SUCCEEDED") await deleteByUrls(urls);
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: { id: jobId, status: { in: ACTIVE } },
      data: { status: "FAILED", error: error.slice(0, 1000), finishedAt: new Date() },
    });
    if (updated.count > 0) await refund(jobId, tx);
  });
}

async function claim(jobId: string): Promise<boolean> {
  const claimed = await db.job.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  return claimed.count > 0;
}

// Lỗi tạm thời trước khi engine nhận việc: trả job về PENDING để BullMQ chạy lại.
async function release(jobId: string): Promise<void> {
  await db.job.updateMany({ where: { id: jobId, status: "RUNNING", museTaskId: null }, data: { status: "PENDING", startedAt: null } });
}

function isFatal(err: unknown): err is EngineError {
  return err instanceof EngineError && !err.retryable;
}

async function buildRequest(job: Job & { model: { engineModel: string } }): Promise<MediaRequest> {
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
  return {
    kind: p.kind,
    engineModel: job.model.engineModel,
    prompt: buildPrompt(job.prompt, preset),
    aspectRatio: p.aspectRatio,
    ...(p.kind === "image" ? { imageCount: p.imageCount ?? 1 } : { durationSec: p.durationSec ?? 5 }),
    ...(job.inputUrl ? { inputUrl: job.inputUrl } : {}),
    ...(inputPath ? { inputPath } : {}),
  };
}

async function runMuse(job: Job & { model: { engineModel: string } }, deps: ProcessDeps): Promise<void> {
  const muse = deps.muse ?? getMuse();
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const kind = job.kind === "IMAGE" ? "image" : "video";
  let taskId = job.museTaskId;

  if (!taskId) {
    if (!(await claim(job.id))) return;
    try {
      const req = await buildRequest(job);
      taskId = (await muse.submit(req)).taskId;
    } catch (err) {
      if (isFatal(err)) return failJob(job.id, err.code);
      await release(job.id);
      throw err;
    }
    await db.job.update({ where: { id: job.id }, data: { museTaskId: taskId } });
  }

  for (;;) {
    const current = await db.job.findUnique({ where: { id: job.id }, select: { status: true } });
    if (current?.status !== "RUNNING") return;
    let task: Awaited<ReturnType<HttpMuseClient["getTask"]>>;
    try {
      task = await muse.getTask(kind, taskId);
    } catch (err) {
      if (isFatal(err)) return failJob(job.id, err.code);
      await sleep(pollMs);
      continue;
    }
    if (task.status === "succeeded") {
      if (task.urls.length === 0) return failJob(job.id, "NO_RESULT");
      return finishJob(job.id, task.urls.map((url) => ({ url })), muse.authHeaders);
    }
    if (task.status === "failed" || task.status === "cancelled") {
      return failJob(job.id, task.error ?? `MUSE_${task.status.toUpperCase()}`);
    }
    await sleep(pollMs);
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

export async function processJob(jobId: string, deps: ProcessDeps = {}): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { model: true } });
  if (!job || job.deletedAt) return;
  const provider = job.model.provider;
  // MUSE đã có museTaskId: poll tiếp, không gửi lại.
  const resumable = job.status === "RUNNING" && provider === "MUSE" && job.museTaskId !== null;
  if (job.status !== "PENDING" && !resumable) return;

  if (provider === "MUSE") return runMuse(job, deps);
  if (provider === "LOCAL") {
    if (!(await claim(job.id))) return;
    const watch = watchJob(job.id, deps.pollMs ?? DEFAULT_POLL_MS);
    try {
      await processAssemble({ ...job, status: "RUNNING" }, watch.signal);
    } finally {
      watch.stop();
    }
    return;
  }
  return runFileEngine(job, deps);
}

export async function sweepStuckJobs(now: Date = new Date()): Promise<number> {
  const providers: Record<QueueName, ModelProvider[]> = { muse: ["MUSE"], cli: ["AGY", "CODEX"], post: ["LOCAL"] };
  let swept = 0;
  for (const [queue, list] of Object.entries(providers) as [QueueName, ModelProvider[]][]) {
    const cutoff = new Date(now.getTime() - QUEUE_TIMEOUT_MS[queue]);
    const stuck = await db.job.findMany({
      where: {
        model: { provider: { in: list } },
        OR: [
          { status: "PENDING", createdAt: { lt: cutoff } },
          { status: "RUNNING", startedAt: { lt: cutoff } },
          { status: "RUNNING", startedAt: null, createdAt: { lt: cutoff } },
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
export async function cancelJob(jobId: string, userId?: string): Promise<void> {
  const where = { id: jobId, ...(userId ? { userId } : {}) };
  const canceled = await db.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: { ...where, status: "PENDING" },
      data: { status: "CANCELED", finishedAt: new Date() },
    });
    if (updated.count > 0) await refund(jobId, tx);
    return updated.count > 0;
  });
  if (canceled) return;
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
