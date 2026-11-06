import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { cancelJob, retryJob } from "@/server/services/job";

const actionSchema = z.object({ action: z.enum(["cancel", "retry"], { message: "Thao tác không hợp lệ" }) });

// Admin không truyền userId: thao tác được trên job của mọi user.
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const { action } = actionSchema.parse(await readJson(req));
    if (action === "cancel") {
      await cancelJob(id);
      return { ok: true };
    }
    const job = await retryJob(id);
    return { ok: true, jobId: job.id };
  });
}
