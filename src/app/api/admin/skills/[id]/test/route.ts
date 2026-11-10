import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { testSkill } from "@/server/services/admin-ops";

// Chạy thử skill qua AI Gateway với 1 ý tưởng, trả chữ AI viết.
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return testSkill((await params).id, await readJson(req));
  });
}
