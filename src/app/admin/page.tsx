import { DashboardView } from "@/components/admin/engine/DashboardView";
import { plain } from "@/components/admin/plain";
import { getMuseSlots } from "@/server/engines/muse-scheduler";
import { getStats, type StatsRange } from "@/server/services/admin";
import { getOpsSnapshot } from "@/server/services/admin-ops";
import { adminPage, one, type SearchParams } from "./guard";

const RANGES: StatsRange[] = ["1d", "7d", "30d"];

export default async function AdminDashboard({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const raw = one((await searchParams).range);
  const range: StatsRange = RANGES.includes(raw as StatsRange) ? (raw as StatsRange) : "7d";
  const [stats, ops, slots] = await Promise.all([getStats(range), getOpsSnapshot(), getMuseSlots()]);
  return <DashboardView range={range} stats={stats} ops={plain(ops)} slots={slots} />;
}
