"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/Bits";

// React Flow chỉ chạy phía trình duyệt.
const FlowView = dynamic(() => import("./FlowView").then((m) => m.FlowView), {
  ssr: false,
  loading: () => (
    <div className="space-y-3">
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-7 w-44" />
      </div>
      <Skeleton aura className="h-[calc(100dvh-250px)] min-h-[520px] rounded-m3" />
    </div>
  ),
});

export function FlowLoader({ demo }: { demo?: boolean }) {
  return <FlowView demo={demo} />;
}
