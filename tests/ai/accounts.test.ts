import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { finishAgyLogin, getAgyAccounts, removeAgyAccount, setAgyProxy, startAgyLogin, switchAgyAccount } from "@/server/ai/agy/accounts";
import { parseBridgeOutput, runBridge } from "@/server/ai/agy/bridge";
import {
  codexProfileHome,
  getCodexLogin,
  listProfileNames,
  parseCodexModels,
  parseDeviceAuth,
  parseLoginStatus,
  startCodexLogin,
  unionModels,
} from "@/server/ai/codex-profiles";
import { getAiRoles } from "@/server/ai/roles";
import { resetDb } from "../helpers/db";

const KEYS = ["AGY_SWITCHER_DIR", "AGY_PROXY_PORT", "AURA_DATA_DIR", "CODEX_PROFILES_DIR", "CODEX_HOME"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let dir: string;
let sw: string;

describe("agy switcher bridge + codex profiles", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aura-acc-test-"));
    sw = path.join(dir, "switcher");
    await cp(path.resolve("tests/fixtures/fake-switcher"), sw, { recursive: true });
    process.env.AGY_SWITCHER_DIR = sw;
    process.env.AGY_PROXY_PORT = "18999";
    process.env.AURA_DATA_DIR = path.join(dir, "data");
    process.env.CODEX_PROFILES_DIR = path.join(dir, "codex_profiles");
    process.env.CODEX_HOME = path.join(dir, "codex-default");
  });

  beforeEach(async () => {
    await writeFile(
      path.join(sw, "accounts.json"),
      JSON.stringify([
        { id: "a@test.local", email: "a@test.local", refreshToken: "1//0gSECRETREFRESH", active: true },
        { id: "b@test.local", email: "b@test.local", refreshToken: "1//0gOTHERSECRET" },
        { id: "c@test.local", email: "c@test.local", refreshToken: "1//0gBROKEN", broken: true },
      ]),
    );
    const keys = await redis.keys("am:test:ai:*");
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
    await redis.quit();
    await db.$disconnect();
  });

  it("parseBridgeOutput takes the last JSON line with ok", () => {
    expect(parseBridgeOutput('rác\n{"x":1}\n{"ok":true,"a":2}\n')).toEqual({ ok: true, a: 2 });
    expect(parseBridgeOutput("không có json")).toBeNull();
  });

  it("status: emails, active, quota groups; never tokens", async () => {
    const accounts = await getAgyAccounts({ refresh: true });
    expect(accounts.map((a) => [a.email, a.active, a.status])).toEqual([
      ["a@test.local", true, "VALID"],
      ["b@test.local", false, "VALID"],
      ["c@test.local", false, "ERROR"],
    ]);
    expect(accounts[0].quota).toContainEqual({ group: "gemini_5h", pct: 80, resetAt: "2026-11-10T20:00:00Z" });
    // 2 cột Gemini | Claude: % còn lại 5 giờ + tuần, lúc reset.
    expect(accounts[0].groups).toEqual({
      gemini: { fiveHour: 80, weekly: 90, fiveHourResetAt: "2026-11-10T20:00:00Z", weeklyResetAt: null },
      claude: { fiveHour: 50, weekly: 60, fiveHourResetAt: null, weeklyResetAt: null },
    });
    expect(accounts[2].groups.gemini).toEqual({ fiveHour: null, weekly: null, fiveHourResetAt: null, weeklyResetAt: null });
    const raw = JSON.stringify(accounts);
    expect(raw).not.toMatch(/SECRET|refreshToken|1\/\/|ya29/);
    expect(accounts[2].error).toContain("***");
    // cache 60 s
    await writeFile(path.join(sw, "accounts.json"), "[]");
    expect(await getAgyAccounts()).toHaveLength(3);
    expect(await getAgyAccounts({ refresh: true })).toHaveLength(0);
  });

  it("login: auth-url keeps verifier server-side, finish validates state", async () => {
    const { url, state } = await startAgyLogin();
    expect(url).toContain("code_challenge=challenge-abc");
    expect(url).toContain(`state=${state}`);
    expect(JSON.stringify({ url, state })).not.toContain("verifier-123");
    expect(await redis.get(`am:test:ai:agy:login:${state}`)).toBe("verifier-123");
    await expect(finishAgyLogin(state, `https://antigravity.google/oauth-callback?code=4/x&state=${"0".repeat(32)}`)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(finishAgyLogin("f".repeat(32), "4/abc")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // exchange gọi Google thật: chỉ kiểm bridge báo thiếu dữ liệu.
    await expect(runBridge(["exchange"], { stdin: "{}" })).rejects.toMatchObject({ code: "AGY_SWITCHER", message: expect.stringContaining("Thiếu") });
  });

  it("switch auto picks most Gemini quota, switch by id, remove", async () => {
    expect(await switchAgyAccount({ auto: true })).toMatchObject({ switched: false, account: { email: "a@test.local" } });
    expect(await switchAgyAccount({ id: "b@test.local" })).toMatchObject({ switched: true, account: { email: "b@test.local" } });
    const stored = JSON.parse(await readFile(path.join(sw, "accounts.json"), "utf8")) as { email: string; active?: boolean }[];
    expect(stored.find((a) => a.active)?.email).toBe("b@test.local");
    await expect(switchAgyAccount({ id: "nobody@test.local" })).rejects.toMatchObject({ code: "AGY_SWITCHER" });
    expect(await removeAgyAccount("c@test.local")).toEqual({ removed: true });
    expect(await removeAgyAccount("c@test.local")).toEqual({ removed: false });
  });

  it("proxy on/off: own port + pid file in data/, saved in ai_roles; owner ports refused", async () => {
    await resetDb();
    const on = await setAgyProxy(true);
    expect(on).toMatchObject({ enabled: true, proxy: { port: 18999, running: true } });
    const state = JSON.parse(await readFile(path.join(sw, "proxy-state.json"), "utf8")) as { pid_file: string };
    expect(state.pid_file).toBe(path.join(dir, "data", "agy-proxy", "proxy.pid"));
    expect((await getAiRoles()).agy.proxy).toBe(true);
    const off = await setAgyProxy(false);
    expect(off).toMatchObject({ enabled: false, proxy: { running: false } });
    expect((await getAiRoles()).agy.proxy).toBe(false);
    process.env.AGY_PROXY_PORT = "8899";
    await expect(setAgyProxy(true)).rejects.toMatchObject({ code: "AGY_PROXY" });
    process.env.AGY_PROXY_PORT = "18999";
  });

  it("codex output parsing: device auth, login status, models with hidden + union", () => {
    const out = "\x1b[1mWelcome\x1b[0m\n1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94mWXYZ-98765\x1b[0m\n";
    expect(parseDeviceAuth(out)).toEqual({ url: "https://auth.openai.com/codex/device", code: "WXYZ-98765" });
    expect(parseDeviceAuth("1. Open this link\n https://x.y/z\n")).toBeNull();
    expect(parseLoginStatus("Logged in using ChatGPT")).toEqual({ loggedIn: true, method: "chatgpt" });
    expect(parseLoginStatus("Logged in using an API key - sk-proj-***abcd")).toEqual({ loggedIn: true, method: "api-key" });
    expect(parseLoginStatus("Not logged in")).toEqual({ loggedIn: false, method: null });
    const models = parseCodexModels(
      JSON.stringify({
        models: [
          { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list", default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }] },
          { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", supported_reasoning_levels: [] },
        ],
      }),
    );
    expect(models).toEqual([
      { id: "gpt-6-luna", name: "GPT-6-Luna", efforts: ["low", "medium"], defaultEffort: "medium", hidden: false },
      { id: "gpt-reserve", name: "GPT-Reserve", efforts: [], defaultEffort: null, hidden: true },
    ]);
    const union = unionModels([
      { name: "acc1", models: [models[0]] },
      { name: "acc 6", models: [{ ...models[0], efforts: ["high"] }, models[1]] },
    ]);
    expect(union).toEqual([
      { ...models[0], efforts: ["low", "medium", "high"], profiles: ["acc1", "acc 6"] },
      { ...models[1], profiles: ["acc 6"] },
    ]);
  });

  it("profiles: default, ~/.codex_profiles dirs (spaces ok), web dirs; device-auth login done/error", async () => {
    await mkdir(path.join(dir, "codex_profiles", "acc 6"), { recursive: true });
    await mkdir(path.join(dir, "codex_profiles", "acc1"), { recursive: true });
    await writeFile(path.join(dir, "codex_profiles", "profiles.json"), "{}");
    expect(codexProfileHome("default")).toBe(path.join(dir, "codex-default"));
    expect(codexProfileHome("acc 6")).toBe(path.join(dir, "codex_profiles", "acc 6"));
    expect(() => codexProfileHome("../etc")).toThrow();
    expect(() => codexProfileHome("Bad Name", { create: true })).toThrow();
    const web = codexProfileHome("shop2", { create: true });
    expect(web).toBe(path.join(dir, "data", "codex", "shop2"));
    const names = await listProfileNames();
    expect(names).toEqual(
      expect.arrayContaining([
        { name: "default", source: "default" },
        { name: "acc 6", source: "external" },
        { name: "acc1", source: "external" },
        { name: "shop2", source: "web" },
      ]),
    );

    const bin = path.resolve("tests/fixtures/fake-codex-device.sh");
    const login = await startCodexLogin("shop2", { bin });
    expect(login).toMatchObject({ url: "https://auth.openai.com/codex/device", code: "ABCD-1234" });
    expect((await getCodexLogin(login.loginId)).status).toBe("waiting");
    await vi.waitFor(async () => expect((await getCodexLogin(login.loginId)).status).toBe("done"), { timeout: 5000 });
    expect(await readFile(path.join(web, "login.txt"), "utf8")).toContain(`home=${web}`);

    process.env.FAKE_LOGIN_FAIL = "1";
    try {
      const bad = await startCodexLogin("acc 6", { bin });
      await vi.waitFor(async () => expect(await getCodexLogin(bad.loginId)).toMatchObject({ status: "error", message: expect.stringContaining("timed out") }), { timeout: 5000 });
    } finally {
      delete process.env.FAKE_LOGIN_FAIL;
    }
    await expect(getCodexLogin("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
