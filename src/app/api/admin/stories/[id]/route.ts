import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { cancelStory, getStory } from "@/server/services/story";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getStory(undefined, (await params).id, { includeDeleted: true });
  });
}

export function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    await cancelStory(undefined, (await params).id);
    return { ok: true };
  });
}
