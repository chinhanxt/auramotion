import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { getAdminSettings, updateAdminSettings } from "@/server/services/admin";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getAdminSettings();
  });
}

// Body: một phần { maintenance, voice_line_cost, credit_packs, prompt_writer }.
export function PATCH(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return updateAdminSettings(await readJson(req));
  });
}
