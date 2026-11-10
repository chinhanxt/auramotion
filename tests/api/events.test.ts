import type { User } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { publishEvent } from "@/lib/events";
import { redis } from "@/lib/redis";
import { createEventStream } from "@/lib/sse";

const current: { user: User | null } = { user: null };

vi.mock("@/lib/auth", async () => {
  const { AppError } = await import("@/lib/errors");
  return {
    requireUser: async () => {
      if (!current.user) throw new AppError("UNAUTHORIZED", "Vui lòng đăng nhập");
      return current.user;
    },
  };
});

const { GET } = await import("@/app/api/events/route");

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string, ms = 3000): Promise<string> {
  const dec = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (!text.includes(needle)) {
    if (Date.now() > deadline) throw new Error(`hết giờ chờ "${needle}", đã nhận: ${text}`);
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  return text;
}

async function subscribers(channel: string): Promise<number> {
  const [, n] = (await redis.pubsub("NUMSUB", channel)) as [string, number];
  return Number(n);
}

describe("SSE events", () => {
  afterAll(async () => {
    await redis.quit();
  });

  it("delivers published events for that user only, pings, cleans up on abort", async () => {
    const userId = `sse-${Date.now()}`;
    const ac = new AbortController();
    const reader = createEventStream(userId, ac.signal, { pingMs: 50 }).getReader();
    await readUntil(reader, "event: ping");
    expect(await subscribers(`am:ev:${userId}`)).toBe(1);

    await publishEvent(`${userId}-other`, "job", { id: "nope" });
    await publishEvent(userId, "job", { id: "j1", status: "RUNNING", progress: 40 });
    const text = await readUntil(reader, '"j1"');
    expect(text).toContain("event: job");
    expect(text).toContain('"progress":40');
    expect(text).not.toContain("nope");

    await publishEvent(userId, "credit", { balance: 12.5 });
    expect(await readUntil(reader, "event: credit")).toContain('"balance":12.5');
    await readUntil(reader, "event: ping");

    ac.abort();
    await new Promise((r) => setTimeout(r, 200));
    expect(await subscribers(`am:ev:${userId}`)).toBe(0);
  });

  it("route requires login and returns an event stream", async () => {
    current.user = null;
    const anon = await GET(new Request("http://x/api/events"));
    expect(anon.status).toBe(401);

    current.user = { id: `sse-route-${Date.now()}` } as User;
    const ac = new AbortController();
    const res = await GET(new Request("http://x/api/events", { signal: ac.signal }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    await readUntil(reader, "event: ping");
    ac.abort();
  });
});
