import Link from "next/link";
import { DataTable } from "@/components/admin/DataTable";
import { LineChart } from "@/components/admin/LineChart";
import { StatCard } from "@/components/admin/StatCard";
import { cardClass, formatVnd } from "@/components/admin/format";
import { formatCredit } from "@/lib/api-client";
import { getStats, type StatsRange } from "@/server/services/admin";
import { adminPage, one, type SearchParams } from "./guard";

const RANGES: { value: StatsRange; label: string }[] = [
  { value: "1d", label: "Hôm nay" },
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
];

export default async function AdminDashboard({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const raw = one((await searchParams).range);
  const range: StatsRange = RANGES.some((r) => r.value === raw) ? (raw as StatsRange) : "7d";
  const stats = await getStats(range);
  const daily = stats.daily.map((d) => ({ ...d, label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}` }));
  const totalUsers = stats.usersByPlan.reduce((sum, p) => sum + p.users, 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tổng quan</h1>
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r.value}
              href={`/admin?range=${r.value}`}
              className={`rounded-md px-3 py-1 ${r.value === range ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Người dùng mới" value={stats.newUsers.toLocaleString("vi-VN")} />
        <StatCard label="Ảnh đã tạo" value={stats.images.toLocaleString("vi-VN")} />
        <StatCard label="Video đã tạo" value={stats.videos.toLocaleString("vi-VN")} hint={`${stats.assembles} video ghép`} />
        <StatCard label="Credit đã tiêu" value={formatCredit(stats.creditsSpent)} />
        <StatCard label="Doanh thu" value={formatVnd(stats.revenue)} />
        <StatCard label="Thuê bao đang hoạt động" value={totalUsers.toLocaleString("vi-VN")} />
      </div>

      {daily.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-medium text-neutral-500">Lượt tạo theo ngày</h2>
            <LineChart
              data={daily}
              xKey="label"
              series={[
                { key: "images", label: "Ảnh", color: "#2563eb" },
                { key: "videos", label: "Video", color: "#16a34a" },
                { key: "assembles", label: "Ghép video", color: "#d97706" },
              ]}
            />
          </section>
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-medium text-neutral-500">Doanh thu theo ngày (₫)</h2>
            <LineChart data={daily} xKey="label" series={[{ key: "revenue", label: "Doanh thu", color: "#171717" }]} />
          </section>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={cardClass}>
          <h2 className="mb-3 text-sm font-medium text-neutral-500">Người dùng theo gói</h2>
          <ul className="space-y-3 text-sm">
            {stats.usersByPlan.map((p) => {
              const pct = totalUsers ? Math.round((p.users / totalUsers) * 100) : 0;
              return (
                <li key={p.code} className="space-y-1">
                  <div className="flex justify-between">
                    <span>{p.name}</span>
                    <span className="text-neutral-600">
                      {p.users} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-neutral-100">
                    <div className="h-2 rounded-full bg-neutral-900" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-500">Credit tiêu thụ theo engine</h2>
          <DataTable
            rows={stats.creditsByModel}
            rowKey={(r) => r.modelId}
            columns={[
              { header: "Engine", cell: (r) => r.name },
              { header: "Credit", cell: (r) => formatCredit(r.credits), className: "text-right" },
            ]}
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-500">Thời gian xử lý trung bình</h2>
          <DataTable
            rows={stats.avgSecondsByModel}
            rowKey={(r) => r.modelId}
            columns={[
              { header: "Engine", cell: (r) => r.name },
              { header: "Giây", cell: (r) => r.seconds.toLocaleString("vi-VN"), className: "text-right" },
            ]}
          />
        </section>
      </div>
    </>
  );
}
