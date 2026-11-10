import { Skeleton } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";

export function HeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-7 w-44" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
    </div>
  );
}

export function StatsSkeleton({ n = 5 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-m3" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8, filters = true }: { rows?: number; filters?: boolean }) {
  return (
    <>
      {filters && (
        <div className="mb-4 flex gap-2">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-9 w-36" />
        </div>
      )}
      <div className="overflow-hidden rounded-m3 bg-s1 hairline">
        <div className="h-10 border-b border-line" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-0">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="hidden h-4 w-1/6 sm:block" />
            <Skeleton className="ml-auto h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </>
  );
}

export function GridSkeleton({ n = 12, aspect = "aspect-[4/5]", cols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" }: { n?: number; aspect?: string; cols?: string }) {
  return (
    <div className={cx("grid gap-3", cols)}>
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} aura={i % 3 === 0} className={cx("rounded-m3", aspect)} />
      ))}
    </div>
  );
}

export function PanelsSkeleton({ n = 4, h = "h-56" }: { n?: number; h?: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className={cx("rounded-m3", h)} />
      ))}
    </div>
  );
}

type Variant = "table" | "grid" | "panels" | "dashboard" | "cards";

export function PageSkeleton({ variant = "table" }: { variant?: Variant }) {
  return (
    <div aria-busy="true" aria-label="Đang tải">
      <HeaderSkeleton />
      {variant === "table" && <TableSkeleton />}
      {variant === "grid" && (
        <>
          <div className="mb-4 flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-full" />
            ))}
          </div>
          <GridSkeleton />
        </>
      )}
      {variant === "panels" && <PanelsSkeleton />}
      {variant === "cards" && <PanelsSkeleton n={6} h="h-40" />}
      {variant === "dashboard" && (
        <div className="space-y-4">
          <StatsSkeleton />
          <Skeleton className="h-14 rounded-m3" />
          <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
            <Skeleton className="h-80 rounded-m3" />
            <Skeleton className="h-80 rounded-m3" />
          </div>
          <PanelsSkeleton n={2} />
        </div>
      )}
    </div>
  );
}
