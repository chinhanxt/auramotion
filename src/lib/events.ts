import { redis } from "@/lib/redis";

// Sự kiện realtime cho UI: Redis pub/sub kênh am:ev:<userId> → SSE /api/events.
export type EventType = "job" | "story" | "credit" | "ping";

export function eventChannel(userId: string): string {
  return `am:ev:${userId}`;
}

export type EventMessage = { type: EventType; data: unknown };

// Không bao giờ ném lỗi: Redis lỗi không được làm hỏng job / giao dịch.
export async function publishEvent(userId: string, type: EventType, data: unknown): Promise<void> {
  try {
    await redis.publish(eventChannel(userId), JSON.stringify({ type, data } satisfies EventMessage));
  } catch (err) {
    console.warn(`[events] không gửi được ${type} cho ${userId}: ${(err as Error).message}`);
  }
}
