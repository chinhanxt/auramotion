import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getMuseStatus } from "@/server/services/admin-ops";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getMuseStatus();
  });
}
