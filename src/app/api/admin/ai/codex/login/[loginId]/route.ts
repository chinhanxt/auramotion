import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getCodexLogin } from "@/server/ai/codex-profiles";

export const dynamic = "force-dynamic";

// { status: "waiting" | "done" | "error", message? }
export function GET(_req: Request, { params }: { params: Promise<{ loginId: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getCodexLogin((await params).loginId);
  });
}
