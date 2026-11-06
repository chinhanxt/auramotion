import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFileEngine } from "@/server/engines";
import { codexImage } from "@/server/engines/codex";
import type { MediaRequest } from "@/server/engines/types";

const ENV_KEYS = ["CODEX_BIN", "CODEX_HOME", "FAKE_LOG", "FAKE_QUOTA", "FAKE_CODEX_FAIL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let scratch: string;
let home: string;
let log: string;
const outputs: string[] = [];

const req: MediaRequest = { kind: "image", engineModel: "", prompt: "a red bottle on sand", aspectRatio: "9:16" };

describe("codexImage", () => {
  beforeEach(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "aura-codex-test-"));
    home = path.join(scratch, "codex-home");
    log = path.join(scratch, "log.txt");
    await mkdir(home);
    process.env.CODEX_BIN = path.resolve("tests/fixtures/fake-codex.sh");
    process.env.CODEX_HOME = home;
    process.env.FAKE_LOG = log;
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await Promise.all(outputs.splice(0).map((f) => rm(f, { force: true })));
    await rm(scratch, { recursive: true, force: true });
  });

  it("is registered as CODEX file engine", () => {
    expect(getFileEngine("CODEX")).toBe(codexImage);
  });

  it("codexImage returns image and cleans thread files", async () => {
    // Phiên khác của user: không được xóa.
    await mkdir(path.join(home, "generated_images", "other"), { recursive: true });
    await writeFile(path.join(home, "generated_images", "other", "keep.png"), "x");
    await mkdir(path.join(home, "sessions", "2026", "11", "05"), { recursive: true });
    const otherRollout = path.join(home, "sessions", "2026", "11", "05", "rollout-y-other.jsonl");
    await writeFile(otherRollout, "{}");

    const { files } = await codexImage.generate(req);
    outputs.push(...files);

    expect(files).toHaveLength(1);
    const out = files[0]!;
    expect(path.dirname(out)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(out)).toMatch(/^aura-out-[\w-]+\.png$/);
    expect(await readFile(out)).toEqual(await readFile("tests/fixtures/sample.png"));

    expect(existsSync(path.join(home, "generated_images", "t123"))).toBe(false);
    expect(existsSync(path.join(home, "sessions", "2026", "11", "06", "rollout-x-t123.jsonl"))).toBe(false);
    expect(existsSync(path.join(home, "generated_images", "other", "keep.png"))).toBe(true);
    expect(existsSync(otherRollout)).toBe(true);
  });

  it("codexImage quota error", async () => {
    process.env.FAKE_QUOTA = "1";
    await expect(codexImage.generate(req)).rejects.toMatchObject({ code: "QUOTA", retryable: false });
    expect(existsSync(path.join(home, "sessions", "2026", "11", "06", "rollout-x-t123.jsonl"))).toBe(false);
  });

  it("codexImage without image tool output throws NO_IMAGE", async () => {
    process.env.FAKE_CODEX_FAIL = "1";
    await expect(codexImage.generate(req)).rejects.toMatchObject({ code: "NO_IMAGE" });
  });

  it("prompt sent via stdin", async () => {
    const ref = path.join(scratch, "input.png");
    await writeFile(ref, await readFile("tests/fixtures/sample.png"));
    const { files } = await codexImage.generate({ ...req, engineModel: "gpt-5.5", inputPath: ref });
    outputs.push(...files);

    const text = await readFile(log, "utf8");
    const argLine = text.split("\n").find((l) => l.startsWith("codex exec"))!;
    expect(argLine).toContain("--skip-git-repo-check");
    expect(argLine).toContain("-s workspace-write --json");
    expect(argLine).toContain("-m gpt-5.5");
    expect(argLine).toMatch(/-i \/\S+\/aura-cli-[^/\s]+\/ref-1\.png$/);
    expect(argLine).not.toContain("a red bottle");

    expect(text).toContain("stdin Use your built-in image generation tool exactly ONCE");
    expect(text).toContain("Reference image 1 = attached image 1 (ref-1.png)");
    expect(text).toContain("Aspect ratio: 9:16.");
    expect(text).toContain("Image prompt:\na red bottle on sand");
  });

  it("omits -m when engineModel is empty", async () => {
    const { files } = await codexImage.generate(req);
    outputs.push(...files);
    const text = await readFile(log, "utf8");
    expect(text).not.toMatch(/ -m /);
    expect(text).toContain("Use no reference images.");
  });
});
