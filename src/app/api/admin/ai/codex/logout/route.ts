import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { logoutCodex } from "@/server/ai/codex-profiles";

const bodySchema = z.object({ profile: z.string().trim().min(1, { message: "Thiếu profile" }).max(40) });

// Body: { profile } → { loggedIn, method }.
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return logoutCodex(bodySchema.parse(await readJson(req)).profile);
  });
}
