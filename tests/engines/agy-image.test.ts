import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFileEngine } from "@/server/engines";
import { agyImage } from "@/server/engines/agy";
import type { MediaRequest } from "@/server/engines/types";

const ENV_KEYS = ["AGY_BIN", "AGY_HOME", "FAKE_LOG", "FAKE_NO_IMAGE", "FAKE_QUOTA"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let scratch: string;
let log: string;
const outputs: string[] = [];

const req: MediaRequest = {
  kind: "image",
  engineModel: "gemini-3.8-flash-medium",
  prompt: "chai nước hoa hổ phách",
  aspectRatio: "9:16",
};

async function tmpOutputs(): Promise<string[]> {
  return (await readdir(os.tmpdir())).filter((n) => n.startsWith("aura-out-"));
}

function logValue(text: string, key: string): string {
  return text.split("\n").find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1) ?? "";
}

describe("agyImage", () => {
  beforeEach(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "aura-agyimg-test-"));
    log = path.join(scratch, "log.txt");
    const agyHome = path.join(scratch, "agy-home");
    await mkdir(agyHome);
    await writeFile(path.join(agyHome, "antigravity-oauth-token"), "fake-token");
    process.env.AGY_BIN = path.resolve("tests/fixtures/fake-agy.sh");
    process.env.AGY_HOME = agyHome;
    process.env.FAKE_LOG = log;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(scratch, { recursive: true, force: true });
    await Promise.all(outputs.splice(0).map((f) => rm(f, { force: true })));
  });

  it("is registered as AGY file engine", () => {
    expect(getFileEngine("AGY")).toBe(agyImage);
  });

  it("agyImage returns file copied out of brain", async () => {
    const { files } = await agyImage.generate(req);
    outputs.push(...files);
    expect(files).toHaveLength(1);
    const [file] = files;
    expect(path.dirname(file)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(file)).toMatch(/^aura-out-[\w-]+\.png$/);
    expect(await readFile(file)).toEqual(await readFile("tests/fixtures/sample.png"));

    const text = await readFile(log, "utf8");
    expect(logValue(text, "agent")).toBe("imagegen");
    expect(logValue(text, "agent_file")).toBe("yes");
    expect(text).toContain("Use no reference images.");
    expect(text).toContain("Aspect ratio: 9:16.");
    expect(text).toContain("IMAGE PROMPT:\nchai nước hoa hổ phách");
    expect(existsSync(logValue(text, "cwd"))).toBe(false);
  });

  it("agyImage copies reference image as ref-1", async () => {
    const input = path.join(scratch, "input.png");
    await writeFile(input, await readFile("tests/fixtures/sample.png"));
    const { files } = await agyImage.generate({ ...req, inputPath: input });
    outputs.push(...files);

    const text = await readFile(log, "utf8");
    const cwd = logValue(text, "cwd");
    expect(logValue(text, "refs").trim()).toBe("ref-1.png");
    expect(text).toContain(`Reference image 1 = ${path.join(cwd, "ref-1.png")}`);
    expect(path.isAbsolute(cwd)).toBe(true);
    expect(text).not.toContain("Use no reference images.");
    // Ảnh tham chiếu không bị lấy nhầm làm kết quả: kết quả là file chép từ brain.
    expect(path.basename(files[0])).toMatch(/^aura-out-/);
  });

  it("agyImage refused", async () => {
    process.env.FAKE_NO_IMAGE = "1";
    const before = new Set(await tmpOutputs());
    await expect(agyImage.generate(req)).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringContaining("I cannot generate this"),
    });
    expect((await tmpOutputs()).filter((n) => !before.has(n))).toEqual([]);
  });

  it("agyImage hết lượt (429) báo QUOTA, không thử lại", async () => {
    process.env.FAKE_QUOTA = "1";
    await expect(agyImage.generate(req)).rejects.toMatchObject({ code: "QUOTA", retryable: false });
  });
});
