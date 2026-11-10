import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agyBin } from "@/server/engines/agy";
import { EngineError } from "@/server/engines/types";
import { getAiRoles, runtimeDir } from "@/server/ai/roles";
import { AcpAgent, type AgentOptions, type ModelInfo } from "./agent";
import { AgentPool } from "./pool";
import { RpcError } from "./rpc";

// Pool `agy acp` thường trực, khởi động lười trong từng tiến trình Node (app Next, worker).

const STATE_FILES = ["antigravity-oauth-token", "installation_id", "settings.json"];
// Khởi động lỗi: tạm dùng CLI trong ngần này, không thử lại liên tục.
const DOWN_MS = 30_000;

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function acpProcesses(): number {
  return intEnv("AGY_ACP_PROCESSES", 1);
}

export function acpDir(): string {
  return process.env.AGY_ACP_DIR ? path.resolve(process.env.AGY_ACP_DIR) : runtimeDir("agy-acp");
}

// Chép token đăng nhập agy hiện tại vào <gemini_dir>/antigravity-cli (mode 600) trước mỗi lần bật tiến trình.
function seedState(geminiDir: string): void {
  const home = process.env.AGY_HOME || path.join(os.homedir(), ".gemini", "antigravity-cli");
  const app = path.join(geminiDir, "antigravity-cli");
  mkdirSync(app, { recursive: true, mode: 0o700 });
  for (const name of STATE_FILES) {
    try {
      copyFileSync(path.join(home, name), path.join(app, name));
      chmodSync(path.join(app, name), 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

export function agentOptions(slot: number, proxyPort?: number): AgentOptions {
  const root = acpDir();
  const gemini = path.join(root, `gemini-${slot}`);
  const cwd = path.join(root, "cwd");
  mkdirSync(cwd, { recursive: true });
  seedState(gemini);
  return {
    command: agyBin(),
    args: ["acp", "--include-default-customizations=false", "--disable-telemetry", "--sandbox", "--gemini_dir", gemini],
    cwd,
    env: proxyPort ? { CLOUD_CODE_URL: `http://127.0.0.1:${proxyPort}` } : {},
    startTimeoutMs: 60_000,
    dataDir: path.join(gemini, "antigravity-cli"),
  };
}

type Runtime = {
  pool: AgentPool | null;
  starting: Promise<AgentPool> | null;
  startedAt: number | null;
  downUntil: number;
  lastError: string | null;
  proxyPort: number | null;
  // Test thay factory (agent ACP giả).
  factory?: (slot: number) => AcpAgent;
};

const g = globalThis as unknown as { auraAcp?: Runtime };
const rt: Runtime = (g.auraAcp ??= { pool: null, starting: null, startedAt: null, downUntil: 0, lastError: null, proxyPort: null });

export function setAcpFactory(factory: ((slot: number) => AcpAgent) | undefined): void {
  rt.factory = factory;
}

async function resolveProxyPort(): Promise<number | null> {
  if (rt.factory) return null;
  const roles = await getAiRoles();
  if (!roles.agy.proxy) return null;
  const { ensureProxy } = await import("@/server/ai/agy/proxy");
  return ensureProxy();
}

async function startPool(): Promise<AgentPool> {
  const proxyPort = await resolveProxyPort();
  const pool = new AgentPool({
    size: acpProcesses(),
    idleSessionMs: 10 * 60_000,
    recycleAfterSessions: intEnv("AGY_RECYCLE_SESSIONS", 150),
    onLog: (m) => console.warn(`[acp] ${m}`),
    factory: (slot) => (rt.factory ? rt.factory(slot) : new AcpAgent(agentOptions(slot, proxyPort ?? undefined))),
  });
  try {
    await pool.start();
  } catch (err) {
    await pool.stop().catch(() => undefined);
    throw err;
  }
  rt.proxyPort = proxyPort;
  return pool;
}

export class AcpUnavailable extends EngineError {
  constructor(message: string) {
    super("ACP_UNAVAILABLE", message, true);
  }
}

// Pool đang chạy, chưa có thì bật (cùng lúc nhiều lời gọi chỉ bật 1 lần). Lỗi khởi động → AcpUnavailable.
export async function getAcpPool(): Promise<AgentPool> {
  if (rt.pool && rt.pool.stats().alive > 0) return rt.pool;
  if (rt.starting) return rt.starting;
  if (Date.now() < rt.downUntil) throw new AcpUnavailable(`Google ACP chưa khởi động được: ${rt.lastError ?? ""}`);
  const old = rt.pool;
  rt.pool = null;
  if (old) void old.stop().catch(() => undefined);
  const starting = startPool().then(
    (pool) => {
      rt.pool = pool;
      rt.startedAt = Date.now();
      rt.lastError = null;
      rt.downUntil = 0;
      return pool;
    },
    (err: unknown) => {
      rt.lastError = (err as Error).message?.slice(0, 300) ?? String(err);
      rt.downUntil = Date.now() + DOWN_MS;
      throw new AcpUnavailable(`Google ACP không khởi động được: ${rt.lastError}`);
    },
  );
  rt.starting = starting;
  try {
    return await starting;
  } finally {
    if (rt.starting === starting) rt.starting = null;
  }
}

export async function stopAcp(): Promise<void> {
  const pool = rt.pool;
  rt.pool = null;
  rt.startedAt = null;
  const starting = rt.starting;
  rt.starting = null;
  if (pool) await pool.stop().catch(() => undefined);
  if (starting) await starting.then((p) => p.stop()).catch(() => undefined);
}

// Khởi động lại pool (đổi tài khoản agy, bật/tắt proxy, Admin bấm).
export async function restartAcp(opts: { start?: boolean } = {}): Promise<AcpStatus> {
  await stopAcp();
  rt.downUntil = 0;
  rt.lastError = null;
  if (opts.start) await getAcpPool().catch(() => undefined);
  return acpStatus();
}

export type AcpStatus = {
  alive: boolean;
  processes: number;
  sessions: number;
  active: number;
  restarts: number;
  startedAt: number | null;
  lastError: string | null;
  proxyPort: number | null;
};

export function acpStatus(): AcpStatus {
  const s = rt.pool?.stats();
  return {
    alive: (s?.alive ?? 0) > 0,
    processes: s?.alive ?? 0,
    sessions: s?.sessions ?? 0,
    active: s?.active ?? 0,
    restarts: s?.restarts ?? 0,
    startedAt: rt.startedAt,
    lastError: rt.lastError,
    proxyPort: rt.proxyPort,
  };
}

export function acpModels(): ModelInfo[] {
  return rt.pool?.models() ?? [];
}

export type AcpTextResult = { text: string; model: string; breakdown: { startMs: number; sessionMs: number; modelMs: number } };

// Một lượt viết chữ qua ACP: phiên tạm (mở → set_model → prompt → đóng). Model không có thì thử `fallbackModels`.
export async function acpText(args: {
  text: string;
  model: string;
  fallbackModels?: string[];
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<AcpTextResult> {
  if (args.signal?.aborted) throw new EngineError("CANCELED", "Đã hủy");
  const t0 = Date.now();
  const pool = await getAcpPool();
  const t1 = Date.now();
  const models = [...new Set([args.model, ...(args.fallbackModels ?? [])].filter(Boolean))];
  let lease;
  try {
    lease = await pool.lease(undefined, models);
  } catch (err) {
    throw toEngineError(err);
  }
  const t2 = Date.now();
  const onAbort = () => lease.agent.cancel(lease.sessionId);
  args.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const r = await lease.agent.prompt(lease.sessionId, [{ type: "text", text: args.text }], undefined, args.timeoutMs);
    if (args.signal?.aborted) throw new EngineError("CANCELED", "Đã hủy");
    if (r.stopReason === "cancelled") throw new EngineError("CANCELED", "Google ACP đã hủy lượt");
    if (!r.text.trim()) throw new EngineError("AGY_FAILED", `Google ACP trả rỗng (${r.stopReason}${r.agyBlocked ? ", bị bộ lọc chặn" : ""})`);
    return { text: r.text, model: lease.model, breakdown: { startMs: t1 - t0, sessionMs: t2 - t1, modelMs: Date.now() - t2 } };
  } catch (err) {
    throw toEngineError(err);
  } finally {
    args.signal?.removeEventListener("abort", onAbort);
    lease.release();
  }
}

function toEngineError(err: unknown): Error {
  if (err instanceof EngineError) return err;
  if (err instanceof RpcError) {
    if (err.code === -32010) return new EngineError("TIMEOUT", `Google ACP: ${err.message}`);
    if (err.code === -32602) return new EngineError("BAD_MODEL", `Google ACP: ${err.message}`);
    if (err.code === -32001) return new AcpUnavailable(err.message);
    return new EngineError("AGY_FAILED", `Google ACP: ${err.message}`);
  }
  return new EngineError("AGY_FAILED", `Google ACP: ${(err as Error).message ?? String(err)}`);
}
