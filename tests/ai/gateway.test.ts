import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { aiText, extractJson, getGatewayHealth, type ProviderRun } from "@/server/ai/gateway";
import { renderTemplate } from "@/server/ai/template";
import { MuseScheduler } from "@/server/engines/muse-scheduler";
import type { HttpMuseClient } from "@/server/engines/muse";
import { EngineError } from "@/server/engines/types";
import { writePrompt } from "@/server/engines/prompt-writer";
import { setSetting } from "@/server/services/settings";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const setting = { order: ["agy", "codex", "muse"] as ("agy" | "codex" | "muse")[], timeoutSec: 5 };

async function clearHealth() {
  await redis.del("am:test:ai:health:agy", "am:test:ai:health:codex", "am:test:ai:health:muse");
}

describe("ai gateway", () => {
  beforeEach(async () => {
    await clearHealth();
  });

  afterAll(async () => {
    await clearHealth();
    await redis.quit();
    await db.$disconnect();
  });

  it("falls back to the next provider and records health", async () => {
    const agy: ProviderRun = vi.fn(async () => {
      throw new Error("agy down");
    });
    const codex: ProviderRun = vi.fn(async () => "xin chào");
    const res = await aiText({ prompt: "p" }, { setting, runners: { agy, codex } });
    expect(res.provider).toBe("codex");
    expect(res.text).toBe("xin chào");
    expect(agy).toHaveBeenCalledTimes(1);
    const health = await getGatewayHealth();
    expect(health.agy.lastError).toContain("agy down");
    expect(health.agy.lastErrAt).not.toBeNull();
    expect(health.codex.lastOkAt).not.toBeNull();
    expect(health.codex.lastMs).toBeGreaterThanOrEqual(0);
    expect(health.muse.lastOkAt).toBeNull();
  });

  it("preferred provider first, passes threadKey and system", async () => {
    const muse: ProviderRun = vi.fn(async ({ threadKey, system }) => `${threadKey}|${system}`);
    const agy: ProviderRun = vi.fn(async () => "agy");
    const res = await aiText({ prompt: "p", system: "sys", provider: "muse", threadKey: "story:1" }, { setting, runners: { muse, agy } });
    expect(res).toMatchObject({ provider: "muse", text: "story:1|sys" });
    expect(agy).not.toHaveBeenCalled();
  });

  it("json mode treats non-JSON as failure", async () => {
    const res = await aiText(
      { prompt: "p", json: true },
      { setting, runners: { agy: async () => "xin lỗi", codex: async () => '```json\n{"a": 1,}\n```' } },
    );
    expect(res.provider).toBe("codex");
    expect(res.data).toEqual({ a: 1 });
  });

  it("all providers fail → AI_GATEWAY", async () => {
    const fail = async () => {
      throw new Error("x");
    };
    const err = await aiText({ prompt: "p" }, { setting, runners: { agy: fail, codex: fail, muse: fail } }).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe("AI_GATEWAY");
  });

  it("muse provider uses chat slot and main-chat user key", async () => {
    const scheduler = new MuseScheduler({ prefix: `am:test:gw:${Date.now()}:`, slots: async () => ({ image: 1, video: 1, chat: 1, gapSec: 0, sendVideoAspect: false }) });
    const chat = vi.fn(async () => "ok");
    const muse = { chat } as unknown as HttpMuseClient;
    const res = await aiText({ prompt: "p", provider: "muse", threadKey: "story:abc" }, { setting, muse, scheduler });
    expect(res.provider).toBe("muse");
    expect(chat).toHaveBeenCalledWith([{ role: "user", content: "p" }], expect.objectContaining({ user: "story:abc" }));
    expect((await scheduler.counts()).chat).toBe(0);
    await scheduler.reset();
  });

  it("extractJson repairs fences, smart quotes and trailing commas", () => {
    expect(extractJson('Đây: ```json {“title”: “A”, "shots": [1,2,],} ``` xong')).toEqual({ title: "A", shots: [1, 2] });
    expect(extractJson("không có")).toBeUndefined();
  });

  it("renderTemplate fills known vars", () => {
    expect(renderTemplate("{{idea}} / {{shots}} / {{style}} / {{x}}", { idea: "mèo", shots: 3 })).toBe(
      "mèo / 3 / not specified, choose what fits the idea / ",
    );
  });

  it("writePrompt renders skill template with style/camera and blocks locked skill", async () => {
    await resetDb();
    await seed();
    await setSetting("prompt_writer", {});
    const skill = await db.promptSkill.findUniqueOrThrow({ where: { slug: "video-one-move" } });
    const style = await db.preset.findFirstOrThrow({ where: { slug: "son-mai" } });
    const camera = await db.preset.findFirstOrThrow({ where: { slug: "cam-orbit" } });
    let seen: { prompt: string; system?: string } | undefined;
    const run: ProviderRun = async (a) => {
      seen = a;
      return '{"prompt": "a lacquer fox"}';
    };
    const out = await writePrompt(
      { idea: "cáo đỏ", kind: "video", durationSec: 5, skillId: skill.id, styleId: style.id, cameraId: camera.id },
      { setting, runners: { agy: run } },
    );
    expect(out).toEqual({ prompt: "a lacquer fox", provider: "agy" });
    expect(seen?.system).toContain("Exactly ONE camera move");
    expect(seen?.prompt).toContain("cáo đỏ");
    expect(seen?.prompt).toContain("lacquer");
    expect(seen?.prompt).toContain("orbit");

    await db.promptSkill.update({ where: { id: skill.id }, data: { minPlanRank: 2 } });
    await expect(writePrompt({ idea: "x", kind: "video", skillId: skill.id, planRank: 0 }, { setting, runners: { agy: run } })).rejects.toMatchObject({
      code: "PLAN_MODEL",
    });
    await expect(writePrompt({ idea: "x", kind: "image", skillId: skill.id }, { setting, runners: { agy: run } })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});
