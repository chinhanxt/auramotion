import { CreditBucket, Prisma, type CreditTransaction } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type Tx = Prisma.TransactionClient;
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
type Amount = Prisma.Decimal.Value;

const ZERO = new Decimal(0);

function toAmount(value: Amount): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

async function lockUser(tx: Tx, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Không tìm thấy người dùng");
}

async function bucketBalances(client: Tx, userId: string): Promise<{ plan: Decimal; purchased: Decimal }> {
  const sums = await client.creditTransaction.groupBy({
    by: ["bucket"],
    where: { userId },
    _sum: { amount: true },
  });
  const of = (bucket: CreditBucket) => sums.find((s) => s.bucket === bucket)?._sum.amount ?? ZERO;
  return { plan: of(CreditBucket.PLAN), purchased: of(CreditBucket.PURCHASED) };
}

async function isSettled(client: Tx, jobId: string): Promise<boolean> {
  const count = await client.creditTransaction.count({
    where: { jobId, type: { in: ["charge", "refund"] } },
  });
  return count > 0;
}

export async function getBalance(
  userId: string,
  tx?: Tx,
): Promise<{ available: Decimal; plan: Decimal; purchased: Decimal; held: Decimal }> {
  const client = tx ?? db;
  const { plan, purchased } = await bucketBalances(client, userId);
  const holds = await client.creditTransaction.findMany({
    where: { userId, type: "hold" },
    select: { jobId: true, amount: true },
  });
  const jobIds = [...new Set(holds.map((h) => h.jobId).filter((id): id is string => id !== null))];
  const settled = new Set(
    (
      await client.creditTransaction.findMany({
        where: { jobId: { in: jobIds }, type: { in: ["charge", "refund"] } },
        select: { jobId: true },
        distinct: ["jobId"],
      })
    ).map((s) => s.jobId),
  );
  const held = holds
    .filter((h) => !settled.has(h.jobId))
    .reduce((sum, h) => sum.minus(h.amount), ZERO);
  return { available: plan.plus(purchased), plan, purchased, held };
}

export async function grant(
  userId: string,
  amount: Amount,
  opts: { type: "grant" | "purchase"; paymentId?: string; note?: string },
  tx?: Tx,
): Promise<CreditTransaction> {
  const value = toAmount(amount);
  if (value.lte(0)) throw new AppError("VALIDATION", "Số Credit cấp phải lớn hơn 0");
  return (tx ?? db).creditTransaction.create({
    data: {
      userId,
      type: opts.type,
      bucket: opts.type === "grant" ? CreditBucket.PLAN : CreditBucket.PURCHASED,
      amount: value,
      paymentId: opts.paymentId,
      note: opts.note,
    },
  });
}

export async function expirePlanCredits(userId: string, tx?: Tx): Promise<void> {
  await inTx(tx, async (t) => {
    await lockUser(t, userId);
    const { plan } = await bucketBalances(t, userId);
    if (plan.lte(0)) {
      // Plan credits may all be held: still write a 0 marker so refund() knows they expired.
      const heldPlan = await t.creditTransaction.count({
        where: {
          userId,
          type: "hold",
          bucket: CreditBucket.PLAN,
          job: { transactions: { none: { type: { in: ["charge", "refund"] } } } },
        },
      });
      if (heldPlan === 0) return;
    }
    await t.creditTransaction.create({
      data: { userId, type: "expire", bucket: CreditBucket.PLAN, amount: plan.gt(0) ? plan.negated() : ZERO },
    });
  });
}

export async function hold(tx: Tx, userId: string, jobId: string, amount: Amount): Promise<void> {
  const value = toAmount(amount);
  if (value.lt(0)) throw new AppError("VALIDATION", "Số Credit giữ không hợp lệ");
  if (value.isZero()) return;
  await lockUser(tx, userId);
  const { plan, purchased } = await bucketBalances(tx, userId);
  if (value.gt(plan.plus(purchased))) {
    throw new AppError("INSUFFICIENT_CREDIT", "Không đủ Credit");
  }
  const planAvailable = plan.gt(0) ? plan : ZERO;
  const fromPlan = value.lt(planAvailable) ? value : planAvailable;
  const fromPurchased = value.minus(fromPlan);
  const rows: Prisma.CreditTransactionCreateManyInput[] = [];
  if (fromPlan.gt(0)) {
    rows.push({ userId, jobId, type: "hold", bucket: CreditBucket.PLAN, amount: fromPlan.negated() });
  }
  if (fromPurchased.gt(0)) {
    rows.push({ userId, jobId, type: "hold", bucket: CreditBucket.PURCHASED, amount: fromPurchased.negated() });
  }
  await tx.creditTransaction.createMany({ data: rows });
}

export async function charge(jobId: string, tx?: Tx): Promise<void> {
  await inTx(tx, async (t) => {
    const holds = await t.creditTransaction.findMany({ where: { jobId, type: "hold" } });
    if (holds.length === 0) return;
    await lockUser(t, holds[0].userId);
    if (await isSettled(t, jobId)) return;
    await t.creditTransaction.create({
      data: { userId: holds[0].userId, jobId, type: "charge", bucket: holds[0].bucket, amount: ZERO },
    });
  });
}

export async function refund(jobId: string, tx?: Tx): Promise<void> {
  await inTx(tx, async (t) => {
    const holds = await t.creditTransaction.findMany({ where: { jobId, type: "hold" } });
    if (holds.length === 0) return;
    await lockUser(t, holds[0].userId);
    if (await isSettled(t, jobId)) return;
    const rows: Prisma.CreditTransactionCreateManyInput[] = holds.map((h) => ({
      userId: h.userId,
      jobId,
      type: "refund",
      bucket: h.bucket,
      amount: h.amount.negated(),
    }));
    // Plan credits that expired while held must not come back: expire the refunded part again.
    const planHold = holds.find((h) => h.bucket === CreditBucket.PLAN);
    if (planHold) {
      const expiredSince = await t.creditTransaction.count({
        where: { userId: planHold.userId, type: "expire", createdAt: { gt: planHold.createdAt } },
      });
      if (expiredSince > 0) {
        rows.push({ userId: planHold.userId, jobId, type: "expire", bucket: CreditBucket.PLAN, amount: planHold.amount });
      }
    }
    await t.creditTransaction.createMany({ data: rows });
  });
}

export async function adminAdjust(
  userId: string,
  amount: Amount,
  actorId: string,
  reason: string,
): Promise<CreditTransaction> {
  const note = reason.trim();
  if (!note) throw new AppError("VALIDATION", "Bắt buộc nhập lý do");
  const value = toAmount(amount);
  if (value.isZero()) throw new AppError("VALIDATION", "Số Credit điều chỉnh phải khác 0");
  return db.$transaction(async (t) => {
    await lockUser(t, userId);
    const { purchased } = await bucketBalances(t, userId);
    if (purchased.plus(value).lt(0)) {
      throw new AppError("INSUFFICIENT_CREDIT", "Không đủ Credit để trừ");
    }
    return t.creditTransaction.create({
      data: { userId, type: "admin_adjust", bucket: CreditBucket.PURCHASED, amount: value, actorId, note },
    });
  });
}
