import { Queue, Worker } from "bullmq";
import { redis } from "@/lib/redis";
import { cleanupExpiredResults, sweepStuckJobs } from "@/server/services/job";
import { expireSubscriptions, runMonthlyGrants, sendRenewalReminders } from "@/server/services/plan";
import { sweepStories } from "@/server/services/story";

const CRON_QUEUE = "cron";
const TZ = "Asia/Ho_Chi_Minh";

type Task = { name: string; run: (now: Date) => Promise<number> };

const TASKS: Record<string, Task[]> = {
  "every-5-min": [
    { name: "sweepStuckJobs", run: sweepStuckJobs },
    { name: "sweepStories", run: sweepStories },
    { name: "runMonthlyGrants", run: runMonthlyGrants },
    { name: "expireSubscriptions", run: expireSubscriptions },
  ],
  daily: [
    { name: "sendRenewalReminders", run: sendRenewalReminders },
    { name: "cleanupExpiredResults", run: cleanupExpiredResults },
  ],
};

async function runTasks(group: string): Promise<void> {
  const now = new Date();
  for (const task of TASKS[group] ?? []) {
    try {
      const n = await task.run(now);
      if (n > 0) console.log(`[cron] ${task.name}: ${n}`);
    } catch (err) {
      console.error(`[cron] ${task.name} lỗi`, err);
    }
  }
}

export async function startCron(): Promise<{ close: () => Promise<void> }> {
  const queue = new Queue(CRON_QUEUE, { connection: redis });
  await queue.upsertJobScheduler("every-5-min", { every: 5 * 60_000 }, { name: "every-5-min" });
  await queue.upsertJobScheduler("daily", { pattern: "0 3 * * *", tz: TZ }, { name: "daily" });
  const worker = new Worker(CRON_QUEUE, (job) => runTasks(job.name), { connection: redis, concurrency: 1 });
  worker.on("error", (err) => console.error("[cron] worker lỗi", err));
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
