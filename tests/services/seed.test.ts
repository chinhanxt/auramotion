import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getBalance } from "@/server/services/credit";
import { getActivePlan } from "@/server/services/plan";
import { getSetting } from "@/server/services/settings";
import { seed, shortenModelNames } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

async function counts() {
  return {
    users: await db.user.count(),
    plans: await db.plan.count(),
    models: await db.aiModel.count(),
    presets: await db.preset.count(),
    skills: await db.promptSkill.count(),
    settings: await db.setting.count(),
    subscriptions: await db.subscription.count(),
    transactions: await db.creditTransaction.count(),
  };
}

describe("seed", () => {
  beforeAll(async () => {
    await resetDb();
    await seed();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("creates plans, engines, settings and admin", async () => {
    expect(await db.plan.count()).toBe(3);
    expect((await db.plan.findUnique({ where: { code: "free" } }))!.maxDurationSec).toBe(5);
    const enabled = await db.aiModel.findMany({ where: { enabled: true } });
    expect(enabled.map((m) => `${m.provider}:${m.kind}:${m.engineModel}`).sort()).toEqual(
      [
        "MUSE:IMAGE:muse-image",
        "AGY:IMAGE:gemini-3.8-flash-medium",
        "CODEX:IMAGE:gpt-6.1-sol",
        "MUSE:VIDEO:muse-video",
        "LOCAL:ASSEMBLE:assemble",
        "AGY:IMAGE:gemini-3.8-flash-low",
        "AGY:IMAGE:gemini-4-argon-low",
        "AGY:IMAGE:claude-sonnet-5-5-low",
        "AGY:IMAGE:claude-opus-5-5-low",
        "CODEX:IMAGE:gpt-6-luna",
        "CODEX:IMAGE:gpt-6-astra",
        "CODEX:IMAGE:gpt-6-sol",
        "CODEX:IMAGE:gpt-6.1-terra",
        "CODEX:IMAGE:gpt-5.6-sol",
        "CODEX:IMAGE:gpt-5.6-terra",
        "CODEX:IMAGE:gpt-5.6-luna",
      ].sort(),
    );
    expect(enabled.every((m) => m.vendor && m.displayName)).toBe(true);
    // "Codex Ảnh" = GPT-6.1 Sol: dùng lại dòng cũ, không tạo trùng; điền verified/badge.
    const sol = await db.aiModel.findUniqueOrThrow({ where: { name: "Codex Ảnh" } });
    expect(sol).toMatchObject({ displayName: "Sol 6.1", vendor: "openai", badge: "Cao cấp", etaSec: 44, verified: { ok: true, ms: 44000 } });
    expect(await db.aiModel.findUniqueOrThrow({ where: { name: "Gemini Ảnh" } })).toMatchObject({ displayName: "Flash 3.8", badge: "Cân bằng" });
    expect((await db.aiModel.findMany({ where: { provider: "CODEX" } })).every((m) => m.minPlanRank === 1 && m.baseCost.toNumber() === 2)).toBe(true);
    expect(await getSetting("voice_line_cost")).toBe(1);
    expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("creates style and camera presets", async () => {
    expect(await db.preset.count({ where: { kind: "STYLE" } })).toBeGreaterThanOrEqual(4 + 18);
    expect(await db.preset.count({ where: { kind: "CAMERA" } })).toBeGreaterThanOrEqual(6 + 8);
    const presets = await db.preset.findMany();
    expect(presets.every((p) => p.slug && p.cover && p.palette.length >= 3 && p.palette.length <= 5)).toBe(true);
    expect(new Set(presets.map((p) => p.slug)).size).toBe(presets.length);
    for (const p of presets) {
      expect(p.cover).toMatch(/gradient\(/);
      for (const hex of p.palette) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(await db.preset.findFirst({ where: { slug: "son-mai" } })).not.toBeNull();
  });

  it("creates prompt skills of every kind", async () => {
    const skills = await db.promptSkill.findMany();
    expect(skills.length).toBeGreaterThanOrEqual(10);
    expect(new Set(skills.map((s) => s.kind))).toEqual(new Set(["IMAGE", "VIDEO", "STORY", "SCRIPT"]));
    for (const s of skills.filter((k) => k.kind === "STORY")) {
      expect(s.instructions).toContain('"shots"');
      expect(s.template).toContain("{{shots}}");
    }
    expect(await getSetting("muse_slots")).toEqual({ image: 2, video: 3, chat: 1, gapSec: 15, sendVideoAspect: true });
  });

  it("gives admin the free plan", async () => {
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    expect((await getActivePlan(admin.id)).plan.code).toBe("free");
    expect((await getBalance(admin.id)).plan.toFixed(2)).toBe("20.00");
  });

  it("đổi sang tên ngắn chỉ dòng còn tên tự sinh cũ, giữ tên Admin đã sửa, chạy lại vô hại", async () => {
    const opus = await db.aiModel.findUniqueOrThrow({ where: { name: "agy:claude-opus-5-5-low:IMAGE" } });
    const sonnet = await db.aiModel.findUniqueOrThrow({ where: { name: "agy:claude-sonnet-5-5-low:IMAGE" } });
    await db.aiModel.update({ where: { id: opus.id }, data: { displayName: "Claude Opus 5.5", badge: "Pro" } });
    await db.aiModel.update({ where: { id: sonnet.id }, data: { displayName: "Sonnet của tôi" } });
    expect(await shortenModelNames()).toBe(1);
    expect(await db.aiModel.findUniqueOrThrow({ where: { id: opus.id } })).toMatchObject({ displayName: "Opus", badge: "Cao cấp" });
    expect((await db.aiModel.findUniqueOrThrow({ where: { id: sonnet.id } })).displayName).toBe("Sonnet của tôi");
    expect(await shortenModelNames()).toBe(0);
    await db.aiModel.update({ where: { id: sonnet.id }, data: { displayName: "Sonnet" } });
  });

  it("is idempotent", async () => {
    const before = await counts();
    await seed();
    expect(await counts()).toEqual(before);
    expect(before.subscriptions).toBe(1);
  });
});
