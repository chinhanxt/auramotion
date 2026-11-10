import path from "node:path";
import type { Job } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { queues, storyQueue } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { putFile } from "@/lib/storage";
import type { ProviderRun } from "@/server/ai/gateway";
import { getBalance } from "@/server/services/credit";
import { startFree } from "@/server/services/plan";
import { setSetting } from "@/server/services/settings";
import {
  advanceStory,
  assembleStory,
  cancelStory,
  createStory,
  getStory,
  parseStoryPlan,
  planStory,
  renderStory,
  sweepStories,
  retryShot,
  PLAN_FOLLOW_UP,
} from "@/server/services/story";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const SAMPLE_MP4 = path.resolve("tests/fixtures/sample.mp4");
const gateway = { order: ["muse", "agy", "codex"] as ("agy" | "codex" | "muse")[], timeoutSec: 5 };

// Mẫu thật Muse chat chính trả (10/11): "shots" thiếu "[", cụt đuôi, kèm chữ thừa.
const MALFORMED = `Đây là kịch bản của bạn:
\`\`\`json
{"title": "Mèo cam phiêu lưu", "shots": {"title": "A", "prompt": "a small orange tabby cat with a white chest wakes up on a windowsill, slow dolly in", "camera": "slow dolly in", "durationSec": 5}, {"title": "B", "prompt": "a small orange tabby cat with a white chest leaps onto a rooftop, smooth tracking shot", "camera": "tracking side", "durationSec": 5}, {"title": "C", "prompt": "a small orange tabby cat with a white chest watches the sunset, gentle crane up", "camera": "crane up", "durationSec": 5}]}
\`\`\`
Chúc bạn sáng tạo vui!`;

const GOOD = JSON.stringify({
  title: "Hành trình",
  shots: [
    { title: "Một", prompt: "a red fox runs through snow, slow dolly in", camera: "slow dolly in", durationSec: 10 },
    { title: "Hai", prompt: "a red fox leaps over a frozen stream", camera: "tracking side", durationSec: 10 },
    { title: "Ba", prompt: "a red fox rests under a pine tree", durationSec: 10 },
  ],
});

let userId: string;

async function balance(id = userId) {
  const b = await getBalance(id);
  return { available: b.available.toFixed(2), held: b.held.toFixed(2) };
}

async function readyStory(extra: Record<string, unknown> = {}, plan = GOOD) {
  const story = await createStory(userId, { idea: "cáo đỏ", aspect: "9:16", shotCount: 3, shotDurationSec: 5, ...extra });
  await planStory(story.id, { setting: gateway, runners: { muse: async () => plan } });
  return story;
}

async function succeed(job: Job): Promise<void> {
  const url = await putFile(SAMPLE_MP4, `results/${job.userId}/${job.id}/0.mp4`);
  await db.job.update({ where: { id: job.id }, data: { status: "SUCCEEDED", resultUrls: [url], finishedAt: new Date() } });
}

async function shotJobs(storyId: string): Promise<Job[]> {
  return db.job.findMany({ where: { storyId, kind: "VIDEO", deletedAt: null }, orderBy: [{ shotIndex: "asc" }, { createdAt: "asc" }] });
}

describe("story", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const q of Object.values(queues)) vi.spyOn(q, "add").mockResolvedValue({} as never);
    vi.spyOn(storyQueue, "add").mockResolvedValue({} as never);
    await resetDb();
    await seed();
    await setSetting("maintenance", false);
    const user = await db.user.create({ data: { email: "story@test.local", name: "Story" } });
    await startFree(user.id);
    userId = user.id;
  });

  afterAll(async () => {
    await Promise.all([...Object.values(queues), storyQueue].map((q) => q.close()));
    await redis.quit();
    await db.$disconnect();
  });

  describe("parseStoryPlan", () => {
    it("repairs the real malformed Muse sample", () => {
      const { title, plan } = parseStoryPlan(MALFORMED, { shotCount: 3, durationSec: 5 });
      expect(title).toBe("Mèo cam phiêu lưu");
      expect(plan.shots.map((s) => s.title)).toEqual(["A", "B", "C"]);
      expect(plan.shots[1]).toMatchObject({ index: 1, camera: "tracking side", durationSec: 5 });
    });

    it("repairs truncated output and extracts objects as last resort", () => {
      const cut = MALFORMED.slice(0, MALFORMED.indexOf('{"title": "C"') + 40);
      expect(parseStoryPlan(cut, { shotCount: 3, durationSec: 5, strict: false }).plan.shots.length).toBeGreaterThanOrEqual(2);
      const loose = 'Cảnh 1: {"title":"X","prompt":"p1"} rồi cảnh 2: {"title":"Y","prompt":"p2",} hết.';
      expect(parseStoryPlan(loose, { shotCount: 3, durationSec: 5, strict: false }).plan.shots.map((s) => s.prompt)).toEqual(["p1", "p2"]);
    });

    it("clamps shot count, forces duration, rejects < 2 shots", () => {
      const { plan } = parseStoryPlan(GOOD, { shotCount: 2, durationSec: 5 });
      expect(plan.shots).toHaveLength(2);
      expect(plan.shots.every((s) => s.durationSec === 5)).toBe(true);
      expect(() => parseStoryPlan('{"shots":[{"prompt":"one"}]}', { shotCount: 3, durationSec: 5 })).toThrow();
      expect(() => parseStoryPlan("xin lỗi", { shotCount: 3, durationSec: 5 })).toThrow();
    });

    it("bỏ cảnh trùng và đòi đủ số cảnh khác nhau", () => {
      const dup = '{"shots":[{"prompt":"Boat drifts."},{"prompt":"Boat reaches river."},{"prompt":"boat drifts"}]}';
      expect(() => parseStoryPlan(dup, { shotCount: 3, durationSec: 5 })).toThrow(/2\/3/);
      expect(parseStoryPlan(dup, { shotCount: 3, durationSec: 5, strict: false }).plan.shots.map((s) => s.prompt)).toEqual([
        "Boat drifts.",
        "Boat reaches river.",
      ]);
    });
  });

  it("create holds plan cost; plan in main chat charges it", async () => {
    const story = await createStory(userId, { idea: "cáo đỏ", aspect: "9:16", shotCount: 3, shotDurationSec: 5 });
    expect(story.status).toBe("PLANNING");
    expect(storyQueue.add).toHaveBeenCalledWith("plan", { storyId: story.id, action: "plan" }, expect.anything());
    expect(await balance()).toEqual({ available: "19.50", held: "0.50" });

    const seen: { threadKey?: string; prompt: string; system?: string }[] = [];
    const muse: ProviderRun = async (a) => {
      seen.push(a);
      return MALFORMED;
    };
    await planStory(story.id, { setting: gateway, runners: { muse } });
    const { story: done } = await getStory(userId, story.id);
    expect(done.status).toBe("READY");
    expect((done.plan as { shots: unknown[] }).shots).toHaveLength(3);
    expect(done.title).toBe("Mèo cam phiêu lưu");
    expect(seen).toHaveLength(1);
    expect(seen[0].threadKey).toBe(`story:${story.id}`);
    expect(seen[0].system).toContain('"shots"');
    expect(seen[0].prompt).toContain("cáo đỏ");
    expect(await balance()).toEqual({ available: "19.50", held: "0.00" });
  });

  it("unparseable answer → one follow-up in the same thread, then next provider", async () => {
    const story = await createStory(userId, { idea: "x", aspect: "9:16", shotCount: 3, shotDurationSec: 5 });
    const calls: { prompt: string; threadKey?: string }[] = [];
    const muse: ProviderRun = async (a) => {
      calls.push(a);
      return a.prompt.startsWith(PLAN_FOLLOW_UP) ? GOOD : "Tôi sẽ kể một câu chuyện...";
    };
    const agy: ProviderRun = vi.fn(async () => GOOD);
    await planStory(story.id, { setting: gateway, runners: { muse, agy } });
    expect(calls.map((c) => c.prompt.slice(0, 20))).toEqual([expect.any(String), PLAN_FOLLOW_UP.slice(0, 20)]);
    expect(calls[1].threadKey).toBe(`story:${story.id}`);
    expect(agy).not.toHaveBeenCalled();
    expect((await getStory(userId, story.id)).story.status).toBe("READY");

    const second = await createStory(userId, { idea: "y", aspect: "9:16", shotCount: 3, shotDurationSec: 5 });
    await planStory(second.id, { setting: gateway, runners: { muse: async () => "không có json", agy } });
    expect(agy).toHaveBeenCalledTimes(1);
    expect((await getStory(userId, second.id)).story.status).toBe("READY");
  });

  it("planning failure refunds plan cost", async () => {
    const story = await createStory(userId, { idea: "x", aspect: "9:16", shotCount: 3, shotDurationSec: 5 });
    const fail = async () => {
      throw new Error("down");
    };
    await planStory(story.id, { setting: gateway, runners: { muse: fail, agy: fail, codex: fail } });
    const { story: s } = await getStory(userId, story.id);
    expect(s).toMatchObject({ status: "FAILED", error: "PLAN_FAILED" });
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
  });

  it("rejects plan limits up front (free: 10 s shots)", async () => {
    await expect(createStory(userId, { idea: "x", aspect: "9:16", shotCount: 3, shotDurationSec: 10 })).rejects.toMatchObject({
      code: "PLAN_DURATION",
    });
    expect(await db.story.count()).toBe(0);
  });

  it("PARALLEL render holds credit per shot and enqueues all (story counts as 1 concurrent task)", async () => {
    const story = await readyStory();
    const res = await renderStory(userId, story.id);
    expect(res.story.status).toBe("RENDERING");
    const jobs = await shotJobs(story.id);
    expect(jobs.map((j) => j.shotIndex)).toEqual([0, 1, 2]);
    expect(jobs.every((j) => j.status === "PENDING" && j.queuedAt && j.cost.toFixed(2) === "3.00")).toBe(true);
    expect(jobs[0].prompt).toContain("slow dolly in");
    expect(jobs[2].prompt).toContain("a red fox rests");
    expect(queues.muse.add).toHaveBeenCalledTimes(3);
    // Free: maxConcurrent 1, nhưng cả story chỉ tính 1 tác vụ.
    expect(await balance()).toEqual({ available: "10.50", held: "9.00" });
    await expect(renderStory(userId, story.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("render without enough credit creates nothing", async () => {
    await setSetting("story", { planCost: 0, maxShots: 8, planner: "muse" });
    const story = await createStory(userId, { idea: "x", aspect: "9:16", shotCount: 8, shotDurationSec: 5 });
    await planStory(story.id, {
      setting: gateway,
      runners: { muse: async () => JSON.stringify({ shots: Array.from({ length: 8 }, (_, i) => ({ prompt: `p${i}` })) }) },
    });
    await expect(renderStory(userId, story.id)).rejects.toMatchObject({ code: "INSUFFICIENT_CREDIT" });
    expect(await shotJobs(story.id)).toHaveLength(0);
    expect((await getStory(userId, story.id)).story).toMatchObject({ status: "READY", error: "INSUFFICIENT_CREDIT" });
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
  });

  it("CHAIN enqueues shot k+1 only after shot k with its last frame, then auto-assembles", async () => {
    const story = await readyStory({ mode: "CHAIN", autoAssemble: true });
    await renderStory(userId, story.id);
    let jobs = await shotJobs(story.id);
    expect(jobs.map((j) => Boolean(j.queuedAt))).toEqual([true, false, false]);
    expect(queues.muse.add).toHaveBeenCalledTimes(1);
    expect(await balance()).toEqual({ available: "10.50", held: "9.00" });

    await advanceStory(story.id);
    expect(queues.muse.add).toHaveBeenCalledTimes(1);

    await succeed(jobs[0]);
    await advanceStory(story.id);
    await advanceStory(story.id);
    jobs = await shotJobs(story.id);
    expect(queues.muse.add).toHaveBeenCalledTimes(2);
    expect(jobs[1].queuedAt).not.toBeNull();
    expect(jobs[1].inputUrl).toMatch(new RegExp(`^/media/uploads/${userId}/story-${story.id}-f0-`));
    expect((jobs[1].params as { inputUrl?: string }).inputUrl).toBe(jobs[1].inputUrl);
    expect(jobs[2].queuedAt).toBeNull();

    await succeed(jobs[1]);
    await advanceStory(story.id);
    await succeed((await shotJobs(story.id))[2]);
    await advanceStory(story.id);

    const assemble = await db.job.findFirstOrThrow({ where: { storyId: story.id, kind: "ASSEMBLE" } });
    expect((assemble.params as { clips: { jobId: string }[] }).clips.map((c) => c.jobId)).toEqual(jobs.map((j) => j.id));
    expect(queues.post.add).toHaveBeenCalledTimes(1);
    expect((await getStory(userId, story.id)).story.status).toBe("ASSEMBLING");

    await succeed(assemble);
    await advanceStory(story.id);
    const { story: done } = await getStory(userId, story.id);
    expect(done).toMatchObject({ status: "DONE", finalJobId: assemble.id });
    expect(done.cover).toBe(jobs[0].resultUrls[0] ?? (await shotJobs(story.id))[0].resultUrls[0]);
  });

  it("failed shot → FAILED, retry shot → RENDERING with a new job; manual assemble", async () => {
    const story = await readyStory();
    await renderStory(userId, story.id);
    const jobs = await shotJobs(story.id);
    await succeed(jobs[0]);
    await succeed(jobs[2]);
    await db.job.update({ where: { id: jobs[1].id }, data: { status: "FAILED", error: "MUSE_FAILED" } });
    await advanceStory(story.id);
    expect((await getStory(userId, story.id)).story).toMatchObject({ status: "FAILED", error: "SHOT_FAILED" });
    await expect(assembleStory(userId, story.id)).rejects.toMatchObject({ code: "CONFLICT" });

    const { job } = await retryShot(userId, story.id, 1);
    expect(job.shotIndex).toBe(1);
    expect((await getStory(userId, story.id)).story.status).toBe("RENDERING");
    await expect(retryShot(userId, story.id, 0)).rejects.toMatchObject({ code: "CONFLICT" });
    const visible = await shotJobs(story.id);
    expect(visible.map((j) => j.id)).toEqual([jobs[0].id, job.id, jobs[2].id]);

    await succeed(job);
    await advanceStory(story.id);
    expect((await getStory(userId, story.id)).story.status).toBe("DONE");
    const { job: assemble } = await assembleStory(userId, story.id);
    expect(assemble.kind).toBe("ASSEMBLE");
    expect((await getStory(userId, story.id)).story.status).toBe("ASSEMBLING");
  });

  it("cancel story cancels pending shots and refunds", async () => {
    const story = await readyStory({ mode: "CHAIN" });
    await renderStory(userId, story.id);
    await cancelStory(userId, story.id);
    expect(await db.job.count({ where: { storyId: story.id, status: "CANCELED" } })).toBe(3);
    expect(await balance()).toEqual({ available: "19.50", held: "0.00" });
    await expect(getStory(userId, story.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cancel while planning refunds plan cost and ignores late plan", async () => {
    const story = await createStory(userId, { idea: "x", aspect: "9:16", shotCount: 3, shotDurationSec: 5 });
    await cancelStory(userId, story.id);
    await planStory(story.id, { setting: gateway, runners: { muse: async () => GOOD } });
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
    expect((await db.story.findUniqueOrThrow({ where: { id: story.id } })).status).toBe("CANCELED");
  });

  it("sweepStories fails stuck planning with refund", async () => {
    const story = await createStory(userId, { idea: "x", aspect: "9:16", shotCount: 3, shotDurationSec: 5 });
    expect(await sweepStories(new Date())).toBe(0);
    expect(await sweepStories(new Date(Date.now() + 16 * 60_000))).toBe(1);
    expect((await getStory(userId, story.id)).story).toMatchObject({ status: "FAILED", error: "TIMEOUT" });
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
  });

  it("autoRun renders right after planning", async () => {
    const story = await readyStory({ autoRun: true });
    expect((await getStory(userId, story.id)).story.status).toBe("RENDERING");
    expect(await shotJobs(story.id)).toHaveLength(3);
  });
});
