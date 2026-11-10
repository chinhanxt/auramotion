import { Workspace } from "@/components/studio/Workspace";

export const metadata = { title: "Ảnh · AuraMotion" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return <Workspace kind="image" fromJobId={one(sp.from)} initialPrompt={one(sp.prompt)} initialFrame={one(sp.ref)} />;
}
