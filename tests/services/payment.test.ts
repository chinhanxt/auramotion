import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getBalance } from "@/server/services/credit";
import { getActivePlan, startFree } from "@/server/services/plan";
import { createOrder, fulfillPayment, getPayment, handleWebhook } from "@/server/services/payment";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

let userId: string;

function sign(body: string): string {
  return createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET!).update(body).digest("hex");
}

function webhookBody(transactionId: string, amount: number, refCode: string): string {
  return JSON.stringify({ transactionId, amount, description: `CT DEN:123 ${refCode} chuyen tien` });
}

async function purchased(): Promise<string> {
  return (await getBalance(userId)).purchased.toFixed(2);
}

describe("payment", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    userId = (await db.user.create({ data: { email: "u@test.local", name: "U" } })).id;
    await startFree(userId);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("createOrder plan uses plan price", async () => {
    const month = await createOrder(userId, { type: "PLAN", planCode: "pro", period: "MONTH" });
    const year = await createOrder(userId, { type: "PLAN", planCode: "ultra", period: "YEAR" });
    expect(month.amount).toBe(199000);
    expect(month.status).toBe("PENDING");
    expect(year.amount).toBe(4790000);
    expect(month.qrUrl).toBe(
      `https://img.vietqr.io/image/970436-0123456789-compact2.png?amount=199000&addInfo=${month.refCode}&accountName=AURAMOTION%20TEST`,
    );
  });

  it("createOrder credit uses credit pack price", async () => {
    const order = await createOrder(userId, { type: "CREDIT", credits: 500 });
    expect(order.amount).toBe(199000);
    expect(order.creditAmount!.toFixed(2)).toBe("500.00");
  });

  it("refCode matches /^AM[A-Z0-9]{8}$/", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { refCode } = await createOrder(userId, { type: "CREDIT", credits: 100 });
      expect(refCode).toMatch(/^AM[A-Z0-9]{8}$/);
      codes.add(refCode);
    }
    expect(codes.size).toBe(20);
  });

  it("getPayment hides other users' orders", async () => {
    const order = await createOrder(userId, { type: "CREDIT", credits: 100 });
    const other = (await db.user.create({ data: { email: "o@test.local", name: "O" } })).id;
    expect((await getPayment(userId, order.id)).qrUrl).toBe(order.qrUrl);
    expect(Object.keys(await getPayment(userId, order.id)).sort()).toEqual(
      ["amount", "createdAt", "creditAmount", "id", "paidAt", "period", "planCode", "qrStatic", "qrUrl", "refCode", "status", "type"].sort(),
    );
    await expect(getPayment(other, order.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("webhook bad signature", async () => {
    const order = await createOrder(userId, { type: "CREDIT", credits: 100 });
    const body = webhookBody("T1", 49000, order.refCode);
    await expect(handleWebhook(body, "deadbeef")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(handleWebhook(body, null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(handleWebhook(body, sign(body) + "zz")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(handleWebhook(body, sign(body + " "))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await db.payment.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await purchased()).toBe("0.00");
  });

  it("webhook fulfills credit order", async () => {
    const order = await createOrder(userId, { type: "CREDIT", credits: 100 });
    const body = webhookBody("T1", 49000, order.refCode);
    expect(await handleWebhook(body, sign(body))).toEqual({ ok: true });
    const paid = await db.payment.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("SUCCEEDED");
    expect(paid.providerTxnId).toBe("T1");
    expect(paid.paidAt).not.toBeNull();
    expect(await purchased()).toBe("100.00");
    const tx = await db.creditTransaction.findFirstOrThrow({ where: { paymentId: order.id } });
    expect(tx.type).toBe("purchase");
  });

  it("webhook ignores unknown refCode", async () => {
    const body = webhookBody("T1", 49000, "AMZZZZZZZZ");
    expect(await handleWebhook(body, sign(body))).toEqual({ ok: true });
    const empty = JSON.stringify({ transactionId: "T2", amount: 1, description: "khong co ma" });
    expect(await handleWebhook(empty, sign(empty))).toEqual({ ok: true });
  });

  it("webhook finds refCode glued to other text", async () => {
    const order = await createOrder(userId, { type: "CREDIT", credits: 100 });
    const body = JSON.stringify({ transactionId: "T1", amount: 49000, description: `NGUYEN VAN NAM${order.refCode}` });
    expect(await handleWebhook(body, sign(body))).toEqual({ ok: true });
    expect(await purchased()).toBe("100.00");
  });

  it("webhook route rejects oversized body", async () => {
    const body = "x".repeat(65 * 1024);
    const res = await webhookRoute(
      new Request("http://localhost/api/payments/webhook", {
        method: "POST",
        body,
        headers: { "content-length": String(body.length), "x-signature": sign(body) },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("webhook is idempotent", async () => {
    const order = await createOrder(userId, { type: "CREDIT", credits: 100 });
    const body = webhookBody("T1", 49000, order.refCode);
    await handleWebhook(body, sign(body));
    await handleWebhook(body, sign(body));
    // Giao dịch khác (chuyển lần 2) cùng refCode cũng không cộng thêm.
    const again = webhookBody("T2", 49000, order.refCode);
    expect(await handleWebhook(again, sign(again))).toEqual({ ok: true });
    expect(await purchased()).toBe("100.00");
    expect(await db.creditTransaction.count({ where: { paymentId: order.id } })).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: order.id } })).providerTxnId).toBe("T1");
  });

  it("concurrent webhooks fulfill once", async () => {
    const credit = await createOrder(userId, { type: "CREDIT", credits: 100 });
    const plan = await createOrder(userId, { type: "PLAN", planCode: "pro", period: "MONTH" });
    const bodies = [
      webhookBody("C1", 49000, credit.refCode),
      webhookBody("C1", 49000, credit.refCode),
      webhookBody("C2", 49000, credit.refCode),
      webhookBody("P1", 199000, plan.refCode),
      webhookBody("P1", 199000, plan.refCode),
      webhookBody("P2", 199000, plan.refCode),
    ];
    const results = await Promise.all(bodies.map((b) => handleWebhook(b, sign(b))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await purchased()).toBe("100.00");
    expect(await db.creditTransaction.count({ where: { paymentId: credit.id } })).toBe(1);
    expect(await db.subscription.count({ where: { userId, status: "ACTIVE" } })).toBe(1);
    const { plan: active, subscription } = await getActivePlan(userId);
    expect(active.code).toBe("pro");
    expect(await db.subscription.count({ where: { userId, plan: { code: "pro" } } })).toBe(1);
    expect((await getBalance(userId)).plan.toFixed(2)).toBe("500.00");
    expect(subscription.endAt).not.toBeNull();
  });

  it("underpaid webhook does not fulfill", async () => {
    const order = await createOrder(userId, { type: "PLAN", planCode: "pro", period: "MONTH" });
    const body = webhookBody("T1", 198999, order.refCode);
    expect(await handleWebhook(body, sign(body))).toEqual({ ok: true });
    const pending = await db.payment.findUniqueOrThrow({ where: { id: order.id } });
    expect(pending.status).toBe("PENDING");
    expect(pending.providerTxnId).toBeNull();
    expect((await getActivePlan(userId)).plan.code).toBe("free");
  });

  it("fulfill plan order activates pro", async () => {
    const order = await createOrder(userId, { type: "PLAN", planCode: "pro", period: "YEAR" });
    expect(await fulfillPayment(order.id, { providerTxnId: "T1" })).toBe(true);
    const { plan, subscription } = await getActivePlan(userId);
    expect(plan.code).toBe("pro");
    expect(subscription.period).toBe("YEAR");
    expect((await getBalance(userId)).plan.toFixed(2)).toBe("500.00");
  });

  it("manual confirm uses the same idempotent path", async () => {
    const order = await createOrder(userId, { type: "CREDIT", credits: 1000 });
    const results = await Promise.all([
      fulfillPayment(order.id, { confirmedBy: "admin-1" }),
      fulfillPayment(order.id, { confirmedBy: "admin-2" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const body = webhookBody("T9", 349000, order.refCode);
    await handleWebhook(body, sign(body));
    expect(await purchased()).toBe("1000.00");
    const paid = await db.payment.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("SUCCEEDED");
    expect(paid.confirmedBy).toMatch(/^admin-[12]$/);
    expect(paid.providerTxnId).toBeNull();
  });

  it("fulfill rolls back to PENDING when activation fails", async () => {
    const order = await db.payment.create({
      data: { userId, type: "PLAN", planCode: "free", period: "MONTH", amount: 1, refCode: "AMBROKEN01" },
    });
    await expect(fulfillPayment(order.id, { providerTxnId: "T1" })).rejects.toMatchObject({ code: "INTERNAL" });
    const after = await db.payment.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PENDING");
    expect(after.providerTxnId).toBeNull();
    expect(after.paidAt).toBeNull();
  });

  it("fulfill does not touch canceled orders", async () => {
    const order = await createOrder(userId, { type: "CREDIT", credits: 100 });
    await db.payment.update({ where: { id: order.id }, data: { status: "CANCELED" } });
    expect(await fulfillPayment(order.id, { confirmedBy: "admin-1" })).toBe(false);
    expect(await purchased()).toBe("0.00");
  });
});
