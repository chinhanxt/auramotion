import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getAiAdmin } from "@/server/services/ai-admin";

export const dynamic = "force-dynamic";

// Trạng thái AI runtime: ai_roles, provider agy / codex / muse (tài khoản, model, ACP, proxy), health, cooldown.
// ?refresh=1: đọc lại quota agy và catalog model codex (bỏ cache).
export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getAiAdmin({ refresh: new URL(req.url).searchParams.get("refresh") === "1" });
  });
}
