import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { testAi } from "@/server/services/ai-admin";

// Body: { provider, model?, effort?, profile?, skillId?, kind?, idea } → { text, prompt, ms, breakdown, provider, model }.
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return testAi(await readJson(req));
  });
}
