import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { renderStory } from "@/server/services/story";

export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    return renderStory(user.id, (await params).id);
  });
}
