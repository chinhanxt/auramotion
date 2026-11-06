import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { changePassword } from "@/server/services/account";

const bodySchema = z.object({ oldPassword: z.string().default(""), newPassword: z.string() });

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { oldPassword, newPassword } = bodySchema.parse(await req.json());
    await changePassword(user.id, oldPassword, newPassword);
    return { ok: true };
  });
}
