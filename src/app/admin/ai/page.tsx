import { AiView } from "@/components/admin/ai/AiView";
import { adminPage, one, type SearchParams } from "../guard";

export const metadata = { title: "AI & Model · Quản trị" };

export default async function AdminAiPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  return <AiView demo={one(sp.demo) === "1"} />;
}
