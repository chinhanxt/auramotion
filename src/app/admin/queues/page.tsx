import { QueuesView } from "@/components/admin/engine/QueuesView";
import { getMuseSlots } from "@/server/engines/muse-scheduler";
import { adminPage } from "../guard";

export default async function AdminQueuesPage() {
  await adminPage();
  return <QueuesView slots={await getMuseSlots()} />;
}
