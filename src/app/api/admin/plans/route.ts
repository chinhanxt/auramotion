import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { listPlans, updatePlan } from "@/server/services/admin";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return listPlans();
  });
}

// Gói cố định free / pro / ultra: chỉ sửa, không tạo / xóa.
export function PATCH(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return updatePlan(await readJson(req));
  });
}
