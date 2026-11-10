import { afterAll, afterEach, describe, expect, it } from "vitest";
import { redis } from "@/lib/redis";
import { MuseScheduler, SlotBusyError, type MuseSlots } from "@/server/engines/muse-scheduler";

const slots: MuseSlots = { image: 2, video: 2, chat: 1, gapSec: 20, sendVideoAspect: false };
const made: MuseScheduler[] = [];

function make(clock: { t: number }, extra: Partial<MuseSlots> = {}, leaseMs = 60_000) {
  const s = new MuseScheduler({
    prefix: `am:test:sched:${Math.random().toString(36).slice(2)}:`,
    now: () => clock.t,
    leaseMs,
    slots: async () => ({ ...slots, ...extra }),
  });
  made.push(s);
  return s;
}

describe("muse scheduler", () => {
  afterEach(async () => {
    for (const s of made.splice(0)) await s.reset();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("limits image slots and frees on release", async () => {
    const clock = { t: 1_000_000 };
    const s = make(clock);
    const a = await s.tryAcquire("image");
    const b = await s.tryAcquire("image");
    const c = await s.tryAcquire("image");
    expect("lease" in a && "lease" in b).toBe(true);
    expect(c).toEqual({ waitMs: 5000 });
    expect((await s.counts()).image).toBe(2);
    if ("lease" in a) await s.release(a.lease);
    expect("lease" in (await s.tryAcquire("image"))).toBe(true);
  });

  it("enforces a gap between video submissions", async () => {
    const clock = { t: 5_000_000 };
    const s = make(clock);
    expect("lease" in (await s.tryAcquire("video"))).toBe(true);
    clock.t += 5_000;
    expect(await s.tryAcquire("video")).toEqual({ waitMs: 15_000 });
    clock.t += 15_000;
    expect("lease" in (await s.tryAcquire("video"))).toBe(true);
    clock.t += 30_000;
    // Hết 2 slot video: báo bận dù đã qua giãn cách.
    expect(await s.tryAcquire("video")).toEqual({ waitMs: 5000 });
    expect(await s.lastVideoAt()).toBe(5_020_000);
  });

  it("gap does not apply to images", async () => {
    const clock = { t: 1 };
    const s = make(clock, { gapSec: 60 });
    expect("lease" in (await s.tryAcquire("image"))).toBe(true);
    expect("lease" in (await s.tryAcquire("image"))).toBe(true);
  });

  it("expired lease (crashed worker) is reclaimed; renew keeps it", async () => {
    const clock = { t: 10_000 };
    const s = make(clock, { chat: 1 }, 1000);
    const a = await s.tryAcquire("chat");
    expect("lease" in a).toBe(true);
    clock.t += 800;
    if ("lease" in a) expect(await s.renew(a.lease)).toBe(true);
    clock.t += 800;
    expect("waitMs" in (await s.tryAcquire("chat"))).toBe(true);
    clock.t += 1500;
    expect("lease" in (await s.tryAcquire("chat"))).toBe(true);
    if ("lease" in a) expect(await s.renew(a.lease)).toBe(false);
  });

  it("force acquire ignores limit (resumed task)", async () => {
    const clock = { t: 1 };
    const s = make(clock, { video: 1 });
    await s.tryAcquire("video");
    expect("lease" in (await s.tryAcquire("video", { force: true }))).toBe(true);
    expect((await s.counts()).video).toBe(2);
  });

  it("acquire waits then times out with SlotBusyError", async () => {
    const s = new MuseScheduler({ prefix: `am:test:sched:wait:${Date.now()}:`, slots: async () => ({ ...slots, chat: 1 }) });
    made.push(s);
    const first = await s.acquire("chat", { timeoutMs: 1000 });
    const err = await s.acquire("chat", { timeoutMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(SlotBusyError);
    const stop = s.hold(first, 50);
    await stop();
    const again = await s.acquire("chat", { timeoutMs: 300 });
    await s.release(again);
  });
});
