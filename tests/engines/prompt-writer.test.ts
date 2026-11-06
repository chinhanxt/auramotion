import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { writePrompt } from "@/server/engines/prompt-writer";
import { EngineError } from "@/server/engines/types";
import { setSetting } from "@/server/services/settings";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const ENV_KEYS = ["AGY_BIN", "CODEX_BIN", "AGY_HOME", "FAKE_FAIL", "FAKE_CODEX_FAIL", "FAKE_RESPONSE", "FAKE_LOG"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let scratch: string;
let log: string;

async function readLog(): Promise<string> {
  return readFile(log, "utf8").catch(() => "");
}

describe("writePrompt", () => {
  beforeAll(async () => {
    await resetDb();
    await seed();
  });

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "aura-pw-test-"));
    log = path.join(scratch, "log.txt");
    const agyHome = path.join(scratch, "agy-home");
    await mkdir(agyHome);
    await writeFile(path.join(agyHome, "antigravity-oauth-token"), "fake-token", { mode: 0o644 });
    process.env.AGY_BIN = path.resolve("tests/fixtures/fake-agy.sh");
    process.env.CODEX_BIN = path.resolve("tests/fixtures/fake-codex.sh");
    process.env.AGY_HOME = agyHome;
    process.env.FAKE_LOG = log;
    await setSetting("prompt_writer", { provider: "agy", model: "claude-sonnet-5-5-low" });
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

  it("image prompt via agy", async () => {
    const out = await writePrompt({ idea: "chai nước hoa hổ phách", kind: "image", aspect: "9:16" });
    expect(out).toEqual({ prompt: "fake prompt" });
    const text = await readLog();
    expect(text).toContain("agent=writer");
    expect(text).toContain("agent_file=yes");
    expect(text).toContain("token_mode=600");
    expect(text).toContain("chai nước hoa hổ phách");
    expect(text).toContain("9:16");
    expect(text).not.toContain("codex ");
  });

  it("falls back to codex when agy fails", async () => {
    process.env.FAKE_FAIL = "1";
    // codex giả luôn trả lines nên dùng kind script để kiểm đường dự phòng.
    const out = await writePrompt({ idea: "trà sữa", kind: "script" });
    expect(out).toEqual({ lines: ["Câu 1.", "Câu 2."] });
    const text = await readLog();
    expect(text).toContain("agent=writer");
    expect(text).toMatch(/codex exec --ephemeral --skip-git-repo-check -C \S+ -s read-only -c model_reasoning_effort="low" -o \S+\/last\.txt/);
  });

  it("script returns lines", async () => {
    await setSetting("prompt_writer", { provider: "codex" });
    const out = await writePrompt({ idea: "son môi đỏ, giảm 20% hôm nay", kind: "script" });
    expect(out).toEqual({ lines: ["Câu 1.", "Câu 2."] });
    expect(await readLog()).not.toContain("agent=writer");
  });

  it("bad json throws BAD_OUTPUT", async () => {
    process.env.FAKE_RESPONSE = JSON.stringify("Xin lỗi, tôi không hiểu yêu cầu");
    await expect(writePrompt({ idea: "xe đạp", kind: "image" })).rejects.toMatchObject({ code: "BAD_OUTPUT" });
    process.env.FAKE_RESPONSE = JSON.stringify('```json\n{"prompt":"a bicycle at dawn"}\n```');
    expect(await writePrompt({ idea: "xe đạp", kind: "video", durationSec: 5 })).toEqual({ prompt: "a bicycle at dawn" });
  });

  it("both engines fail throws PROMPT_WRITER", async () => {
    process.env.FAKE_FAIL = "1";
    process.env.FAKE_CODEX_FAIL = "1";
    const err = await writePrompt({ idea: "x", kind: "image" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe("PROMPT_WRITER");
  });
});
