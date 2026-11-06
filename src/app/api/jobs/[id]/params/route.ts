import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getJobParams } from "@/server/services/job";

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    return getJobParams(user.id, id);
  });
}
