import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { deleteMuseAccount, updateMuseAccount } from "@/server/services/admin-ops";

type Ctx = { params: Promise<{ id: string }> };

export function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return updateMuseAccount((await params).id, await readJson(req));
  });
}

export function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return deleteMuseAccount((await params).id);
  });
}
