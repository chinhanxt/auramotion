import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { removeAgyAccount } from "@/server/ai/agy/accounts";

export function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return removeAgyAccount(decodeURIComponent((await params).id));
  });
}
