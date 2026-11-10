import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { clearMuseVideoBlock } from "@/server/services/admin-ops";

// Gỡ cờ "Muse không tạo được video" để người dùng tạo video lại.
export function POST(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return clearMuseVideoBlock();
  });
}
