import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { User } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { storagePath } from "@/lib/storage";
import { MuseScheduler } from "@/server/engines/muse-scheduler";
import { EngineError, type FileEngine, type MediaRequest } from "@/server/engines/types";
import { syncModels, verifyModel } from "@/server/services/model-catalog";
import { effortBadge, prettyModelName, sortByVendor, vendorOf } from "@/server/services/model-naming";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const current: { user: User | null } = { user: null };
vi.mock("@/lib/auth", async () => {
  const { AppError } = await import("@/lib/errors");
  return {
    requireAdmin: async () => {
      if (!current.user) throw new AppError("UNAUTHORIZED", "Vui lòng đăng nhập");
      if (current.user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Bạn không có quyền truy cập");
      return current.user;
    },
  };
});

const SAMPLE_PNG = path.resolve("tests/fixtures/sample.png");
const SAMPLE_MP4 = path.resolve("tests/fixtures/sample.mp4");

const agyModels = async () => [{ id: "gemini-3.8-flash-low" }, { id: "gemini-3.8-flash-high" }, { id: "claude-opus-5-5-medium" }, { id: "gemini-4-argon-low" }];
const codexModels = async () => ({
  profiles: ["default", "acc5"],
  models: [
    { id: "gpt-6.1-sol", hidden: false, profiles: ["default", "acc5"] },
    { id: "gpt-daybreak-mini", hidden: false, profiles: ["acc5"] },
    { id: "gpt-reserve", hidden: true, profiles: ["default"] },
  ],
});

async function tempOut(src: string): Promise<string> {
  const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}${path.extname(src)}`);
  await fs.copyFile(src, out);
  return out;
}

const okEngine = (seen: MediaRequest[] = []): FileEngine => ({
  async generate(req) {
    seen.push(req);
    return { files: [await tempOut(SAMPLE_PNG)] };
  },
});

describe("model naming", () => {
  it("tên đẹp + hãng + nhãn effort", () => {
    expect(prettyModelName("gemini-3.8-flash-low")).toBe("Gemini 3.8 Flash");
    expect(prettyModelName("gemini-4-argon-low")).toBe("Gemini 4 Argon");
    expect(prettyModelName("claude-sonnet-5-5-low")).toBe("Claude Sonnet 5.5");
    expect(prettyModelName("claude-opus-5-5-high")).toBe("Claude Opus 5.5");
    expect(prettyModelName("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(prettyModelName("gpt-5.5")).toBe("GPT-5.5");
    expect(prettyModelName("gpt-6-chat-thinking")).toBe("GPT-6 Chat Thinking");
    expect(prettyModelName("gpt-daybreak-mini")).toBe("GPT Daybreak Mini");
    expect(prettyModelName("muse-image")).toBe("Muse Image");
    expect(effortBadge("gemini-3.8-flash-low")).toBe("Nhanh");
    expect(effortBadge("gemini-3.8-flash-medium")).toBe("Cân bằng");
    expect(effortBadge("claude-opus-5-5-high")).toBe("Kỹ");
    expect(effortBadge("gpt-6.1-sol")).toBe("");
    expect(vendorOf("AGY", "gemini-3.8-flash-low")).toBe("google");
    expect(vendorOf("AGY", "claude-opus-5-5-low")).toBe("anthropic");
    expect(vendorOf("CODEX", "gpt-6-luna")).toBe("openai");
    expect(vendorOf("CODEX", "codex-mini")).toBe("openai");
    expect(vendorOf("MUSE", "muse-video")).toBe("muse");
    expect(vendorOf("LOCAL", "assemble")).toBe("local");
    expect(sortByVendor([
      { vendor: "openai", sort: 1, name: "a" },
      { vendor: "muse", sort: 9, name: "b" },
      { vendor: "anthropic", sort: 0, name: "c" },
      { vendor: "google", sort: 2, name: "d" },
      { vendor: "google", sort: 1, name: "e" },
    ]).map((r) => r.name)).toEqual(["b", "e", "d", "c", "a"]);
  });
});

describe("model catalog: sync + verify", () => {
  let server: Server;
  let baseUrl: string;
  let admin: User;

  beforeAll(async () => {
    const mp4 = await fs.readFile(SAMPLE_MP4);
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(mp4);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await resetDb();
    await seed();
    admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    current.user = admin;
    const keys = await redis.keys("am:test:model:verify:*");
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await redis.quit();
    await db.$disconnect();
  });

  it("đồng bộ: tạo dòng synced tắt, tên đẹp + hãng + badge, không đụng dòng có sẵn, chạy lại không tạo trùng", async () => {
    const before = await db.aiModel.count();
    const r = await syncModels({ agyModels, codexModels });
    expect(r.errors).toEqual({});
    // Có sẵn: muse-image, muse-video, gemini-3.8-flash-low, gemini-4-argon-low, gpt-6.1-sol (= Codex Ảnh).
    expect(r.existing).toBe(5);
    expect(r.created).toBe(3);
    expect(await db.aiModel.count()).toBe(before + 3);
    const high = await db.aiModel.findUniqueOrThrow({ where: { name: "agy:gemini-3.8-flash-high:IMAGE" } });
    expect(high).toMatchObject({ enabled: false, source: "synced", vendor: "google", displayName: "Gemini 3.8 Flash", badge: "Kỹ", provider: "AGY", kind: "IMAGE", minPlanRank: 0 });
    const opus = await db.aiModel.findUniqueOrThrow({ where: { name: "agy:claude-opus-5-5-medium:IMAGE" } });
    expect(opus).toMatchObject({ vendor: "anthropic", displayName: "Claude Opus 5.5", badge: "Cân bằng" });
    const day = await db.aiModel.findUniqueOrThrow({ where: { name: "codex:gpt-daybreak-mini:IMAGE" } });
    expect(day).toMatchObject({ vendor: "openai", displayName: "GPT Daybreak Mini", minPlanRank: 1, enabled: false, description: "Chỉ có ở profile codex: acc5" });
    expect(day.baseCost.toNumber()).toBe(2);
    expect(await db.aiModel.findFirst({ where: { engineModel: "gpt-reserve" } })).toBeNull();
    expect(await db.aiModel.count({ where: { provider: "CODEX", engineModel: "gpt-6.1-sol" } })).toBe(1);
    const sol = await db.aiModel.findUniqueOrThrow({ where: { name: "Codex Ảnh" } });
    expect(sol.enabled).toBe(true);

    const again = await syncModels({ agyModels, codexModels });
    expect(again).toMatchObject({ created: 0, existing: 8 });
    expect(await db.aiModel.count()).toBe(before + 3);
  });

  it("đồng bộ: agy lỗi vẫn đồng bộ phần còn lại, báo lỗi theo provider", async () => {
    const r = await syncModels({
      agyModels: async () => {
        throw new Error("agy ACP không khởi động được");
      },
      codexModels,
    });
    expect(r.errors.agy).toContain("ACP");
    expect(r.created).toBe(1);
  });

  it("POST /api/admin/models/sync chỉ cho admin", async () => {
    const route = await import("@/app/api/admin/models/sync/route");
    current.user = await db.user.create({ data: { email: "u@test.local", name: "U" } });
    expect((await route.POST()).status).toBe(403);
  });

  it("test vẽ ảnh: đúng engineModel, 1:1, lưu ảnh mẫu + verified ok; ảnh mẫu cũ bị xóa khi test lại", async () => {
    const model = await db.aiModel.findUniqueOrThrow({ where: { name: "agy:claude-opus-5-5-low:IMAGE" } });
    const seen: MediaRequest[] = [];
    const txBefore = await db.creditTransaction.count();
    const r = await verifyModel(model.id, { engines: { AGY: okEngine(seen) } });
    expect(seen[0]).toMatchObject({ kind: "image", engineModel: "claude-opus-5-5-low", aspectRatio: "1:1", imageCount: 1 });
    expect(r.verified).toMatchObject({ ok: true });
    expect(r.verified.ms).toBeGreaterThanOrEqual(0);
    expect(r.verified.sampleUrl).toMatch(new RegExp(`^/media/models/${model.id}/sample-\\d+\\.png$`));
    await fs.access(storagePath(r.verified.sampleUrl!.slice("/media/".length)));
    expect((await db.aiModel.findUniqueOrThrow({ where: { id: model.id } })).verified).toMatchObject({ ok: true, sampleUrl: r.verified.sampleUrl });
    // Không trừ Credit, không tạo job.
    expect(await db.job.count()).toBe(0);
    expect(await db.creditTransaction.count()).toBe(txBefore);

    await new Promise((res) => setTimeout(res, 5));
    const again = await verifyModel(model.id, { engines: { AGY: okEngine() } });
    expect(again.verified.sampleUrl).not.toBe(r.verified.sampleUrl);
    await expect(fs.access(storagePath(r.verified.sampleUrl!.slice("/media/".length)))).rejects.toThrow();
  });

  it("test vẽ lỗi: verified.ok=false + mã lỗi (QUOTA, NO_IMAGE), qua route", async () => {
    const model = await db.aiModel.findUniqueOrThrow({ where: { name: "Codex Ảnh" } });
    const quota: FileEngine = {
      async generate() {
        throw new EngineError("QUOTA", "Tài khoản Codex hết lượt.");
      },
    };
    const r = await verifyModel(model.id, { engines: { CODEX: quota } });
    expect(r.verified).toMatchObject({ ok: false, error: "QUOTA: Tài khoản Codex hết lượt." });
    expect(r.verified.sampleUrl).toBeUndefined();
    const stored = (await db.aiModel.findUniqueOrThrow({ where: { id: model.id } })).verified as { ok: boolean; error: string };
    expect(stored.ok).toBe(false);

    const empty: FileEngine = { generate: async () => ({ files: [] }) };
    expect((await verifyModel(model.id, { engines: { CODEX: empty } })).verified.error).toMatch(/^NO_IMAGE/);

    const route = await import("@/app/api/admin/models/[id]/verify/route");
    current.user = await db.user.create({ data: { email: "u2@test.local", name: "U" } });
    const res = await route.POST(new Request("http://localhost"), { params: Promise.resolve({ id: model.id }) });
    expect(res.status).toBe(403);
  });

  it("không chạy 2 lần test cùng 1 dòng cùng lúc", async () => {
    const model = await db.aiModel.findUniqueOrThrow({ where: { name: "agy:gemini-3.8-flash-low:IMAGE" } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: FileEngine = {
      async generate() {
        await gate;
        return { files: [await tempOut(SAMPLE_PNG)] };
      },
    };
    const first = verifyModel(model.id, { engines: { AGY: slow } });
    await new Promise((r) => setTimeout(r, 50));
    const second = await verifyModel(model.id, { engines: { AGY: okEngine() } }).catch((e) => e);
    expect(second.code).toBe("CONFLICT");
    release();
    expect((await first).verified.ok).toBe(true);
    // Xong thì test lại được.
    expect((await verifyModel(model.id, { engines: { AGY: okEngine() } })).verified.ok).toBe(true);
  });

  it("test video Muse 5 s: ghim tài khoản, giữ slot, tải file về storage", async () => {
    const model = await db.aiModel.findUniqueOrThrow({ where: { name: "MUSE Video" } });
    await db.aiModel.update({ where: { id: model.id }, data: { options: { ...(model.options as object), museAccount: "acc2" } } });
    const submitted: MediaRequest[] = [];
    let polls = 0;
    const muse = {
      authHeaders: { Authorization: "Bearer x" },
      submit: async (req: MediaRequest) => {
        submitted.push(req);
        return { taskId: "t1" };
      },
      getTask: async () => (++polls < 2 ? { status: "running" as const, urls: [], progress: 50 } : { status: "succeeded" as const, urls: [`${baseUrl}/v.mp4`], progress: 100 }),
    };
    const scheduler = new MuseScheduler({ prefix: `am:test:mc:${randomUUID()}:`, slots: async () => ({ image: 1, video: 1, chat: 1, gapSec: 0, sendVideoAspect: true }) });
    const r = await verifyModel(model.id, { muse, scheduler, pollMs: 5 });
    expect(submitted[0]).toMatchObject({ kind: "video", engineModel: "muse-video", durationSec: 5, museAccount: "acc2" });
    expect(r.verified.ok).toBe(true);
    expect(r.verified.sampleUrl).toMatch(/\.mp4$/);
    expect(await scheduler.counts()).toEqual({ image: 0, video: 0, chat: 0 });

    const failing = { ...muse, getTask: async () => ({ status: "failed" as const, urls: [], progress: 0, error: "content refused", errorCode: "REFUSED" }) };
    expect((await verifyModel(model.id, { muse: failing, scheduler, pollMs: 5 })).verified).toMatchObject({ ok: false, error: "REFUSED: content refused" });
  });

  it("model ghép video không test được; id lạ → 404", async () => {
    const asm = await db.aiModel.findUniqueOrThrow({ where: { name: "Ghép video" } });
    expect((await verifyModel(asm.id).catch((e) => e)).code).toBe("VALIDATION");
    expect((await verifyModel("khong-co").catch((e) => e)).code).toBe("NOT_FOUND");
  });

  it("PATCH /api/admin/models/:id sửa trường hiển thị mới", async () => {
    const route = await import("@/app/api/admin/models/[id]/route");
    const model = await db.aiModel.findUniqueOrThrow({ where: { name: "Gemini Ảnh" } });
    const res = await route.PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ displayName: "Gemini Flash Medium", badge: "Cân bằng", etaSec: 40, vendor: "google", description: "x" }) }),
      { params: Promise.resolve({ id: model.id }) },
    );
    expect(res.status).toBe(200);
    expect(await db.aiModel.findUniqueOrThrow({ where: { id: model.id } })).toMatchObject({ displayName: "Gemini Flash Medium", badge: "Cân bằng", etaSec: 40, description: "x" });
    const bad = await route.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ vendor: "xai" }) }), { params: Promise.resolve({ id: model.id }) });
    expect(bad.status).toBe(400);
  });
});
