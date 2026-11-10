import { HeaderSkeleton, PanelsSkeleton, StatsSkeleton, TableSkeleton } from "@/components/admin/Skeletons";

export default function Loading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton actions={2} />
      <StatsSkeleton n={4} />
      <TableSkeleton rows={2} filters={false} />
      <PanelsSkeleton n={2} />
    </div>
  );
}
