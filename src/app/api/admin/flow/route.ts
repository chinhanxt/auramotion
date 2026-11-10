import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getFlow } from "@/server/services/ai-admin";

export const dynamic = "force-dynamic";

// Sơ đồ luồng dựng từ cấu hình thật: { nodes, edges, live }.
export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getFlow();
  });
}
