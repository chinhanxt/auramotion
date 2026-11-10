import { EditLoader } from "@/components/studio/EditLoader";

export const metadata = { title: "Ghép · AuraMotion" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { from } = await searchParams;
  return <EditLoader fromJobId={typeof from === "string" ? from : undefined} />;
}
