import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { cancelStory, getStory, updateStory } from "@/server/services/story";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    return getStory(user.id, (await params).id);
  });
}

export function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    return updateStory(user.id, (await params).id, await readJson(req));
  });
}

// Hủy các cảnh đang chờ (hoàn Credit) và ẩn kịch bản.
export function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    await cancelStory(user.id, (await params).id);
    return { ok: true };
  });
}
