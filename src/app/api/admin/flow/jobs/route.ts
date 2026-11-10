import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { listFlowJobs } from "@/server/services/ai-admin";

export const dynamic = "force-dynamic";

// ?limit=20 → { items: [job gần đây có trace] }.
export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return listFlowJobs(new URL(req.url).searchParams.get("limit") ?? undefined);
  });
}
