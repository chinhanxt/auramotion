import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getCodexAppServer, newCodexAppServer, type RawRateLimits } from "./appserver";

// Quota codex theo profile: primary = cửa sổ 5 giờ, secondary = tuần. Profile đang bật hỏi qua tiến trình
// app-server thường trực; profile khác bật app-server tạm (≤ 20 s) rồi tắt. Cache 5 phút / CODEX_HOME.
// Lỗi → đọc `rate_limits` mới nhất trong log phiên (`<home>/sessions/**/rollout-*.jsonl`).

export type QuotaWindow = { usedPercent: number; windowMinutes: number | null; resetsAt: string | null };
export type CodexQuota = {
  primary: QuotaWindow | null;
  secondary: QuotaWindow | null;
  source: "app-server" | "session-log";
  checkedAt: string;
  planType?: string;
};

const CACHE_MS = 5 * 60_000;
const TEMP_TIMEOUT_MS = 20_000;
const TAIL_BYTES = 1024 * 1024;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isoFromEpoch = (sec: number | null): string | null => (sec === null ? null : new Date(sec * 1000).toISOString());

function windowOf(raw: unknown, snake: boolean): QuotaWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const used = num(snake ? w.used_percent : w.usedPercent);
  if (used === null) return null;
  return {
    usedPercent: used,
    windowMinutes: num(snake ? w.window_minutes : w.windowDurationMins),
    resetsAt: isoFromEpoch(num(snake ? w.resets_at : w.resetsAt)),
  };
}

// Kết quả `account/rateLimits/read` (camelCase). Ưu tiên bucket "codex" trong rateLimitsByLimitId.
export function parseAppServerRateLimits(raw: RawRateLimits | null | undefined, now = new Date()): CodexQuota | null {
  const snap = raw?.rateLimitsByLimitId?.codex ?? raw?.rateLimits;
  if (!snap) return null;
  const primary = windowOf(snap.primary, false);
  const secondary = windowOf(snap.secondary, false);
  if (!primary && !secondary) return null;
  return {
    primary,
    secondary,
    source: "app-server",
    checkedAt: now.toISOString(),
    ...(typeof snap.planType === "string" ? { planType: snap.planType } : {}),
  };
}

// 1 dòng log phiên (snake_case): payload.rate_limits.{primary,secondary}.{used_percent, window_minutes, resets_at}.
export function parseSessionLogLine(line: string): CodexQuota | null {
  if (!line.includes('"rate_limits"')) return null;
  let ev: { timestamp?: unknown; payload?: { rate_limits?: Record<string, unknown> | null } };
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  const rl = ev.payload?.rate_limits;
  if (!rl) return null;
  const primary = windowOf(rl.primary, true);
  const secondary = windowOf(rl.secondary, true);
  if (!primary && !secondary) return null;
  const at = typeof ev.timestamp === "string" && !Number.isNaN(Date.parse(ev.timestamp)) ? new Date(ev.timestamp).toISOString() : new Date().toISOString();
  return { primary, secondary, source: "session-log", checkedAt: at, ...(typeof rl.plan_type === "string" ? { planType: rl.plan_type } : {}) };
}

async function readTail(file: string, bytes: number): Promise<string> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

// `rate_limits` mới nhất: file rollout mới nhất (theo mtime) có dữ liệu quota, dòng cuối cùng có quota.
export async function quotaFromSessionLog(home: string): Promise<CodexQuota | null> {
  const root = path.join(home, "sessions");
  const names = await readdir(root, { recursive: true }).catch(() => [] as string[]);
  const files = await Promise.all(
    names
      .filter((n) => path.basename(n).startsWith("rollout-") && n.endsWith(".jsonl"))
      .map(async (n) => {
        const file = path.join(root, n);
        return { file, mtime: (await stat(file).catch(() => null))?.mtimeMs ?? 0 };
      }),
  );
  files.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of files.slice(0, 10)) {
    const lines = (await readTail(file, TAIL_BYTES).catch(() => "")).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const q = parseSessionLogLine(lines[i]);
      if (q) return q;
    }
  }
  return null;
}

async function fromAppServer(home: string, active: boolean): Promise<CodexQuota | null> {
  if (active) return parseAppServerRateLimits(await (await getCodexAppServer(home)).rateLimits(TEMP_TIMEOUT_MS));
  const server = newCodexAppServer(home);
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("quá 20 giây")), TEMP_TIMEOUT_MS).unref());
  try {
    return await Promise.race([server.start().then(() => server.rateLimits(TEMP_TIMEOUT_MS)).then((r) => parseAppServerRateLimits(r)), timeout]);
  } finally {
    await server.stop().catch(() => undefined);
  }
}

const gq = globalThis as unknown as { auraCodexQuota?: Map<string, { at: number; quota: CodexQuota | null }> };
const cache = (gq.auraCodexQuota ??= new Map());

export function clearCodexQuotaCache(): void {
  cache.clear();
}

// `appServer: false` (CODEX_TRANSPORT=exec): chỉ đọc log phiên, không bật tiến trình nào.
export async function getCodexQuota(home: string, opts: { active: boolean; refresh?: boolean; appServer?: boolean }): Promise<CodexQuota | null> {
  const hit = cache.get(home);
  if (!opts.refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.quota;
  let quota: CodexQuota | null = null;
  if (opts.appServer !== false) {
    try {
      quota = await fromAppServer(home, opts.active);
    } catch {
      quota = null;
    }
  }
  quota ??= await quotaFromSessionLog(home).catch(() => null);
  cache.set(home, { at: Date.now(), quota });
  return quota;
}
