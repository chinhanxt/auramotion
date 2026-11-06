import type { ModelProvider, PlanCode } from "@prisma/client";
import { Queue } from "bullmq";
import { redis } from "@/lib/redis";

export type QueueName = "muse" | "cli" | "post";
export type QueueJobData = { jobId: string };

export const QUEUE_NAMES: QueueName[] = ["muse", "cli", "post"];

// BullMQ: số nhỏ chạy trước.
export const PLAN_PRIORITY: Record<PlanCode, number> = { ultra: 1, pro: 5, free: 10 };

function createQueue(name: QueueName): Queue<QueueJobData> {
  return new Queue<QueueJobData>(name, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "fixed", delay: 10_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
}

const globalForQueues = globalThis as unknown as { queues?: Record<QueueName, Queue<QueueJobData>> };

export const queues: Record<QueueName, Queue<QueueJobData>> = globalForQueues.queues ?? {
  muse: createQueue("muse"),
  cli: createQueue("cli"),
  post: createQueue("post"),
};

if (process.env.NODE_ENV !== "production") globalForQueues.queues = queues;

export function queueFor(provider: ModelProvider): QueueName {
  if (provider === "MUSE") return "muse";
  if (provider === "LOCAL") return "post";
  return "cli";
}
