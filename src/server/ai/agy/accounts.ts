import { AppError } from "@/lib/errors";
import { redis } from "@/lib/redis";
import { restartAcp } from "@/server/ai/acp/runtime";
import { getAiRoles, saveAiRoles } from "@/server/ai/roles";
import { EngineError } from "@/server/engines/types";
import { runBridge } from "./bridge";
import { ensureProxy, getProxyStatus, stopProxy, type ProxyStatus } from "./proxy";

// Tài khoản agy (antigravity-switcher): trạng thái + quota, đăng nhập 2 bước, chuyển, gỡ, proxy xoay tài khoản.

const prefix = () => (process.env.NODE_ENV === "test" ? "am:test:" : "am:");
const STATUS_KEY = () => `${prefix()}ai:agy:status`;
const loginKey = (state: string) => `${prefix()}ai:agy:login:${state}`;
const STATUS_TTL_SEC = 60;
const LOGIN_TTL_SEC = 600;
const STATE_RE = /^[a-f0-9]{16,64}$/;

export type AgyQuota = { group: string; pct: number | null; resetAt: string | null };
export type AgyAccount = { id: string; email: string; active: boolean; status: string; quota: AgyQuota[]; minQuota?: number | null; error?: string };

function toAccounts(raw: unknown): AgyAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      id: String(a.id ?? a.email ?? ""),
      email: String(a.email ?? ""),
      active: a.active === true,
      status: typeof a.status === "string" ? a.status : "VALID",
      quota: Array.isArray(a.quota)
        ? a.quota
            .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
            .map((q) => ({
              group: String(q.group ?? ""),
              pct: typeof q.pct === "number" ? q.pct : null,
              resetAt: typeof q.resetAt === "string" ? q.resetAt : null,
            }))
        : [],
      ...(typeof a.minQuota === "number" ? { minQuota: a.minQuota } : {}),
      ...(typeof a.error === "string" ? { error: a.error.slice(0, 300) } : {}),
    }))
    .filter((a) => a.id);
}

// Danh sách tài khoản + quota (mỗi tài khoản 1 lần làm mới token với Google): cache Redis 60 giây.
export async function getAgyAccounts(opts: { refresh?: boolean } = {}): Promise<AgyAccount[]> {
  if (!opts.refresh) {
    const cached = await redis.get(STATUS_KEY()).catch(() => null);
    if (cached) return toAccounts(JSON.parse(cached));
  }
  const r = await runBridge<{ accounts: unknown }>(["status"], { timeoutMs: 90_000 });
  const accounts = toAccounts(r.accounts);
  await redis.set(STATUS_KEY(), JSON.stringify(accounts), "EX", STATUS_TTL_SEC).catch(() => null);
  return accounts;
}

async function invalidateStatus(): Promise<void> {
  await redis.del(STATUS_KEY()).catch(() => 0);
}

// Bước 1: link đăng nhập Google; verifier PKCE giữ trong Redis 10 phút theo `state`, không trả ra ngoài.
export async function startAgyLogin(): Promise<{ url: string; state: string }> {
  const r = await runBridge<{ url: string; state: string; verifier: string }>(["auth-url"], { timeoutMs: 20_000 });
  if (!STATE_RE.test(r.state) || !r.verifier || !r.url.startsWith("https://")) throw new EngineError("AGY_SWITCHER", "switcher trả link đăng nhập sai");
  await redis.set(loginKey(r.state), r.verifier, "EX", LOGIN_TTL_SEC);
  return { url: r.url, state: r.state };
}

// Bước 2: dán URL callback (…/oauth-callback?code=…&state=…) hoặc mã → lưu tài khoản (không tự chuyển sang).
export async function finishAgyLogin(state: string, callback: string): Promise<{ account: { id: string; email: string }; created: boolean }> {
  if (!STATE_RE.test(state)) throw new AppError("VALIDATION", "Phiên đăng nhập không hợp lệ");
  const text = callback.trim();
  const m = /[?&]state=([^&#\s]+)/.exec(text);
  if (m && decodeURIComponent(m[1]) !== state) throw new AppError("VALIDATION", "URL callback không thuộc phiên đăng nhập này");
  const verifier = await redis.getdel(loginKey(state));
  if (!verifier) throw new AppError("NOT_FOUND", "Phiên đăng nhập đã hết hạn (10 phút), vui lòng bắt đầu lại");
  const r = await runBridge<{ account: { id: string; email: string }; created: boolean }>(["exchange"], {
    stdin: JSON.stringify({ callback: text, verifier }),
    timeoutMs: 30_000,
  });
  await invalidateStatus();
  return { account: { id: String(r.account.id), email: String(r.account.email) }, created: Boolean(r.created) };
}

export type SwitchResult = { switched: boolean; account: { id: string; email: string } };

// Chuyển tài khoản agy đang dùng (id hoặc auto = còn nhiều quota Gemini nhất), rồi bật lại pool ACP để nhận token mới.
export async function switchAgyAccount(target: { id: string } | { auto: true }): Promise<SwitchResult> {
  const arg = "auto" in target ? "auto" : target.id;
  if (arg !== "auto" && !/^[\w.@+-]{1,200}$/.test(arg)) throw new AppError("VALIDATION", "Mã tài khoản không hợp lệ");
  const r = await runBridge<SwitchResult>(["switch", arg], { timeoutMs: 90_000 });
  await invalidateStatus();
  if (r.switched) await restartAcp();
  return { switched: Boolean(r.switched), account: { id: String(r.account?.id ?? ""), email: String(r.account?.email ?? "") } };
}

export async function removeAgyAccount(id: string): Promise<{ removed: boolean }> {
  if (!/^[\w.@+-]{1,200}$/.test(id)) throw new AppError("VALIDATION", "Mã tài khoản không hợp lệ");
  const r = await runBridge<{ removed: boolean }>(["remove", id], { timeoutMs: 20_000 });
  await invalidateStatus();
  return { removed: Boolean(r.removed) };
}

// Bật/tắt proxy xoay tài khoản: lưu ai_roles.agy.proxy, bật/tắt proxy riêng, khởi động lại pool ACP (đổi CLOUD_CODE_URL).
export async function setAgyProxy(enabled: boolean): Promise<{ enabled: boolean; proxy: ProxyStatus }> {
  const roles = await getAiRoles();
  if (enabled) await ensureProxy();
  await saveAiRoles({ ...roles, agy: { ...roles.agy, proxy: enabled } });
  if (!enabled) await stopProxy().catch((err: Error) => console.warn(`[agy] không tắt được proxy: ${err.message}`));
  await restartAcp();
  return { enabled, proxy: await getProxyStatus() };
}
