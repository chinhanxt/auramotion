import { AssembleForm } from "@/components/studio/AssembleForm";

export const metadata = { title: "Ghép video · AuraMotion" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { from } = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Ghép video</h1>
      <AssembleForm fromJobId={typeof from === "string" ? from : undefined} />
    </div>
  );
}
