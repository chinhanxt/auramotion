import type { JobKind, User } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { loadSessionUser } from "@/server/services/account";
import { charge, getBalance, hold, refund } from "@/server/services/credit";
import { createOrder } from "@/server/services/payment";
import { getActivePlan, startFree } from "@/server/services/plan";
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

const { adminChangePlan, createModel, deletePreset, getCreditRules, getStats, setUserStatus, updateAdminSettings, updateModel } =
  await import("@/server/services/admin");
const catalogRoute = await import("@/app/api/catalog/route");
const creditsRoute = await import("@/app/api/admin/users/[id]/credits/route");
const modelsRoute = await import("@/app/api/admin/models/route");
const confirmRoute = await import("@/app/api/admin/payments/[id]/confirm/route");

const ADMIN_ROUTES: Record<string, Record<string, unknown>> = {
  stats: await import("@/app/api/admin/stats/route"),
  users: await import("@/app/api/admin/users/route"),
  "users/[id]": await import("@/app/api/admin/users/[id]/route"),
  "users/[id]/credits": creditsRoute,
  models: modelsRoute,
  plans: await import("@/app/api/admin/plans/route"),
  presets: await import("@/app/api/admin/presets/route"),
  music: await import("@/app/api/admin/music/route"),
  jobs: await import("@/app/api/admin/jobs/route"),
  "jobs/[id]": await import("@/app/api/admin/jobs/[id]/route"),
  payments: await import("@/app/api/admin/payments/route"),
  "payments/[id]/confirm": confirmRoute,
  settings: await import("@/app/api/admin/settings/route"),
  "engines/health": await import("@/app/api/admin/engines/health/route"),
};

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

let admin: User;
let member: User;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectAppError(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

async function modelId(name: string): Promise<string> {
  return (await db.aiModel.findUniqueOrThrow({ where: { name } })).id;
}

// Job đã chạy xong: giữ credit rồi trừ (hoặc hoàn) giống luồng worker.
async function finishedJob(opts: {
  userId: string;
  model: string;
  kind: JobKind;
  cost: number;
  createdAt: Date;
  seconds: number;
  outcome: "charge" | "refund";
}): Promise<void> {
  const startedAt = new Date(opts.createdAt.getTime() + 1000);
  const job = await db.job.create({
    data: {
      userId: opts.userId,
      modelId: await modelId(opts.model),
      kind: opts.kind,
      prompt: "p",
      cost: opts.cost,
      status: opts.outcome === "charge" ? "SUCCEEDED" : "FAILED",
      createdAt: opts.createdAt,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + opts.seconds * 1000),
    },
  });
  await db.$transaction((tx) => hold(tx, opts.userId, job.id, opts.cost));
  if (opts.outcome === "charge") await charge(job.id);
  else await refund(job.id);
  await db.creditTransaction.updateMany({ where: { jobId: job.id }, data: { createdAt: startedAt } });
}

describe("admin", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    admin = await db.user.findUniqueOrThrow({ where: { email: "admin@auramotion.local" } });
    member = await db.user.create({ data: { email: "member@test.local", name: "Member" } });
    await startFree(member.id);
    current.user = admin;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("every admin route rejects a normal user with 403", async () => {
    current.user = member;
    let checked = 0;
    for (const [path, mod] of Object.entries(ADMIN_ROUTES)) {
      for (const method of METHODS) {
        const handler = mod[method] as Handler | undefined;
        if (!handler) continue;
        const url = `http://localhost/api/admin/${path.replace("[id]", member.id)}`;
        const res = await handler(jsonRequest(url, method, method === "GET" ? undefined : {}), ctx(member.id));
        expect(res.status, `${method} ${path}`).toBe(403);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(Object.keys(ADMIN_ROUTES).length);
  });

  it("getStats counts users, jobs, credits, revenue, per model and per day", async () => {
    const now = new Date("2026-11-06T05:00:00Z"); // 12:00 giờ Việt Nam
    const day = 24 * 60 * 60 * 1000;
    const old = new Date(now.getTime() - 60 * day);
    await db.user.updateMany({ data: { createdAt: old } });
    const fresh = await db.user.create({ data: { email: "new@test.local", name: "New", createdAt: new Date(now.getTime() - 2 * day) } });
    await startFree(fresh.id);
    await db.user.create({ data: { email: "today@test.local", name: "Today", createdAt: new Date(now.getTime() - 3600_000) } });

    const pro = await db.user.create({ data: { email: "pro@test.local", name: "Pro", createdAt: old } });
    await startFree(pro.id);
    await adminChangePlan(pro.id, "pro", "MONTH");

    const today = new Date(now.getTime() - 2 * 3600_000);
    const yesterday = new Date(now.getTime() - day);
    await finishedJob({ userId: pro.id, model: "MUSE Ảnh", kind: "IMAGE", cost: 4, createdAt: today, seconds: 30, outcome: "charge" });
    await finishedJob({ userId: pro.id, model: "MUSE Ảnh", kind: "IMAGE", cost: 2, createdAt: yesterday, seconds: 50, outcome: "charge" });
    await finishedJob({ userId: pro.id, model: "MUSE Video", kind: "VIDEO", cost: 6, createdAt: yesterday, seconds: 120, outcome: "charge" });
    await finishedJob({ userId: pro.id, model: "Ghép video", kind: "ASSEMBLE", cost: 5, createdAt: today, seconds: 60, outcome: "charge" });
    // Hoàn credit: không tính vào credit đã tiêu, không tính là đã tạo.
    await finishedJob({ userId: pro.id, model: "MUSE Video", kind: "VIDEO", cost: 3, createdAt: today, seconds: 10, outcome: "refund" });
    // Ngoài khoảng 7 ngày.
    await finishedJob({ userId: pro.id, model: "MUSE Ảnh", kind: "IMAGE", cost: 1, createdAt: old, seconds: 5, outcome: "charge" });

    const paid = await createOrder(member.id, { type: "CREDIT", credits: 100 });
    await db.payment.update({ where: { id: paid.id }, data: { status: "SUCCEEDED", paidAt: yesterday } });
    const paidToday = await createOrder(member.id, { type: "CREDIT", credits: 500 });
    await db.payment.update({ where: { id: paidToday.id }, data: { status: "SUCCEEDED", paidAt: today } });
    await createOrder(member.id, { type: "CREDIT", credits: 1000 }); // PENDING: không tính
    const oldPaid = await createOrder(member.id, { type: "CREDIT", credits: 100 });
    await db.payment.update({ where: { id: oldPaid.id }, data: { status: "SUCCEEDED", paidAt: old } });

    const week = await getStats("7d", now);
    expect(week.newUsers).toBe(2);
    expect(week.images).toBe(2);
    expect(week.videos).toBe(1);
    expect(week.assembles).toBe(1);
    expect(week.creditsSpent).toBe(17);
    expect(week.revenue).toBe(49000 + 199000);
    expect(week.usersByPlan).toEqual([
      { code: "free", name: "Free", users: 3 },
      { code: "pro", name: "Pro", users: 1 },
      { code: "ultra", name: "Ultra", users: 0 },
    ]);
    const credits = Object.fromEntries(week.creditsByModel.map((m) => [m.name, m.credits]));
    expect(credits).toEqual({ "MUSE Ảnh": 6, "MUSE Video": 6, "Ghép video": 5 });
    expect(week.creditsByModel[0].modelId).toBe(await modelId("MUSE Ảnh"));
    const seconds = Object.fromEntries(week.avgSecondsByModel.map((m) => [m.name, m.seconds]));
    expect(seconds).toEqual({ "MUSE Ảnh": 40, "MUSE Video": 120, "Ghép video": 60 });

    expect(week.daily).toHaveLength(7);
    expect(week.daily[6]).toEqual({ date: "2026-11-06", images: 1, videos: 0, assembles: 1, revenue: 199000 });
    expect(week.daily[5]).toEqual({ date: "2026-11-05", images: 1, videos: 1, assembles: 0, revenue: 49000 });
    expect(week.daily[0].date).toBe("2026-10-31");

    const todayStats = await getStats("1d", now);
    expect(todayStats.daily).toHaveLength(1);
    expect(todayStats.images).toBe(1);
    expect(todayStats.creditsSpent).toBe(9);
    expect(todayStats.revenue).toBe(199000);
    expect(todayStats.newUsers).toBe(1);

    const stats = ADMIN_ROUTES.stats.GET as Handler;
    const res = await stats(new Request("http://localhost/api/admin/stats?range=30d"), ctx(""));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { daily: unknown[] }).daily).toHaveLength(30);
    expect((await stats(new Request("http://localhost/api/admin/stats?range=2d"), ctx(""))).status).toBe(400);
  });

  it("admin cannot lock self, locked user gets ACCOUNT_LOCKED", async () => {
    await expectAppError(setUserStatus(admin.id, "LOCKED", admin.id), "VALIDATION");
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).status).toBe("ACTIVE");

    const users = ADMIN_ROUTES["users/[id]"].PATCH as Handler;
    const self = await users(jsonRequest(`http://localhost/api/admin/users/${admin.id}`, "PATCH", { status: "LOCKED" }), ctx(admin.id));
    expect(self.status).toBe(400);

    const res = await users(jsonRequest(`http://localhost/api/admin/users/${member.id}`, "PATCH", { status: "LOCKED" }), ctx(member.id));
    expect(res.status).toBe(200);
    await expectAppError(loadSessionUser(member.id), "ACCOUNT_LOCKED");

    await setUserStatus(member.id, "ACTIVE", admin.id);
    expect((await loadSessionUser(member.id)).id).toBe(member.id);
  });

  it("adjust credit requires reason and goes through admin_adjust", async () => {
    const post = creditsRoute.POST as Handler;
    const url = `http://localhost/api/admin/users/${member.id}/credits`;
    const noReason = await post(jsonRequest(url, "POST", { amount: 50, reason: "   " }), ctx(member.id));
    expect(noReason.status).toBe(400);
    expect(((await noReason.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
    expect((await getBalance(member.id)).available.toFixed(2)).toBe("20.00");

    const ok = await post(jsonRequest(url, "POST", { amount: 50, reason: "Bù lỗi job" }), ctx(member.id));
    expect(ok.status).toBe(200);
    expect((await getBalance(member.id)).available.toFixed(2)).toBe("70.00");
    const txn = await db.creditTransaction.findFirstOrThrow({ where: { userId: member.id, type: "admin_adjust" } });
    expect(txn.actorId).toBe(admin.id);
    expect(txn.note).toBe("Bù lỗi job");

    const tooMuch = await post(jsonRequest(url, "POST", { amount: -100, reason: "Trừ" }), ctx(member.id));
    expect(tooMuch.status).toBe(402);
  });

  it("disable model hides it from catalog; model with jobs is only disabled on delete", async () => {
    current.user = admin;
    const videoId = await modelId("MUSE Video");
    const patch = modelsRoute.PATCH as Handler;
    const res = await patch(jsonRequest("http://localhost/api/admin/models", "PATCH", { id: videoId, enabled: false }), ctx(""));
    expect(res.status).toBe(200);

    current.user = member;
    const catalog = await catalogRoute.GET(new Request("http://localhost/api/catalog?kind=video"));
    expect(((await catalog.json()) as { models: unknown[] }).models).toEqual([]);

    current.user = admin;
    const imageId = await modelId("MUSE Ảnh");
    await db.job.create({ data: { userId: member.id, modelId: imageId, kind: "IMAGE", prompt: "p", cost: 1, status: "SUCCEEDED" } });
    const del = modelsRoute.DELETE as Handler;
    const kept = await del(new Request(`http://localhost/api/admin/models?id=${imageId}`, { method: "DELETE" }), ctx(""));
    expect(await kept.json()).toEqual({ deleted: false });
    expect((await db.aiModel.findUniqueOrThrow({ where: { id: imageId } })).enabled).toBe(false);

    const geminiId = await modelId("Gemini Ảnh");
    const gone = await del(new Request(`http://localhost/api/admin/models?id=${geminiId}`, { method: "DELETE" }), ctx(""));
    expect(await gone.json()).toEqual({ deleted: true });
    expect(await db.aiModel.findUnique({ where: { id: geminiId } })).toBeNull();
  });

  it("manual confirm fulfills once", async () => {
    const order = await createOrder(member.id, { type: "CREDIT", credits: 100 });
    const post = confirmRoute.POST as Handler;
    const url = `http://localhost/api/admin/payments/${order.id}/confirm`;
    const first = await post(jsonRequest(url, "POST"), ctx(order.id));
    expect(first.status).toBe(200);
    const second = await post(jsonRequest(url, "POST"), ctx(order.id));
    expect(second.status).toBe(409);
    expect((await getBalance(member.id)).purchased.toFixed(2)).toBe("100.00");
    const payment = await db.payment.findUniqueOrThrow({ where: { id: order.id } });
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.confirmedBy).toBe(admin.id);
    expect((await post(jsonRequest(url, "POST"), ctx("missing"))).status).toBe(404);
  });

  it("adminChangePlan switches to paid plan and back to free", async () => {
    await adminChangePlan(member.id, "ultra", "YEAR");
    expect((await getActivePlan(member.id)).plan.code).toBe("ultra");
    expect((await getBalance(member.id)).plan.toFixed(2)).toBe("2000.00");

    await adminChangePlan(member.id, "free", "MONTH");
    const { plan, subscription } = await getActivePlan(member.id);
    expect(plan.code).toBe("free");
    expect(subscription.endAt).toBeNull();
    expect((await getBalance(member.id)).plan.toFixed(2)).toBe("20.00");
    expect(await db.subscription.count({ where: { userId: member.id, status: "ACTIVE" } })).toBe(1);

    // Đang Free mà đổi sang Free: không cấp thêm credit.
    await adminChangePlan(member.id, "free", "MONTH");
    expect((await getBalance(member.id)).plan.toFixed(2)).toBe("20.00");
  });
  it("getCreditRules previews cost through quote", async () => {
    await updateAdminSettings({ voice_line_cost: 1.5 });
    await db.aiModel.update({ where: { name: "Codex Ảnh" }, data: { baseCost: 2.25 } });
    const { voiceLineCost, models } = await getCreditRules();
    expect(voiceLineCost).toBe(1.5);
    const byName = Object.fromEntries(models.map((m) => [m.name, m]));
    expect(byName["MUSE Ảnh"].previews).toEqual([
      { label: "1 ảnh", cost: 1 },
      { label: "2 ảnh", cost: 2 },
      { label: "4 ảnh", cost: 4 },
    ]);
    expect(byName["Codex Ảnh"].baseCost).toBe(2.25);
    expect(byName["Codex Ảnh"].previews.map((p) => p.cost)).toEqual([2.25, 4.5, 9]);
    expect(byName["MUSE Video"].previews).toEqual([
      { label: "5 giây", cost: 3 },
      { label: "10 giây", cost: 6 },
    ]);
    expect(byName["Ghép video"].previews).toEqual([
      { label: "0 câu", cost: 2 },
      { label: "3 câu", cost: 6.5 },
      { label: "6 câu", cost: 11 },
    ]);
  });

  it("model options that would break createJob are rejected", async () => {
    const imageId = await modelId("MUSE Ảnh");
    const base = { name: "Ảnh mới", provider: "MUSE", engineModel: "x", kind: "IMAGE", baseCost: 1 };
    await expect(createModel({ ...base, options: {} })).rejects.toThrow();
    await expect(createModel({ ...base, options: { aspectRatios: ["1:1"], counts: [] } })).rejects.toThrow();
    await expect(createModel({ ...base, options: { aspectRatios: ["1:1"], counts: [3] } })).rejects.toThrow();
    await expect(updateModel({ id: imageId, options: { aspectRatios: [], counts: [1] } })).rejects.toThrow();
    // Đổi loại sang VIDEO mà options cũ không có durations.
    await expect(updateModel({ id: imageId, kind: "VIDEO" })).rejects.toThrow();
    const patch = modelsRoute.PATCH as Handler;
    const res = await patch(jsonRequest("http://localhost/api/admin/models", "PATCH", { id: imageId, options: { aspectRatios: ["1:1"] } }), ctx(""));
    expect(res.status).toBe(400);
    expect((await db.aiModel.findUniqueOrThrow({ where: { id: imageId } })).options).toMatchObject({ counts: [1, 2, 4] });

    const created = await createModel({ ...base, options: { aspectRatios: ["1:1"], counts: [1, 2], extra: true } });
    expect(created.options).toEqual({ aspectRatios: ["1:1"], counts: [1, 2] });
    await updateModel({ id: imageId, options: { aspectRatios: ["1:1"], counts: [1] } });
    expect((await db.aiModel.findUniqueOrThrow({ where: { id: imageId } })).options).toEqual({ aspectRatios: ["1:1"], counts: [1] });
  });

  it("credit packs must have a positive price", async () => {
    await expect(updateAdminSettings({ credit_packs: [{ credits: 100, price: 0 }] })).rejects.toThrow();
    await expect(updateAdminSettings({ credit_packs: [{ credits: 100, price: -1 }] })).rejects.toThrow();
    await expect(updateAdminSettings({ credit_packs: [] })).rejects.toThrow();
  });

  it("preset used by a job is only disabled on delete", async () => {
    const used = await db.preset.create({ data: { kind: "STYLE", name: "Dùng rồi", promptSuffix: "a" } });
    const unused = await db.preset.create({ data: { kind: "STYLE", name: "Chưa dùng", promptSuffix: "b" } });
    await db.job.create({
      data: {
        userId: member.id,
        modelId: await modelId("MUSE Ảnh"),
        kind: "IMAGE",
        prompt: "p",
        cost: 1,
        status: "FAILED",
        params: { kind: "image", presetId: used.id },
      },
    });
    expect(await deletePreset(used.id)).toEqual({ deleted: false });
    expect((await db.preset.findUniqueOrThrow({ where: { id: used.id } })).enabled).toBe(false);
    expect(await deletePreset(unused.id)).toEqual({ deleted: true });
    expect(await db.preset.findUnique({ where: { id: unused.id } })).toBeNull();
    await expectAppError(deletePreset(unused.id), "NOT_FOUND");
  });
});
