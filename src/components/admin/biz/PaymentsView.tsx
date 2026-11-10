"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { DataList, Mono, PageHeader, Pager, UrlFilters } from "@/components/admin/kit";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, formatDateTime, formatVnd } from "@/components/admin/format";
import type { Plain } from "@/components/admin/plain";
import { Badge } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { api, formatCredit } from "@/lib/api-client";
import type { listPayments } from "@/server/services/admin";

type Data = Plain<Awaited<ReturnType<typeof listPayments>>>;
type Row = Data["items"][number];

const PLAN_NAME: Record<string, string> = { free: "Free", pro: "Pro", ultra: "Ultra" };

function describe(p: Row) {
  if (p.type === "CREDIT") return { icon: "coin" as const, text: `${formatCredit(p.creditAmount ?? 0)} Credit` };
  return { icon: "tag" as const, text: `Gói ${PLAN_NAME[p.planCode ?? ""] ?? p.planCode ?? ""} · ${p.period === "YEAR" ? "năm" : "tháng"}` };
}

export function PaymentsView({ data }: { data: Data }) {
  const router = useRouter();
  const { run, isBusy } = useAction();
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [done, setDone] = useState<Record<string, true>>({});

  async function confirmPay(p: Row) {
    const ok = await run(p.id, () => api(`/api/admin/payments/${p.id}/confirm`, jsonInit("POST")), { success: `Đã xác nhận ${p.refCode}` });
    setConfirm(null);
    if (ok) {
      setDone((d) => ({ ...d, [p.id]: true }));
      router.refresh();
    }
  }

  const pendingHere = data.items.filter((p) => p.status === "PENDING" && !done[p.id]).length;

  return (
    <>
      <PageHeader
        icon="card"
        title="Thanh toán"
        sub={
          <span className="flex items-center gap-2">
            {data.total.toLocaleString("vi-VN")} đơn
            {pendingHere > 0 && (
              <Badge tone="warn" dot>
                {pendingHere} chờ
              </Badge>
            )}
          </span>
        }
      />
      <UrlFilters
        fields={[
          { name: "search", type: "search", placeholder: "Mã đơn / email" },
          {
            name: "status",
            type: "chips",
            options: [
              { value: "", label: "Tất cả" },
              { value: "PENDING", label: "Chờ" },
              { value: "SUCCEEDED", label: "Thành công" },
              { value: "CANCELED", label: "Hủy" },
            ],
          },
        ]}
      />
      <DataList<Row>
        rows={data.items}
        rowKey={(p) => p.id}
        cols={[
          { key: "time", label: "Tạo lúc", cell: (p) => <span className="whitespace-nowrap text-muted">{formatDateTime(p.createdAt)}</span> },
          { key: "ref", label: "Mã đơn", mobile: "title", cell: (p) => <Mono className="text-[13px] text-fg">{p.refCode}</Mono> },
          { key: "user", label: "Người dùng", cell: (p) => <span className="block max-w-56 truncate">{p.user.email}</span> },
          {
            key: "what",
            label: "Nội dung",
            cell: (p) => {
              const d = describe(p);
              return (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Icon name={d.icon} size={15} className="text-muted" />
                  {d.text}
                </span>
              );
            },
          },
          { key: "amount", label: "Số tiền", align: "right", cell: (p) => <span className="font-semibold whitespace-nowrap tabular-nums">{formatVnd(p.amount)}</span> },
          {
            key: "status",
            label: "Trạng thái",
            cell: (p) => {
              const status = done[p.id] ? "SUCCEEDED" : p.status;
              return (
                <span className="inline-flex flex-col items-end gap-0.5 md:items-start">
                  <Badge tone={PAYMENT_STATUS_TONE[status]} dot>
                    {PAYMENT_STATUS_LABEL[status]}
                  </Badge>
                  {p.paidAt && <span className="text-xs text-dim">{formatDateTime(p.paidAt)}</span>}
                  {(p.confirmedBy || done[p.id]) && <span className="text-xs text-dim">Admin xác nhận</span>}
                </span>
              );
            },
          },
          {
            key: "act",
            label: "",
            align: "right",
            mobile: "actions",
            cell: (p) =>
              p.status === "PENDING" && !done[p.id] ? (
                <Button size="sm" variant="outline" icon="check" loading={isBusy(p.id)} onClick={() => setConfirm(p)}>
                  Xác nhận
                </Button>
              ) : null,
          },
        ]}
      />
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} />
      <ConfirmDialog
        open={confirm !== null}
        title="Xác nhận đã nhận tiền?"
        body={confirm ? `${formatVnd(confirm.amount)} · ${confirm.refCode} · ${confirm.user.email}` : undefined}
        confirmLabel="Đã nhận"
        busy={confirm ? isBusy(confirm.id) : false}
        onConfirm={() => confirm && confirmPay(confirm)}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
