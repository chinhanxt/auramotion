import { MuseView } from "@/components/admin/engine/MuseView";
import { getMuseSlots } from "@/server/engines/muse-scheduler";
import { adminPage } from "../guard";

export default async function AdminMusePage() {
  await adminPage();
  return <MuseView slots={await getMuseSlots()} />;
}
