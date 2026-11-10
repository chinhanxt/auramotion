import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { updateModel } from "@/server/services/admin";

// Sửa 1 model (id trên đường dẫn); giống PATCH /api/admin/models với id trong body.
export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const body = (await readJson(req)) as Record<string, unknown> | null;
    return updateModel({ ...(body && typeof body === "object" ? body : {}), id: (await params).id });
  });
}
