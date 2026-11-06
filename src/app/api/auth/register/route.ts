import { z } from "zod";
import { handle } from "@/lib/http";
import { registerUser } from "@/server/services/account";

const bodySchema = z.object({ email: z.string(), password: z.string(), name: z.string() });

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await registerUser(bodySchema.parse(await req.json()));
    return { id: user.id, email: user.email, name: user.name };
  });
}
