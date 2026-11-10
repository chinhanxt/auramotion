import type IORedis from "ioredis";
import { eventChannel, type EventMessage } from "@/lib/events";
import { redis as sharedRedis } from "@/lib/redis";

const PING_MS = 20_000;

// Luồng SSE cho 1 client: kết nối Redis subscriber riêng (redis.duplicate()), ping định kỳ, dọn khi client ngắt.
export function createEventStream(
  userId: string,
  signal: AbortSignal,
  opts: { pingMs?: number; redis?: IORedis } = {},
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const sub = (opts.redis ?? sharedRedis).duplicate();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    sub.removeAllListeners("message");
    sub.quit().catch(() => sub.disconnect());
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const finish = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // đã đóng
        }
      };
      if (signal.aborted) return finish();
      signal.addEventListener("abort", finish, { once: true });

      sub.on("message", (_channel: string, raw: string) => {
        try {
          const msg = JSON.parse(raw) as EventMessage;
          if (msg?.type) send(msg.type, msg.data);
        } catch {
          // bỏ tin hỏng
        }
      });
      sub.on("error", (err) => console.warn(`[sse] redis lỗi: ${err.message}`));
      controller.enqueue(enc.encode("retry: 3000\n\n"));
      try {
        await sub.subscribe(eventChannel(userId));
      } catch (err) {
        console.error("[sse] không subscribe được", err);
        return finish();
      }
      send("ping", { t: Date.now() });
      timer = setInterval(() => send("ping", { t: Date.now() }), opts.pingMs ?? PING_MS);
    },
    cancel() {
      cleanup();
    },
  });
}
