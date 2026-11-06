import { z } from "zod";
import { handle } from "@/lib/http";
import { requestPasswordReset } from "@/server/services/account";

const bodySchema = z.object({ email: z.string().min(1, { error: "Vui lòng nhập email" }) });

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const { email } = bodySchema.parse(await req.json());
    await requestPasswordReset(email);
    return { ok: true };
  });
}
