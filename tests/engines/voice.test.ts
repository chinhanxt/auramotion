import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { User } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { storagePath } from "@/lib/storage";
import { listVoices, previewVoice, SAMPLE_TEXT } from "@/server/engines/voice";
import { activatePlan, startFree } from "@/server/services/plan";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

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

const { GET } = await import("@/app/api/voices/route");
const { POST } = await import("@/app/api/voices/preview/route");

const ENV_KEYS = ["VIENEU_BIN", "STORAGE_DIR", "FAKE_LOG", "FAKE_SLEEP", "FAKE_FAIL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let scratch: string;
let log: string;

async function runs(): Promise<string[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split("\n").filter((l) => l && !l.includes("--list"));
}

function preview(body: unknown): Promise<Response> {
  return POST(new Request("http://localhost/api/voices/preview", { method: "POST", body: JSON.stringify(body) }));
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function makeUser(email: string, plan: "free" | "pro"): Promise<User> {
  const user = await db.user.create({ data: { email, name: email } });
  await startFree(user.id);
  if (plan === "pro") await activatePlan(user.id, "pro", "MONTH");
  return user;
}

async function makeUpload(userId: string): Promise<string> {
  const key = `uploads/${userId}/sample.wav`;
  await mkdir(path.dirname(storagePath(key)), { recursive: true });
  await writeFile(storagePath(key), "fake wav");
  return `/media/${key}`;
}

describe("voice", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    scratch = await mkdtemp(path.join(os.tmpdir(), "aura-voice-test-"));
    log = path.join(scratch, "log.txt");
    process.env.VIENEU_BIN = path.resolve("tests/fixtures/fake-vieneu-say.sh");
    process.env.STORAGE_DIR = path.join(scratch, "storage");
    process.env.FAKE_LOG = log;
    current.user = await makeUser("voice@test.local", "free");
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(scratch, { recursive: true, force: true });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("listVoices parses names", async () => {
    const voices = await listVoices();
    expect(voices).toHaveLength(3);
    expect(voices[0]).toEqual({ id: "Trúc Ly", name: "Trúc Ly", gender: "Nữ", region: "Bắc", style: "Phong cách tự nhiên" });
    expect(voices[2]).toMatchObject({ id: "Thục Đoan", gender: "Nữ", region: "Nam", style: "Phong cách kể chuyện" });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }[]).map((v) => v.id)).toEqual(["Trúc Ly", "Quang Sơn", "Thục Đoan"]);
  });

  it("previewVoice caches by key", async () => {
    const first = await previewVoice({ preset: "Trúc Ly" });
    expect(first).toMatch(/^\/media\/previews\/[0-9a-f]{40}\.wav$/);
    expect((await stat(storagePath(first.slice("/media/".length)))).size).toBeGreaterThan(0);

    expect(await previewVoice({ preset: "Trúc Ly" })).toBe(first);
    const calls = await runs();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(SAMPLE_TEXT);
    expect(calls[0]).toContain(`--voice Trúc Ly -- ${SAMPLE_TEXT}`);

    const other = await previewVoice({ preset: "Quang Sơn" });
    expect(other).not.toBe(first);
    expect(await runs()).toHaveLength(2);
  });

  it("preview clone requires pro", async () => {
    const refUrl = await makeUpload(current.user!.id);
    const res = await preview({ refUrl });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("PLAN_MODEL");
    expect(await runs()).toHaveLength(0);
  });

  it("pro clone uses own upload as --ref", async () => {
    current.user = await makeUser("pro@test.local", "pro");
    const refUrl = await makeUpload(current.user.id);
    const res = await preview({ refUrl });
    expect(res.status).toBe(200);
    expect((await res.json()) as { url: string }).toMatchObject({ url: expect.stringMatching(/^\/media\/previews\//) });
    expect((await runs())[0]).toContain(`--ref ${storagePath(refUrl.slice("/media/".length))}`);
  });

  it("clone previews of two users do not share a cache key", async () => {
    const urls: string[] = [];
    for (const email of ["a@test.local", "b@test.local"]) {
      current.user = await makeUser(email, "pro");
      const res = await preview({ refUrl: await makeUpload(current.user.id) });
      urls.push(((await res.json()) as { url: string }).url);
    }
    expect(urls[0]).not.toBe(urls[1]);
    expect(await runs()).toHaveLength(2);
  });

  it("rejects foreign or invalid refUrl", async () => {
    const other = await makeUser("other@test.local", "free");
    current.user = await makeUser("pro2@test.local", "pro");
    const foreign = await makeUpload(other.id);
    for (const refUrl of [
      foreign,
      `/media/uploads/${current.user.id}/../${other.id}/sample.wav`,
      `/media/uploads/${current.user.id}/missing.wav`,
      `/media/previews/x.wav`,
    ]) {
      const res = await preview({ refUrl });
      expect(res.status, refUrl).toBe(400);
      expect(await errorCode(res)).toBe("VALIDATION");
    }
    expect(await runs()).toHaveLength(0);
  });

  it("rejects unknown preset and long text", async () => {
    let res = await preview({ preset: "Không có" });
    expect(await errorCode(res)).toBe("VALIDATION");
    res = await preview({ preset: "Trúc Ly", text: "a".repeat(121) });
    expect(await errorCode(res)).toBe("VALIDATION");
    expect(await runs()).toHaveLength(0);
  });

  it("one preview at a time per user", async () => {
    process.env.FAKE_SLEEP = "1";
    const [a, b] = await Promise.all([preview({ preset: "Trúc Ly" }), preview({ preset: "Quang Sơn" })]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(await errorCode(a.status === 429 ? a : b)).toBe("CONCURRENCY_LIMIT");
  });

  it("engine failure maps to ENGINE", async () => {
    process.env.FAKE_FAIL = "1";
    const res = await preview({ preset: "Thục Đoan" });
    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe("ENGINE");
  });
});
