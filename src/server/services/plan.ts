import type { BillingPeriod, Plan, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sendMail } from "@/lib/mail";
import { expirePlanCredits, grant, type Tx } from "@/server/services/credit";

const REMIND_BEFORE_MS = 3 * 24 * 60 * 60 * 1000;

function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.$transaction(fn);
}

async function lockUser(tx: Tx, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Không tìm thấy người dùng");
}

// Cộng tháng dương lịch (UTC); ngày vượt quá cuối tháng thì lấy ngày cuối tháng (31/01 + 1 tháng = 28/02).
function addMonths(date: Date, months: number): Date {
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

function addPeriod(date: Date, period: BillingPeriod): Date {
  return addMonths(date, period === "YEAR" ? 12 : 1);
}

function findActive(client: Tx, userId: string) {
  return client.subscription.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { startAt: "desc" },
    include: { plan: true },
  });
}

export async function getActivePlan(userId: string): Promise<{ plan: Plan; subscription: Subscription }> {
  const sub = await findActive(db, userId);
  if (!sub) throw new AppError("NOT_FOUND", "Người dùng chưa có gói");
  const { plan, ...subscription } = sub;
  return { plan, subscription };
}

export async function startFree(userId: string, tx?: Tx, now: Date = new Date()): Promise<Subscription> {
  return inTx(tx, async (t) => {
    await lockUser(t, userId);
    const plan = await t.plan.findUniqueOrThrow({ where: { code: "free" } });
    const sub = await t.subscription.create({
      data: { userId, planId: plan.id, period: "MONTH", startAt: now, endAt: null, nextGrantAt: addMonths(now, 1) },
    });
    await grant(userId, plan.monthlyCredits, { type: "grant", note: "Credit gói Free" }, t);
    return sub;
  });
}

export async function activatePlan(
  userId: string,
  planCode: "pro" | "ultra",
  period: BillingPeriod,
  now: Date = new Date(),
  tx?: Tx,
): Promise<Subscription> {
  return inTx(tx, async (t) => {
    await lockUser(t, userId);
    const plan = await t.plan.findUniqueOrThrow({ where: { code: planCode } });
    const current = await findActive(t, userId);

    // Gia hạn đúng gói đang dùng: chỉ cộng thời hạn từ endAt cũ, không cấp thêm credit.
    if (current && current.planId === plan.id && current.endAt) {
      const base = current.endAt > now ? current.endAt : now;
      return t.subscription.update({
        where: { id: current.id },
        data: { endAt: addPeriod(base, period), period, remindedAt: null },
      });
    }

    if (current) {
      await t.subscription.update({ where: { id: current.id }, data: { status: "CANCELED", endAt: now } });
    }
    await expirePlanCredits(userId, t);
    const sub = await t.subscription.create({
      data: {
        userId,
        planId: plan.id,
        period,
        startAt: now,
        endAt: addPeriod(now, period),
        nextGrantAt: addMonths(now, 1),
      },
    });
    await grant(userId, plan.monthlyCredits, { type: "grant", note: `Credit gói ${plan.name}` }, t);
    return sub;
  });
}

// Cấp lại credit gói cho các thuê bao tới kỳ. Gọi lại cùng `now` không cấp lần hai.
export async function runMonthlyGrants(now: Date): Promise<number> {
  const due = await db.subscription.findMany({
    where: { status: "ACTIVE", nextGrantAt: { lte: now }, OR: [{ endAt: null }, { endAt: { gt: now } }] },
    select: { id: true, userId: true },
  });
  let granted = 0;
  for (const { id, userId } of due) {
    const done = await db.$transaction(async (t) => {
      await lockUser(t, userId);
      const sub = await t.subscription.findUnique({ where: { id }, include: { plan: true } });
      if (!sub || sub.status !== "ACTIVE" || sub.nextGrantAt > now || (sub.endAt && sub.endAt <= now)) return false;
      // Kỳ kế tiếp tính từ startAt để không trôi ngày khi rơi vào cuối tháng; bỏ qua các kỳ đã lỡ.
      let n = 1;
      while (addMonths(sub.startAt, n) <= now) n++;
      await expirePlanCredits(userId, t);
      await grant(userId, sub.plan.monthlyCredits, { type: "grant", note: `Credit gói ${sub.plan.name} hằng tháng` }, t);
      await t.subscription.update({ where: { id }, data: { nextGrantAt: addMonths(sub.startAt, n) } });
      return true;
    });
    if (done) granted++;
  }
  return granted;
}

// Thuê bao trả phí hết hạn → EXPIRED, bỏ credit gói, chuyển về Free.
export async function expireSubscriptions(now: Date): Promise<number> {
  const due = await db.subscription.findMany({
    where: { status: "ACTIVE", endAt: { lte: now } },
    select: { id: true, userId: true },
  });
  let expired = 0;
  for (const { id, userId } of due) {
    const done = await db.$transaction(async (t) => {
      await lockUser(t, userId);
      const sub = await t.subscription.findUnique({ where: { id } });
      if (!sub || sub.status !== "ACTIVE" || !sub.endAt || sub.endAt > now) return false;
      await t.subscription.update({ where: { id }, data: { status: "EXPIRED" } });
      await expirePlanCredits(userId, t);
      await startFree(userId, t, now);
      return true;
    });
    if (done) expired++;
  }
  return expired;
}

export async function sendRenewalReminders(now: Date): Promise<number> {
  const due = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      remindedAt: null,
      endAt: { gt: now, lte: new Date(now.getTime() + REMIND_BEFORE_MS) },
    },
    include: { plan: true, user: { select: { email: true, name: true } } },
  });
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  let sent = 0;
  for (const sub of due) {
    // Đánh dấu trước khi gửi để hai lần chạy song song không gửi trùng.
    const claimed = await db.subscription.updateMany({
      where: { id: sub.id, remindedAt: null },
      data: { remindedAt: now },
    });
    if (claimed.count === 0) continue;
    const endText = sub.endAt!.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    try {
      await sendMail(
        sub.user.email,
        `Gói ${sub.plan.name} sắp hết hạn`,
        `<p>Xin chào ${sub.user.name},</p>` +
          `<p>Gói ${sub.plan.name} của bạn sẽ hết hạn vào ngày ${endText}. ` +
          `Sau thời điểm này tài khoản sẽ chuyển về gói Free và Credit gói còn lại sẽ hết hạn.</p>` +
          `<p><a href="${appUrl}/pricing">Gia hạn ngay</a></p>`,
      );
      sent++;
    } catch (err) {
      await db.subscription.update({ where: { id: sub.id }, data: { remindedAt: null } });
      console.error(`[plan] gửi mail nhắc gia hạn thất bại cho subscription ${sub.id}`, err);
    }
  }
  return sent;
}
