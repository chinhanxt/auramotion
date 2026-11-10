import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getJobTrace } from "@/server/services/ai-admin";

export const dynamic = "force-dynamic";

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getJobTrace((await params).id);
  });
}
