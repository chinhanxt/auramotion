import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { createSkill, listSkills } from "@/server/services/admin-ops";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return listSkills();
  });
}

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return createSkill(await readJson(req));
  });
}
