import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { assembleStory } from "@/server/services/story";

export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    return assembleStory(user.id, (await params).id);
  });
}
