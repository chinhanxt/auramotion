import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { renewMuseAccount } from "@/server/services/admin-ops";

export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return renewMuseAccount((await params).id);
  });
}
