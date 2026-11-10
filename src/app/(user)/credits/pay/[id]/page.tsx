import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { PaymentDetail } from "@/components/billing/PaymentView";
import { PaymentView } from "@/components/billing/PaymentView";
import { Icon } from "@/components/ui/Icon";
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
    <div className="mx-auto max-w-[1100px] px-3 pt-3 pb-16 sm:px-5 lg:px-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="t-h2">Thanh toán</h1>
        <Link href="/credits" className="press inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
          <Icon name="arrowLeft" size={16} /> Credit
        </Link>
      </div>
      <PaymentView initial={initial} bank={bank} />
    </div>
  );
}
