"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/Bits";

// recharts nặng: tải riêng phía trình duyệt, hiện skeleton khi chờ.
export const Chart = dynamic(() => import("./LineChart").then((m) => m.LineChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px] rounded-m2" />,
});
