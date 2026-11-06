import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { listUsers } from "@/server/services/admin";

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return listUsers(Object.fromEntries(new URL(req.url).searchParams));
  });
}
