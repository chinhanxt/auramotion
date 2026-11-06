import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  adminAdjust,
  charge,
  expirePlanCredits,
  getBalance,
  grant,
  hold,
  refund,
} from "@/server/services/credit";
import { resetDb } from "../helpers/db";

let userId: string;
let adminId: string;
let modelId: string;

async function newJob(): Promise<string> {
  const job = await db.job.create({
    data: { userId, modelId, kind: "IMAGE", prompt: "test", cost: 0 },
  });
  return job.id;
}

async function balance() {
  const b = await getBalance(userId);
  return {
    available: b.available.toFixed(2),
    plan: b.plan.toFixed(2),
    purchased: b.purchased.toFixed(2),
    held: b.held.toFixed(2),
  };
}

function holdTx(jobId: string, amount: number, commitDelayMs = 0) {
  return db.$transaction(async (tx) => {
    await hold(tx, userId, jobId, amount);
    if (commitDelayMs) await new Promise((r) => setTimeout(r, commitDelayMs));
  });
}

describe("credit ledger", () => {
  beforeEach(async () => {
    await resetDb();
    userId = (await db.user.create({ data: { email: "u@test.local", name: "U" } })).id;
    adminId = (await db.user.create({ data: { email: "a@test.local", name: "A", role: "ADMIN" } })).id;
    modelId = (
      await db.aiModel.create({
        data: { name: "Test", provider: "MUSE", engineModel: "muse-image", kind: "IMAGE", baseCost: 1 },
      })
    ).id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("grant then balance", async () => {
    await grant(userId, 20, { type: "grant" });
    expect(await balance()).toEqual({ available: "20.00", plan: "20.00", purchased: "0.00", held: "0.00" });
  });

  it("hold takes plan bucket first", async () => {
    await grant(userId, 5, { type: "grant" });
    await grant(userId, 10, { type: "purchase" });
    const jobId = await newJob();
    await holdTx(jobId, 8);
    expect(await balance()).toEqual({ available: "7.00", plan: "0.00", purchased: "7.00", held: "8.00" });
    const rows = await db.creditTransaction.findMany({ where: { jobId }, orderBy: { bucket: "asc" } });
    expect(rows.map((r) => `${r.type}:${r.bucket}:${r.amount.toFixed(2)}`)).toEqual([
      "hold:PLAN:-5.00",
      "hold:PURCHASED:-3.00",
    ]);
  });

  it("hold insufficient", async () => {
    await grant(userId, 2, { type: "grant" });
    const jobId = await newJob();
    await expect(holdTx(jobId, 2.5)).rejects.toMatchObject({ code: "INSUFFICIENT_CREDIT" });
    expect((await balance()).available).toBe("2.00");
  });

  it("charge is idempotent", async () => {
    await grant(userId, 10, { type: "grant" });
    const jobId = await newJob();
    await holdTx(jobId, 4);
    await charge(jobId);
    await charge(jobId);
    expect(await balance()).toEqual({ available: "6.00", plan: "6.00", purchased: "0.00", held: "0.00" });
    expect(await db.creditTransaction.count({ where: { jobId, type: "charge" } })).toBe(1);
  });

  it("refund returns to same buckets", async () => {
    await grant(userId, 5, { type: "grant" });
    await grant(userId, 10, { type: "purchase" });
    const jobId = await newJob();
    await holdTx(jobId, 8);
    await refund(jobId);
    await refund(jobId);
    expect(await balance()).toEqual({ available: "15.00", plan: "5.00", purchased: "10.00", held: "0.00" });
    expect(await db.creditTransaction.count({ where: { jobId, type: "refund" } })).toBe(2);
  });

  it("refund after charge is no-op", async () => {
    await grant(userId, 10, { type: "grant" });
    const jobId = await newJob();
    await holdTx(jobId, 3);
    await charge(jobId);
    await refund(jobId);
    expect(await balance()).toEqual({ available: "7.00", plan: "7.00", purchased: "0.00", held: "0.00" });
    expect(await db.creditTransaction.count({ where: { jobId, type: "refund" } })).toBe(0);
  });

  it("hold is serialized per user", async () => {
    await grant(userId, 5, { type: "grant" });
    const jobs = [await newJob(), await newJob()];
    // Each transaction stays open after hold so the two overlap: without the row lock both would succeed.
    const results = await Promise.allSettled(jobs.map((id) => holdTx(id, 3, 300)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "INSUFFICIENT_CREDIT" });
    expect(await balance()).toEqual({ available: "2.00", plan: "2.00", purchased: "0.00", held: "3.00" });
  });

  it("expirePlanCredits keeps purchased", async () => {
    await grant(userId, 12, { type: "grant" });
    await grant(userId, 5, { type: "purchase" });
    await expirePlanCredits(userId);
    expect(await balance()).toEqual({ available: "5.00", plan: "0.00", purchased: "5.00", held: "0.00" });
    await expirePlanCredits(userId);
    expect(await db.creditTransaction.count({ where: { userId, type: "expire" } })).toBe(1);
  });

  it("refund after plan expired does not revive plan credits", async () => {
    await grant(userId, 10, { type: "grant" });
    await grant(userId, 5, { type: "purchase" });
    const jobId = await newJob();
    await holdTx(jobId, 12);
    await expirePlanCredits(userId);
    await grant(userId, 500, { type: "grant" });
    await refund(jobId);
    await refund(jobId);
    expect(await balance()).toEqual({ available: "505.00", plan: "500.00", purchased: "5.00", held: "0.00" });
  });

  it("refund after partial plan expiry keeps plan at zero", async () => {
    await grant(userId, 10, { type: "grant" });
    const jobId = await newJob();
    await holdTx(jobId, 4);
    await expirePlanCredits(userId);
    await refund(jobId);
    expect(await balance()).toEqual({ available: "0.00", plan: "0.00", purchased: "0.00", held: "0.00" });
  });

  it("amounts round HALF_UP to 2 decimals", async () => {
    await grant(userId, 1.005, { type: "grant" });
    await grant(userId, "2.004", { type: "purchase" });
    expect(await balance()).toMatchObject({ plan: "1.01", purchased: "2.00" });
  });

  it("adminAdjust requires reason", async () => {
    await expect(adminAdjust(userId, 10, adminId, "  ")).rejects.toMatchObject({ code: "VALIDATION" });
    await adminAdjust(userId, 10, adminId, "bonus");
    await expect(adminAdjust(userId, -11, adminId, "fix")).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDIT",
    });
    await adminAdjust(userId, -4, adminId, "fix");
    expect(await balance()).toEqual({ available: "6.00", plan: "0.00", purchased: "6.00", held: "0.00" });
    const row = await db.creditTransaction.findFirstOrThrow({ where: { userId, note: "bonus" } });
    expect(row).toMatchObject({ type: "admin_adjust", bucket: "PURCHASED", actorId: adminId });
  });

  it("zero hold writes nothing", async () => {
    const jobId = await newJob();
    await holdTx(jobId, 0);
    expect(await db.creditTransaction.count({ where: { jobId } })).toBe(0);
    await charge(jobId);
    await refund(jobId);
    expect(await db.creditTransaction.count({ where: { jobId } })).toBe(0);
  });
});
