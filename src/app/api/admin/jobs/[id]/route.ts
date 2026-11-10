import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { getAdminJob } from "@/server/services/admin";
import { setJobFeatured } from "@/server/services/admin-ops";
import { cancelJob, retryJob } from "@/server/services/job";

const actionSchema = z.object({ action: z.enum(["cancel", "retry"], { message: "Thao tác không hợp lệ" }) });

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return getAdminJob((await params).id);
  });
}

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

// Body: { featured: boolean } — đánh dấu nổi bật cho trang Explore.
export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const job = await setJobFeatured(id, await readJson(req));
    return { ok: true, id: job.id, featured: job.featured };
  });
}
