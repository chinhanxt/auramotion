import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { CodexAppServer, codexAppText, getCodexAppServer, setCodexAppServerFactory, stopCodexAppServers } from "@/server/ai/codex/appserver";
import { clearCodexQuotaCache, getCodexQuota, parseAppServerRateLimits, parseSessionLogLine, quotaFromSessionLog } from "@/server/ai/codex/quota";
import { aiText } from "@/server/ai/gateway";
import { aiRolesSchema } from "@/server/ai/roles";

const FAKE_AS = path.resolve("tests/fixtures/fake-codex-appserver.mjs");
const FAKE_CODEX = path.resolve("tests/fixtures/fake-codex.sh");
const KEYS = ["CODEX_BIN", "CODEX_HOME", "CODEX_TRANSPORT", "FAKE_CX_LOG", "FAKE_CX_NO_RATE", "FAKE_LOG"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let dir: string;
let home: string;
let logFile: string;

const server = (h = home) => new CodexAppServer({ command: FAKE_AS, home: h, cwd: path.join(dir, "cwd"), startTimeoutMs: 5000 });
const starts = async () => (await readFile(logFile, "utf8").catch(() => "")).split("\n").filter((l) => l.startsWith("start ")).length;

const SESSION_LINE = JSON.stringify({
  timestamp: "2026-11-10T04:25:57.258Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    rate_limits: { limit_id: "codex", primary: { used_percent: 6, window_minutes: 300, resets_at: 1794295167 }, secondary: { used_percent: 7.5, window_minutes: 10080, resets_at: 1794449450 }, plan_type: "plus" },
  },
});

describe("codex app-server", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aura-cxas-test-"));
    home = path.join(dir, "home");
    await mkdir(home, { recursive: true });
    logFile = path.join(dir, "cx.log");
    process.env.FAKE_CX_LOG = logFile;
    process.env.CODEX_HOME = home;
  });

  afterEach(async () => {
    setCodexAppServerFactory(undefined);
    await stopCodexAppServers();
    clearCodexQuotaCache();
    delete process.env.FAKE_CX_NO_RATE;
    await rm(logFile, { force: true });
  });

  afterAll(async () => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
    await redis.del("am:test:ai:health:codex");
    await redis.quit();
    await db.$disconnect();
  });

  it("handshake, thread read-only ephemeral, gom chữ final_answer, model + effort, breakdown", async () => {
    setCodexAppServerFactory((h) => server(h));
    const r = await codexAppText({ home, prompt: "xin chào", model: "gpt-6-luna", effort: "low", timeoutMs: 5000 });
    expect(r.text).toBe("cx:gpt-6-luna:low:8");
    expect(r.model).toBe("gpt-6-luna");
    expect(r.breakdown.startMs).toBeGreaterThanOrEqual(0);
    expect(r.breakdown.sessionMs).toBeGreaterThanOrEqual(0);
    expect(r.breakdown.modelMs).toBeGreaterThanOrEqual(0);
    const log = await readFile(logFile, "utf8");
    expect(log).toContain(`start ${home}`);
    expect(log).toContain("initialized");
    expect(log).toContain("thread model=gpt-6-luna sandbox=read-only approval=never ephemeral=true");
    expect(log).toContain("turn effort=low");
    // Tiến trình thường trực: lượt thứ 2 không bật tiến trình mới.
    await codexAppText({ home, prompt: "lần 2", timeoutMs: 5000 });
    expect(await starts()).toBe(1);
    expect((await readFile(logFile, "utf8")).match(/thread\/unsubscribe/g)?.length).toBe(2);
  });

  it("chỉ có delta (không item/completed) vẫn gom được chữ; từ chối mọi yêu cầu duyệt lệnh", async () => {
    const s = server();
    await s.start();
    try {
      expect((await s.text({ prompt: "[[deltaonly]]", timeoutMs: 5000 })).text).toBe("cx:gpt-default::13");
      expect((await s.text({ prompt: "[[approval]]", timeoutMs: 5000 })).text).toMatch(/:decline$/);
    } finally {
      await s.stop();
    }
  });

  it("turn lỗi → EngineError có lý do; hết giờ → interrupt + TIMEOUT; hủy → CANCELED", async () => {
    const s = server();
    await s.start();
    try {
      const err = await s.text({ prompt: "[[error]]", timeoutMs: 5000 }).catch((e) => e);
      expect(err.code).toBe("CODEX_FAILED");
      expect(err.message).toContain("usage limit");
      const slow = await s.text({ prompt: "[[sleep:3000]]", timeoutMs: 200 }).catch((e) => e);
      expect(slow.code).toBe("TIMEOUT");
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 100);
      const canceled = await s.text({ prompt: "[[sleep:3000]]", timeoutMs: 5000, signal: ac.signal }).catch((e) => e);
      expect(canceled.code).toBe("CANCELED");
      expect(await readFile(logFile, "utf8")).toContain("turn/interrupt");
      // Vẫn dùng tiếp được.
      expect((await s.text({ prompt: "ok", timeoutMs: 5000 })).text).toBe("cx:gpt-default::2");
    } finally {
      await s.stop();
    }
  });

  it("tiến trình chết giữa lượt → lỗi; lần sau tự bật lại", async () => {
    setCodexAppServerFactory((h) => server(h));
    const err = await codexAppText({ home, prompt: "[[crash]]", timeoutMs: 5000 }).catch((e) => e);
    expect(err.code).toBe("CODEX_APPSERVER");
    const r = await codexAppText({ home, prompt: "lại", timeoutMs: 5000 });
    expect(r.text).toBe("cx:gpt-default::3");
    expect(await starts()).toBe(2);
  });

  it("gateway: app-server trước; không khởi động được thì về codex exec", async () => {
    process.env.CODEX_TRANSPORT = "app-server";
    const roles = aiRolesSchema.parse({});
    const chain = { chain: [{ provider: "codex" as const, model: "gpt-6-luna", effort: "low" }], strategy: "fallback" as const };
    setCodexAppServerFactory((h) => server(h));
    const ok = await aiText({ prompt: "viết" }, { roles, role: chain });
    expect(ok.text).toBe("cx:gpt-6-luna:low:4");
    expect(ok.breakdown?.sessionMs).toBeGreaterThanOrEqual(0);
    await stopCodexAppServers();
    // codex giả (fake-codex.sh) không biết app-server: thoát ngay → dùng `codex exec`.
    setCodexAppServerFactory((h) => new CodexAppServer({ command: FAKE_CODEX, home: h, cwd: path.join(dir, "cwd"), startTimeoutMs: 5000 }));
    process.env.CODEX_BIN = FAKE_CODEX;
    const fb = await aiText({ prompt: "viết" }, { roles, role: chain });
    expect(fb.text).toBe('{"lines":["Câu 1.","Câu 2."]}');
    process.env.CODEX_TRANSPORT = "exec";
  });

  it("quota: đọc rateLimits qua app-server (profile đang bật + tạm), cache; lỗi → log phiên", async () => {
    setCodexAppServerFactory((h) => server(h));
    const q = await getCodexQuota(home, { active: true });
    expect(q).toMatchObject({
      source: "app-server",
      planType: "plus",
      primary: { usedPercent: 12, windowMinutes: 300, resetsAt: new Date(1794313806 * 1000).toISOString() },
      secondary: { usedPercent: 40, windowMinutes: 10080 },
    });
    expect(await getCodexQuota(home, { active: true })).toEqual(q);
    expect(await starts()).toBe(1);

    // Profile khác: app-server tạm, tắt ngay sau khi đọc.
    const other = path.join(dir, "other");
    await mkdir(path.join(other, "sessions", "2026", "11", "10"), { recursive: true });
    const tmp = await getCodexQuota(other, { active: false });
    expect(tmp?.source).toBe("app-server");
    expect(await starts()).toBe(2);

    // app-server lỗi → rate_limits mới nhất trong log phiên (file mới nhất theo mtime).
    process.env.FAKE_CX_NO_RATE = "1";
    const sessions = path.join(other, "sessions", "2026", "11", "10");
    const older = path.join(sessions, "rollout-a.jsonl");
    await writeFile(older, SESSION_LINE.replace('"used_percent":6', '"used_percent":99') + "\n");
    await utimes(older, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    await writeFile(path.join(sessions, "rollout-b.jsonl"), `{"type":"x"}\n${SESSION_LINE}\n{"type":"y"}\n`);
    const fromLog = await getCodexQuota(other, { active: false, refresh: true });
    expect(fromLog).toMatchObject({ source: "session-log", checkedAt: "2026-11-10T04:25:57.258Z", primary: { usedPercent: 6 }, secondary: { usedPercent: 7.5 } });
  });

  it("parse rate limits: ưu tiên bucket codex, cửa sổ thiếu → null, log phiên không có quota → null", async () => {
    expect(
      parseAppServerRateLimits({
        rateLimits: { primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: null } },
        rateLimitsByLimitId: { codex: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1 }, secondary: null } },
      }),
    ).toMatchObject({ primary: { usedPercent: 5, resetsAt: "1970-01-01T00:00:01.000Z" }, secondary: null });
    expect(parseAppServerRateLimits({ rateLimits: { primary: null, secondary: null } })).toBeNull();
    expect(parseSessionLogLine('{"payload":{"rate_limits":null}}')).toBeNull();
    expect(parseSessionLogLine("không phải json rate_limits")).toBeNull();
    expect(await quotaFromSessionLog(path.join(dir, "khong-co"))).toBeNull();
  });

  it("getCodexAppServer: lỗi khởi động → tạm nghỉ 30 s (không bật lại liên tục)", async () => {
    setCodexAppServerFactory((h) => new CodexAppServer({ command: path.join(dir, "khong-ton-tai"), home: h, cwd: path.join(dir, "cwd") }));
    const a = await getCodexAppServer(home).catch((e) => e);
    expect(a.code).toBe("CODEX_APPSERVER");
    setCodexAppServerFactory((h) => server(h));
    const b = await getCodexAppServer(home).catch((e) => e);
    expect(b.message).toContain("chưa khởi động được");
  });
});
