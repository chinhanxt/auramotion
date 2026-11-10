import { MasonrySkeleton } from "@/components/library/LibraryView";

export default function Loading() {
  return (
    <div className="px-3 pt-3 sm:px-5 lg:px-6">
      <div className="skel mb-5 h-9 w-36 rounded-m1" />
      <div className="skel mb-4 h-9 w-80 max-w-full rounded-m1" />
      <MasonrySkeleton />
    </div>
  );
}
