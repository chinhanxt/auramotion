import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { EngineError } from "@/server/engines/types";

// Gọi tools/agy/switcher_bridge.py (python3 -I): mỗi lệnh in đúng 1 dòng JSON; không bao giờ có token.

export function switcherDir(): string {
  return process.env.AGY_SWITCHER_DIR || path.join(os.homedir(), "tool-app", "antigravity-switcher");
}

function bridgePath(): string {
  return path.resolve(process.env.AGY_BRIDGE || "tools/agy/switcher_bridge.py");
}

const ENV_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TZ", "TMPDIR", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "SSL_CERT_FILE", "SSL_CERT_DIR"];

function bridgeEnv(): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const k of ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.AGY_SWITCHER_DIR = switcherDir();
  env.PYTHONIOENCODING = "utf-8";
  return env;
}

export type BridgeReply = { ok: boolean; error?: string } & Record<string, unknown>;

// Dòng JSON cuối cùng có `ok` trên stdout (bỏ mọi dòng khác).
export function parseBridgeOutput(stdout: string): BridgeReply | null {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      const v = JSON.parse(lines[i]) as BridgeReply;
      if (v && typeof v === "object" && typeof v.ok === "boolean") return v;
    } catch {
      // dòng khác
    }
  }
  return null;
}

export function runBridge<T extends Record<string, unknown>>(args: string[], opts: { stdin?: string; timeoutMs?: number } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.env.AGY_PYTHON || "python3",
      ["-I", bridgePath(), ...args],
      { env: bridgeEnv(), timeout: opts.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024, cwd: os.tmpdir() },
      (err, stdout) => {
        const reply = parseBridgeOutput(String(stdout ?? ""));
        if (reply?.ok) return resolve(reply as unknown as T);
        if (reply) return reject(new EngineError("AGY_SWITCHER", reply.error || "antigravity-switcher báo lỗi"));
        const why = err ? ((err as NodeJS.ErrnoException & { killed?: boolean }).killed ? "quá thời gian" : err.message.split("\n")[0]) : "không trả JSON";
        reject(new EngineError("AGY_SWITCHER", `Không chạy được antigravity-switcher: ${why}`.slice(0, 300)));
      },
    );
    if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
    else child.stdin?.end();
  });
}
