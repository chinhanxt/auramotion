import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { createJob, listJobs } from "@/server/services/job";
import { generationParamsSchema } from "@/server/services/pricing";

const listQuery = z.object({
  kind: z.enum(["image", "video", "assemble"]).optional(),
  status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
  cursor: z.string().min(1).optional(),
  storyId: z.string().min(1).max(100).optional(),
  ids: z
    .string()
    .transform((s) => s.split(",").map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string()).max(100))
    .optional(),
});

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const params = generationParamsSchema.parse(await readJson(req));
    return createJob(user.id, params);
  });
}

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const search = Object.fromEntries(new URL(req.url).searchParams);
    return listJobs(user.id, listQuery.parse(search));
  });
}
