import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { switchAgyAccount } from "@/server/ai/agy/accounts";

const bodySchema = z.union([z.object({ auto: z.literal(true) }), z.object({ id: z.string().trim().min(1).max(200) })], {
  message: "Cần { id } hoặc { auto: true }",
});

// Body: { id } hoặc { auto: true } → { switched, account }.
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const body = bodySchema.parse(await readJson(req));
    return switchAgyAccount("auto" in body ? { auto: true } : { id: body.id });
  });
}
