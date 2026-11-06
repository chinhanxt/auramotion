import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { listAdminJobs } from "@/server/services/admin";

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return listAdminJobs(Object.fromEntries(new URL(req.url).searchParams));
  });
}
