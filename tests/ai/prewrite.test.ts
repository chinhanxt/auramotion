import type { User } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { getCachedWrite, prewrite, prewriteKey, resolvePrewrite } from "@/server/ai/prewrite";
import type { WritePromptResult } from "@/server/engines/prompt-writer";
import type { FileEngine } from "@/server/engines/types";
import { createJob, processJob } from "@/server/services/job";
import { startFree } from "@/server/services/plan";
import { traceOf } from "@/server/services/trace";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SAMPLE_PNG = path.resolve("tests/fixtures/sample.png");

async function clearPw() {
  const keys = await redis.keys("am:test:pw:*");
  if (keys.length) await redis.del(...keys);
}

function fakeWriter(prompt = "A tall glass of iced coffee", ms = 0) {
  return vi.fn(async (input: { idea: string }): Promise<WritePromptResult> => {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    return { prompt: `${prompt} (${input.idea})`, provider: "agy", model: "gemini-3.8-flash-low", ms: 5 };
  });
}

let user: User;

describe("prewrite", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const q of Object.values(queues)) vi.spyOn(q, "add").mockResolvedValue({} as never);
    await clearPw();
    await resetDb();
    await seed();
    user = await db.user.create({ data: { email: "pw@test.local", name: "PW" } });
    await startFree(user.id);
  });

  afterAll(async () => {
    await clearPw();
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await redis.quit();
    await db.$disconnect();
  });

  it("key depends on every input and on skill updatedAt", async () => {
    const base = { idea: "cà phê", kind: "image" as const, aspect: "9:16" };
    const skill = { id: "s1", updatedAt: new Date(1000) };
    const k = prewriteKey(base, skill);
    expect(prewriteKey({ ...base }, skill)).toBe(k);
    for (const change of [{ idea: "trà" }, { aspect: "1:1" }, { styleId: "x" }, { cameraId: "y" }, { durationSec: 5 }, { hasRef: true }, { kind: "video" as const }]) {
      expect(prewriteKey({ ...base, ...change }, skill)).not.toBe(k);
    }
    expect(prewriteKey(base, { id: "s1", updatedAt: new Date(2000) })).not.toBe(k);
    expect(prewriteKey(base, null)).not.toBe(k);
  });

  it("pending → ready; same key while pending does not start a second write", async () => {
    const writePrompt = fakeWriter("Iced coffee", 150);
    const input = { idea: "ly cà phê sữa đá", kind: "image" as const, aspect: "9:16" };
    let job: Promise<void> | undefined;
    const first = await prewrite(input, { writePrompt, onStart: (p) => (job = p) });
    expect(first.status).toBe("pending");
    const second = await prewrite(input, { writePrompt });
    expect(second).toEqual({ key: first.key, status: "pending" });
    await job;
    expect(writePrompt).toHaveBeenCalledTimes(1);
    // skill tự chọn theo ý tưởng được truyền vào lần viết.
    expect(writePrompt.mock.calls[0][2]).toMatchObject({ slug: "image-food-drink" });
    const ready = await prewrite(input, { writePrompt });
    expect(ready).toMatchObject({ key: first.key, status: "ready", prompt: "Iced coffee (ly cà phê sữa đá)", provider: "agy" });
    expect(writePrompt).toHaveBeenCalledTimes(1);
  });

  it("write error is reported briefly, canStart limits concurrent writes, disabled setting", async () => {
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    let job: Promise<void> | undefined;
    const input = { idea: "bát phở", kind: "image" as const, aspect: "1:1" };
    await prewrite(input, { writePrompt: failing, onStart: (p) => (job = p) });
    await job;
    expect(await prewrite(input, { writePrompt: failing })).toMatchObject({ status: "error" });
    await expect(prewrite({ ...input, idea: "khác" }, { writePrompt: failing, canStart: () => false })).rejects.toMatchObject({ code: "CONCURRENCY_LIMIT" });
    const { saveAiRoles, getAiRoles } = await import("@/server/ai/roles");
    await saveAiRoles({ ...(await getAiRoles()), prewrite: false });
    expect(await prewrite({ ...input, idea: "x" })).toMatchObject({ status: "disabled" });
  });

  it("autoWrite job uses the prewrite cache (no second AI call) and records trace", async () => {
    const model = await db.aiModel.findFirstOrThrow({ where: { name: "Gemini Ảnh" } });
    const writer = fakeWriter("Prewritten", 0);
    const input = { idea: "ly trà sữa trân châu", kind: "image" as const, aspect: "9:16", planRank: 0 };
    let job: Promise<void> | undefined;
    await prewrite(input, { writePrompt: writer, onStart: (p) => (job = p) });
    await job;
    const { key } = await resolvePrewrite(input);
    expect(await getCachedWrite(key)).toMatchObject({ prompt: "Prewritten (ly trà sữa trân châu)" });

    const created = await createJob(user.id, { kind: "image", modelId: model.id, prompt: "ly trà sữa trân châu", aspectRatio: "9:16", imageCount: 1, autoWrite: true });
    expect(traceOf(created.params)).toMatchObject({ createdAt: expect.any(Number), queuedAt: expect.any(Number) });
    const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}.png`);
    await fs.copyFile(SAMPLE_PNG, out);
    const prompts: string[] = [];
    const agy: FileEngine = { generate: async (req) => (prompts.push(req.prompt), { files: [out] }) };
    const writePrompt = fakeWriter("Should not run");
    await processJob(created.id, { engines: { AGY: agy }, writePrompt });

    expect(writePrompt).not.toHaveBeenCalled();
    expect(prompts).toEqual(["Prewritten (ly trà sữa trân châu)"]);
    const done = await db.job.findUniqueOrThrow({ where: { id: created.id } });
    expect(done.status).toBe("SUCCEEDED");
    const trace = traceOf(done.params)!;
    expect(trace.writer).toMatchObject({ provider: "agy", model: "gemini-3.8-flash-low", skill: "image-food-drink", cache: true });
    expect(trace).toMatchObject({ writeStart: expect.any(Number), writeEnd: expect.any(Number), slotAt: expect.any(Number), submitAt: expect.any(Number), doneAt: expect.any(Number) });
    expect(trace.engine).toEqual({ provider: "agy", model: model.engineModel });
    expect(trace.writeStart! <= trace.writeEnd! && trace.writeEnd! <= trace.submitAt! && trace.submitAt! <= trace.doneAt!).toBe(true);
    expect(done.params).toMatchObject({ written: { cache: true, provider: "agy" } });
  });

  it("autoWrite without cache writes once, stores cache; failure records failedAt", async () => {
    const model = await db.aiModel.findFirstOrThrow({ where: { name: "Gemini Ảnh" } });
    const created = await createJob(user.id, { kind: "image", modelId: model.id, prompt: "bánh mì nóng giòn", aspectRatio: "1:1", imageCount: 1, autoWrite: true });
    const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}.png`);
    await fs.copyFile(SAMPLE_PNG, out);
    const writePrompt = fakeWriter("Fresh");
    await processJob(created.id, { engines: { AGY: { generate: async () => ({ files: [out] }) } }, writePrompt });
    expect(writePrompt).toHaveBeenCalledTimes(1);
    const done = await db.job.findUniqueOrThrow({ where: { id: created.id } });
    expect(traceOf(done.params)?.writer).toMatchObject({ cache: false });
    const { key } = await resolvePrewrite({ idea: "bánh mì nóng giòn", kind: "image", aspect: "1:1", planRank: 0 });
    expect(await getCachedWrite(key)).toMatchObject({ prompt: "Fresh (bánh mì nóng giòn)" });

    const bad = await createJob(user.id, { kind: "image", modelId: model.id, prompt: "x", aspectRatio: "1:1", imageCount: 1, autoWrite: true });
    await processJob(bad.id, {
      engines: { AGY: { generate: vi.fn() } },
      writePrompt: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const failed = await db.job.findUniqueOrThrow({ where: { id: bad.id } });
    expect(failed.status).toBe("FAILED");
    expect(traceOf(failed.params)).toMatchObject({ failedAt: expect.any(Number), error: "WRITE_FAILED" });
  });
});
