import { ModelsView } from "@/components/admin/engine/ModelsView";
import { plain } from "@/components/admin/plain";
import { listModels } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminModelsPage() {
  await adminPage();
  return <ModelsView models={plain(await listModels())} />;
}
