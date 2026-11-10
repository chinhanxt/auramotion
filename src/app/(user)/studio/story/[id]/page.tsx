import { StoryView } from "@/components/story/StoryView";

export const metadata = { title: "Story · AuraMotion" };

export default async function StoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StoryView id={id} />;
}
