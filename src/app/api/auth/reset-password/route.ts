import { z } from "zod";
import { handle } from "@/lib/http";
import { resetPassword } from "@/server/services/account";

const bodySchema = z.object({ token: z.string().min(1), password: z.string() });

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const { token, password } = bodySchema.parse(await req.json());
    await resetPassword(token, password);
    return { ok: true };
  });
}
