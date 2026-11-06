import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    museMock: boolean;
  }
}

const READY_TIMEOUT_MS = 30_000;

async function waitReady(url: string, child: ChildProcess): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(1000) });
      if (res.ok && ((await res.json()) as { ready?: boolean }).ready) return true;
    } catch {
      // chưa lên
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const env = loadEnv("test", process.cwd(), "");
  const dbUrl = env.DATABASE_URL ?? "";
  if (!dbUrl.split("?")[0].endsWith("_test")) {
    throw new Error(`DATABASE_URL must point to a *_test database, got: ${dbUrl.replace(/\/\/([^:/@]*):[^@]*@/, "//$1:***@") || "(empty)"}`);
  }
  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    env: { ...process.env, ...env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "inherit",
  });

  // muse2api driver mock cho tests/engines/muse.test.ts.
  const museUrl = new URL(env.MUSE_API_URL || "http://127.0.0.1:18611");
  if (museUrl.port === "18610") throw new Error("MUSE_API_URL của test không được trỏ vào muse2api thật (cổng 18610)");
  const museDir = path.resolve(env.MUSE2API_DIR || process.env.MUSE2API_DIR || "../refs/muse2api");
  if (!existsSync(path.join(museDir, ".venv/bin/python"))) {
    console.warn(`[global-setup] Bỏ qua muse.test: không thấy muse2api tại ${museDir} (đặt MUSE2API_DIR)`);
    project.provide("museMock", false);
    return;
  }

  const child = spawn("bash", [path.resolve("scripts/muse2api-mock.sh")], {
    env: { ...process.env, MUSE2API_DIR: museDir, MUSE2API_PORT: museUrl.port || "18611" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-4000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  if (!(await waitReady(museUrl.origin, child))) {
    await stop(child);
    throw new Error(`muse2api mock không khởi động được:\n${output}`);
  }
  project.provide("museMock", true);
  return () => stop(child);
}
