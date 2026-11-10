import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { setQueuePaused } from "@/server/services/admin-ops";

// POST /api/admin/queues/:name/pause | resume
export function POST(_req: Request, { params }: { params: Promise<{ name: string; action: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const { name, action } = await params;
    return setQueuePaused(name, action);
  });
}
