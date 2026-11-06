import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCli, runCli } from "@/server/engines/cli";
import { EngineError } from "@/server/engines/types";

const FAKE_AGY = path.resolve("tests/fixtures/fake-agy.sh");
const FAKE_CODEX = path.resolve("tests/fixtures/fake-codex.sh");

// Còn sống = có trong /proc và không phải zombie.
function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch {
    return false;
  }
}

async function waitDead(pids: number[], ms = 2000): Promise<number[]> {
  const deadline = Date.now() + ms;
  let left = pids.filter(alive);
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    left = left.filter(alive);
  }
  return left;
}

async function catchError(p: Promise<unknown>): Promise<EngineError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EngineError);
  return err as EngineError;
}

describe("runCli", () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "aura-cli-test-"));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("runCli returns stdout and cleans workdir", async () => {
    let dir = "";
    const { stdout, result } = await runCli({
      bin: FAKE_CODEX,
      args: ["exec", "-o", "last.txt", "hello; rm -rf / $(whoami)"],
      timeoutMs: 5000,
      setup: async (d) => {
        dir = d;
        await writeFile(path.join(d, "input.txt"), "x");
      },
      collect: async (d, out) => ({ last: await readFile(path.join(d, "last.txt"), "utf8"), out }),
    });
    expect(path.basename(dir)).toMatch(/^aura-cli-/);
    expect(result.last).toBe('{"lines":["Câu 1.","Câu 2."]}');
    expect(result.out).toBe(stdout);
    expect(existsSync(dir)).toBe(false);
  });

  it("runCli passes stdin and env", async () => {
    const { stdout } = await runCli({
      bin: "bash",
      args: ["-c", 'cat; printf "|%s" "$AURA_TEST_VAR"'],
      stdin: "xin chào",
      env: { AURA_TEST_VAR: "ok" },
      timeoutMs: 5000,
    });
    expect(stdout).toBe("xin chào|ok");
  });

  it("runCli kills process group on timeout and removes workdir", async () => {
    const pidFile = path.join(scratch, "pids");
    let dir = "";
    const started = Date.now();
    const err = await catchError(
      runCli({
        bin: FAKE_AGY,
        args: ["-p", "x"],
        env: { FAKE_SLEEP: "5", FAKE_PIDS: pidFile },
        timeoutMs: 300,
        setup: async (d) => {
          dir = d;
        },
      }),
    );
    expect(err.code).toBe("TIMEOUT");
    expect(err.retryable).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
    // Tiến trình con (subshell) và cháu (sleep trong subshell) đều đã chết.
    const pids = (await readFile(pidFile, "utf8")).trim().split("\n").map(Number);
    expect(pids).toHaveLength(2);
    expect(await waitDead(pids)).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });

  it("runCli aborted by signal throws CANCELED and kills group", async () => {
    const pidFile = path.join(scratch, "pids");
    let dir = "";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const err = await catchError(
      runCli({
        bin: FAKE_AGY,
        args: ["-p", "x"],
        env: { FAKE_SLEEP: "5", FAKE_PIDS: pidFile },
        timeoutMs: 10_000,
        signal: controller.signal,
        setup: async (d) => {
          dir = d;
        },
      }),
    );
    expect(err.code).toBe("CANCELED");
    const pids = (await readFile(pidFile, "utf8")).trim().split("\n").map(Number);
    expect(await waitDead(pids)).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });

  it("runCli returns when a detached grandchild keeps stdout open", async () => {
    const started = Date.now();
    const { stdout } = await runCli({ bin: "bash", args: ["-c", "setsid sleep 4 & echo done"], timeoutMs: 10_000 });
    expect(stdout).toBe("done\n");
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it("runCli nonzero exit throws CLI_FAILED", async () => {
    let dir = "";
    const err = await catchError(
      runCli({
        bin: FAKE_AGY,
        args: ["-p", "x"],
        env: { FAKE_FAIL: "1" },
        timeoutMs: 5000,
        setup: async (d) => {
          dir = d;
        },
      }),
    );
    expect(err.code).toBe("CLI_FAILED");
    expect(err.message).toContain("agy: fake failure");
    expect(existsSync(dir)).toBe(false);
  });

  it("runCli missing binary throws CLI_FAILED", async () => {
    const err = await catchError(runCli({ bin: path.join(scratch, "nope"), args: [], timeoutMs: 5000 }));
    expect(err.code).toBe("CLI_FAILED");
  });

  it("runCli removes workdir when collect throws", async () => {
    let dir = "";
    await expect(
      runCli({
        bin: FAKE_CODEX,
        args: [],
        timeoutMs: 5000,
        setup: async (d) => {
          dir = d;
        },
        collect: async () => {
          throw new EngineError("NO_IMAGE", "x");
        },
      }),
    ).rejects.toMatchObject({ code: "NO_IMAGE" });
    expect(existsSync(dir)).toBe(false);
  });
});

describe("checkCli", () => {
  const saved = { AGY_BIN: process.env.AGY_BIN, CODEX_BIN: process.env.CODEX_BIN };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("checkCli reports versions", async () => {
    process.env.AGY_BIN = FAKE_AGY;
    process.env.CODEX_BIN = "/nonexistent/codex";
    expect(await checkCli()).toEqual({ agy: { ok: true, version: "1.5.2" }, codex: { ok: false } });
    process.env.CODEX_BIN = FAKE_CODEX;
    expect((await checkCli()).codex).toEqual({ ok: true, version: "0.166.0" });
  });
});
