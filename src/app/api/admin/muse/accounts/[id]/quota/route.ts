import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { museAccountQuota } from "@/server/services/admin-ops";

export const dynamic = "force-dynamic";

export function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const refresh = ["1", "true"].includes(new URL(req.url).searchParams.get("refresh") ?? "");
    return museAccountQuota((await params).id, refresh);
  });
}
