import { SkillsView } from "@/components/admin/content/SkillsView";
import { plain } from "@/components/admin/plain";
import { listSkills } from "@/server/services/admin-ops";
import { adminPage } from "../guard";

export default async function AdminSkillsPage() {
  await adminPage();
  const skills = await listSkills();
  return <SkillsView initial={plain(skills)} />;
}
