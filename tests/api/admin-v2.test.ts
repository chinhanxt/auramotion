import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { User } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { anyQueue, queues, storyQueue } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { clearVideoBlocked, getVideoBlocked, setVideoBlocked } from "@/server/engines/muse-block";
import { finishJob } from "@/server/services/job";
import { startFree } from "@/server/services/plan";
import { getSetting } from "@/server/services/settings";
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

// muse2api giả cho proxy /admin/*.
const museCalls: { method: string; url: string; auth?: string; body: string }[] = [];
let museServer: Server;
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

const ROUTES: Record<string, Record<string, unknown>> = {
  skills: await import("@/app/api/admin/skills/route"),
  "skills/[id]": await import("@/app/api/admin/skills/[id]/route"),
  "skills/[id]/test": await import("@/app/api/admin/skills/[id]/test/route"),
  "presets/[id]/cover": await import("@/app/api/admin/presets/[id]/cover/route"),
  stories: await import("@/app/api/admin/stories/route"),
  "stories/[id]": await import("@/app/api/admin/stories/[id]/route"),
  "muse/accounts": await import("@/app/api/admin/muse/accounts/route"),
  "muse/accounts/[id]": await import("@/app/api/admin/muse/accounts/[id]/route"),
  "muse/accounts/[id]/renew": await import("@/app/api/admin/muse/accounts/[id]/renew/route"),
  "muse/accounts/[id]/quota": await import("@/app/api/admin/muse/accounts/[id]/quota/route"),
  "muse/status": await import("@/app/api/admin/muse/status/route"),
  "muse/video-block/clear": await import("@/app/api/admin/muse/video-block/clear/route"),
  gateway: await import("@/app/api/admin/gateway/route"),
  "gateway/test": await import("@/app/api/admin/gateway/test/route"),
  queues: await import("@/app/api/admin/queues/route"),
  "queues/[name]/[action]": await import("@/app/api/admin/queues/[name]/[action]/route"),
  "jobs/[id]": await import("@/app/api/admin/jobs/[id]/route"),
  settings: await import("@/app/api/admin/settings/route"),
  ai: await import("@/app/api/admin/ai/route"),
  "ai/roles": await import("@/app/api/admin/ai/roles/route"),
  "ai/test": await import("@/app/api/admin/ai/test/route"),
  "ai/agy/login": await import("@/app/api/admin/ai/agy/login/route"),
  "ai/agy/login/finish": await import("@/app/api/admin/ai/agy/login/finish/route"),
  "ai/agy/switch": await import("@/app/api/admin/ai/agy/switch/route"),
  "ai/agy/accounts/[id]": await import("@/app/api/admin/ai/agy/accounts/[id]/route"),
  "ai/agy/proxy": await import("@/app/api/admin/ai/agy/proxy/route"),
  "ai/acp/restart": await import("@/app/api/admin/ai/acp/restart/route"),
  "ai/codex/login": await import("@/app/api/admin/ai/codex/login/route"),
  "ai/codex/login/[loginId]": await import("@/app/api/admin/ai/codex/login/[loginId]/route"),
  "ai/codex/logout": await import("@/app/api/admin/ai/codex/logout/route"),
  flow: await import("@/app/api/admin/flow/route"),
  "flow/jobs": await import("@/app/api/admin/flow/jobs/route"),
  "jobs/[id]/trace": await import("@/app/api/admin/jobs/[id]/trace/route"),
};
const jobTraceRoute = await import("@/app/api/jobs/[id]/trace/route");
const prewriteRoute = await import("@/app/api/ai/prewrite/route");
const presetsRoute = await import("@/app/api/admin/presets/route");
const exploreRoute = await import("@/app/api/explore/route");
const themesRoute = await import("@/app/api/themes/route");

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function call(route: string, method: string, body?: unknown, params: Record<string, string> = {}) {
  const handler = ROUTES[route][method] as Handler;
  const req = new Request(`http://localhost/api/admin/${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(req, { params: Promise.resolve(params) });
}

async function json(res: Response | Promise<Response>) {
  const r = await res;
  return { status: r.status, body: await r.json() };
}

let admin: User;
let member: User;

describe("admin v2 routes", () => {
  beforeAll(async () => {
    museServer = createServer(async (req, res) => {
      museCalls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body: await readBody(req) });
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/admin/tasks?limit=100") res.end(JSON.stringify({ data: [{ id: "a", status: "running" }, { id: "b", status: "succeeded" }] }));
      else res.end(JSON.stringify({ ok: true, data: [] }));
    });
    await new Promise<void>((r) => museServer.listen(0, "127.0.0.1", r));
    // getMuse() đọc env lúc tạo client lần đầu.
    process.env.MUSE_API_URL = `http://127.0.0.1:${(museServer.address() as AddressInfo).port}`;
    process.env.MUSE2API_ADMIN_KEY = "adm-key";
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const q of Object.values(queues)) vi.spyOn(q, "add").mockResolvedValue({} as never);
    vi.spyOn(storyQueue, "add").mockResolvedValue({} as never);
    museCalls.length = 0;
    await resetDb();
    await seed();
    admin = await db.user.findUniqueOrThrow({ where: { email: "admin@auramotion.local" } });
    member = await db.user.create({ data: { email: "m@test.local", name: "M" } });
    await startFree(member.id);
    current.user = admin;
  });

  afterAll(async () => {
    await clearVideoBlocked();
    await new Promise((r) => museServer.close(r));
    await Promise.all([...Object.values(queues), storyQueue].map((q) => q.close()));
    await redis.quit();
    await db.$disconnect();
  });

  it("every new admin route: 401 anonymous, 403 normal user", async () => {
    let checked = 0;
    const params = { id: "x", name: "story", action: "pause", loginId: "x" };
    for (const [who, status] of [
      [null, 401],
      [() => member, 403],
    ] as const) {
      current.user = who ? who() : null;
      for (const [route, mod] of Object.entries(ROUTES)) {
        for (const method of METHODS) {
          if (!mod[method]) continue;
          const res = await call(route, method, method === "GET" ? undefined : {}, params);
          expect(res.status, `${method} ${route}`).toBe(status);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2 * 24);
    expect(museCalls).toHaveLength(0);
  });

  it("skills CRUD", async () => {
    const base = { slug: "test-skill", name: "Thử", kind: "VIDEO", instructions: "rules", template: "{{idea}}" };
    const created = await json(call("skills", "POST", base));
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ slug: "test-skill", enabled: true, minPlanRank: 0 });
    expect((await json(call("skills", "POST", base))).status).toBe(409);
    expect((await json(call("skills", "POST", { ...base, slug: "Bad Slug" }))).status).toBe(400);
    const patched = await json(call("skills/[id]", "PATCH", { minPlanRank: 1, enabled: false }, { id: created.body.id }));
    expect(patched.body).toMatchObject({ minPlanRank: 1, enabled: false });
    const list = await json(call("skills", "GET"));
    expect(list.body.length).toBeGreaterThanOrEqual(11);
    expect((await json(call("skills/[id]", "DELETE", undefined, { id: created.body.id }))).body).toEqual({ deleted: true });
    expect((await json(call("skills/[id]", "DELETE", undefined, { id: created.body.id }))).status).toBe(404);
  });

  it("skill test via gateway (fake provider)", async () => {
    const { testSkill } = await import("@/server/services/admin-ops");
    const skill = await db.promptSkill.findUniqueOrThrow({ where: { slug: "story-continuous-flow" } });
    const out = await testSkill(
      skill.id,
      { idea: "mèo" },
      { setting: { order: ["codex"], timeoutSec: 5 }, runners: { codex: async () => '{"title":"t","shots":[]}' } },
    );
    expect(out).toMatchObject({ provider: "codex", data: { title: "t" } });
    expect(out.prompt).toContain("mèo");
  });

  it("preset new fields: cover must be a safe gradient or image URL; palette hex", async () => {
    const preset = await db.preset.findFirstOrThrow({ where: { slug: "son-mai" } });
    const ok = await json(
      presetsRoute.PATCH(
        new Request("http://x", {
          method: "PATCH",
          body: JSON.stringify({ id: preset.id, cover: "linear-gradient(90deg, #000, #fff)", palette: ["#000000", "#ffffff"], featured: true }),
        }),
      ),
    );
    expect(ok.body).toMatchObject({ featured: true, palette: ["#000000", "#ffffff"] });
    for (const bad of [{ cover: "linear-gradient(red, red); background: url(javascript:x)" }, { palette: ["red"] }]) {
      const res = await presetsRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ id: preset.id, ...bad }) }));
      expect(res.status).toBe(400);
    }
    const themes = await json(themesRoute.GET());
    expect(themes.body.styles.length).toBeGreaterThanOrEqual(18);
    expect(themes.body.cameras.length).toBeGreaterThanOrEqual(8);
    expect(themes.body.styles[0]).toHaveProperty("palette");
  });

  it("preset cover job is free and sets preset.cover on success", async () => {
    const preset = await db.preset.findFirstOrThrow({ where: { slug: "dong-ho" } });
    const res = await json(call("presets/[id]/cover", "POST", {}, { id: preset.id }));
    expect(res.status).toBe(200);
    const job = await db.job.findUniqueOrThrow({ where: { id: res.body.job.id } });
    expect(job.cost.toFixed(2)).toBe("0.00");
    expect(job.expiresAt).toBeNull();
    expect(await db.creditTransaction.count({ where: { jobId: job.id } })).toBe(0);
    await db.job.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date() } });
    const out = path.join(os.tmpdir(), `aura-out-cover-${Date.now()}.png`);
    await fs.copyFile(path.resolve("tests/fixtures/sample.png"), out);
    await finishJob(job.id, [{ path: out }]);
    expect((await db.preset.findUniqueOrThrow({ where: { id: preset.id } })).cover).toMatch(/^\/media\/results\//);
  });

  it("featured toggle feeds public explore", async () => {
    const model = await db.aiModel.findFirstOrThrow({ where: { kind: "IMAGE" } });
    const style = await db.preset.findFirstOrThrow({ where: { slug: "son-mai" } });
    const job = await db.job.create({
      data: {
        userId: member.id,
        modelId: model.id,
        kind: "IMAGE",
        prompt: "p",
        cost: 1,
        status: "SUCCEEDED",
        resultUrls: ["/media/results/x/0.png"],
        params: { presetId: style.id },
        finishedAt: new Date(),
      },
    });
    expect((await json(call("jobs/[id]", "PATCH", { featured: "yes" }, { id: job.id }))).status).toBe(400);
    expect((await json(call("jobs/[id]", "PATCH", { featured: true }, { id: job.id }))).body).toMatchObject({ featured: true });
    const explore = await json(exploreRoute.GET(new Request("http://x/api/explore")));
    expect(explore.body.items).toEqual([{ id: job.id, kind: "IMAGE", prompt: "p", resultUrls: ["/media/results/x/0.png"], presetName: style.name }]);
    expect(explore.body.nextCursor).toBeNull();
  });

  it("gateway get/put with validation and health", async () => {
    const got = await json(call("gateway", "GET"));
    expect(got.body.setting.order).toEqual(["agy", "codex", "muse"]);
    expect(got.body.health).toHaveProperty("muse");
    expect((await json(call("gateway", "PUT", { order: ["muse", "muse"], timeoutSec: 60 }))).status).toBe(400);
    expect((await json(call("gateway", "PUT", { order: [], timeoutSec: 60 }))).status).toBe(400);
    const put = await json(call("gateway", "PUT", { order: ["muse", "agy"], timeoutSec: 90, agyModel: "m" }));
    expect(put.body.setting).toMatchObject({ order: ["muse", "agy"], timeoutSec: 90 });
  });

  it("settings: muse_slots and story validated", async () => {
    expect((await json(call("settings", "PATCH", { muse_slots: { image: -1, video: 2, chat: 1, gapSec: 20, sendVideoAspect: false } }))).status).toBe(400);
    expect((await json(call("settings", "PATCH", { story: { planCost: -1, maxShots: 4 } }))).status).toBe(400);
    const ok = await json(
      call("settings", "PATCH", { muse_slots: { image: 1, video: 2, chat: 1, gapSec: 30, sendVideoAspect: false }, story: { planCost: 1, maxShots: 6 } }),
    );
    expect(ok.status).toBe(200);
    expect(await getSetting("story")).toMatchObject({ planCost: 1, maxShots: 6, planner: "muse" });
    expect(ok.body.muse_slots.gapSec).toBe(30);
  });

  it("queues: counts, pause/resume (mocked), unknown queue rejected", async () => {
    const q = anyQueue("story");
    const pause = vi.spyOn(q, "pause").mockResolvedValue();
    const resume = vi.spyOn(q, "resume").mockResolvedValue();
    vi.spyOn(q, "isPaused").mockResolvedValue(true);
    const list = await json(call("queues", "GET"));
    expect(list.body.queues.map((x: { name: string }) => x.name)).toEqual(["muse", "cli", "post", "story"]);
    expect(list.body.queues[0].counts).toHaveProperty("waiting");
    expect(list.body.museSlots).toHaveProperty("video");
    expect((await json(call("queues/[name]/[action]", "POST", {}, { name: "story", action: "pause" }))).body).toEqual({ name: "story", paused: true });
    await call("queues/[name]/[action]", "POST", {}, { name: "story", action: "resume" });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect((await call("queues/[name]/[action]", "POST", {}, { name: "nope", action: "pause" })).status).toBe(400);
    expect((await call("queues/[name]/[action]", "POST", {}, { name: "story", action: "drop" })).status).toBe(400);
  });

  it("muse proxy uses admin key; import / renew clear the video block", async () => {
    await setVideoBlocked("region");
    expect((await json(call("muse/accounts", "GET"))).status).toBe(200);
    expect(museCalls.at(-1)).toMatchObject({ method: "GET", url: "/admin/accounts", auth: "Bearer adm-key" });

    expect((await call("muse/accounts", "POST", { cookies: "" })).status).toBe(400);
    await call("muse/accounts", "POST", { label: "acc2", cookies: [{ name: "hatch_sess", value: "v" }] });
    expect(museCalls.at(-1)).toMatchObject({ method: "POST", url: "/admin/accounts" });
    expect(await getVideoBlocked()).toBeNull();

    await call("muse/accounts", "POST", { accounts: [{ cookies: { hatch_sess: "v" } }] });
    expect(museCalls.at(-1)?.url).toBe("/admin/accounts/import");

    await call("muse/accounts/[id]", "PATCH", { enabled: false }, { id: "acc_1" });
    expect(museCalls.at(-1)).toMatchObject({ method: "PATCH", url: "/admin/accounts/acc_1", body: '{"enabled":false}' });
    expect((await call("muse/accounts/[id]", "PATCH", {}, { id: "acc_1" })).status).toBe(400);
    expect((await call("muse/accounts/[id]", "DELETE", undefined, { id: "../x" })).status).toBe(400);

    await setVideoBlocked("region");
    await call("muse/accounts/[id]/renew", "POST", {}, { id: "acc_1" });
    expect(museCalls.at(-1)?.url).toBe("/admin/accounts/acc_1/renew");
    expect(await getVideoBlocked()).toBeNull();

    const quota = ROUTES["muse/accounts/[id]/quota"].GET as Handler;
    await quota(new Request("http://x/q?refresh=1"), { params: Promise.resolve({ id: "acc_1" }) });
    expect(museCalls.at(-1)?.url).toBe("/admin/accounts/acc_1/quota?refresh=true");

    const status = await json(call("muse/status", "GET"));
    expect(status.body.tasks).toEqual([{ id: "a", status: "running" }]);
    expect(status.body.videoBlocked).toBeNull();
  });

  it("muse PATCH passes kinds through ([] = mọi loại), rejects unknown kind", async () => {
    await call("muse/accounts/[id]", "PATCH", { kinds: ["video", "image", "video"] }, { id: "acc_1" });
    expect(museCalls.at(-1)).toMatchObject({ method: "PATCH", url: "/admin/accounts/acc_1" });
    expect(JSON.parse(museCalls.at(-1)!.body)).toEqual({ kinds: ["video", "image"] });
    await call("muse/accounts/[id]", "PATCH", { kinds: [] }, { id: "acc_1" });
    expect(JSON.parse(museCalls.at(-1)!.body)).toEqual({ kinds: [] });
    const n = museCalls.length;
    expect((await call("muse/accounts/[id]", "PATCH", { kinds: ["audio"] }, { id: "acc_1" })).status).toBe(400);
    expect(museCalls).toHaveLength(n);
  });

  it("gateway test: validates prompt, runs through providers", async () => {
    expect((await call("gateway/test", "POST", { prompt: " " })).status).toBe(400);
    expect((await call("gateway/test", "POST", { prompt: "x", provider: "gpt" })).status).toBe(400);
    const { testGateway } = await import("@/server/services/admin-ops");
    const res = await testGateway(
      { prompt: "chào", provider: "codex" },
      { setting: { order: ["agy", "codex"], timeoutSec: 5 }, runners: { codex: async ({ prompt }) => `ok:${prompt}`, agy: async () => "agy" } },
    );
    expect(res).toMatchObject({ text: "ok:chào", provider: "codex" });
    await expect(
      testGateway({ prompt: "x" }, { setting: { order: ["agy"], timeoutSec: 5 }, runners: { agy: async () => Promise.reject(new Error("down")) } }),
    ).rejects.toBeTruthy();
  });

  it("job detail, list filters (kind / featured) and ops snapshot", async () => {
    const { listAdminJobs } = await import("@/server/services/admin");
    const { getOpsSnapshot } = await import("@/server/services/admin-ops");
    const image = await db.aiModel.findFirstOrThrow({ where: { kind: "IMAGE" } });
    const base = { userId: member.id, modelId: image.id, kind: "IMAGE" as const, prompt: "p", cost: 1 };
    const a = await db.job.create({ data: { ...base, status: "SUCCEEDED", featured: true, finishedAt: new Date() } });
    await db.job.create({ data: { ...base, status: "SUCCEEDED", finishedAt: new Date() } });
    await db.job.create({ data: { ...base, status: "FAILED", error: "TIMEOUT", finishedAt: new Date() } });

    const detail = await json(call("jobs/[id]", "GET", undefined, { id: a.id }));
    expect(detail.body.job).toMatchObject({ id: a.id, featured: true, user: { email: "m@test.local" } });
    expect((await call("jobs/[id]", "GET", undefined, { id: "nope" })).status).toBe(404);

    expect((await listAdminJobs({ status: "SUCCEEDED", featured: "1" })).items.map((j) => j.id)).toEqual([a.id]);
    expect((await listAdminJobs({ status: "SUCCEEDED", featured: "0" })).total).toBe(1);
    expect((await listAdminJobs({ kind: "VIDEO" })).total).toBe(0);
    expect((await listAdminJobs({ pageSize: 2 })).items).toHaveLength(2);

    const snap = await getOpsSnapshot();
    expect(snap).toMatchObject({ jobsToday: 3, succeededToday: 2, failedToday: 1, successRate: 66.7 });
    expect(snap.users).toBeGreaterThanOrEqual(2);
    expect(snap.recentFailed[0]).toMatchObject({ error: "TIMEOUT", user: { email: "m@test.local" } });
  });

  it("music used by a pending assemble job cannot be deleted", async () => {
    const { deleteMusicTrack } = await import("@/server/services/admin");
    const model = await db.aiModel.findFirstOrThrow({ where: { kind: "ASSEMBLE" } });
    await db.job.create({
      data: { userId: member.id, modelId: model.id, kind: "ASSEMBLE", prompt: "", cost: 0, params: { kind: "assemble", musicId: "lofi-chill" } },
    });
    await expect(deleteMusicTrack("lofi-chill")).rejects.toMatchObject({ code: "CONFLICT" });
    await deleteMusicTrack("happy-clap");
  });

  it("admin stories list / detail / cancel", async () => {
    const { createStory } = await import("@/server/services/story");
    const story = await createStory(member.id, { idea: "x", aspect: "9:16", shotCount: 2, shotDurationSec: 5 });
    const list = await json(call("stories", "GET"));
    expect(list.body.items[0]).toMatchObject({ id: story.id, user: { email: "m@test.local" }, doneCount: 0 });
    const video = await db.aiModel.findFirstOrThrow({ where: { kind: "VIDEO" } });
    for (const [i, status] of (["SUCCEEDED", "RUNNING"] as const).entries()) {
      await db.job.create({ data: { userId: member.id, modelId: video.id, kind: "VIDEO", prompt: "s", cost: 2.5, status, storyId: story.id, shotIndex: i } });
    }
    // Quay lại cảnh 0 thành công thêm lần nữa + job ghép không có shotIndex: vẫn 1 cảnh xong.
    await db.job.create({ data: { userId: member.id, modelId: video.id, kind: "VIDEO", prompt: "s", cost: 2.5, status: "SUCCEEDED", storyId: story.id, shotIndex: 0 } });
    await db.job.create({ data: { userId: member.id, modelId: video.id, kind: "VIDEO", prompt: "s", cost: 0, status: "SUCCEEDED", storyId: story.id } });
    expect((await json(call("stories", "GET"))).body.items[0]).toMatchObject({ jobCount: 4, doneCount: 1, cost: 7.5 });
    expect((await json(call("stories/[id]", "GET", undefined, { id: story.id }))).body.story.id).toBe(story.id);
    expect((await call("stories/[id]", "DELETE", undefined, { id: story.id })).status).toBe(200);
    expect((await db.story.findUniqueOrThrow({ where: { id: story.id } })).status).toBe("CANCELED");
    expect((await json(call("stories/[id]", "GET", undefined, { id: story.id }))).body.story.status).toBe("CANCELED");
  });

  it("flow graph from real config, flow jobs + trace routes (owner only)", async () => {
    const { saveAiRoles, getAiRoles } = await import("@/server/ai/roles");
    await saveAiRoles({ ...(await getAiRoles()), writer: { chain: [{ provider: "agy", model: "gemini-3.8-flash-low" }, { provider: "codex", model: "gpt-6-luna", effort: "low" }], strategy: "race", timeoutSec: 30 } });
    const flow = await json(call("flow", "GET"));
    expect(flow.status).toBe(200);
    const nodes = flow.body.nodes as { id: string; kind: string; ai?: { provider: string; model?: string } }[];
    expect(nodes.find((n) => n.id === "writer:0")?.ai).toEqual({ provider: "agy", model: "gemini-3.8-flash-low" });
    expect(nodes.find((n) => n.id === "writer:1")?.ai).toMatchObject({ provider: "codex", model: "gpt-6-luna" });
    const models = await db.aiModel.findMany({ where: { enabled: true } });
    for (const m of models) expect(nodes.some((n) => n.id === `exec:${m.id}` && n.kind === "executor")).toBe(true);
    const edges = flow.body.edges as { from: string; to: string; label?: string }[];
    expect(edges).toContainEqual({ from: "skill", to: "writer:1", label: "race" });
    expect(flow.body.live).toMatchObject({ queues: expect.any(Object), slots: { limits: expect.any(Object), used: expect.any(Object) }, activeJobs: [] });

    const image = models.find((m) => m.kind === "IMAGE")!;
    const job = await db.job.create({
      data: { userId: member.id, modelId: image.id, kind: "IMAGE", prompt: "p", cost: 1, status: "SUCCEEDED", params: { trace: { createdAt: 1, doneAt: 2 } } },
    });
    const list = await json(call("flow/jobs", "GET"));
    expect(list.body.items.map((j: { id: string }) => j.id)).toContain(job.id);
    const tr = await json(call("jobs/[id]/trace", "GET", undefined, { id: job.id }));
    expect(tr.body).toMatchObject({ id: job.id, trace: { createdAt: 1, doneAt: 2 } });

    const own = (id: string) => (jobTraceRoute.GET as unknown as Handler)(new Request("http://localhost/api/jobs/x/trace"), { params: Promise.resolve({ id }) });
    current.user = member;
    expect((await json(own(job.id))).body).toMatchObject({ trace: { doneAt: 2 } });
    current.user = admin;
    expect((await own(job.id)).status).toBe(404);
    current.user = null;
    expect((await own(job.id)).status).toBe(401);
    const pw = (prewriteRoute.POST as unknown as (r: Request) => Promise<Response>)(
      new Request("http://localhost/api/ai/prewrite", { method: "POST", body: JSON.stringify({ idea: "x", kind: "image", aspect: "1:1" }) }),
    );
    expect((await pw).status).toBe(401);
  });

  it("ai roles PUT validates; ai test runs one provider with timing", async () => {
    expect((await call("ai/roles", "PUT", { writer: { chain: [] } })).status).toBe(400);
    const { getAiRoles } = await import("@/server/ai/roles");
    const ok = await json(call("ai/roles", "PUT", { ...(await getAiRoles()), cacheHours: 12 }));
    expect(ok.body.roles.cacheHours).toBe(12);
    expect((await call("ai/test", "POST", { provider: "gpt", idea: "x" })).status).toBe(400);
    const { testAi } = await import("@/server/services/ai-admin");
    const res = await testAi(
      { provider: "codex", model: "gpt-6-luna", effort: "low", idea: "mèo" },
      { runners: { codex: async ({ step }) => ({ text: `{"prompt":"${step.model}/${step.effort}"}`, model: step.model, breakdown: { modelMs: 3 } }) } },
    );
    expect(res).toMatchObject({ provider: "codex", model: "gpt-6-luna", breakdown: { modelMs: 3 }, text: '{"prompt":"gpt-6-luna/low"}' });
    expect(res.prompt).toContain("mèo");
    expect(res.ms).toBeGreaterThanOrEqual(0);
  });
});
