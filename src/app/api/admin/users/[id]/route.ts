import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { adminChangePlan, getUserDetail, setUserStatus, userPatchSchema } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    return getUserDetail(id);
  });
}

// Body: { status } để khóa / mở khóa, hoặc { planCode, period } để đổi gói.
export function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = userPatchSchema.parse(await readJson(req));
    if ("status" in body) await setUserStatus(id, body.status, admin.id);
    else await adminChangePlan(id, body.planCode, body.period);
    return { ok: true };
  });
}
