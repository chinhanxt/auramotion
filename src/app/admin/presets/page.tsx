import { PresetsView } from "@/components/admin/content/PresetsView";
import { plain } from "@/components/admin/plain";
import { listPresets } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminPresetsPage() {
  await adminPage();
  const presets = await listPresets();
  return <PresetsView initial={plain(presets)} />;
}
