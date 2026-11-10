import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { startCodexLogin } from "@/server/ai/codex-profiles";

const bodySchema = z.object({ profile: z.string().trim().min(1, { message: "Thiếu profile" }).max(40) });

// Body: { profile } → { loginId, url, code } (codex login --device-auth chạy nền tới khi xác nhận xong).
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return startCodexLogin(bodySchema.parse(await readJson(req)).profile);
  });
}
