import { FlowLoader } from "@/components/admin/flow/FlowLoader";
import { adminPage, one, type SearchParams } from "../guard";

export const metadata = { title: "Luồng xử lý · Quản trị" };

export default async function AdminFlowPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  return <FlowLoader demo={one(sp.demo) === "1"} />;
}
