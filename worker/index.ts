import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { QUEUE_NAMES, queues, type QueueJobData, type QueueName } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { startCron } from "./cron";
import { processGenerate } from "./processors/generate";

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Job đang chạy dở khi dừng: BullMQ đánh stalled rồi chạy lại, job MUSE poll tiếp theo museTaskId.
const SHUTDOWN_GRACE_MS = 10_000;

const CONCURRENCY: Record<QueueName, number> = {
  muse: intEnv("MUSE_CONCURRENCY", 3),
  cli: intEnv("CLI_CONCURRENCY", 1),
  post: 1,
};

async function main(): Promise<void> {
  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker<QueueJobData>(name, processGenerate, {
      connection: redis,
      concurrency: CONCURRENCY[name],
    });
    worker.on("failed", (job, err) => console.error(`[worker:${name}] job ${job?.data.jobId} lỗi: ${err.message}`));
    worker.on("error", (err) => console.error(`[worker:${name}] lỗi`, err));
    return worker;
  });
  const cron = await startCron();
  console.log(`[worker] đang chạy: ${QUEUE_NAMES.map((n) => `${n}×${CONCURRENCY[n]}`).join(", ")}`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[worker] nhận ${signal}, đang dừng...`);
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS + 5000).unref();
    try {
      const closeAll = Promise.all([...workers.map((w) => w.close()), cron.close()]);
      await Promise.race([closeAll, new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))]);
      await Promise.all(Object.values(queues).map((q) => q.close()));
      await redis.quit();
      await db.$disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] không khởi động được", err);
  process.exit(1);
});
