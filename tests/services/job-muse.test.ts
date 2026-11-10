import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { User } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { queues, storyQueue } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { HttpMuseClient, type MuseTaskView } from "@/server/engines/muse";
import { clearVideoBlocked, getVideoBlocked, setVideoBlocked } from "@/server/engines/muse-block";
import { MuseScheduler, SlotBusyError, type MuseSlots } from "@/server/engines/muse-scheduler";
import type { MediaRequest } from "@/server/engines/types";
import { getBalance } from "@/server/services/credit";
import { createJob, processJob } from "@/server/services/job";
import { startFree } from "@/server/services/plan";
import type { GenerationParams } from "@/server/services/pricing";
import { setSetting } from "@/server/services/settings";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const current: { user: User | null } = { user: null };

vi.mock("@/lib/auth", async () => {
  const { AppError } = await import("@/lib/errors");
  const requireUser = async () => {
    if (!current.user) throw new AppError("UNAUTHORIZED", "Vui lòng đăng nhập");
    return current.user;
  };
  return {
    requireUser,
    requireAdmin: async () => {
      const user = await requireUser();
      if (user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Bạn không có quyền truy cập");
      return user;
    },
  };
});

const catalogRoute = await import("@/app/api/catalog/route");
const clearRoute = await import("@/app/api/admin/muse/video-block/clear/route");
const statusRoute = await import("@/app/api/admin/muse/status/route");

const MP4 = path.resolve("tests/fixtures/sample.mp4");
let server: Server;
let baseUrl: string;
let body: Buffer;
let user: User;
let videoModel: string;
let slots: MuseSlots;

function scheduler() {
  return new MuseScheduler({ prefix: `am:test:jm:${Math.random().toString(36).slice(2)}:`, slots: async () => slots });
}

function videoParams(extra: Partial<Extract<GenerationParams, { kind: "video" }>> = {}): GenerationParams {
  return { kind: "video", modelId: videoModel, prompt: "a fox runs", aspectRatio: "9:16", durationSec: 5, ...extra };
}

function stub(tasks: Partial<MuseTaskView>[]) {
  const submitted: MediaRequest[] = [];
  let i = 0;
  return {
    submitted,
    muse: {
      authHeaders: {},
      submit: vi.fn(async (req: MediaRequest) => {
        submitted.push(req);
        return { taskId: "t1" };
      }),
      getTask: vi.fn(async () => ({ urls: [], progress: 0, status: "running", ...tasks[Math.min(i++, tasks.length - 1)] }) as MuseTaskView),
    },
  };
}

async function balance() {
  const b = await getBalance(user.id);
  return { available: b.available.toFixed(2), held: b.held.toFixed(2) };
}

describe("job MUSE video: scheduler, progress, media check, region block", () => {
  beforeAll(async () => {
    body = await fs.readFile(MP4);
    server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(req.url?.includes("broken") ? body.subarray(0, 5000) : body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const q of Object.values(queues)) vi.spyOn(q, "add").mockResolvedValue({} as never);
    vi.spyOn(storyQueue, "add").mockResolvedValue({} as never);
    await resetDb();
    await seed();
    await clearVideoBlocked();
    slots = { image: 2, video: 3, chat: 1, gapSec: 0, sendVideoAspect: true };
    user = await db.user.create({ data: { email: "jm@test.local", name: "JM" } });
    await startFree(user.id);
    current.user = user;
    videoModel = (await db.aiModel.findFirstOrThrow({ where: { name: "MUSE Video" } })).id;
  });

  afterAll(async () => {
    await clearVideoBlocked();
    await new Promise((r) => server.close(r));
    await Promise.all([...Object.values(queues), storyQueue].map((q) => q.close()));
    await redis.quit();
    await db.$disconnect();
  });

  it("stores real width/height/duration and progress; sends size when enabled", async () => {
    const job = await createJob(user.id, videoParams());
    const s = stub([{ status: "running", progress: 40 }, { status: "succeeded", urls: [`${baseUrl}/v/ok.mp4`] }]);
    await processJob(job.id, { muse: s.muse, pollMs: 1, scheduler: scheduler() });
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.progress).toBe(100);
    expect((done.params as { result?: unknown }).result).toEqual({ width: 320, height: 240, durationSec: 1 });
    expect(s.submitted[0].omitSize).toBeUndefined();
    expect(s.submitted[0].prompt).toBe("a fox runs");
  });

  it("sendVideoAspect=false omits size and adds a framing hint", async () => {
    slots = { ...slots, sendVideoAspect: false };
    const job = await createJob(user.id, videoParams());
    const s = stub([{ status: "succeeded", urls: [`${baseUrl}/v/ok.mp4`] }]);
    await processJob(job.id, { muse: s.muse, pollMs: 1, scheduler: scheduler() });
    expect(s.submitted[0]).toMatchObject({ omitSize: true, prompt: "a fox runs, vertical 9:16 framing" });
  });

  it("broken download → retryable BAD_MEDIA, job stays RUNNING to re-download", async () => {
    const job = await createJob(user.id, videoParams());
    const s = stub([{ status: "succeeded", urls: [`${baseUrl}/v/broken.mp4`] }]);
    await expect(processJob(job.id, { muse: s.muse, pollMs: 1, scheduler: scheduler() })).rejects.toMatchObject({ code: "BAD_MEDIA" });
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: "RUNNING", museTaskId: "t1", resultUrls: [] });
  });

  it("no free video slot → SlotBusyError before claiming", async () => {
    slots = { ...slots, video: 0 };
    const job = await createJob(user.id, videoParams());
    const s = stub([]);
    await expect(processJob(job.id, { muse: s.muse, pollMs: 1, scheduler: scheduler() })).rejects.toBeInstanceOf(SlotBusyError);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
    expect(s.muse.submit).not.toHaveBeenCalled();
  });

  it("region refusal → REGION_BLOCKED, refund, flag; then createJob and catalog block video until cleared", async () => {
    const job = await createJob(user.id, videoParams());
    const s = stub([
      {
        status: "failed",
        error: "upstream replied with text only: video generation isn't available for this account in your country or region",
        errorCode: "REGION_BLOCKED",
      },
    ]);
    await processJob(job.id, { muse: s.muse, pollMs: 1, scheduler: scheduler() });
    expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "FAILED", error: "REGION_BLOCKED" });
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
    expect((await getVideoBlocked())?.message).toContain("country or region");

    await expect(createJob(user.id, videoParams())).rejects.toMatchObject({ code: "MUSE_VIDEO_UNAVAILABLE", status: 503 });
    const cat = await (await catalogRoute.GET(new Request("http://x/api/catalog?kind=video"))).json();
    expect(cat.videoUnavailable).toBe(true);
    const img = await (await catalogRoute.GET(new Request("http://x/api/catalog?kind=image"))).json();
    expect(img.videoUnavailable).toBeUndefined();

    expect((await clearRoute.POST()).status).toBe(403);
    await db.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    current.user = { ...user, role: "ADMIN" };
    const st = await (await statusRoute.GET()).json();
    expect(st.videoBlocked?.message).toContain("country or region");
    expect((await clearRoute.POST()).status).toBe(200);
    expect(await getVideoBlocked()).toBeNull();
    expect((await createJob(user.id, videoParams())).status).toBe("PENDING");
  });

  it("muse client maps region refusal text to REGION_BLOCKED (task + HTTP)", async () => {
    const srv = createServer((req, res) => {
      if (req.method === "POST") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Video is not available in your region" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "t",
          status: "failed",
          progress: 55,
          error: { code: "upstream_refused", message: "video generation isn't available for this account in your country or region" },
        }),
      );
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const client = new HttpMuseClient(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`, "k");
    const task = await client.getTask("video", "t");
    expect(task).toMatchObject({ status: "failed", errorCode: "REGION_BLOCKED", progress: 55 });
    await expect(client.submit({ kind: "video", engineModel: "m", prompt: "p", aspectRatio: "9:16" })).rejects.toMatchObject({
      code: "REGION_BLOCKED",
      retryable: false,
    });
    await new Promise((r) => srv.close(r));
  });

  it("setVideoBlocked has a TTL", async () => {
    await setVideoBlocked("x");
    const ttl = await redis.ttl("am:test:muse:videoBlocked");
    expect(ttl).toBeGreaterThan(5 * 3600);
  });
});
