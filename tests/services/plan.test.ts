import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { charge, getBalance, grant, hold } from "@/server/services/credit";
import {
  activatePlan,
  expireSubscriptions,
  getActivePlan,
  runMonthlyGrants,
  sendRenewalReminders,
  startFree,
} from "@/server/services/plan";
import { sendMail } from "@/lib/mail";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));

const T0 = new Date("2026-01-31T10:00:00Z");
let userId: string;

async function balance() {
  const b = await getBalance(userId);
  return { plan: b.plan.toFixed(2), purchased: b.purchased.toFixed(2) };
}

async function spend(amount: number) {
  const model = await db.aiModel.findFirstOrThrow();
  const job = await db.job.create({ data: { userId, modelId: model.id, kind: "IMAGE", prompt: "x", cost: amount } });
  await db.$transaction((tx) => hold(tx, userId, job.id, amount));
  await charge(job.id);
}

describe("plan", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    userId = (await db.user.create({ data: { email: "u@test.local", name: "U" } })).id;
    vi.mocked(sendMail).mockClear();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("startFree grants 20", async () => {
    await startFree(userId, undefined, T0);
    const { plan, subscription } = await getActivePlan(userId);
    expect(plan.code).toBe("free");
    expect(subscription.endAt).toBeNull();
    expect(subscription.nextGrantAt.toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(await balance()).toEqual({ plan: "20.00", purchased: "0.00" });
  });

  it("activatePlan pro replaces free credits", async () => {
    await startFree(userId, undefined, T0);
    await spend(8);
    await grant(userId, 5, { type: "purchase" });
    const sub = await activatePlan(userId, "pro", "MONTH", T0);
    expect(sub.endAt!.toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(await balance()).toEqual({ plan: "500.00", purchased: "5.00" });
    expect((await getActivePlan(userId)).plan.code).toBe("pro");
    expect(await db.subscription.count({ where: { userId, status: "ACTIVE" } })).toBe(1);
    expect(await db.subscription.count({ where: { userId, status: "CANCELED" } })).toBe(1);
  });

  it("yearly plan grants monthly", async () => {
    await startFree(userId, undefined, T0);
    const sub = await activatePlan(userId, "pro", "YEAR", T0);
    expect(sub.endAt!.toISOString()).toBe("2027-01-31T10:00:00.000Z");
    expect(sub.nextGrantAt.toISOString()).toBe("2026-02-28T10:00:00.000Z");
    await spend(100);

    const t1 = new Date("2026-02-28T10:00:00Z");
    expect(await runMonthlyGrants(t1)).toBe(1);
    expect(await runMonthlyGrants(t1)).toBe(0);
    expect(await balance()).toEqual({ plan: "500.00", purchased: "0.00" });
    const after = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.nextGrantAt.toISOString()).toBe("2026-03-31T10:00:00.000Z");
  });

  it("monthly grant catches up once after downtime", async () => {
    await startFree(userId, undefined, T0);
    await spend(15);
    const late = new Date("2026-04-15T00:00:00Z");
    expect(await runMonthlyGrants(late)).toBe(1);
    expect(await runMonthlyGrants(late)).toBe(0);
    expect(await balance()).toEqual({ plan: "20.00", purchased: "0.00" });
    const { subscription } = await getActivePlan(userId);
    expect(subscription.nextGrantAt.toISOString()).toBe("2026-04-30T10:00:00.000Z");
  });

  it("expire falls back to free", async () => {
    await startFree(userId, undefined, T0);
    await grant(userId, 7, { type: "purchase" });
    const sub = await activatePlan(userId, "ultra", "MONTH", T0);
    const end = sub.endAt!;
    expect(await runMonthlyGrants(end)).toBe(0);
    expect(await expireSubscriptions(end)).toBe(1);
    expect(await expireSubscriptions(end)).toBe(0);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("EXPIRED");
    const { plan, subscription } = await getActivePlan(userId);
    expect(plan.code).toBe("free");
    expect(subscription.startAt.toISOString()).toBe(end.toISOString());
    expect(await balance()).toEqual({ plan: "20.00", purchased: "7.00" });
  });

  it("renewal reminder sent once", async () => {
    await startFree(userId, undefined, T0);
    const sub = await activatePlan(userId, "pro", "MONTH", T0);
    expect(await sendRenewalReminders(new Date("2026-02-20T10:00:00Z"))).toBe(0);
    const near = new Date("2026-02-25T11:00:00Z");
    expect(await sendRenewalReminders(near)).toBe(1);
    expect(await sendRenewalReminders(near)).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMail).mock.calls[0][0]).toBe("u@test.local");
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).remindedAt).not.toBeNull();
  });

  it("renew same plan extends endAt", async () => {
    await startFree(userId, undefined, T0);
    const first = await activatePlan(userId, "pro", "MONTH", T0);
    await spend(50);
    await db.subscription.update({ where: { id: first.id }, data: { remindedAt: T0 } });
    const renewed = await activatePlan(userId, "pro", "MONTH", new Date("2026-02-20T00:00:00Z"));
    expect(renewed.id).toBe(first.id);
    expect(renewed.endAt!.toISOString()).toBe("2026-03-28T10:00:00.000Z");
    expect(renewed.remindedAt).toBeNull();
    expect(await balance()).toEqual({ plan: "450.00", purchased: "0.00" });
    expect(await db.subscription.count({ where: { userId } })).toBe(2);
  });

  it("getActivePlan without subscription throws NOT_FOUND", async () => {
    await expect(getActivePlan(userId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
