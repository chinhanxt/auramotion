"use client";

import dynamic from "next/dynamic";
import { EditSkeleton } from "./EditSkeleton";

// Trình ghép nặng (timeline, giọng, nhạc): tải riêng, hiện skeleton đúng bố cục trong lúc chờ.
const EditStudio = dynamic(() => import("./EditStudio"), { ssr: false, loading: () => <EditSkeleton /> });

export function EditLoader({ fromJobId }: { fromJobId?: string }) {
  return <EditStudio fromJobId={fromJobId} />;
}
