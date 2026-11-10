import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { putAiRoles } from "@/server/services/ai-admin";

// Body: ai_roles đầy đủ (writer, story, prewrite, cacheHours, agy, codex) → { roles }.
export function PUT(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return putAiRoles(await readJson(req));
  });
}
