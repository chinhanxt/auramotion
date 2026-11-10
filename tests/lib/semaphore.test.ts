import { afterAll, describe, expect, it } from "vitest";
import { redis } from "@/lib/redis";
import { acquireSlot } from "@/lib/semaphore";

const KEY = "am:test:sem:cli";

describe("acquireSlot (giới hạn tiến trình agy/codex)", () => {
  afterAll(async () => {
    await redis.del(KEY);
    await redis.quit();
  });

  it("đủ chỗ thì vào ngay, hết chỗ thì chờ tới khi có người trả", async () => {
    await redis.del(KEY);
    const a = await acquireSlot(redis, KEY, { limit: 1, timeoutMs: 1000 });
    await expect(acquireSlot(redis, KEY, { limit: 1, timeoutMs: 300 })).rejects.toThrow(/hết chỗ/);
    const waiting = acquireSlot(redis, KEY, { limit: 1, timeoutMs: 3000 });
    setTimeout(() => void a(), 200);
    const b = await waiting;
    expect(await redis.zcard(KEY)).toBe(1);
    await b();
    expect(await redis.zcard(KEY)).toBe(0);
  });

  it("lease của tiến trình chết tự hết hạn", async () => {
    await redis.del(KEY);
    await redis.zadd(KEY, Date.now() - 1, "dead");
    const c = await acquireSlot(redis, KEY, { limit: 1, timeoutMs: 500 });
    await c();
  });
});
