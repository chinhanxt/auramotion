import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Prisma, type BillingPeriod, type Payment } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { grant, publishCredit } from "@/server/services/credit";
import { getPaymentQr } from "@/server/services/payment-qr";
import { activatePlan } from "@/server/services/plan";
import { getSetting } from "@/server/services/settings";

export type OrderInput =
  | { type: "PLAN"; planCode: "pro" | "ultra"; period: BillingPeriod }
  | { type: "CREDIT"; credits: 100 | 500 | 1000 };

export type PublicPayment = Pick<
  Payment,
  "id" | "type" | "planCode" | "period" | "creditAmount" | "amount" | "refCode" | "status" | "paidAt" | "createdAt"
>;
export type PaymentWithQr = PublicPayment & { qrUrl: string; qrStatic: boolean; qrNote?: string };

const REF_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// Lookahead để lấy cả các ứng viên chồng lấn, vd "NAMAM12345678" → "AMAM123456", "AM12345678".
const REF_PATTERN = /(?=(AM[A-Z0-9]{8}))/g;

const webhookSchema = z.object({
  transactionId: z.union([z.string().min(1), z.number()]).transform(String),
  amount: z.coerce.number().int(),
  description: z.string(),
});

function newRefCode(): string {
  let code = "AM";
  for (let i = 0; i < 8; i++) code += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return code;
}

function qrUrl(amount: number, refCode: string): string {
  const bankId = process.env.BANK_ID ?? "";
  const account = process.env.BANK_ACCOUNT ?? "";
  const name = encodeURIComponent(process.env.BANK_ACCOUNT_NAME ?? "");
  return `https://img.vietqr.io/image/${bankId}-${account}-compact2.png?amount=${amount}&addInfo=${refCode}&accountName=${name}`;
}

// Chỉ trả trường người dùng cần (bỏ providerTxnId, confirmedBy, userId).
async function withQr(p: Payment): Promise<PaymentWithQr> {
  // Admin đã tải mã QR riêng lên thì dùng ảnh đó (không nhúng số tiền / nội dung); chưa có thì dùng QR tự sinh (VietQR).
  const own = await getPaymentQr();
  return {
    id: p.id,
    type: p.type,
    planCode: p.planCode,
    period: p.period,
    creditAmount: p.creditAmount,
    amount: p.amount,
    refCode: p.refCode,
    status: p.status,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    qrUrl: own ? own.url : qrUrl(p.amount, p.refCode),
    qrStatic: Boolean(own),
    ...(own?.note ? { qrNote: own.note } : {}),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function createOrder(userId: string, input: OrderInput): Promise<PaymentWithQr> {
  let data: Omit<Prisma.PaymentUncheckedCreateInput, "refCode">;
  if (input.type === "PLAN") {
    const plan = await db.plan.findUniqueOrThrow({ where: { code: input.planCode } });
    data = {
      userId,
      type: "PLAN",
      planCode: input.planCode,
      period: input.period,
      amount: input.period === "YEAR" ? plan.priceYear : plan.priceMonth,
    };
  } else {
    const packs = await getSetting<{ credits: number; price: number }[]>("credit_packs");
    const pack = packs.find((p) => p.credits === input.credits);
    if (!pack) throw new AppError("VALIDATION", "Gói Credit không tồn tại");
    data = { userId, type: "CREDIT", creditAmount: pack.credits, amount: pack.price };
  }

  // refCode trùng (rất hiếm) thì sinh lại.
  for (let attempt = 0; ; attempt++) {
    try {
      return await withQr(await db.payment.create({ data: { ...data, refCode: newRefCode() } }));
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= 4) throw err;
    }
  }
}

export async function getPayment(userId: string, paymentId: string): Promise<PaymentWithQr> {
  const payment = await db.payment.findFirst({ where: { id: paymentId, userId } });
  if (!payment) throw new AppError("NOT_FOUND", "Không tìm thấy đơn thanh toán");
  return await withQr(payment);
}

// Chuyển PENDING → SUCCEEDED và kích hoạt gói / cộng Credit trong cùng 1 transaction.
// Chỉ một lời gọi thắng được updateMany; các lời gọi còn lại (webhook lặp, admin bấm lại) trả false.
export async function fulfillPayment(
  paymentId: string,
  opts: { providerTxnId?: string; confirmedBy?: string },
): Promise<boolean> {
  let userId: string | null = null;
  const done = await db.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "SUCCEEDED", paidAt: now, providerTxnId: opts.providerTxnId, confirmedBy: opts.confirmedBy },
    });
    if (claimed.count === 0) return false;

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    userId = payment.userId;
    if (payment.type === "PLAN") {
      if (payment.planCode !== "pro" && payment.planCode !== "ultra") throw new AppError("INTERNAL", "Đơn gói không hợp lệ");
      await activatePlan(payment.userId, payment.planCode, payment.period ?? "MONTH", now, tx);
    } else {
      await grant(
        payment.userId,
        payment.creditAmount!,
        { type: "purchase", paymentId: payment.id, note: `Mua ${payment.creditAmount!.toFixed(0)} Credit` },
        tx,
      );
    }
    return true;
  });
  if (done && userId) await publishCredit(userId);
  return done;
}

function verifySignature(rawBody: string, signature: string | null): void {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const hex = signature?.trim() ?? "";
  if (!secret || !/^[0-9a-f]{64}$/i.test(hex)) throw new AppError("UNAUTHORIZED", "Chữ ký webhook không hợp lệ");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  if (!timingSafeEqual(Buffer.from(hex, "hex"), expected)) {
    throw new AppError("UNAUTHORIZED", "Chữ ký webhook không hợp lệ");
  }
}

// Định dạng chung { transactionId, amount, description }; header x-signature = HMAC-SHA256 hex của raw body.
export async function handleWebhook(rawBody: string, signature: string | null): Promise<{ ok: true }> {
  verifySignature(rawBody, signature);

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new AppError("VALIDATION", "Dữ liệu webhook không hợp lệ");
  }
  const body = webhookSchema.parse(json);

  const candidates = [...body.description.toUpperCase().matchAll(REF_PATTERN)].map((m) => m[1]);
  if (candidates.length === 0) return { ok: true };

  const processed = await db.payment.findUnique({ where: { providerTxnId: body.transactionId } });
  if (processed) return { ok: true };

  const payment = await db.payment.findFirst({ where: { refCode: { in: candidates }, status: "PENDING" } });
  if (!payment) return { ok: true };

  if (body.amount < payment.amount) {
    console.warn(
      `[payment] ${payment.refCode} chuyển thiếu: nhận ${body.amount}, cần ${payment.amount} (giao dịch ${body.transactionId})`,
    );
    return { ok: true };
  }

  try {
    await fulfillPayment(payment.id, { providerTxnId: body.transactionId });
  } catch (err) {
    // Cùng providerTxnId đang được xử lý song song cho đơn khác.
    if (!isUniqueViolation(err)) throw err;
  }
  return { ok: true };
}
