import { GenerateForm } from "@/components/studio/GenerateForm";

export const metadata = { title: "Tạo ảnh · AuraMotion" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { from } = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tạo ảnh</h1>
      <GenerateForm kind="image" fromJobId={typeof from === "string" ? from : undefined} />
    </div>
  );
}
