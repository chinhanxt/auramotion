import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { deleteSkill, updateSkill } from "@/server/services/admin-ops";

type Ctx = { params: Promise<{ id: string }> };

export function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return updateSkill((await params).id, await readJson(req));
  });
}

export function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return deleteSkill((await params).id);
  });
}
