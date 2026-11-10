import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { getGatewayAdmin, putGatewayAdmin } from "@/server/services/admin-ops";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getGatewayAdmin();
  });
}

// Body: { order: ["agy","codex","muse"], agyModel?, codexModel?, museModel?, timeoutSec }.
export function PUT(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return putGatewayAdmin(await readJson(req));
  });
}
