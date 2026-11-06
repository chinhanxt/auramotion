import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/admin/ActionButton";
import { Badge, DataTable } from "@/components/admin/DataTable";
import { EntityForm } from "@/components/admin/EntityForm";
import { StatCard } from "@/components/admin/StatCard";
import { KIND_LABEL, TXN_LABEL, cardClass, formatDateTime } from "@/components/admin/format";
import { STATUS_COLOR, STATUS_LABEL, formatCredit } from "@/lib/api-client";
import { AppError } from "@/lib/errors";
import { getUserDetail } from "@/server/services/admin";
import { adminPage } from "../../guard";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await adminPage();
  const { id } = await params;
  const detail = await getUserDetail(id).catch((err: unknown) => {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  const { user, balance, subscription, transactions, jobs } = detail;
  const locked = user.status === "LOCKED";

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/users" className="text-sm text-neutral-600 hover:underline">
          ← Người dùng
        </Link>
        <h1 className="text-xl font-semibold">{user.email}</h1>
        {user.role === "ADMIN" && <Badge className="bg-purple-100 text-purple-800">Admin</Badge>}
        {locked ? <Badge className="bg-red-100 text-red-700">Đã khóa</Badge> : <Badge className="bg-green-100 text-green-800">Hoạt động</Badge>}
        {user.id !== admin.id && (
          <span className="ml-auto">
            <ActionButton
              url={`/api/admin/users/${user.id}`}
              method="PATCH"
              body={{ status: locked ? "ACTIVE" : "LOCKED" }}
              label={locked ? "Mở khóa" : "Khóa tài khoản"}
              confirmText={locked ? undefined : `Khóa tài khoản ${user.email}?`}
              danger={!locked}
            />
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Khả dụng" value={formatCredit(balance.available)} />
        <StatCard label="Credit gói" value={formatCredit(balance.plan)} />
        <StatCard label="Credit mua" value={formatCredit(balance.purchased)} />
        <StatCard label="Đang giữ" value={formatCredit(balance.held)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${cardClass} space-y-2 text-sm`}>
          <h2 className="font-medium text-neutral-500">Thông tin</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-neutral-500">Tên</dt>
            <dd>{user.name}</dd>
            <dt className="text-neutral-500">Đăng nhập</dt>
            <dd>{user.hasGoogle ? "Google" : "Email"}</dd>
            <dt className="text-neutral-500">Ngày tạo</dt>
            <dd>{formatDateTime(user.createdAt)}</dd>
            <dt className="text-neutral-500">Gói</dt>
            <dd>{subscription ? `${subscription.plan.name} (${subscription.period === "YEAR" ? "năm" : "tháng"})` : "—"}</dd>
            <dt className="text-neutral-500">Hết hạn</dt>
            <dd>{subscription?.endAt ? formatDateTime(subscription.endAt) : "Không"}</dd>
          </dl>
        </section>
        <section className={`${cardClass} space-y-2`}>
          <h2 className="text-sm font-medium text-neutral-500">Đổi gói</h2>
          <EntityForm
            url={`/api/admin/users/${user.id}`}
            method="PATCH"
            submitLabel="Đổi gói"
            initial={{ planCode: subscription?.plan.code ?? "free", period: subscription?.period ?? "MONTH" }}
            fields={[
              {
                name: "planCode",
                label: "Gói",
                type: "select",
                options: [
                  { value: "free", label: "Free" },
                  { value: "pro", label: "Pro" },
                  { value: "ultra", label: "Ultra" },
                ],
              },
              {
                name: "period",
                label: "Kỳ hạn",
                type: "select",
                options: [
                  { value: "MONTH", label: "Tháng" },
                  { value: "YEAR", label: "Năm" },
                ],
              },
            ]}
          />
        </section>
        <section className={`${cardClass} space-y-2`}>
          <h2 className="text-sm font-medium text-neutral-500">Cộng / trừ Credit</h2>
          <EntityForm
            url={`/api/admin/users/${user.id}/credits`}
            method="POST"
            submitLabel="Điều chỉnh"
            resetOnSuccess
            fields={[
              { name: "amount", label: "Số Credit (âm để trừ)", type: "number", placeholder: "50" },
              { name: "reason", label: "Lý do (bắt buộc)", type: "text", placeholder: "Bù lỗi tác vụ" },
            ]}
          />
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-500">Lịch sử Credit (50 gần nhất)</h2>
        <DataTable
          rows={transactions}
          rowKey={(t) => t.id}
          columns={[
            { header: "Thời gian", cell: (t) => formatDateTime(t.createdAt), className: "whitespace-nowrap" },
            { header: "Loại", cell: (t) => TXN_LABEL[t.type] ?? t.type },
            { header: "Nguồn", cell: (t) => (t.bucket === "PLAN" ? "Gói" : "Mua") },
            {
              header: "Số Credit",
              cell: (t) => {
                const n = t.amount.toNumber();
                return <span className={n < 0 ? "text-red-700" : "text-green-700"}>{`${n > 0 ? "+" : ""}${formatCredit(n)}`}</span>;
              },
              className: "text-right",
            },
            { header: "Ghi chú", cell: (t) => t.note ?? "" },
          ]}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-500">Lịch sử tạo (50 gần nhất)</h2>
        <DataTable
          rows={jobs}
          rowKey={(j) => j.id}
          columns={[
            { header: "Thời gian", cell: (j) => formatDateTime(j.createdAt), className: "whitespace-nowrap" },
            { header: "Loại", cell: (j) => KIND_LABEL[j.kind] },
            { header: "Engine", cell: (j) => j.model.name },
            { header: "Prompt", cell: (j) => <span className="line-clamp-2 max-w-sm">{j.prompt}</span> },
            { header: "Credit", cell: (j) => formatCredit(j.cost.toNumber()), className: "text-right" },
            {
              header: "Trạng thái",
              cell: (j) => (
                <span className="space-y-1">
                  <Badge className={STATUS_COLOR[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                  {j.deletedAt && <span className="block text-xs text-neutral-500">Người dùng đã xóa</span>}
                  {j.error && <span className="block text-xs text-red-700">{j.error}</span>}
                </span>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
