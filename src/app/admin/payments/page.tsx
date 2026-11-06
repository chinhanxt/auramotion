import type { Payment } from "@prisma/client";
import { ActionButton } from "@/components/admin/ActionButton";
import { Badge, DataTable, Pager } from "@/components/admin/DataTable";
import {
  PAYMENT_STATUS_COLOR,
  PAYMENT_STATUS_LABEL,
  buttonClass,
  formatDateTime,
  formatVnd,
  inputClass,
} from "@/components/admin/format";
import { formatCredit } from "@/lib/api-client";
import { listPayments } from "@/server/services/admin";
import { adminPage, one, type SearchParams } from "../guard";

type PaymentStatus = keyof typeof PAYMENT_STATUS_LABEL;
const STATUSES = Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[];

function describe(p: Payment): string {
  if (p.type === "CREDIT") return `${formatCredit(p.creditAmount?.toNumber() ?? 0)} Credit`;
  return `Gói ${p.planCode ?? ""} (${p.period === "YEAR" ? "năm" : "tháng"})`;
}

export default async function AdminPaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  const statusRaw = one(sp.status);
  const status = STATUSES.includes(statusRaw as PaymentStatus) ? (statusRaw as PaymentStatus) : undefined;
  const search = one(sp.search);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const result = await listPayments({ status, search, page });

  return (
    <>
      <h1 className="text-xl font-semibold">Thanh toán</h1>
      <form className="flex flex-wrap gap-2" action="/admin/payments">
        <select name="status" defaultValue={status ?? ""} className={`${inputClass} w-40`}>
          <option value="">Mọi trạng thái</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PAYMENT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input name="search" defaultValue={search} placeholder="Mã đơn hoặc email" className={`${inputClass} max-w-xs`} />
        <button type="submit" className={buttonClass}>
          Lọc
        </button>
      </form>
      <DataTable
        rows={result.items}
        rowKey={(p) => p.id}
        columns={[
          { header: "Tạo lúc", cell: (p) => formatDateTime(p.createdAt), className: "whitespace-nowrap" },
          { header: "Mã đơn", cell: (p) => <span className="font-mono text-xs">{p.refCode}</span> },
          { header: "Người dùng", cell: (p) => p.user.email },
          { header: "Nội dung", cell: describe },
          { header: "Số tiền", cell: (p) => formatVnd(p.amount), className: "text-right whitespace-nowrap" },
          {
            header: "Trạng thái",
            cell: (p) => (
              <span className="space-y-1">
                <Badge className={PAYMENT_STATUS_COLOR[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                {p.paidAt && <span className="block text-xs text-neutral-500">{formatDateTime(p.paidAt)}</span>}
                {p.confirmedBy && <span className="block text-xs text-neutral-500">Admin xác nhận</span>}
              </span>
            ),
          },
          {
            header: "Thao tác",
            cell: (p) =>
              p.status === "PENDING" ? (
                <ActionButton
                  url={`/api/admin/payments/${p.id}/confirm`}
                  label="Xác nhận"
                  confirmText={`Xác nhận đã nhận ${formatVnd(p.amount)} cho đơn ${p.refCode}?`}
                />
              ) : null,
          },
        ]}
      />
      <Pager basePath="/admin/payments" query={{ status, search }} page={result.page} total={result.total} pageSize={result.pageSize} />
    </>
  );
}
