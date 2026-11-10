import { GatewayView } from "@/components/admin/engine/GatewayView";
import { getGatewayAdmin } from "@/server/services/admin-ops";
import { adminPage } from "../guard";

export default async function AdminGatewayPage() {
  await adminPage();
  return <GatewayView initial={await getGatewayAdmin()} />;
}
