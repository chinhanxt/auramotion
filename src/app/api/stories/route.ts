import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { createStory, listStories, storyCreateSchema } from "@/server/services/story";

const querySchema = z.object({ cursor: z.string().min(1).max(100).optional() });

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const body = storyCreateSchema.parse(await readJson(req));
    return { story: await createStory(user.id, body) };
  });
}

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { cursor } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return listStories(user.id, cursor);
  });
}
