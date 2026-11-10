import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";

// Semaphore đếm dùng chung giữa app + worker (Redis ZSET: member = lease, score = hạn).
// Lease tự hết hạn nếu tiến trình chết; giữ lâu thì tự gia hạn.

const ACQUIRE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[2]), ARGV[4])
return 1
`;

export type SemaphoreOptions = { limit: number; timeoutMs: number; leaseMs?: number; signal?: AbortSignal };

export async function acquireSlot(redis: IORedis, key: string, opts: SemaphoreOptions): Promise<() => Promise<void>> {
  const leaseMs = opts.leaseMs ?? 60_000;
  const id = randomUUID();
  const deadline = Date.now() + opts.timeoutMs;
  for (let wait = 150; ; wait = Math.min(wait * 1.5, 2000)) {
    const ok = await redis.eval(ACQUIRE, 1, key, Date.now(), leaseMs, Math.max(1, opts.limit), id);
    if (ok === 1) break;
    if (opts.signal?.aborted) throw new Error("aborted");
    if (Date.now() >= deadline) throw new Error(`hết chỗ ${key}`);
    await new Promise((r) => setTimeout(r, wait));
  }
  const timer = setInterval(() => {
    redis.zadd(key, Date.now() + leaseMs, id).catch(() => 0);
  }, leaseMs / 3);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await redis.zrem(key, id).catch(() => 0);
  };
}
