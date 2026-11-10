import { Workspace } from "@/components/studio/Workspace";

export const metadata = { title: "Video · AuraMotion" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

// ?frame=<url ảnh> đặt khung đầu (từ nút "Dùng làm khung đầu"), ?prompt= điền sẵn mô tả.
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return <Workspace kind="video" fromJobId={one(sp.from)} initialPrompt={one(sp.prompt)} initialFrame={one(sp.frame)} />;
}
