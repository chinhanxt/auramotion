import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { finishAgyLogin } from "@/server/ai/agy/accounts";

const bodySchema = z.object({
  state: z.string().trim().min(1, { message: "Thiếu state" }).max(100),
  callback: z.string().trim().min(1, { message: "Hãy dán URL callback hoặc mã" }).max(4000),
});

// Bước 2: { state, callback } → { account: { id, email }, created }.
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const { state, callback } = bodySchema.parse(await readJson(req));
    return finishAgyLogin(state, callback);
  });
}
