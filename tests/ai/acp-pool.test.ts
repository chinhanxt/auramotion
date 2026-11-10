import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { AcpAgent } from "@/server/ai/acp/agent";
import { AgentPool } from "@/server/ai/acp/pool";
import { acpModels, acpStatus, acpText, restartAcp, stopAcp } from "@/server/ai/acp/runtime";
import { aiText, clearCooldown, getCooldowns } from "@/server/ai/gateway";
import { aiRolesSchema } from "@/server/ai/roles";

const FAKE_ACP = path.resolve("tests/fixtures/fake-acp.mjs");
const FAKE_AGY = path.resolve("tests/fixtures/fake-agy.sh");
const KEYS = ["AGY_BIN", "AGY_HOME", "AGY_ACP_DIR", "AGY_TRANSPORT", "FAKE_ACP_LOG", "FAKE_LOG"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let dir: string;
const roles = aiRolesSchema.parse({ agy: { transport: "acp", proxy: false } });

async function readLog(file: string) {
  return readFile(file, "utf8").catch(() => "");
}

describe("agy ACP pool", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aura-acp-test-"));
    await writeFile(path.join(dir, "token"), "x");
    const home = path.join(dir, "agy-home");
    await import("node:fs/promises").then((fs) => fs.mkdir(home));
    await writeFile(path.join(home, "antigravity-oauth-token"), "fake-token", { mode: 0o644 });
    process.env.AGY_BIN = FAKE_ACP;
    process.env.AGY_HOME = home;
    process.env.AGY_ACP_DIR = path.join(dir, "acp");
    process.env.AGY_TRANSPORT = "acp";
    process.env.FAKE_ACP_LOG = path.join(dir, "acp.log");
    process.env.FAKE_LOG = path.join(dir, "cli.log");
    await clearCooldown("agy:gemini-3.8-flash-low");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await stopAcp();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await clearCooldown("agy:gemini-3.8-flash-low");
    await redis.del("am:test:ai:health:agy");
    await rm(dir, { recursive: true, force: true });
    await redis.quit();
    await db.$disconnect();
  });

  it("starts lazily, sets model per session, returns text + breakdown, copies token 600", async () => {
    await restartAcp();
    const r = await acpText({ text: "xin chào", model: "claude-sonnet-5-5-low", timeoutMs: 10_000 });
    expect(r.model).toBe("claude-sonnet-5-5-low");
    expect(JSON.parse(r.text)).toEqual({ prompt: "acp:claude-sonnet-5-5-low:8" });
    expect(r.breakdown.startMs).toBeGreaterThanOrEqual(0);
    expect(r.breakdown.sessionMs).toBeGreaterThanOrEqual(0);
    expect(r.breakdown.modelMs).toBeGreaterThanOrEqual(0);
    const log = await readLog(process.env.FAKE_ACP_LOG!);
    expect(log).toMatch(/start args=acp --include-default-customizations=false --disable-telemetry --sandbox --gemini_dir \S+gemini-0 cloud=\n/);
    expect(log).toContain("session/set_model claude-sonnet-5-5-low");
    expect(log).toContain("session/close");
    const token = await stat(path.join(process.env.AGY_ACP_DIR!, "gemini-0", "antigravity-cli", "antigravity-oauth-token"));
    expect(token.mode & 0o777).toBe(0o600);
    expect(acpStatus()).toMatchObject({ alive: true, processes: 1 });
    expect(acpModels().map((m) => m.id)).toEqual(["gemini-3.8-flash-low", "claude-sonnet-5-5-low"]);

    // Lần 2 dùng lại tiến trình (không start lại).
    const again = await acpText({ text: "a", model: "gemini-3.8-flash-low", timeoutMs: 10_000 });
    expect(again.model).toBe("gemini-3.8-flash-low");
    expect((await readLog(process.env.FAKE_ACP_LOG!)).match(/^start /gm)).toHaveLength(1);
  });

  it("unknown model falls back to the next model in the list", async () => {
    const r = await acpText({ text: "a", model: "no-such-model", fallbackModels: ["gemini-3.8-flash-low"], timeoutMs: 10_000 });
    expect(r.model).toBe("gemini-3.8-flash-low");
  });

  it("abort cancels the running prompt", async () => {
    const ac = new AbortController();
    const p = acpText({ text: "[[sleep:5000]]", model: "gemini-3.8-flash-low", timeoutMs: 10_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    await expect(p).rejects.toMatchObject({ code: "CANCELED" });
    expect((await readLog(process.env.FAKE_ACP_LOG!))).toContain("session/cancel");
  });

  it("gateway agy runner uses ACP; quota → agy switch once, retry, then next provider", async () => {
    const ok = await aiText({ prompt: "viết", json: true }, { roles, role: { chain: [{ provider: "agy", model: "claude-sonnet-5-5-low" }] }, agySwitch: async () => true });
    expect(ok).toMatchObject({ provider: "agy", model: "claude-sonnet-5-5-low", data: { prompt: expect.stringContaining("acp:claude-sonnet-5-5-low") } });
    expect(ok.breakdown?.sessionMs).toBeGreaterThanOrEqual(0);

    const agySwitch = vi.fn(async () => true);
    const codex = vi.fn(async () => '{"prompt":"từ codex"}');
    const res = await aiText(
      { prompt: "[[quota]]", json: true },
      { roles, role: { chain: [{ provider: "agy" }, { provider: "codex" }] }, agySwitch, runners: { codex } },
    );
    expect(res.provider).toBe("codex");
    expect(agySwitch).toHaveBeenCalledTimes(1);
    const log = await readLog(process.env.FAKE_ACP_LOG!);
    // 2 lượt prompt agy: lần đầu + lần chạy lại sau khi đổi tài khoản.
    expect(log.split("\n").filter((l) => l === "session/prompt").length).toBeGreaterThanOrEqual(2);
 
    // Chỉ đúng agy + model đó tạm nghỉ, tối đa 30 phút; model khác của agy vẫn chạy ngay.
    const cd = await getCooldowns();
    expect(cd["agy:gemini-3.8-flash-low"]).toBeGreaterThan(0);
    expect(cd["agy:gemini-3.8-flash-low"]).toBeLessThanOrEqual(1800);
    expect(cd["agy:claude-sonnet-5-5-low"]).toBeUndefined();

    // Mắt xích đang nghỉ được thử nền bằng 1 câu ngắn; thử được thì bỏ nghỉ.
    const res2 = await aiText(
      { prompt: "viết", json: true },
      { roles, role: { chain: [{ provider: "agy", model: "claude-sonnet-5-5-low" }, { provider: "agy", model: "gemini-3.8-flash-low" }] }, agySwitch },
    );
    expect(res2.model).toBe("claude-sonnet-5-5-low");
    await vi.waitFor(async () => expect((await getCooldowns())["agy:gemini-3.8-flash-low"]).toBeUndefined(), { timeout: 5000 });
  });

  it("proxy enabled: retry once after rotation, no switch, no cooldown", async () => {
    await clearCooldown("agy:gemini-3.8-flash-low");
    const agySwitch = vi.fn(async () => true);
    const withProxy = aiRolesSchema.parse({ agy: { transport: "acp", proxy: true } });
    const res = await aiText(
      { prompt: "[[quota]]", json: true },
      { roles: withProxy, role: { chain: [{ provider: "agy" }, { provider: "codex" }] }, agySwitch, runners: { codex: async () => '{"prompt":"c"}' } },
    );
    expect(res.provider).toBe("codex");
    expect(agySwitch).not.toHaveBeenCalled();
    // Proxy xoay tài khoản: chạy lại 1 lần, không tạm nghỉ agy.
    expect((await getCooldowns())["agy:gemini-3.8-flash-low"]).toBeUndefined();
  });

  it("ACP start failure falls back to the agy CLI", async () => {
    await stopAcp();
    process.env.AGY_BIN = FAKE_AGY; // `agy acp` giả thoát ngay → ACP không khởi động được
    try {
      await restartAcp();
      const res = await aiText({ prompt: "viết", json: true }, { roles, role: { chain: [{ provider: "agy", model: "gemini-3.8-flash-low" }] }, agySwitch: async () => false });
      expect(res).toMatchObject({ provider: "agy", data: { prompt: "fake prompt" } });
      expect(await readLog(process.env.FAKE_LOG!)).toContain("agent=writer");
      expect(acpStatus().lastError).toBeTruthy();
    } finally {
      process.env.AGY_BIN = FAKE_ACP;
      await restartAcp();
    }
  });

  it("pool replaces a crashed process and stop() kills all", async () => {
    const pool = new AgentPool({
      size: 2,
      idleSessionMs: 60_000,
      restartDelayMs: 10,
      onLog: () => {},
      factory: () => new AcpAgent({ command: process.execPath, args: [FAKE_ACP], cwd: os.tmpdir() }),
    });
    await pool.start();
    expect(pool.stats()).toMatchObject({ size: 2, alive: 2 });
    const lease = await pool.lease(undefined, "gemini-3.8-flash-low");
    await expect(lease.agent.prompt(lease.sessionId, [{ type: "text", text: "[[crash]]" }], undefined, 5000)).rejects.toThrow();
    lease.release();
    await vi.waitFor(() => expect(pool.stats().alive).toBe(2), { timeout: 5000 });
    expect(pool.stats().restarts).toBeGreaterThanOrEqual(1);
    await pool.stop();
    expect(pool.stats().alive).toBe(0);
  });
});
