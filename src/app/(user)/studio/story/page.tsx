import { StoryComposer } from "@/components/story/StoryComposer";
import { StoryGrid } from "@/components/story/StoryGrid";

export const metadata = { title: "Story · AuraMotion" };

export default async function StoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { idea } = await searchParams;
  return (
    <div className="px-3 pt-3 pb-16 sm:px-5 lg:px-6">
      <section className="relative mx-auto max-w-[1040px] pt-6 pb-10 sm:pt-12">
        <div className="pointer-events-none absolute inset-x-0 -top-10 h-72 opacity-60 blur-3xl" aria-hidden="true" style={{ background: "radial-gradient(40% 60% at 30% 40%, rgba(124,92,255,.35), transparent 70%), radial-gradient(35% 55% at 70% 50%, rgba(255,79,216,.22), transparent 70%)" }} />
        <h1 className="t-h1 relative mb-6 text-center">
          Một ý tưởng. <span className="aura-text">Nhiều cảnh.</span>
        </h1>
        <StoryComposer initialIdea={typeof idea === "string" ? idea : ""} />
      </section>
      <h2 className="t-label mb-3">Story của bạn</h2>
      <StoryGrid />
    </div>
  );
}
