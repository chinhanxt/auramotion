"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, formatCredit } from "@/lib/api-client";
import { PAYMENT_STATUS_COLOR, PAYMENT_STATUS_LABEL, formatVnd, paymentTitle, type PaymentSummary } from "./labels";

const POLL_MS = 3000;
const REDIRECT_MS = 3000;

export type PaymentDetail = PaymentSummary & { qrUrl: string };
export type BankInfo = { bankId: string; account: string; accountName: string };

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="flex items-center gap-2 text-right font-medium break-all">
        {value}
        {copy && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {});
            }}
            className="shrink-0 rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-normal hover:bg-neutral-100"
          >
            {copied ? "Đã chép" : "Chép"}
          </button>
        )}
      </span>
    </div>
  );
}

export function PaymentView({ initial, bank }: { initial: PaymentDetail; bank: BankInfo }) {
  const router = useRouter();
  const [payment, setPayment] = useState(initial);
  // Chốt trạng thái lúc mở trang: router.refresh() render lại server nên prop `initial` cũng thành SUCCEEDED.
  const [paidOnOpen] = useState(initial.status === "SUCCEEDED");

  useEffect(() => {
    if (payment.status !== "PENDING") return;
    const timer = setInterval(async () => {
      try {
        setPayment(await api<PaymentDetail>(`/api/payments/${payment.id}`));
      } catch {
        // lỗi mạng tạm thời: lần poll sau thử lại
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [payment.id, payment.status]);

  useEffect(() => {
    if (payment.status !== "SUCCEEDED" || paidOnOpen) return;
    router.refresh();
    const timer = setTimeout(() => router.push("/credits"), REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [payment.status, paidOnOpen, router]);

  const title = paymentTitle(payment);

  if (payment.status === "SUCCEEDED") {
    return (
      <div className="space-y-4 rounded-xl border border-green-200 bg-white p-6 text-center">
        <p className="text-lg font-semibold text-green-700">Thanh toán thành công</p>
        <p className="text-sm text-neutral-700">
          {payment.type === "PLAN"
            ? `Đã kích hoạt ${title}.`
            : `Đã cộng ${formatCredit(payment.creditAmount ?? 0)} Credit vào tài khoản.`}
        </p>
        {!paidOnOpen && <p className="text-xs text-neutral-500">Đang chuyển về trang Credit...</p>}
        <Link href="/credits" className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Về trang Credit
        </Link>
      </div>
    );
  }

  if (payment.status === "CANCELED") {
    return (
      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 text-center">
        <p className="text-lg font-semibold">Đơn đã hủy</p>
        <p className="text-sm text-neutral-600">Đơn {title} đã bị hủy. Bạn có thể tạo đơn mới ở trang Bảng giá.</p>
        <Link href="/pricing" className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Xem bảng giá
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 rounded-xl border border-neutral-200 bg-white p-4 sm:p-6 md:grid-cols-2">
      <div className="flex flex-col items-center gap-3">
        <img src={payment.qrUrl} alt="Mã QR chuyển khoản" className="w-full max-w-72 rounded-md border border-neutral-200" />
        <p className="text-center text-xs text-neutral-500">Mở app ngân hàng, quét mã QR để chuyển khoản.</p>
      </div>
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_COLOR[payment.status]}`}>
              {PAYMENT_STATUS_LABEL[payment.status]}
            </span>
          </div>
          <p className="text-2xl font-semibold">{formatVnd(payment.amount)}</p>
        </div>
        <div className="divide-y divide-neutral-100 border-y border-neutral-100">
          {bank.bankId && <Row label="Ngân hàng" value={bank.bankId} />}
          {bank.account && <Row label="Số tài khoản" value={bank.account} copy />}
          {bank.accountName && <Row label="Chủ tài khoản" value={bank.accountName} />}
          <Row label="Số tiền" value={String(payment.amount)} copy />
          <Row label="Nội dung chuyển khoản" value={payment.refCode} copy />
        </div>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ghi đúng nội dung <span className="font-semibold">{payment.refCode}</span> và chuyển đủ số tiền. Hệ thống tự kích hoạt
          sau khi nhận tiền.
        </p>
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          Đang chờ thanh toán...
        </p>
      </div>
    </div>
  );
}
