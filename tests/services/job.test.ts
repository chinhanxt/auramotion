import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { queues } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { putFile, storagePath } from "@/lib/storage";
import type { HttpMuseClient, MuseTaskStatus } from "@/server/engines/muse";
import { EngineError, type FileEngine, type MediaRequest } from "@/server/engines/types";
import { getBalance } from "@/server/services/credit";
import {
  cancelJob,
  cleanupExpiredResults,
  createJob,
  deleteJob,
  failJob,
  processJob,
  retryJob,
  sweepStuckJobs,
} from "@/server/services/job";
import { startFree } from "@/server/services/plan";
import type { GenerationParams } from "@/server/services/pricing";
import { setSetting } from "@/server/services/settings";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const SAMPLE_PNG = path.resolve("tests/fixtures/sample.png");
const MINUTE = 60_000;

let server: Server;
let baseUrl: string;
const seenHeaders: IncomingHttpHeaders[] = [];

let userId: string;
let otherId: string;
let models: Record<string, string>;

async function newFreeUser(email: string): Promise<string> {
  const user = await db.user.create({ data: { email, name: email } });
  await startFree(user.id);
  return user.id;
}

async function balance(id = userId) {
  const b = await getBalance(id);
  return { available: b.available.toFixed(2), held: b.held.toFixed(2) };
}

function imageParams(extra: Partial<Extract<GenerationParams, { kind: "image" }>> = {}): GenerationParams {
  return { kind: "image", modelId: models["MUSE Ảnh"], prompt: "a bottle", aspectRatio: "9:16", imageCount: 2, ...extra };
}

async function expectAppError(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

type StubTask = { status: MuseTaskStatus; urls?: string[]; error?: string };

function stubMuse(tasks: StubTask[]) {
  const submitted: MediaRequest[] = [];
  const polled: string[] = [];
  let i = 0;
  const muse = {
    authHeaders: { Authorization: "Bearer dev-muse-key" },
    submit: vi.fn(async (req: MediaRequest) => {
      submitted.push(req);
      return { taskId: "task_1" };
    }),
    getTask: vi.fn(async (_kind: "image" | "video", taskId: string) => {
      polled.push(taskId);
      const t = tasks[Math.min(i++, tasks.length - 1)];
      return { status: t.status, urls: t.urls ?? [], ...(t.error ? { error: t.error } : {}) };
    }),
  };
  return { muse: muse as unknown as HttpMuseClient, submitted, polled, raw: muse };
}

function resultUrls(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${baseUrl}/v1/media/img_${i}.webp`);
}

describe("job", () => {
  beforeAll(async () => {
    const png = await fs.readFile(SAMPLE_PNG);
    server = createServer((req, res) => {
      seenHeaders.push(req.headers);
      res.writeHead(200, { "Content-Type": "image/webp" });
      res.end(png);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const q of Object.values(queues)) vi.spyOn(q, "add").mockResolvedValue({} as never);
    seenHeaders.length = 0;
    await resetDb();
    await seed();
    await setSetting("maintenance", false);
    userId = await newFreeUser("job@test.local");
    otherId = await newFreeUser("other@test.local");
    models = Object.fromEntries((await db.aiModel.findMany()).map((m) => [m.name, m.id]));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await redis.quit();
    await db.$disconnect();
  });

  it("createJob holds credit", async () => {
    const job = await createJob(userId, imageParams());
    expect(job.status).toBe("PENDING");
    expect(job.cost.toFixed(2)).toBe("2.00");
    expect(job.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * MINUTE);
    expect(await balance()).toEqual({ available: "18.00", held: "2.00" });
    expect(queues.muse.add).toHaveBeenCalledWith("image", { jobId: job.id }, { priority: 10, jobId: job.id });
  });

  it("createJob stores parsed params only", async () => {
    const job = await createJob(userId, { ...imageParams(), hack: "x" } as unknown as GenerationParams);
    expect(job.params).not.toHaveProperty("hack");
    expect(job.params).toMatchObject({ kind: "image", prompt: "a bottle", imageCount: 2 });
  });

  it("createJob routes agy to cli queue", async () => {
    const job = await createJob(userId, imageParams({ modelId: models["Gemini Ảnh"], imageCount: 1 }));
    expect(queues.cli.add).toHaveBeenCalledWith("image", { jobId: job.id }, expect.objectContaining({ jobId: job.id }));
    expect(queues.muse.add).not.toHaveBeenCalled();
  });

  it("createJob concurrency limit", async () => {
    await createJob(userId, imageParams({ imageCount: 1 }));
    await expectAppError(createJob(userId, imageParams({ imageCount: 1 })), "CONCURRENCY_LIMIT");
    expect(await balance()).toEqual({ available: "19.00", held: "1.00" });
    expect(await db.job.count({ where: { userId } })).toBe(1);
  });

  it("createJob in maintenance", async () => {
    await setSetting("maintenance", true);
    await expectAppError(createJob(userId, imageParams()), "MAINTENANCE");
    expect(await db.job.count()).toBe(0);
  });

  it("createJob rejects disabled model", async () => {
    await db.aiModel.update({ where: { id: models["MUSE Ảnh"] }, data: { enabled: false } });
    await expectAppError(createJob(userId, imageParams()), "NOT_FOUND");
  });

  it("createJob rejects input file of another user", async () => {
    const own = await putFile(SAMPLE_PNG, `uploads/${userId}/${randomUUID()}.png`);
    const foreign = await putFile(SAMPLE_PNG, `uploads/${otherId}/${randomUUID()}.png`);
    await expectAppError(createJob(userId, imageParams({ inputUrl: foreign })), "FORBIDDEN");
    await expectAppError(createJob(userId, imageParams({ inputUrl: "https://evil.example/x.png" })), "VALIDATION");
    await expectAppError(createJob(userId, imageParams({ inputUrl: `/media/uploads/${userId}/missing.png` })), "VALIDATION");

    const otherJob = await createJob(otherId, imageParams({ imageCount: 1 }));
    const otherResult = await putFile(SAMPLE_PNG, `results/${otherId}/${otherJob.id}/0.png`);
    await db.job.update({ where: { id: otherJob.id }, data: { status: "SUCCEEDED", resultUrls: [otherResult] } });
    await expectAppError(createJob(userId, imageParams({ inputUrl: otherResult })), "FORBIDDEN");

    const job = await createJob(userId, imageParams({ inputUrl: own }));
    expect(job.inputUrl).toBe(own);
  });

  it("processJob muse success charges", async () => {
    const preset = await db.preset.findFirstOrThrow({ where: { kind: "STYLE", name: "Studio" } });
    const job = await createJob(userId, imageParams({ presetId: preset.id }));
    const stub = stubMuse([{ status: "running" }, { status: "succeeded", urls: resultUrls(2) }]);
    await processJob(job.id, { muse: stub.muse, pollMs: 1 });

    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.museTaskId).toBe("task_1");
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    expect(done.resultUrls).toEqual([
      `/media/results/${userId}/${job.id}/0.webp`,
      `/media/results/${userId}/${job.id}/1.webp`,
    ]);
    for (const url of done.resultUrls) expect(existsSync(storagePath(url.slice("/media/".length)))).toBe(true);
    expect(seenHeaders[0].authorization).toBe("Bearer dev-muse-key");
    expect(stub.submitted[0]).toMatchObject({
      kind: "image",
      engineModel: "muse-image",
      prompt: `a bottle, ${preset.promptSuffix}`,
      aspectRatio: "9:16",
      imageCount: 2,
    });
    expect(await balance()).toEqual({ available: "18.00", held: "0.00" });
  });

  it("processJob muse failure refunds", async () => {
    const job = await createJob(userId, imageParams());
    const stub = stubMuse([{ status: "failed", error: "upstream refused" }]);
    await processJob(job.id, { muse: stub.muse, pollMs: 1 });

    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("FAILED");
    expect(done.error).toBe("upstream refused");
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
  });

  it("processJob resumes without resubmit", async () => {
    const job = await createJob(userId, imageParams());
    await db.job.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date(), museTaskId: "task_9" } });
    const stub = stubMuse([{ status: "running" }, { status: "succeeded", urls: resultUrls(2) }]);
    await processJob(job.id, { muse: stub.muse, pollMs: 1 });

    expect(stub.raw.submit).not.toHaveBeenCalled();
    expect(stub.polled).toEqual(["task_9", "task_9"]);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUCCEEDED");
  });

  it("two concurrent resumes keep the winner's files", async () => {
    const job = await createJob(userId, imageParams());
    await db.job.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date(), museTaskId: "task_9" } });
    const a = stubMuse([{ status: "succeeded", urls: resultUrls(2) }]);
    const b = stubMuse([{ status: "succeeded", urls: resultUrls(2) }]);
    await Promise.all([
      processJob(job.id, { muse: a.muse, pollMs: 1 }),
      processJob(job.id, { muse: b.muse, pollMs: 1 }),
    ]);

    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.resultUrls).toHaveLength(2);
    for (const url of done.resultUrls) expect(existsSync(storagePath(url.slice("/media/".length)))).toBe(true);
    expect(await db.creditTransaction.count({ where: { jobId: job.id, type: "charge" } })).toBe(1);
  });

  it("processJob twice is no-op", async () => {
    const job = await createJob(userId, imageParams());
    const stub = stubMuse([{ status: "succeeded", urls: resultUrls(2) }]);
    await processJob(job.id, { muse: stub.muse, pollMs: 1 });
    await processJob(job.id, { muse: stub.muse, pollMs: 1 });

    expect(stub.raw.submit).toHaveBeenCalledTimes(1);
    expect(stub.raw.getTask).toHaveBeenCalledTimes(1);
    const txns = await db.creditTransaction.count({ where: { jobId: job.id, type: "charge" } });
    expect(txns).toBe(1);
  });

  it("processJob retryable submit error returns job to pending", async () => {
    const job = await createJob(userId, imageParams());
    const stub = stubMuse([]);
    stub.raw.submit.mockRejectedValueOnce(new EngineError("MUSE_BUSY", "busy", true));
    await expect(processJob(job.id, { muse: stub.muse, pollMs: 1 })).rejects.toThrow("busy");
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("PENDING");
    expect(await balance()).toEqual({ available: "18.00", held: "2.00" });
  });

  it("processJob file engine success", async () => {
    const job = await createJob(userId, imageParams({ modelId: models["Gemini Ảnh"], imageCount: 1 }));
    const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}.png`);
    await fs.copyFile(SAMPLE_PNG, out);
    const requests: MediaRequest[] = [];
    const agy: FileEngine = {
      generate: async (req) => {
        requests.push(req);
        return { files: [out] };
      },
    };
    await processJob(job.id, { engines: { AGY: agy } });

    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.resultUrls).toEqual([`/media/results/${userId}/${job.id}/0.png`]);
    expect(existsSync(storagePath(done.resultUrls[0].slice("/media/".length)))).toBe(true);
    expect(existsSync(out)).toBe(false);
    expect(requests[0]).toMatchObject({ engineModel: "gemini-3.8-flash-medium", aspectRatio: "9:16" });
    expect(await balance()).toEqual({ available: "19.00", held: "0.00" });
  });

  it("AI Gateway: autoWrite viết prompt bằng skill rồi mới gửi engine người dùng chọn", async () => {
    const style = await db.preset.findFirstOrThrow({ where: { kind: "STYLE", slug: "son-mai" } });
    const skill = await db.promptSkill.findFirstOrThrow({ where: { slug: "image-food-drink" } });
    const job = await createJob(
      userId,
      imageParams({ modelId: models["Gemini Ảnh"], imageCount: 1, prompt: "ly cà phê sữa đá", presetId: style.id, autoWrite: true, skillId: skill.id }),
    );
    const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}.png`);
    await fs.copyFile(SAMPLE_PNG, out);
    const requests: MediaRequest[] = [];
    const agy: FileEngine = { generate: async (req) => (requests.push(req), { files: [out] }) };
    const calls: unknown[] = [];
    const writePrompt = vi.fn(async (input: unknown) => {
      calls.push(input);
      return { prompt: "A glass of Vietnamese iced milk coffee on lacquer", provider: "agy" as const, ms: 900, skill: { id: skill.id, slug: skill.slug, name: skill.name } };
    });
    await processJob(job.id, { engines: { AGY: agy }, writePrompt });

    expect(calls[0]).toMatchObject({ idea: "ly cà phê sữa đá", kind: "image", skillId: skill.id, styleId: style.id, autoSkill: true, hasRef: false });
    // Prompt đã viết đi thẳng tới engine, không nối promptSuffix của style lần nữa.
    expect(requests[0].prompt).toBe("A glass of Vietnamese iced milk coffee on lacquer");
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.prompt).toBe("A glass of Vietnamese iced milk coffee on lacquer");
    expect(done.params).toMatchObject({ idea: "ly cà phê sữa đá", written: { provider: "agy", skillSlug: "image-food-drink", ms: 900 } });
  });

  it("AI Gateway lỗi: job FAILED WRITE_FAILED, hoàn Credit, không gọi engine", async () => {
    const job = await createJob(userId, imageParams({ modelId: models["Gemini Ảnh"], imageCount: 1, prompt: "bát phở", autoWrite: true }));
    const generate = vi.fn();
    await processJob(job.id, {
      engines: { AGY: { generate } },
      writePrompt: vi.fn(async () => {
        throw new Error("all providers down");
      }),
    });
    expect(generate).not.toHaveBeenCalled();
    expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "FAILED", error: "WRITE_FAILED" });
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
  });

  it("skill không hợp lệ cho autoWrite bị chặn lúc tạo job", async () => {
    const story = await db.promptSkill.findFirstOrThrow({ where: { kind: "STORY" } });
    await expectAppError(createJob(userId, imageParams({ autoWrite: true, skillId: story.id })), "VALIDATION");
  });

  it("file engine is aborted when the job stops running", async () => {
    const job = await createJob(userId, imageParams({ modelId: models["Gemini Ảnh"], imageCount: 1 }));
    let aborted = false;
    const agy: FileEngine = {
      generate: (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new EngineError("CANCELED", "canceled"));
          });
          void failJob(job.id, "TIMEOUT");
        }),
    };
    await processJob(job.id, { engines: { AGY: agy }, pollMs: 20 });

    expect(aborted).toBe(true);
    expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "FAILED", error: "TIMEOUT" });
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
  });

  it("file engine output is removed when saving fails", async () => {
    const job = await createJob(userId, imageParams({ modelId: models["Gemini Ảnh"], imageCount: 1 }));
    const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}.png`);
    await fs.copyFile(SAMPLE_PNG, out);
    const storage = await import("@/lib/storage");
    vi.spyOn(storage, "putFile").mockRejectedValue(new Error("disk full"));
    const agy: FileEngine = { generate: async () => ({ files: [out] }) };
    await expect(processJob(job.id, { engines: { AGY: agy } })).rejects.toThrow("disk full");
    expect(existsSync(out)).toBe(false);
  });

  it("sweepStuckJobs refunds timed-out jobs", async () => {
    const now = new Date();
    const museJob = await createJob(userId, imageParams());
    await db.job.update({
      where: { id: museJob.id },
      data: { status: "RUNNING", museTaskId: "task_1", startedAt: new Date(now.getTime() - 21 * MINUTE) },
    });
    const cliJob = await createJob(otherId, imageParams({ modelId: models["Gemini Ảnh"], imageCount: 1 }));
    await db.job.update({
      where: { id: cliJob.id },
      data: { status: "RUNNING", startedAt: new Date(now.getTime() - 11 * MINUTE) },
    });

    expect(await sweepStuckJobs(now)).toBe(1);
    const swept = await db.job.findUniqueOrThrow({ where: { id: museJob.id } });
    expect(swept.status).toBe("FAILED");
    expect(swept.error).toBe("TIMEOUT");
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
    expect((await db.job.findUniqueOrThrow({ where: { id: cliJob.id } })).status).toBe("RUNNING");
    expect(await balance(otherId)).toEqual({ available: "19.00", held: "1.00" });
  });

  it("cancelJob only pending", async () => {
    const job = await createJob(userId, imageParams());
    await cancelJob(job.id);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("CANCELED");
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
    await expectAppError(cancelJob(job.id), "CONFLICT");

    const running = await createJob(userId, imageParams());
    await db.job.update({ where: { id: running.id }, data: { status: "RUNNING", startedAt: new Date() } });
    await expectAppError(cancelJob(running.id), "CONFLICT");
    await expectAppError(cancelJob("missing"), "NOT_FOUND");
  });

  it("cancelJob and retryJob with userId reject other user's job", async () => {
    const job = await createJob(userId, imageParams());
    await expectAppError(cancelJob(job.id, otherId), "NOT_FOUND");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
    await cancelJob(job.id, userId);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("CANCELED");

    const failed = await createJob(userId, imageParams());
    await failJob(failed.id, "MUSE_FAILED");
    await expectAppError(retryJob(failed.id, otherId), "NOT_FOUND");
    expect(await db.job.count({ where: { userId } })).toBe(2);
    const retried = await retryJob(failed.id, userId);
    expect(retried.userId).toBe(userId);
    expect(retried.status).toBe("PENDING");
  });

  it("processJob fails BAD_INPUT without retry when input file was deleted", async () => {
    const input = await putFile(SAMPLE_PNG, `uploads/${userId}/${randomUUID()}.png`);
    const job = await createJob(userId, imageParams({ inputUrl: input }));
    await fs.rm(storagePath(input.slice("/media/".length)));
    const stub = stubMuse([{ status: "succeeded", urls: resultUrls(2) }]);
    await processJob(job.id, { muse: stub.muse, pollMs: 1 });
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("FAILED");
    expect(done.error).toBe("BAD_INPUT");
    expect(stub.raw.submit).not.toHaveBeenCalled();
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });

    const agyJob = await createJob(userId, imageParams({ modelId: models["Gemini Ảnh"], imageCount: 1, inputUrl: await putFile(SAMPLE_PNG, `uploads/${userId}/${randomUUID()}.png`) }));
    await fs.rm(storagePath(agyJob.inputUrl!.slice("/media/".length)));
    const engine: FileEngine = { generate: vi.fn(async () => ({ files: [SAMPLE_PNG] })) };
    await processJob(agyJob.id, { engines: { AGY: engine } });
    const agyDone = await db.job.findUniqueOrThrow({ where: { id: agyJob.id } });
    expect(agyDone.status).toBe("FAILED");
    expect(agyDone.error).toBe("BAD_INPUT");
    expect(engine.generate).not.toHaveBeenCalled();
  });

  it("deleteJob other user", async () => {
    const job = await createJob(userId, imageParams());
    await processJob(job.id, { muse: stubMuse([{ status: "succeeded", urls: resultUrls(2) }]).muse, pollMs: 1 });
    await expectAppError(deleteJob(otherId, job.id), "NOT_FOUND");

    const { resultUrls: urls } = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    await deleteJob(userId, job.id);
    const deleted = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(deleted.deletedAt).not.toBeNull();
    for (const url of urls) expect(existsSync(storagePath(url.slice("/media/".length)))).toBe(false);
    await expectAppError(deleteJob(userId, job.id), "NOT_FOUND");
  });

  it("cleanupExpiredResults removes free results after 30 days", async () => {
    const job = await createJob(userId, imageParams());
    await processJob(job.id, { muse: stubMuse([{ status: "succeeded", urls: resultUrls(2) }]).muse, pollMs: 1 });
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(await cleanupExpiredResults(new Date(Date.now() + 29 * 24 * 60 * MINUTE))).toBe(0);
    expect(await cleanupExpiredResults(new Date(Date.now() + 31 * 24 * 60 * MINUTE))).toBe(1);
    const cleaned = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(cleaned.deletedAt).not.toBeNull();
    for (const url of done.resultUrls) expect(existsSync(storagePath(url.slice("/media/".length)))).toBe(false);
  });
});
