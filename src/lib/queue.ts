import type { ModelProvider, PlanCode } from "@prisma/client";
import { Queue } from "bullmq";
import { redis } from "@/lib/redis";

// Hàng đợi tạo media (job trong DB).
export type QueueName = "muse" | "cli" | "post";
export type QueueJobData = { jobId: string };

// Hàng đợi story: lập kịch bản / đẩy cảnh kế tiếp / ghép.
export type StoryAction = "plan" | "advance";
export type StoryJobData = { storyId: string; action: StoryAction };

export const QUEUE_NAMES: QueueName[] = ["muse", "cli", "post"];
export const ALL_QUEUE_NAMES = [...QUEUE_NAMES, "story"] as const;
export type AnyQueueName = (typeof ALL_QUEUE_NAMES)[number];

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

const globalForQueues = globalThis as unknown as {
  queues?: Record<QueueName, Queue<QueueJobData>>;
  storyQueue?: Queue<StoryJobData>;
};

export const queues: Record<QueueName, Queue<QueueJobData>> = globalForQueues.queues ?? {
  muse: createQueue("muse"),
  cli: createQueue("cli"),
  post: createQueue("post"),
};

export const storyQueue: Queue<StoryJobData> =
  globalForQueues.storyQueue ??
  new Queue<StoryJobData>("story", {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "fixed", delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForQueues.queues = queues;
  globalForQueues.storyQueue = storyQueue;
}

export function anyQueue(name: AnyQueueName): Queue {
  return (name === "story" ? storyQueue : queues[name]) as Queue;
}

export function queueFor(provider: ModelProvider): QueueName {
  if (provider === "MUSE") return "muse";
  if (provider === "LOCAL") return "post";
  return "cli";
}
