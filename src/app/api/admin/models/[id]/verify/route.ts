import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { verifyModel } from "@/server/services/model-catalog";

// Test vẽ thật bằng đúng model này (ảnh 1:1 / video Muse 5 s), ghi `verified` + ảnh mẫu. Không trừ Credit.
export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return verifyModel((await params).id);
  });
}
