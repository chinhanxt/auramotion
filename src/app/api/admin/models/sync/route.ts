import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { syncModels } from "@/server/services/model-catalog";

// Đồng bộ model thật (agy ACP, codex các profile đã đăng nhập, Muse) → dòng `synced` mặc định tắt.
export function POST(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return syncModels();
  });
}
