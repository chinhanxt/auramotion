"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCreditBalance } from "@/components/realtime/Events";
import { Badge, Empty, Notice } from "@/components/ui/Bits";
import { Button, LinkButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { CoinMark } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { api, formatCredit } from "@/lib/api-client";
import { CreditPacks } from "./CreditPacks";
import {
  JOB_KIND_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
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

function txnDetail(t: Transaction): string {
  if (t.type === "charge") return "Xác nhận trừ khoản đã giữ";
  if (t.note) return t.note;
  if (t.jobKind) return JOB_KIND_LABEL[t.jobKind] ?? "";
  return "";
}

function Amount({ value }: { value: string }) {
  const n = Number(value);
  if (n === 0) return <span className="text-dim">—</span>;
  return (
    <span className={n > 0 ? "text-ok" : "text-fg"}>
      {n > 0 ? "+" : "−"}
      {formatCredit(Math.abs(n))}
    </span>
  );
}

export function CreditsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="skel h-56 rounded-m4" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skel h-[104px] rounded-m3" />
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skel h-48 rounded-m3" />
        ))}
      </div>
    </div>
  );
}

export function CreditsView({ packs }: { packs: CreditPack[] }) {
  const live = useCreditBalance();
  const [data, setData] = useState<CreditsData | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<"txn" | "pay">("txn");

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
      setData((d) => d && { ...d, transactions: [...d.transactions, ...page.transactions.filter((t) => !d.transactions.some((x) => x.id === t.id))], nextCursor: page.nextCursor });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!data) return error ? <Notice tone="danger">{error}</Notice> : <CreditsSkeleton />;
  const { balance, plan, subscription } = data;
  const available = live.balance ?? Number(balance.available);

  return (
    <div className="space-y-10">
      <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="grain relative overflow-hidden rounded-m4 bg-s1 p-6 hairline sm:p-8">
          <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full opacity-35 blur-3xl" style={{ background: "var(--aura)" }} />
          <p className="t-label relative">Khả dụng</p>
          <p className="relative mt-2 flex items-center gap-3 text-[clamp(2.75rem,2rem+3vw,4.5rem)] leading-none font-extrabold tracking-[-0.05em] tabular-nums">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f5c84b]/[.12] shadow-[inset_0_0_0_1px_rgba(245,200,75,.28)]">
              <CoinMark size={28} />
            </span>
            {formatCredit(available)}
          </p>
          <div className="relative mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <Badge tone="aura">{plan.name}</Badge>
              <span className="text-muted">{subscription.endAt ? `đến ${formatDate(subscription.endAt, false)}` : "không giới hạn"}</span>
            </span>
            <span className="text-muted">
              +{formatCredit(plan.monthlyCredits)} vào {formatDate(subscription.nextGrantAt, false)}
            </span>
          </div>
          <div className="relative mt-6 flex flex-wrap gap-2">
            <LinkButton href="/pricing" variant="primary" icon="sparkle">
              {plan.code === "free" ? "Nâng cấp" : "Gia hạn / đổi gói"}
            </LinkButton>
            <a href="#packs" className="press inline-flex h-10 items-center rounded-m1 px-4 text-sm font-medium text-fg/80 hover:bg-white/[.06]">
              Mua Credit lẻ
            </a>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Đang giữ", value: balance.held, hint: "tác vụ đang chạy" },
            { label: "Credit gói", value: balance.plan, hint: "hết hạn theo kỳ" },
            { label: "Credit mua", value: balance.purchased, hint: "không hết hạn" },
            { label: "Mỗi tháng", value: plan.monthlyCredits, hint: `gói ${plan.name}` },
          ].map((s, i) => (
            <div key={s.label} className="reveal rounded-m3 bg-s1 p-4 hairline" style={{ "--i": i } as React.CSSProperties}>
              <p className="text-xs text-muted">{s.label}</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">{formatCredit(s.value)}</p>
              <p className="mt-0.5 text-xs text-dim">{s.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="packs" className="scroll-mt-20 space-y-4">
        <h2 className="t-h2">Mua thêm Credit</h2>
        <CreditPacks packs={packs} returnTo="/credits" />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="t-h2">Lịch sử</h2>
          <Segmented
            size="sm"
            ariaLabel="Loại lịch sử"
            options={[
              { value: "txn" as const, label: "Giao dịch" },
              { value: "pay" as const, label: `Thanh toán${data.payments.some((p) => p.status === "PENDING") ? " •" : ""}` },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        {tab === "txn" ? (
          data.transactions.length === 0 ? (
            <Empty icon="coin" title="Chưa có giao dịch" className="py-10" />
          ) : (
            <div className="overflow-hidden rounded-m3 bg-s1 hairline">
              <ul className="divide-y divide-line">
                {data.transactions.map((t) => {
                  const detail = txnDetail(t);
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3.5 text-sm sm:px-5">
                      <div className="min-w-0 space-y-0.5">
                        <p className="flex items-center gap-2 font-medium">
                          {TXN_LABEL[t.type] ?? t.type}
                          <span className="rounded-md bg-white/[.06] px-1.5 py-0.5 text-[11px] font-normal text-muted">{t.bucket === "PLAN" ? "Gói" : "Mua"}</span>
                        </p>
                        <p className="truncate text-xs text-muted">
                          {formatDate(t.createdAt)}
                          {detail && ` · ${detail}`}
                          {t.jobId && (
                            <>
                              {" · "}
                              <Link href={`/library/${t.jobId}`} className="text-fg/80 underline-offset-2 hover:underline">
                                Xem
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums">
                        <Amount value={t.amount} />
                      </span>
                    </li>
                  );
                })}
              </ul>
              {data.nextCursor && (
                <div className="border-t border-line p-2">
                  <Button variant="ghost" block loading={loadingMore} onClick={loadMore}>
                    Xem thêm
                  </Button>
                </div>
              )}
            </div>
          )
        ) : data.payments.length === 0 ? (
          <Empty icon="qr" title="Chưa có đơn thanh toán" className="py-10" />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-m3 bg-s1 hairline">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3.5 text-sm sm:px-5">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">{paymentTitle(p)}</p>
                  <p className="text-xs text-muted">
                    {formatDate(p.createdAt)} · {p.refCode}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatVnd(p.amount)}</span>
                  {p.status === "PENDING" ? (
                    <Link href={`/credits/pay/${p.id}`} className={cx("press rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-ink")}>
                      Thanh toán
                    </Link>
                  ) : (
                    <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </section>
    </div>
  );
}
