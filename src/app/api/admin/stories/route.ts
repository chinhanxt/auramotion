import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { listAdminStories } from "@/server/services/story";

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return listAdminStories(Object.fromEntries(new URL(req.url).searchParams));
  });
}
