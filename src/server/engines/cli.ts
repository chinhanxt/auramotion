import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EngineError } from "@/server/engines/types";

export type RunCliOptions<T> = {
  bin: string;
  // Hàm khi tham số cần đường dẫn thư mục tạm (gọi sau `setup`).
  args: string[] | ((dir: string) => string[]);
  stdin?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  setup?: (dir: string) => Promise<void>;
  collect?: (dir: string, stdout: string) => Promise<T>;
  signal?: AbortSignal;
};

const STDERR_TAIL = 300;
const EXIT_GRACE_MS = 2000;

function killGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Nhóm đã không còn tiến trình nào.
  }
}

// Chạy 1 lệnh CLI trong thư mục tạm riêng (cwd), không qua shell. Quá giờ / bị hủy thì kill cả nhóm tiến trình.
// Thư mục tạm luôn bị xóa sau khi `collect` xong, kể cả khi lỗi.
export async function runCli<T = undefined>(opts: RunCliOptions<T>): Promise<{ stdout: string; result: T }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aura-cli-"));
  try {
    await opts.setup?.(dir);
    const stdout = await spawnInGroup(opts, dir);
    const result = (opts.collect ? await opts.collect(dir, stdout) : undefined) as T;
    return { stdout, result };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

function spawnInGroup(opts: RunCliOptions<unknown>, dir: string): Promise<string> {
  const name = path.basename(opts.bin);
  if (opts.signal?.aborted) return Promise.reject(new EngineError("CANCELED", `Đã hủy lệnh ${name}`));

  return new Promise((resolve, reject) => {
    const args = typeof opts.args === "function" ? opts.args(dir) : opts.args;
    const child = spawn(opts.bin, args, {
      cwd: dir,
      detached: true,
      env: { ...process.env, ...opts.env },
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stopped: "TIMEOUT" | "CANCELED" | null = null;
    let spawnError: Error | null = null;

    const stop = (reason: "TIMEOUT" | "CANCELED") => {
      stopped ??= reason;
      killGroup(child.pid);
    };
    const onAbort = () => stop("CANCELED");
    const timer = setTimeout(() => stop("TIMEOUT"), opts.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4 * STDERR_TAIL);
    });
    if (child.stdin) {
      child.stdin.on("error", () => {
        // Tiến trình thoát trước khi đọc hết stdin.
      });
      child.stdin.end(opts.stdin);
    }

    child.on("error", (err) => {
      spawnError = err;
    });
    // Tiến trình chính thoát: dọn nốt con cháu trong nhóm. Tiến trình đã tự tách nhóm (setsid) mà còn giữ
    // stdout/stderr thì sau 2 giây đóng ống luôn, để 'close' xảy ra.
    child.on("exit", () => {
      killGroup(child.pid);
      setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, EXIT_GRACE_MS).unref();
    });
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (stopped === "TIMEOUT") {
        reject(new EngineError("TIMEOUT", `Lệnh ${name} quá ${Math.round(opts.timeoutMs / 1000)} giây`));
      } else if (stopped === "CANCELED") {
        reject(new EngineError("CANCELED", `Đã hủy lệnh ${name}`));
      } else if (spawnError) {
        reject(new EngineError("CLI_FAILED", `Không chạy được ${name}: ${spawnError.message}`));
      } else if (code !== 0) {
        const tail = (stderr.trim() || stdout.trim()).slice(-STDERR_TAIL);
        reject(new EngineError("CLI_FAILED", `${name} thoát mã ${code ?? sig}: ${tail}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export type CliStatus = { ok: boolean; version?: string };

async function cliVersion(bin: string): Promise<CliStatus> {
  try {
    const { stdout } = await runCli({ bin, args: ["--version"], timeoutMs: 10_000 });
    const line = stdout.trim().split("\n")[0] ?? "";
    return { ok: true, version: line.match(/\d+\.\d+[\w.-]*/)?.[0] ?? line };
  } catch {
    return { ok: false };
  }
}

export async function checkCli(): Promise<{ agy: CliStatus; codex: CliStatus }> {
  const [agy, codex] = await Promise.all([
    cliVersion(process.env.AGY_BIN || "agy"),
    cliVersion(process.env.CODEX_BIN || "codex"),
  ]);
  return { agy, codex };
}
