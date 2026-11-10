import { mkdirSync } from "node:fs";
import { connect } from "node:net";
import { runtimeDir } from "@/server/ai/roles";
import { EngineError } from "@/server/engines/types";
import { runBridge } from "./bridge";

// Proxy xoay tài khoản agy (proxy.py của antigravity-switcher) riêng của AuraMotion: cổng AGY_PROXY_PORT (8901),
// pid file trong data/. Không đụng proxy 8899 / 8900 của chủ máy.

const RESERVED_PORTS = new Set([8899, 8900]);

export function proxyPort(): number {
  const n = Number.parseInt(process.env.AGY_PROXY_PORT ?? "", 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 8901;
}

function proxyFiles(): { pidFile: string; logFile: string } {
  const dir = runtimeDir("agy-proxy");
  mkdirSync(dir, { recursive: true });
  return { pidFile: `${dir}/proxy.pid`, logFile: `${dir}/proxy.log` };
}

function assertOwnPort(port: number): void {
  if (RESERVED_PORTS.has(port)) throw new EngineError("AGY_PROXY", `Cổng ${port} là proxy riêng của chủ máy, đặt AGY_PROXY_PORT khác`);
}

export function portOpen(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.setTimeout(timeoutMs, () => done(false));
  });
}

export type ProxyStatus = { port: number; running: boolean; pid?: number | null; accountsReady?: number | null };

type BridgeProxy = { running: boolean; pid: number | null; port: number; accountsReady: number | null };

export async function getProxyStatus(): Promise<ProxyStatus> {
  const port = proxyPort();
  const { pidFile } = proxyFiles();
  try {
    const r = await runBridge<BridgeProxy>(["proxy-status", "--port", String(port), "--pid-file", pidFile], { timeoutMs: 15_000 });
    return { port, running: r.running, pid: r.pid, accountsReady: r.accountsReady };
  } catch {
    return { port, running: false };
  }
}

// Bật proxy nếu cổng chưa mở; trả cổng.
export async function ensureProxy(): Promise<number> {
  const port = proxyPort();
  assertOwnPort(port);
  if (await portOpen(port)) return port;
  const { pidFile, logFile } = proxyFiles();
  const r = await runBridge<BridgeProxy>(["proxy-start", "--port", String(port), "--pid-file", pidFile, "--log-file", logFile], { timeoutMs: 30_000 });
  if (!r.running) throw new EngineError("AGY_PROXY", `Proxy Google không mở cổng ${port}`);
  return port;
}

export async function stopProxy(): Promise<ProxyStatus> {
  const port = proxyPort();
  assertOwnPort(port);
  const { pidFile } = proxyFiles();
  const r = await runBridge<BridgeProxy>(["proxy-stop", "--port", String(port), "--pid-file", pidFile], { timeoutMs: 20_000 });
  return { port, running: r.running, pid: r.pid };
}
