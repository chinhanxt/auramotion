import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { createPresetCover } from "@/server/services/admin-ops";

// Tạo ảnh bìa preset bằng Muse (Admin chịu, không trừ Credit).
export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const admin = await requireAdmin();
    return createPresetCover(admin.id, (await params).id);
  });
}
