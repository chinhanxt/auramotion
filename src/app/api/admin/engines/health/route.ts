import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getEngineHealth } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getEngineHealth();
  });
}
