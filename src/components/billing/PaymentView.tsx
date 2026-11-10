"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCreditBalance } from "@/components/realtime/Events";
import { Badge } from "@/components/ui/Bits";
import { LinkButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { api, formatCredit } from "@/lib/api-client";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, formatVnd, paymentTitle, type PaymentSummary } from "./labels";

const POLL_MS = 3000;
const REDIRECT_MS = 3000;

export type PaymentDetail = PaymentSummary & { qrUrl: string };
export type BankInfo = { bankId: string; account: string; accountName: string };

function Row({ label, value, display, copy, strong }: { label: string; value: string; display?: string; copy?: boolean; strong?: boolean }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx("text-right break-all", strong ? "text-base font-bold text-accent" : "text-sm font-semibold")}>{display ?? value}</span>
        {copy && (
          <button
            type="button"
            aria-label={`Chép ${label.toLowerCase()}`}
            onClick={() =>
              navigator.clipboard?.writeText(value).then(
                () => {
                  setCopied(true);
                  toast.success(`Đã chép ${label.toLowerCase()}`, { duration: 1800 });
                  setTimeout(() => setCopied(false), 1600);
                },
                () => {},
              )
            }
            className={cx("press flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] hover:bg-white/[.08]", copied ? "text-accent" : "text-muted")}
          >
            <Icon name={copied ? "check" : "copy"} size={16} />
          </button>
        )}
      </span>
    </div>
  );
}

export function PaymentView({ initial, bank }: { initial: PaymentDetail; bank: BankInfo }) {
  const router = useRouter();
  const { refresh } = useCreditBalance();
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
    refresh();
    router.refresh();
    const timer = setTimeout(() => router.push("/credits"), REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [payment.status, paidOnOpen, router, refresh]);

  const title = paymentTitle(payment);

  if (payment.status !== "PENDING") {
    const ok = payment.status === "SUCCEEDED";
    return (
      <div className="pop-in relative mx-auto flex max-w-xl flex-col items-center gap-4 overflow-hidden rounded-m4 bg-s1 p-8 text-center hairline sm:p-12">
        {ok && <div className="pointer-events-none absolute -top-20 h-48 w-72 rounded-full opacity-40 blur-3xl" style={{ background: "var(--aura)" }} />}
        <span className={cx("relative flex h-16 w-16 items-center justify-center rounded-full", ok ? "bg-accent text-accent-ink" : "bg-white/[.08] text-muted")}>
          <Icon name={ok ? "check" : "close"} size={30} strokeWidth={2.2} />
        </span>
        <p className="t-h2 relative">{ok ? "Thanh toán thành công" : "Đơn đã hủy"}</p>
        <p className="relative text-sm text-muted">
          {ok ? (payment.type === "PLAN" ? `Đã kích hoạt ${title}.` : `Đã cộng ${formatCredit(payment.creditAmount ?? 0)} Credit.`) : `Đơn ${title} đã bị hủy.`}
        </p>
        {ok && !paidOnOpen && <p className="relative text-xs text-dim">Đang chuyển về trang Credit…</p>}
        <LinkButton href={ok ? "/credits" : "/pricing"} variant={ok ? "primary" : "outline"} className="relative">
          {ok ? "Về trang Credit" : "Xem bảng giá"}
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_1fr]">
      <div className="relative overflow-hidden rounded-m4 bg-s1 p-5 hairline sm:p-7">
        <div className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-64 w-64 rounded-full opacity-30 blur-3xl" style={{ background: "var(--aura)" }} />
        <div className="relative mx-auto aspect-square w-full max-w-[340px] rounded-m3 bg-white p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)]">
          <img src={payment.qrUrl} alt="Mã QR chuyển khoản" className="h-full w-full object-contain" />
        </div>
        <p className="relative mt-5 flex items-center justify-center gap-2 text-sm text-muted">
          <Icon name="qr" size={16} /> Mở app ngân hàng và quét mã
        </p>
      </div>

      <div className="space-y-4 rounded-m4 bg-s1 p-5 hairline sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted">{title}</p>
          <Badge tone={PAYMENT_STATUS_TONE[payment.status]} dot>
            {PAYMENT_STATUS_LABEL[payment.status]}
          </Badge>
        </div>
        <p className="text-[clamp(2.25rem,1.8rem+2vw,3.25rem)] leading-none font-extrabold tracking-[-0.045em] tabular-nums">{formatVnd(payment.amount)}</p>
        <div className="divide-y divide-line border-y border-line">
          {bank.bankId && <Row label="Ngân hàng" value={bank.bankId} />}
          {bank.account && <Row label="Số tài khoản" value={bank.account} copy />}
          {bank.accountName && <Row label="Chủ tài khoản" value={bank.accountName} />}
          <Row label="Số tiền" value={String(payment.amount)} display={formatVnd(payment.amount)} copy />
          <Row label="Nội dung" value={payment.refCode} copy strong />
        </div>
        <p className="rounded-m2 bg-warn/[.08] px-4 py-3 text-sm text-fg/80 shadow-[inset_0_0_0_1px_rgba(255,198,92,.2)]">
          Ghi đúng nội dung <b className="text-warn">{payment.refCode}</b> và chuyển đủ số tiền. Hệ thống tự kích hoạt khi nhận tiền.
        </p>
        <div className="flex items-center gap-3 rounded-m2 bg-white/[.03] px-4 py-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 rounded-full bg-warn opacity-50 blur-[4px]" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-warn" />
          </span>
          <span className="text-sm text-fg/80">Đang chờ thanh toán</span>
          <span className="ml-auto w-24">
            <span className="aura-bar block" data-indeterminate="">
              <i />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
