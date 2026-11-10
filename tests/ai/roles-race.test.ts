import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { aiText, getGatewayHealth, getGatewaySetting, type ProviderRun } from "@/server/ai/gateway";
import { aiRolesSchema, getAiRoles, migrateLegacy, saveAiRoles, DEFAULT_AI_ROLES } from "@/server/ai/roles";
import { setSetting } from "@/server/services/settings";
import { resetDb } from "../helpers/db";

const roles = aiRolesSchema.parse({});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runner chờ `ms` (hủy được), rồi trả `text` hoặc ném lỗi.
function slow(ms: number, text: string | Error, seen: { aborted?: boolean } = {}): ProviderRun {
  return ({ signal }) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => (text instanceof Error ? reject(text) : resolve(text)), ms);
      signal.addEventListener("abort", () => {
        seen.aborted = true;
        clearTimeout(t);
        reject(new Error("aborted"));
      });
    });
}

describe("ai_roles + race", () => {
  beforeEach(async () => {
    await redis.del("am:test:ai:health:agy", "am:test:ai:health:codex", "am:test:ai:health:muse");
  });

  afterAll(async () => {
    await redis.quit();
    await db.$disconnect();
  });

  it("defaults: writer agy gemini-3.8-flash-low → codex gpt-6-luna low → muse", () => {
    expect(roles.writer).toEqual({
      chain: [{ provider: "agy", model: "gemini-3.8-flash-low" }, { provider: "codex", model: "gpt-6-luna", effort: "low" }, { provider: "muse" }],
      strategy: "fallback",
      timeoutSec: 60,
    });
    expect(roles).toMatchObject({ prewrite: true, cacheHours: 72, agy: { transport: "acp", proxy: false }, codex: { profile: "default" } });
    expect(roles.story.chain[0]).toEqual({ provider: "muse" });
  });

  it("migrates ai_gateway + prompt_writer", () => {
    const r = migrateLegacy({ order: ["codex", "agy", "muse", "bogus"], agyModel: "claude-opus-5-5-low", codexModel: "gpt-6.1-sol", timeoutSec: 90 }, { provider: "agy", model: "claude-sonnet-5-5-low" });
    expect(r.writer.chain).toEqual([
      { provider: "agy", model: "claude-sonnet-5-5-low" },
      { provider: "codex", model: "gpt-6.1-sol", effort: "low" },
      { provider: "muse" },
    ]);
    expect(r.writer.timeoutSec).toBe(90);
    expect(r.story.chain.map((s) => s.provider)).toEqual(["codex", "agy", "muse"]);
    expect(r.story.chain[1]).toEqual({ provider: "agy", model: "claude-opus-5-5-low" });
    // prompt_writer codex không model: codex lên đầu, giữ model của gateway.
    expect(migrateLegacy({ order: ["agy", "codex"], timeoutSec: 60 }, { provider: "codex" }).writer.chain.map((s) => s.provider)).toEqual(["codex", "agy"]);
    expect(migrateLegacy(null, null)).toEqual(aiRolesSchema.parse({}));
  });

  it("getAiRoles reads ai_roles, else legacy settings; zod rejects bad values", async () => {
    await resetDb();
    expect(await getAiRoles()).toEqual(aiRolesSchema.parse({}));
    await setSetting("ai_gateway", { order: ["codex", "agy"], timeoutSec: 30 });
    expect((await getAiRoles()).writer.chain.map((s) => s.provider)).toEqual(["codex", "agy"]);
    expect((await getGatewaySetting()).order).toEqual(["codex", "agy"]);
    await saveAiRoles({ ...DEFAULT_AI_ROLES, writer: { chain: [{ provider: "muse", model: "" }], strategy: "race", timeoutSec: 20 } });
    const saved = await getAiRoles();
    expect(saved.writer).toEqual({ chain: [{ provider: "muse" }], strategy: "race", timeoutSec: 20 });
    await expect(saveAiRoles({ writer: { chain: [] } })).rejects.toThrow();
    await expect(saveAiRoles({ writer: { chain: [{ provider: "gpt" }] } })).rejects.toThrow();
    await expect(saveAiRoles({ codex: { profile: "../x" } })).rejects.toThrow();
    expect(aiRolesSchema.parse({ codex: { profile: "acc 6" } }).codex.profile).toBe("acc 6");
  });

  it("race: first valid result wins, loser is aborted and not recorded as an error", async () => {
    const seen: { aborted?: boolean } = {};
    const agy = slow(2000, '{"prompt":"agy"}', seen);
    const codex = slow(30, '{"prompt":"codex"}');
    const muse = vi.fn(async () => '{"prompt":"muse"}');
    const started = Date.now();
    const res = await aiText(
      { prompt: "p", json: true },
      { roles, role: { chain: [{ provider: "agy" }, { provider: "codex", model: "gpt-6-luna" }, { provider: "muse" }], strategy: "race", timeoutSec: 10 }, runners: { agy, codex, muse } },
    );
    expect(res).toMatchObject({ provider: "codex", model: "gpt-6-luna", data: { prompt: "codex" } });
    expect(Date.now() - started).toBeLessThan(1500);
    await sleep(20);
    expect(seen.aborted).toBe(true);
    expect(muse).not.toHaveBeenCalled();
    const health = await getGatewayHealth();
    expect(health.agy.lastErrAt).toBeNull();
    expect(health.codex.lastOkAt).not.toBeNull();
  });

  it("race: invalid output does not win; both fail → rest of chain", async () => {
    const res = await aiText(
      { prompt: "p", json: true },
      {
        roles,
        role: { chain: [{ provider: "agy" }, { provider: "codex" }], strategy: "race", timeoutSec: 10 },
        runners: { agy: slow(10, "không phải json"), codex: slow(60, '{"prompt":"ok"}') },
      },
    );
    expect(res.provider).toBe("codex");

    const muse = vi.fn(async () => '{"prompt":"muse"}');
    const res2 = await aiText(
      { prompt: "p", json: true },
      {
        roles,
        role: { chain: [{ provider: "agy" }, { provider: "codex" }, { provider: "muse" }], strategy: "race", timeoutSec: 10 },
        runners: { agy: slow(10, new Error("agy down")), codex: slow(20, new Error("codex down")), muse },
      },
    );
    expect(res2.provider).toBe("muse");
    expect(muse).toHaveBeenCalledTimes(1);
  });

  it("fallback passes model/effort per step and preferred provider goes first", async () => {
    const seen: string[] = [];
    const run: ProviderRun = async ({ step }) => {
      seen.push(`${step.provider}:${step.model ?? ""}:${step.effort ?? ""}`);
      if (step.provider === "agy") throw new Error("down");
      return "ok";
    };
    const res = await aiText(
      { prompt: "p", provider: "muse" },
      { roles, role: { chain: [{ provider: "agy", model: "a" }, { provider: "codex", model: "c", effort: "medium" }], strategy: "fallback" }, runners: { agy: run, codex: run, muse: run } },
    );
    expect(res.provider).toBe("muse");
    expect(seen).toEqual(["muse::"]);
    seen.length = 0;
    await aiText({ prompt: "p" }, { roles, role: { chain: [{ provider: "agy", model: "a" }, { provider: "codex", model: "c", effort: "medium" }] }, runners: { agy: run, codex: run } });
    expect(seen).toEqual(["agy:a:", "codex:c:medium"]);
  });
});
