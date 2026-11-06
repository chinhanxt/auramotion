import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getBalance } from "@/server/services/credit";
import { getActivePlan } from "@/server/services/plan";
import { getSetting } from "@/server/services/settings";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

async function counts() {
  return {
    users: await db.user.count(),
    plans: await db.plan.count(),
    models: await db.aiModel.count(),
    presets: await db.preset.count(),
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
    expect(
      (await db.aiModel.findMany({ where: { enabled: true }, orderBy: { sort: "asc" } })).map(
        (m) => `${m.provider}:${m.kind}`,
      ),
    ).toEqual(["MUSE:IMAGE", "AGY:IMAGE", "CODEX:IMAGE", "MUSE:VIDEO", "LOCAL:ASSEMBLE"]);
    expect((await db.aiModel.findFirst({ where: { provider: "CODEX" } }))!.minPlanRank).toBe(1);
    expect(await getSetting("voice_line_cost")).toBe(1);
    expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("creates style and camera presets", async () => {
    expect(await db.preset.count({ where: { kind: "STYLE" } })).toBe(4);
    expect(await db.preset.count({ where: { kind: "CAMERA" } })).toBe(6);
  });

  it("gives admin the free plan", async () => {
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    expect((await getActivePlan(admin.id)).plan.code).toBe("free");
    expect((await getBalance(admin.id)).plan.toFixed(2)).toBe("20.00");
  });

  it("is idempotent", async () => {
    const before = await counts();
    await seed();
    expect(await counts()).toEqual(before);
    expect(before.subscriptions).toBe(1);
  });
});
