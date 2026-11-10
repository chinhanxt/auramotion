import { PlansView } from "@/components/admin/biz/PlansView";
import { plain } from "@/components/admin/plain";
import { listPlans } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminPlansPage() {
  await adminPage();
  return <PlansView plans={plain(await listPlans())} />;
}
