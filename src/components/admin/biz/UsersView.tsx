"use client";

import Link from "next/link";
import { DataList, PageHeader, Pager, UrlFilters } from "@/components/admin/kit";
import { formatDateTime } from "@/components/admin/format";
import type { Plain } from "@/components/admin/plain";
import { Avatar, Badge } from "@/components/ui/Bits";
import { formatCredit } from "@/lib/api-client";
import type { listUsers } from "@/server/services/admin";

type Data = Plain<Awaited<ReturnType<typeof listUsers>>>;
type Row = Data["items"][number];

export const PLAN_TONE = { free: "neutral", pro: "info", ultra: "aura" } as const;
export const PLAN_NAME = { free: "Free", pro: "Pro", ultra: "Ultra" } as const;

export function UserBadges({ role, status }: { role: string; status: string }) {
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {role === "ADMIN" && <Badge tone="accent">Admin</Badge>}
      {status === "LOCKED" ? (
        <Badge tone="danger" dot>
          Đã khóa
        </Badge>
      ) : (
        <Badge tone="ok" dot>
          Hoạt động
        </Badge>
      )}
    </span>
  );
}

export function UsersView({ data }: { data: Data }) {
  return (
    <>
      <PageHeader icon="users" title="Người dùng" sub={`${data.total.toLocaleString("vi-VN")} tài khoản`} />
      <UrlFilters
        fields={[
          { name: "search", type: "search", placeholder: "Email" },
          {
            name: "plan",
            type: "chips",
            options: [
              { value: "", label: "Tất cả" },
              { value: "free", label: "Free" },
              { value: "pro", label: "Pro" },
              { value: "ultra", label: "Ultra" },
            ],
          },
        ]}
      />
      <DataList<Row>
        rows={data.items}
        rowKey={(u) => u.id}
        cols={[
          {
            key: "user",
            label: "Tài khoản",
            mobile: "title",
            cell: (u) => (
              <Link href={`/admin/users/${u.id}`} className="group flex min-w-0 items-center gap-3">
                <Avatar name={u.name || u.email} url={u.avatarUrl} size={32} />
                <span className="min-w-0">
                  <span className="block truncate font-medium group-hover:underline">{u.email}</span>
                  <span className="block truncate text-xs font-normal text-muted">{u.name}</span>
                </span>
              </Link>
            ),
          },
          {
            key: "plan",
            label: "Gói",
            cell: (u) =>
              u.planCode ? <Badge tone={PLAN_TONE[u.planCode]}>{PLAN_NAME[u.planCode]}</Badge> : <span className="text-dim">—</span>,
          },
          { key: "credit", label: "Khả dụng", align: "right", cell: (u) => <span className="font-semibold tabular-nums">{formatCredit(u.available)}</span> },
          { key: "status", label: "Trạng thái", cell: (u) => <UserBadges role={u.role} status={u.status} /> },
          { key: "created", label: "Ngày tạo", cell: (u) => <span className="whitespace-nowrap text-muted">{formatDateTime(u.createdAt)}</span> },
        ]}
      />
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} />
    </>
  );
}
