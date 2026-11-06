import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { quoteJob } from "@/server/services/job";
import { generationParamsSchema } from "@/server/services/pricing";

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireUser();
    const cost = await quoteJob(generationParamsSchema.parse(await readJson(req)));
    return { cost: cost.toNumber() };
  });
}
