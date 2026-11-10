import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { setAgyProxy } from "@/server/ai/agy/accounts";

const bodySchema = z.object({ enabled: z.boolean({ message: "enabled phải là true/false" }) });

// Body: { enabled } bật/tắt proxy xoay tài khoản agy (cổng AGY_PROXY_PORT, mặc định 8901).
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return setAgyProxy(bodySchema.parse(await readJson(req)).enabled);
  });
}
