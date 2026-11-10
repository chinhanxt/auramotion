import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { QUEUE_NAMES, queues, storyQueue, type QueueJobData, type QueueName, type StoryJobData } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { QUEUE_TIMEOUT_MS } from "@/server/services/job";
import { startCron } from "./cron";
import { processGenerate } from "./processors/generate";
import { processStory } from "./processors/story";

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Job đang chạy dở khi dừng: BullMQ đánh stalled rồi chạy lại, job MUSE poll tiếp theo museTaskId.
const SHUTDOWN_GRACE_MS = 10_000;

// muse: job chờ slot Muse được dời lại (không giữ chỗ worker), nên concurrency = tổng slot ảnh + video là đủ;
// giới hạn thật do scheduler (setting muse_slots) quyết định.
const CONCURRENCY: Record<QueueName, number> = {
  muse: intEnv("MUSE_CONCURRENCY", 4),
  cli: intEnv("CLI_CONCURRENCY", 1),
  post: 1,
};
const STORY_CONCURRENCY = 2;

async function main(): Promise<void> {
  const workers: Worker[] = QUEUE_NAMES.map((name) => {
    const worker = new Worker<QueueJobData>(name, processGenerate, {
      connection: redis,
      concurrency: CONCURRENCY[name],
      // Lock dài hơn chu kỳ poll; job ghép (post) chạy tới QUEUE_TIMEOUT_MS.post, BullMQ tự gia hạn lock.
      lockDuration: 60_000,
      // Worker chết giữa chừng: job stalled được chạy lại tối đa 2 lần rồi mới FAILED.
      maxStalledCount: 2,
    });
    worker.on("failed", (job, err) => console.error(`[worker:${name}] job ${job?.data.jobId} lỗi: ${err.message}`));
    worker.on("error", (err) => console.error(`[worker:${name}] lỗi`, err));
    return worker;
  });
  const story = new Worker<StoryJobData>("story", processStory, { connection: redis, concurrency: STORY_CONCURRENCY });
  story.on("failed", (job, err) => console.error(`[worker:story] ${job?.data.action} ${job?.data.storyId} lỗi: ${err.message}`));
  story.on("error", (err) => console.error("[worker:story] lỗi", err));
  workers.push(story);

  const cron = await startCron();
  console.log(
    `[worker] đang chạy: ${QUEUE_NAMES.map((n) => `${n}×${CONCURRENCY[n]}`).join(", ")}, story×${STORY_CONCURRENCY}; ` +
      `timeout ${Object.entries(QUEUE_TIMEOUT_MS)
        .map(([n, ms]) => `${n} ${ms / 60_000}p`)
        .join(", ")}`,
  );

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[worker] nhận ${signal}, đang dừng...`);
    // Không đợi quá lâu: job đang chạy sẽ stalled và được worker sau chạy tiếp.
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS + 5000).unref();
    try {
      const closeAll = Promise.all([...workers.map((w) => w.close()), cron.close()]);
      await Promise.race([closeAll, new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))]);
      // Hết thời gian chờ: buộc đóng (job dở trả về stalled).
      await Promise.all(workers.map((w) => w.close(true).catch(() => undefined)));
      await Promise.all([...Object.values(queues), storyQueue].map((q) => q.close()));
      await redis.quit();
      await db.$disconnect();
    } catch (err) {
      console.error("[worker] lỗi khi dừng", err);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => console.error("[worker] promise lỗi không bắt", err));
}

main().catch((err) => {
  console.error("[worker] không khởi động được", err);
  process.exit(1);
});
