import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { testGateway } from "@/server/services/admin-ops";

// Body: { prompt, provider? } → chạy thử 1 câu qua AI Gateway, trả { text, provider, ms }.
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return testGateway(await readJson(req));
  });
}
