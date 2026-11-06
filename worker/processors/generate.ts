import type { Job as BullJob } from "bullmq";
import { AppError } from "@/lib/errors";
import type { QueueJobData } from "@/lib/queue";
import { EngineError } from "@/server/engines/types";
import { failJob, processJob } from "@/server/services/job";

function errorCode(err: unknown): string {
  if (err instanceof EngineError || err instanceof AppError) return err.code;
  return "INTERNAL";
}

// Lỗi tạm thời được ném lại để BullMQ thử tiếp; lần thử cuối thì đánh FAILED và hoàn Credit.
export async function processGenerate(bullJob: BullJob<QueueJobData>): Promise<void> {
  try {
    await processJob(bullJob.data.jobId);
  } catch (err) {
    const attempts = bullJob.opts.attempts ?? 1;
    if (bullJob.attemptsMade + 1 >= attempts) await failJob(bullJob.data.jobId, errorCode(err));
    throw err;
  }
}
