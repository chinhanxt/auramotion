import { UsersView } from "@/components/admin/biz/UsersView";
import { plain } from "@/components/admin/plain";
import { listUsers } from "@/server/services/admin";
import { adminPage, one, type SearchParams } from "../guard";

const PLANS = ["free", "pro", "ultra"] as const;

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  const search = one(sp.search);
  const planRaw = one(sp.plan);
  const plan = PLANS.find((p) => p === planRaw);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const result = await listUsers({ search, plan, page });
  return <UsersView data={plain(result)} />;
}
