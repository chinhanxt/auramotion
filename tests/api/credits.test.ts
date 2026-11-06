import type { User } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { grant, hold } from "@/server/services/credit";
import { createOrder } from "@/server/services/payment";
import { startFree } from "@/server/services/plan";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const current: { user: User | null } = { user: null };

vi.mock("@/lib/auth", async () => {
  const { AppError } = await import("@/lib/errors");
  return {
    requireUser: async () => {
      if (!current.user) throw new AppError("UNAUTHORIZED", "Vui lòng đăng nhập");
      return current.user;
    },
  };
});

const { GET } = await import("@/app/api/credits/route");

type CreditsBody = {
  balance: { available: string; plan: string; purchased: string; held: string };
  plan: { code: string; name: string };
  subscription: { status: string; endAt: string | null };
  transactions: { id: string; type: string; amount: string; jobKind: string | null }[];
  nextCursor: string | null;
  payments: { id: string; refCode: string; status: string; amount: number }[];
};

async function getCredits(query = ""): Promise<{ status: number; body: CreditsBody }> {
  const res = await GET(new Request(`http://localhost/api/credits${query}`));
  return { status: res.status, body: (await res.json()) as CreditsBody };
}

async function newUser(email: string): Promise<User> {
  const user = await db.user.create({ data: { email, name: email.split("@")[0] } });
  await startFree(user.id);
  return user;
}

async function holdForJob(userId: string, cost: number): Promise<string> {
  const model = await db.aiModel.findUniqueOrThrow({ where: { name: "MUSE Ảnh" } });
  const job = await db.job.create({ data: { userId, modelId: model.id, kind: "IMAGE", prompt: "test", cost } });
  await db.$transaction((tx) => hold(tx, userId, job.id, cost));
  return job.id;
}

describe("GET /api/credits", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    current.user = await newUser("credits@test.local");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("after grant + hold: held = cost, newest transaction is hold", async () => {
    await grant(current.user!.id, 100, { type: "purchase" });
    await holdForJob(current.user!.id, 2);

    const { status, body } = await getCredits();
    expect(status).toBe(200);
    expect(Number(body.balance.held)).toBe(2);
    expect(Number(body.balance.available)).toBe(118);
    expect(Number(body.balance.plan)).toBe(18);
    expect(Number(body.balance.purchased)).toBe(100);
    expect(body.transactions[0].type).toBe("hold");
    expect(Number(body.transactions[0].amount)).toBe(-2);
    expect(body.transactions[0].jobKind).toBe("IMAGE");
    expect(body.plan.code).toBe("free");
    expect(body.subscription.status).toBe("ACTIVE");
  });

  it("paginates transactions 30 per page", async () => {
    for (let i = 0; i < 34; i++) await grant(current.user!.id, 1, { type: "purchase" });

    const first = await getCredits();
    expect(first.body.transactions).toHaveLength(30);
    expect(first.body.nextCursor).toBe(first.body.transactions[29].id);

    const second = await getCredits(`?cursor=${first.body.nextCursor}`);
    expect(second.body.transactions).toHaveLength(5); // 4 còn lại + grant gói Free
    expect(second.body.nextCursor).toBeNull();
    const ids = new Set([...first.body.transactions, ...second.body.transactions].map((t) => t.id));
    expect(ids.size).toBe(35);
  });

  it("never returns another user's transactions or payments", async () => {
    const other = await newUser("other@test.local");
    await grant(other.id, 500, { type: "purchase" });
    await holdForJob(other.id, 3);
    const foreignOrder = await createOrder(other.id, { type: "CREDIT", credits: 100 });
    const ownOrder = await createOrder(current.user!.id, { type: "CREDIT", credits: 500 });

    const { body } = await getCredits();
    expect(Number(body.balance.available)).toBe(20);
    expect(Number(body.balance.held)).toBe(0);
    expect(body.transactions.map((t) => t.type)).toEqual(["grant"]);
    expect(body.payments.map((p) => p.id)).toEqual([ownOrder.id]);
    expect(body.payments[0].amount).toBe(199000);

    // Cursor trỏ vào giao dịch của user khác cũng không lộ dữ liệu của họ.
    const foreignTxn = await db.creditTransaction.findFirstOrThrow({ where: { userId: other.id } });
    const paged = await getCredits(`?cursor=${foreignTxn.id}`);
    expect(paged.body.transactions.every((t) => t.id !== foreignTxn.id)).toBe(true);
    const foreignIds = new Set((await db.creditTransaction.findMany({ where: { userId: other.id } })).map((t) => t.id));
    expect(paged.body.transactions.some((t) => foreignIds.has(t.id))).toBe(false);
    expect(paged.body.payments.some((p) => p.id === foreignOrder.id)).toBe(false);
  });

  it("rejects anonymous user", async () => {
    current.user = null;
    expect((await getCredits()).status).toBe(401);
  });
});
