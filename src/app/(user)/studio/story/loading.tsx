import { StoryGridSkeleton } from "@/components/story/StoryGrid";

export default function Loading() {
  return (
    <div className="px-3 pt-3 sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1040px] pt-6 pb-10 sm:pt-12">
        <div className="skel mx-auto mb-6 h-12 w-2/3 rounded-m2" />
        <div className="skel h-64 rounded-m4" />
      </div>
      <StoryGridSkeleton />
    </div>
  );
}
