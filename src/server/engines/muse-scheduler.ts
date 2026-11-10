import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import { redis as defaultRedis } from "@/lib/redis";
import { getSetting } from "@/server/services/settings";

// Muse scheduler: giới hạn số "chat phụ" (tab Muse) chạy cùng lúc theo loại media + giãn cách gửi video.
// Semaphore đếm bằng Redis ZSET (member = lease, score = hạn), lease tự hết hạn nếu worker chết.

export type SlotType = "image" | "video" | "chat";
export type MuseSlots = { image: number; video: number; chat: number; gapSec: number; sendVideoAspect: boolean };

// Đo thật 10/11: 3 video song song (gửi cách 20 s) ~61 s; gửi size thì Muse ra đúng tỷ lệ (9:16 → 720×1280).
export const DEFAULT_MUSE_SLOTS: MuseSlots = { image: 2, video: 3, chat: 1, gapSec: 15, sendVideoAspect: true };
export const SLOT_TYPES: SlotType[] = ["image", "video", "chat"];

const LEASE_MS = 60_000;
const RENEW_MS = 20_000;
// Hết slot (không phải chờ giãn cách): thử lại sau chừng này.
const BUSY_RETRY_MS = 5_000;

export async function getMuseSlots(): Promise<MuseSlots> {
  const raw = await getSetting<Partial<MuseSlots>>("muse_slots").catch(() => ({}));
  return { ...DEFAULT_MUSE_SLOTS, ...(raw && typeof raw === "object" ? raw : {}) };
}

// Hết slot hoặc chưa đủ giãn cách: job quay lại hàng đợi sau `waitMs`, không tính là lần thử.
export class SlotBusyError extends Error {
  constructor(
    readonly slot: SlotType,
    readonly waitMs: number,
  ) {
    super(`Muse ${slot} đang bận, thử lại sau ${Math.ceil(waitMs / 1000)} s`);
    this.name = "SlotBusyError";
  }
}

const ACQUIRE = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local force = ARGV[6] == '1'
local gap = tonumber(ARGV[5])
if not force then
  if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return {0, -1} end
  if gap > 0 then
    local raw = redis.call('GET', KEYS[2])
    if raw then
      local last = tonumber(raw)
      if now - last < gap then return {0, gap - (now - last)} end
    end
  end
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[4])
if gap > 0 and not force then redis.call('SET', KEYS[2], now, 'PX', gap + 60000) end
return {1, 0}
`;

const RENEW = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
  return 1
end
return 0
`;

export type Lease = { type: SlotType; id: string };

export type SchedulerOptions = {
  redis?: IORedis;
  prefix?: string;
  leaseMs?: number;
  now?: () => number;
  slots?: () => Promise<MuseSlots>;
};

export class MuseScheduler {
  private readonly redis: IORedis;
  private readonly prefix: string;
  readonly leaseMs: number;
  private readonly now: () => number;
  private readonly slots: () => Promise<MuseSlots>;

  constructor(opts: SchedulerOptions = {}) {
    this.redis = opts.redis ?? defaultRedis;
    this.prefix = opts.prefix ?? (process.env.NODE_ENV === "test" ? "am:test:muse:" : "am:muse:");
    this.leaseMs = opts.leaseMs ?? LEASE_MS;
    this.now = opts.now ?? Date.now;
    this.slots = opts.slots ?? getMuseSlots;
  }

  private semKey(type: SlotType): string {
    return `${this.prefix}sem:${type}`;
  }

  private gapKey(): string {
    return `${this.prefix}lastVideoAt`;
  }

  getSlots(): Promise<MuseSlots> {
    return this.slots();
  }

  // force: job MUSE chạy tiếp sau khi worker khởi động lại — task đã chiếm tab, chỉ ghi nhận lease.
  async tryAcquire(type: SlotType, opts: { force?: boolean } = {}): Promise<{ lease: Lease } | { waitMs: number }> {
    const slots = await this.slots();
    const limit = Math.max(0, Math.floor(slots[type]));
    const gapMs = type === "video" ? Math.max(0, slots.gapSec) * 1000 : 0;
    const id = randomUUID();
    const [ok, wait] = (await this.redis.eval(
      ACQUIRE,
      2,
      this.semKey(type),
      this.gapKey(),
      this.now(),
      this.leaseMs,
      limit,
      id,
      gapMs,
      opts.force ? "1" : "0",
    )) as [number, number];
    if (ok === 1) return { lease: { type, id } };
    return { waitMs: wait < 0 ? BUSY_RETRY_MS : wait };
  }

  // Chờ tới khi có slot (dùng cho chat trong request HTTP); quá `timeoutMs` thì ném SlotBusyError.
  async acquire(type: SlotType, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<Lease> {
    const deadline = this.now() + opts.timeoutMs;
    for (;;) {
      const res = await this.tryAcquire(type);
      if ("lease" in res) return res.lease;
      const left = deadline - this.now();
      if (left <= 0 || opts.signal?.aborted) throw new SlotBusyError(type, res.waitMs);
      await new Promise((r) => setTimeout(r, Math.min(res.waitMs, left, 1000)));
    }
  }

  async renew(lease: Lease): Promise<boolean> {
    const ok = await this.redis.eval(RENEW, 1, this.semKey(lease.type), lease.id, this.now() + this.leaseMs);
    return ok === 1;
  }

  async release(lease: Lease): Promise<void> {
    await this.redis.zrem(this.semKey(lease.type), lease.id).catch(() => 0);
  }

  // Gia hạn lease định kỳ trong lúc task chạy; gọi hàm trả về để dừng + trả slot.
  hold(lease: Lease, everyMs = RENEW_MS): () => Promise<void> {
    const timer = setInterval(() => {
      this.renew(lease).catch(() => false);
    }, everyMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await this.release(lease);
    };
  }

  async counts(): Promise<Record<SlotType, number>> {
    const now = this.now();
    const out = {} as Record<SlotType, number>;
    for (const t of SLOT_TYPES) out[t] = await this.redis.zcount(this.semKey(t), `(${now}`, "+inf");
    return out;
  }

  async lastVideoAt(): Promise<number | null> {
    const v = await this.redis.get(this.gapKey());
    return v ? Number(v) : null;
  }

  // Chỉ dùng trong test.
  async reset(): Promise<void> {
    await this.redis.del(...SLOT_TYPES.map((t) => this.semKey(t)), this.gapKey());
  }
}

let shared: MuseScheduler | undefined;

export function getScheduler(): MuseScheduler {
  shared ??= new MuseScheduler();
  return shared;
}
