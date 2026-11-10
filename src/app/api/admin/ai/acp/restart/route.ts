import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { restartAcp } from "@/server/ai/acp/runtime";

// Khởi động lại pool agy ACP của tiến trình app (worker tự khởi động lại khi đổi tài khoản / proxy).
export function POST(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return { acp: await restartAcp({ start: true }) };
  });
}
