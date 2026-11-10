import { JobsView } from "@/components/admin/biz/JobsView";
import { plain } from "@/components/admin/plain";
import { listAdminJobs, listModels } from "@/server/services/admin";
import { adminPage, one, type SearchParams } from "../guard";

const STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"] as const;
const KINDS = ["IMAGE", "VIDEO", "ASSEMBLE"] as const;

export default async function AdminJobsPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === one(sp.status));
  const kind = KINDS.find((k) => k === one(sp.kind));
  const user = one(sp.user);
  const modelId = one(sp.modelId);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [result, models] = await Promise.all([listAdminJobs({ status, kind, user, modelId, page }), listModels()]);
  return <JobsView data={plain(result)} models={models.map((m) => ({ id: m.id, name: m.name }))} />;
}
