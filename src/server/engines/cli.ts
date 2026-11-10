import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireSlot } from "@/lib/semaphore";
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
  // Nhận stdout ngay khi có, kể cả khi lệnh sau đó lỗi / quá giờ (lúc đó `collect` không chạy).
  onStdout?: (chunk: string) => void;
  signal?: AbortSignal;
  // Giới hạn số tiến trình cùng tên chạy đồng thời trên cả app + worker (agy chạy song song dễ hỏng phiên / cắt đầu ra).
  lock?: { key: string; limit: number };
};

const STDERR_TAIL = 300;
const EXIT_GRACE_MS = 2000;
// stdout lớn hơn mức này (CLI in vô hạn) thì kill nhóm, tránh tràn bộ nhớ.
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;

// Chỉ truyền cho CLI biến hệ thống nó cần; không lộ DATABASE_URL, AUTH_SECRET… của app.
const ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TERM",
  "TZ",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "CODEX_HOME",
];

function cliEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // FAKE_*: tham số cho CLI giả trong test.
    if (ENV_KEYS.includes(key) || key.startsWith("LC_") || (process.env.NODE_ENV === "test" && key.startsWith("FAKE_"))) {
      env[key] = value;
    }
  }
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}

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
// Số tiến trình agy / codex chạy cùng lúc (env AGY_CONCURRENCY, CODEX_CONCURRENCY; mặc định 2).
export function cliLock(name: "agy" | "codex"): { key: string; limit: number } {
  const raw = Number.parseInt(process.env[name === "agy" ? "AGY_CONCURRENCY" : "CODEX_CONCURRENCY"] ?? "", 10);
  return { key: `am:cli:${name}`, limit: Number.isFinite(raw) && raw > 0 ? raw : 2 };
}

export async function runCli<T = undefined>(opts: RunCliOptions<T>): Promise<{ stdout: string; result: T }> {
  let release: (() => Promise<void>) | undefined;
  if (opts.lock && process.env.NODE_ENV !== "test") {
    const { redis } = await import("@/lib/redis");
    try {
      release = await acquireSlot(redis, opts.lock.key, { limit: opts.lock.limit, timeoutMs: opts.timeoutMs, signal: opts.signal });
    } catch {
      throw new EngineError("CLI_BUSY", `${path.basename(opts.bin)} đang bận, thử lại sau`, true);
    }
  }
  try {
    return await runCliNow(opts);
  } finally {
    await release?.();
  }
}

async function runCliNow<T>(opts: RunCliOptions<T>): Promise<{ stdout: string; result: T }> {
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
      env: cliEnv(opts.env),
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let stopped: "TIMEOUT" | "CANCELED" | "TOO_LARGE" | null = null;
    let spawnError: Error | null = null;

    const stop = (reason: "TIMEOUT" | "CANCELED" | "TOO_LARGE") => {
      stopped ??= reason;
      killGroup(child.pid);
    };
    const onAbort = () => stop("CANCELED");
    const timer = setTimeout(() => stop("TIMEOUT"), opts.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      if (stopped) return;
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > MAX_STDOUT_BYTES) return stop("TOO_LARGE");
      stdout += chunk;
      opts.onStdout?.(chunk);
    });
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
      } else if (stopped === "TOO_LARGE") {
        reject(new EngineError("CLI_FAILED", `${name} in ra quá ${MAX_STDOUT_BYTES / 1024 / 1024} MB`));
      } else if (spawnError) {
        reject(new EngineError("CLI_FAILED", `Không chạy được ${name}: ${spawnError.message}`));
      } else if (code !== 0) {
        // Giữ cả đầu (lý do lỗi thật) lẫn cuối (agy in kèm danh sách model rất dài ở cuối).
        const out = stderr.trim() || stdout.trim();
        const tail = out.length <= STDERR_TAIL ? out : `${out.slice(0, STDERR_TAIL / 2)} … ${out.slice(-STDERR_TAIL / 2)}`;
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
