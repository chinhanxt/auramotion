import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { startAgyLogin } from "@/server/ai/agy/accounts";

// Bước 1 đăng nhập agy: { url, state } (verifier giữ phía server 10 phút).
export function POST(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return startAgyLogin();
  });
}
