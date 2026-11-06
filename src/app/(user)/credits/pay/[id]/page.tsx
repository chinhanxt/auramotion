import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { PaymentDetail } from "@/components/billing/PaymentView";
import { PaymentView } from "@/components/billing/PaymentView";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { getPayment } from "@/server/services/payment";

export const metadata = { title: "Thanh toán · AuraMotion" };

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  // getPayment lọc theo userId: đơn của người khác trả NOT_FOUND.
  const payment = await getPayment(user.id, id).catch((err: unknown) => {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  });

  const initial: PaymentDetail = {
    id: payment.id,
    type: payment.type,
    planCode: payment.planCode,
    period: payment.period,
    creditAmount: payment.creditAmount?.toString() ?? null,
    amount: payment.amount,
    refCode: payment.refCode,
    status: payment.status,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    qrUrl: payment.qrUrl,
  };
  const bank = {
    bankId: process.env.BANK_ID ?? "",
    account: process.env.BANK_ACCOUNT ?? "",
    accountName: process.env.BANK_ACCOUNT_NAME ?? "",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Thanh toán QR</h1>
        <Link href="/credits" className="text-sm text-neutral-600 hover:underline">
          ← Trang Credit
        </Link>
      </div>
      <PaymentView initial={initial} bank={bank} />
    </div>
  );
}
