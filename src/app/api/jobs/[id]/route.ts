import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { deleteJob } from "@/server/services/job";

export function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await deleteJob(user.id, id);
    return { ok: true };
  });
}
