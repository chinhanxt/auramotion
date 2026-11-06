import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { creditAdjustSchema } from "@/server/services/admin";
import { adminAdjust } from "@/server/services/credit";

export function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { amount, reason } = creditAdjustSchema.parse(await readJson(req));
    return adminAdjust(id, amount, admin.id, reason);
  });
}
