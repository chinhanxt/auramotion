import Link from "next/link";
import { Badge, DataTable, Pager } from "@/components/admin/DataTable";
import { buttonClass, formatDateTime, inputClass } from "@/components/admin/format";
import { formatCredit } from "@/lib/api-client";
import { listUsers } from "@/server/services/admin";
import { adminPage, one, type SearchParams } from "../guard";

const PLANS = [
  { value: "", label: "Tất cả gói" },
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "ultra", label: "Ultra" },
];

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  const search = one(sp.search);
  const planRaw = one(sp.plan);
  const plan = PLANS.some((p) => p.value && p.value === planRaw) ? (planRaw as "free" | "pro" | "ultra") : undefined;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const result = await listUsers({ search, plan, page });

  return (
    <>
      <h1 className="text-xl font-semibold">Người dùng</h1>
      <form className="flex flex-wrap gap-2" action="/admin/users">
        <input name="search" defaultValue={search} placeholder="Tìm theo email" className={`${inputClass} max-w-xs`} />
        <select name="plan" defaultValue={plan ?? ""} className={`${inputClass} w-40`}>
          {PLANS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass}>
          Lọc
        </button>
      </form>
      <DataTable
        rows={result.items}
        rowKey={(u) => u.id}
        columns={[
          {
            header: "Email",
            cell: (u) => (
              <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                {u.email}
              </Link>
            ),
          },
          { header: "Tên", cell: (u) => u.name },
          { header: "Gói", cell: (u) => u.planCode ?? "—" },
          { header: "Khả dụng", cell: (u) => formatCredit(u.available), className: "text-right" },
          {
            header: "Trạng thái",
            cell: (u) => (
              <span className="flex gap-1">
                {u.role === "ADMIN" && <Badge className="bg-purple-100 text-purple-800">Admin</Badge>}
                {u.status === "LOCKED" ? (
                  <Badge className="bg-red-100 text-red-700">Đã khóa</Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-800">Hoạt động</Badge>
                )}
              </span>
            ),
          },
          { header: "Ngày tạo", cell: (u) => formatDateTime(u.createdAt), className: "whitespace-nowrap" },
        ]}
      />
      <Pager basePath="/admin/users" query={{ search, plan }} page={result.page} total={result.total} pageSize={result.pageSize} />
    </>
  );
}
