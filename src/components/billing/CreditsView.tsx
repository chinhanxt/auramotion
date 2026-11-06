"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, formatCredit } from "@/lib/api-client";
import { CreditPacks } from "./CreditPacks";
import {
  JOB_KIND_LABEL,
  PAYMENT_STATUS_COLOR,
  PAYMENT_STATUS_LABEL,
  TXN_LABEL,
  formatDate,
  formatVnd,
  paymentTitle,
  type CreditPack,
  type PaymentSummary,
} from "./labels";

type Transaction = {
  id: string;
  type: string;
  bucket: "PLAN" | "PURCHASED";
  amount: string;
  note: string | null;
  jobId: string | null;
  jobKind: string | null;
  createdAt: string;
};

type CreditsData = {
  balance: { available: string; plan: string; purchased: string; held: string };
  plan: { code: string; name: string; monthlyCredits: string };
  subscription: { period: "MONTH" | "YEAR"; startAt: string; endAt: string | null; nextGrantAt: string };
  transactions: Transaction[];
  nextCursor: string | null;
  payments: PaymentSummary[];
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

function Amount({ value }: { value: string }) {
  const n = Number(value);
  if (n === 0) return <span className="text-neutral-400">—</span>;
  return (
    <span className={n > 0 ? "text-green-700" : "text-neutral-900"}>
      {n > 0 ? "+" : "−"}
      {formatCredit(Math.abs(n))}
    </span>
  );
}

function txnDetail(t: Transaction): string {
  if (t.type === "charge") return "Xác nhận trừ khoản đã giữ";
  if (t.note) return t.note;
  if (t.jobKind) return JOB_KIND_LABEL[t.jobKind] ?? "";
  return "";
}

export function CreditsView({ packs }: { packs: CreditPack[] }) {
  const [data, setData] = useState<CreditsData | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api<CreditsData>("/api/credits")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function loadMore() {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api<CreditsData>(`/api/credits?cursor=${encodeURIComponent(data.nextCursor)}`);
      setData((d) =>
        d && {
          ...d,
          transactions: [...d.transactions, ...page.transactions.filter((t) => !d.transactions.some((x) => x.id === t.id))],
          nextCursor: page.nextCursor,
        },
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!data) {
    return error ? (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
    ) : (
      <p className="text-sm text-neutral-500">Đang tải...</p>
    );
  }

  const { balance, plan, subscription } = data;

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Khả dụng" value={formatCredit(balance.available)} hint="Credit có thể dùng ngay" />
        <Stat label="Đang giữ" value={formatCredit(balance.held)} hint="Cho tác vụ đang chạy" />
        <Stat label="Credit gói" value={formatCredit(balance.plan)} hint="Hết hạn khi sang kỳ mới" />
        <Stat label="Credit mua" value={formatCredit(balance.purchased)} hint="Không hết hạn" />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm">
          <p>
            Gói hiện tại: <span className="font-semibold">{plan.name}</span>
            {subscription.endAt && <span className="text-neutral-500"> ({subscription.period === "YEAR" ? "theo năm" : "theo tháng"})</span>}
          </p>
          <p className="text-neutral-600">
            {subscription.endAt ? `Hết hạn: ${formatDate(subscription.endAt, false)}` : "Không giới hạn thời gian"}
            {" · "}
            Cấp lại {formatCredit(plan.monthlyCredits)} Credit gói vào {formatDate(subscription.nextGrantAt, false)}
          </p>
        </div>
        <Link
          href="/pricing"
          className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-neutral-800"
        >
          {plan.code === "free" ? "Nâng cấp gói" : "Gia hạn / đổi gói"}
        </Link>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Mua thêm Credit</h2>
          <p className="text-sm text-neutral-600">Thanh toán bằng QR chuyển khoản, Credit được cộng ngay khi nhận tiền.</p>
        </div>
        <CreditPacks packs={packs} returnTo="/credits" />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Lịch sử giao dịch</h2>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-neutral-500">Chưa có giao dịch.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
            {data.transactions.map((t) => {
              const detail = txnDetail(t);
              return (
                <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium">
                      {TXN_LABEL[t.type] ?? t.type}
                      <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-normal text-neutral-600">
                        {t.bucket === "PLAN" ? "Gói" : "Mua"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {formatDate(t.createdAt)}
                      {detail && ` · ${detail}`}
                      {t.jobId && (
                        <>
                          {" · "}
                          <Link href={`/library/${t.jobId}`} className="underline hover:text-neutral-800">
                            Xem tác vụ
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">
                    <Amount value={t.amount} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {data.nextCursor && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full rounded-md border border-neutral-300 bg-white py-2 text-sm hover:bg-neutral-100 disabled:opacity-50"
          >
            {loadingMore ? "Đang tải..." : "Xem thêm"}
          </button>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Lịch sử thanh toán</h2>
        {data.payments.length === 0 ? (
          <p className="text-sm text-neutral-500">Chưa có đơn thanh toán.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">{paymentTitle(p)}</p>
                  <p className="text-xs text-neutral-500">
                    {formatDate(p.createdAt)} · Mã {p.refCode}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-medium tabular-nums">{formatVnd(p.amount)}</span>
                  {p.status === "PENDING" ? (
                    <Link href={`/credits/pay/${p.id}`} className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_COLOR.PENDING}`}>
                      Thanh toán
                    </Link>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_COLOR[p.status]}`}>
                      {PAYMENT_STATUS_LABEL[p.status]}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
