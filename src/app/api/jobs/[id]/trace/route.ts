import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getJobTrace } from "@/server/services/ai-admin";

export const dynamic = "force-dynamic";

// Trace job của chính người dùng.
export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    return getJobTrace((await params).id, user.id);
  });
}
