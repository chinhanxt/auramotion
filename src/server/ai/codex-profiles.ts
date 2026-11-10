import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { redis } from "@/lib/redis";
import { CODEX_PROFILE_NAME_RE, CODEX_PROFILE_RE, getAiRoles, runtimeDir } from "@/server/ai/roles";
import { runCli } from "@/server/engines/cli";
import { codexBin } from "@/server/engines/codex";
import { EngineError } from "@/server/engines/types";

// Profile codex: "default" = ~/.codex (hoặc env CODEX_HOME); mọi thư mục trong ~/.codex_profiles (env
// CODEX_PROFILES_DIR, chỉ đọc profiles.json để lấy email / tên gọi, không sửa); data/codex/<name> tạo từ web.
// Đăng nhập device-auth, trạng thái, đăng xuất, catalog model theo từng profile (`codex debug models`).

const prefix = () => (process.env.NODE_ENV === "test" ? "am:test:" : "am:");
const loginKey = (id: string) => `${prefix()}ai:codex:login:${id}`;
const LOGIN_TTL_SEC = 30 * 60;
const LOGIN_MAX_MS = 16 * 60_000;
const URL_WAIT_MS = 30_000;
const MODELS_TTL_MS = 10 * 60_000;

export function assertProfile(name: string): string {
  if (!CODEX_PROFILE_NAME_RE.test(name)) throw new AppError("VALIDATION", "Tên profile OpenAI không hợp lệ");
  return name;
}

function webRoot(): string {
  return runtimeDir("codex");
}

export function externalRoot(): string {
  return path.resolve(process.env.CODEX_PROFILES_DIR || path.join(os.homedir(), ".codex_profiles"));
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export type ProfileSource = "default" | "external" | "web";

function locate(name: string): { home: string; source: ProfileSource } {
  assertProfile(name);
  if (name === "default") return { home: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), source: "default" };
  const ext = path.join(externalRoot(), name);
  if (isDir(ext)) return { home: ext, source: "external" };
  return { home: path.join(webRoot(), name), source: "web" };
}

// `create`: profile mới từ web (chỉ tên chữ thường/số/-/_) → tạo data/codex/<name>.
export function codexProfileHome(name: string, opts: { create?: boolean } = {}): string {
  const found = locate(name);
  if (opts.create && found.source === "web" && !existsSync(found.home)) {
    if (!CODEX_PROFILE_RE.test(name)) throw new AppError("VALIDATION", "Tên profile mới chỉ gồm chữ thường, số, - và _ (tối đa 32 ký tự)");
    mkdirSync(found.home, { recursive: true, mode: 0o700 });
  }
  return found.home;
}

// CODEX_HOME của profile đang bật (ai_roles.codex.profile) hoặc của profile chỉ định.
export async function activeCodexHome(profile?: string): Promise<string> {
  if (profile) return codexProfileHome(profile);
  const roles = await getAiRoles().catch(() => null);
  return codexProfileHome(roles?.codex.profile ?? "default");
}

export type LoginStatus = { loggedIn: boolean; method: "chatgpt" | "api-key" | null };

// Chỉ đọc kiểu đăng nhập; không bao giờ trả nguyên văn (bản API key in kèm khóa che một phần).
export function parseLoginStatus(text: string): LoginStatus {
  if (/not logged in/i.test(text)) return { loggedIn: false, method: null };
  if (/logged in using chatgpt/i.test(text)) return { loggedIn: true, method: "chatgpt" };
  if (/logged in using an? api key/i.test(text)) return { loggedIn: true, method: "api-key" };
  return { loggedIn: false, method: null };
}

// `codex login status` in kết quả ra STDERR (stdout rỗng) và thoát mã 1 khi chưa đăng nhập: đọc cả hai luồng.
async function loginStatus(home: string): Promise<LoginStatus> {
  const out = await new Promise<string>((resolve) => {
    let text = "";
    const proc = spawn(codexBin(), ["login", "status"], {
      env: { PATH: process.env.PATH ?? "", HOME: os.homedir(), CODEX_HOME: home } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: os.tmpdir(),
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), 15_000);
    proc.stdout?.on("data", (d: Buffer) => (text += d.toString("utf8")));
    proc.stderr?.on("data", (d: Buffer) => (text += d.toString("utf8")));
    proc.on("error", () => resolve(text));
    proc.on("close", () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
  return parseLoginStatus(out);
}

type ProfileMeta = { email?: string; alias?: string };

// profiles.json của bộ chuyển profile codex (chỉ đọc): ánh xạ thư mục → email, tên gọi.
async function externalMeta(): Promise<Map<string, ProfileMeta>> {
  const out = new Map<string, ProfileMeta>();
  try {
    const data = JSON.parse(await readFile(path.join(externalRoot(), "profiles.json"), "utf8")) as { profiles?: Record<string, unknown>[] };
    for (const p of data.profiles ?? []) {
      const dir = typeof p.dir === "string" ? path.basename(p.dir) : typeof p.name === "string" ? p.name : "";
      if (!dir) continue;
      out.set(dir, {
        ...(typeof p.email === "string" && p.email ? { email: p.email } : {}),
        ...(typeof p.alias === "string" && p.alias && p.alias !== dir ? { alias: p.alias } : {}),
      });
    }
  } catch {
    // không có / hỏng: bỏ qua
  }
  return out;
}

export type CodexProfile = {
  name: string;
  source: ProfileSource;
  email?: string;
  alias?: string;
  loggedIn: boolean;
  method: LoginStatus["method"];
  active: boolean;
  models: CodexModel[];
  modelsError?: string;
};

export async function listProfileNames(): Promise<{ name: string; source: ProfileSource }[]> {
  const out = new Map<string, ProfileSource>([["default", "default"]]);
  for (const [root, source] of [
    [externalRoot(), "external"],
    [webRoot(), "web"],
  ] as const) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const d of entries) {
      if (out.has(d.name) || !CODEX_PROFILE_NAME_RE.test(d.name) || d.name.startsWith(".")) continue;
      if (d.isDirectory() || (d.isSymbolicLink() && isDir(path.join(root, d.name)))) out.set(d.name, source);
    }
  }
  return [...out].map(([name, source]) => ({ name, source }));
}

// Chạy giới hạn `limit` việc cùng lúc (mỗi profile 2 lệnh codex).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function listCodexProfiles(opts: { refresh?: boolean } = {}): Promise<CodexProfile[]> {
  const [roles, names, meta] = await Promise.all([getAiRoles(), listProfileNames(), externalMeta()]);
  return mapLimit(names, 2, async ({ name, source }) => {
    const home = codexProfileHome(name);
    const status = await loginStatus(home);
    let models: CodexModel[] = [];
    let modelsError: string | undefined;
    if (status.loggedIn) {
      try {
        models = await getCodexModels({ home, refresh: opts.refresh });
      } catch (err) {
        modelsError = (err as Error).message.slice(0, 200);
      }
    }
    return {
      name,
      source,
      ...(source === "external" ? (meta.get(name) ?? {}) : {}),
      ...status,
      active: roles.codex.profile === name,
      models,
      ...(modelsError ? { modelsError } : {}),
    };
  });
}

// Hợp catalog mọi profile: mỗi model kèm danh sách profile có nó.
export function unionModels(profiles: Pick<CodexProfile, "name" | "models">[]): (CodexModel & { profiles: string[] })[] {
  const out = new Map<string, CodexModel & { profiles: string[] }>();
  for (const p of profiles) {
    for (const m of p.models) {
      const cur = out.get(m.id);
      if (!cur) out.set(m.id, { ...m, profiles: [p.name] });
      else {
        cur.profiles.push(p.name);
        cur.efforts = [...new Set([...cur.efforts, ...m.efforts])];
        cur.hidden = cur.hidden && m.hidden;
      }
    }
  }
  return [...out.values()];
}

// ---------- Đăng nhập device-auth ----------

// Bỏ mã màu ANSI, lấy link https đầu tiên sau "Open this link" và mã một lần sau "one-time code".
export function parseDeviceAuth(output: string): { url: string; code: string } | null {
  // eslint-disable-next-line no-control-regex
  const text = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
  const linkAt = text.search(/open this link/i);
  const url = /https:\/\/[^\s"'<>]+/.exec(linkAt >= 0 ? text.slice(linkAt) : text)?.[0];
  const codeAt = text.search(/one-time code/i);
  if (!url || codeAt < 0) return null;
  const after = text.slice(codeAt).replace(/^[^\n]*one-time code[^\n]*\n?/i, "");
  const code = /\b([A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+|[A-Z0-9]{6,12})\b/.exec(after)?.[1];
  return code ? { url: url.replace(/[).,]+$/, ""), code } : null;
}

export type CodexLoginState = { status: "waiting" | "done" | "error"; profile: string; message?: string };

type LoginEntry = { proc: ChildProcess; timer: NodeJS.Timeout };
const g = globalThis as unknown as { auraCodexLogins?: Map<string, LoginEntry> };
const logins = (g.auraCodexLogins ??= new Map<string, LoginEntry>());

async function saveLogin(id: string, state: CodexLoginState): Promise<void> {
  await redis.set(loginKey(id), JSON.stringify(state), "EX", LOGIN_TTL_SEC).catch(() => null);
}

// Chạy `codex login --device-auth` với CODEX_HOME của profile, giữ tiến trình tới khi người dùng xác nhận xong.
export async function startCodexLogin(profile: string, opts: { bin?: string } = {}): Promise<{ loginId: string; url: string; code: string }> {
  const home = codexProfileHome(profile, { create: true });
  const loginId = randomUUID();
  const env = { CODEX_HOME: home, NO_COLOR: "1" } as unknown as NodeJS.ProcessEnv;
  for (const k of ["PATH", "HOME", "USER", "LANG", "TZ", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"]) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (process.env.NODE_ENV === "test") for (const [k, v] of Object.entries(process.env)) if (k.startsWith("FAKE_")) env[k] = v;
  const proc = spawn(opts.bin ?? codexBin(), ["login", "--device-auth"], { env, stdio: ["ignore", "pipe", "pipe"], cwd: os.tmpdir() });
  let output = "";
  let settled = false;
  const timer = setTimeout(() => proc.kill("SIGTERM"), LOGIN_MAX_MS);
  timer.unref();
  logins.set(loginId, { proc, timer });

  return new Promise((resolve, reject) => {
    const urlTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(new EngineError("CODEX_LOGIN", "OpenAI không in link đăng nhập"));
    }, URL_WAIT_MS);
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-8000);
      if (settled) return;
      const parsed = parseDeviceAuth(output);
      if (!parsed) return;
      settled = true;
      clearTimeout(urlTimer);
      void saveLogin(loginId, { status: "waiting", profile }).then(() => resolve({ loginId, ...parsed }));
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(urlTimer);
      reject(new EngineError("CODEX_LOGIN", `Không chạy được OpenAI: ${err.message}`));
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      logins.delete(loginId);
      if (!settled) {
        settled = true;
        clearTimeout(urlTimer);
        reject(new EngineError("CODEX_LOGIN", `OpenAI login thoát mã ${code} trước khi in link`));
        return;
      }
      const ok = code === 0;
      const last = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim().split("\n").pop()?.slice(0, 200) ?? "";
      void saveLogin(loginId, { status: ok ? "done" : "error", profile, ...(ok ? {} : { message: last || `OpenAI thoát mã ${code}` }) });
    });
  });
}

export async function getCodexLogin(loginId: string): Promise<CodexLoginState> {
  if (!/^[0-9a-f-]{36}$/.test(loginId)) throw new AppError("NOT_FOUND", "Không tìm thấy phiên đăng nhập");
  const raw = await redis.get(loginKey(loginId)).catch(() => null);
  if (!raw) throw new AppError("NOT_FOUND", "Không tìm thấy phiên đăng nhập");
  return JSON.parse(raw) as CodexLoginState;
}

export async function logoutCodex(profile: string): Promise<LoginStatus> {
  const home = codexProfileHome(profile);
  await runCli({ bin: codexBin(), args: ["logout"], env: { CODEX_HOME: home }, timeoutMs: 15_000 }).catch(() => undefined);
  return loginStatus(home);
}

export function stopCodexLogins(): void {
  for (const { proc, timer } of logins.values()) {
    clearTimeout(timer);
    proc.kill("SIGTERM");
  }
  logins.clear();
}

// ---------- Catalog model ----------

export type CodexModel = { id: string; name: string; efforts: string[]; defaultEffort: string | null; hidden: boolean };

type RawModel = {
  slug?: unknown;
  display_name?: unknown;
  visibility?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: { effort?: unknown }[];
};

// Mọi model của `codex debug models`; model `visibility: hide` vẫn giữ, gắn `hidden: true`.
export function parseCodexModels(stdout: string): CodexModel[] {
  const start = stdout.indexOf("{");
  if (start < 0) return [];
  let data: { models?: RawModel[] };
  try {
    data = JSON.parse(stdout.slice(start));
  } catch {
    return [];
  }
  return (data.models ?? [])
    .filter((m) => typeof m.slug === "string")
    .map((m) => ({
      id: m.slug as string,
      name: typeof m.display_name === "string" ? m.display_name : (m.slug as string),
      efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter((e): e is string => typeof e === "string"),
      defaultEffort: typeof m.default_reasoning_level === "string" ? m.default_reasoning_level : null,
      hidden: m.visibility === "hide",
    }));
}

const gm = globalThis as unknown as { auraCodexModels?: Map<string, { at: number; models: CodexModel[] }> };
const modelCache = (gm.auraCodexModels ??= new Map());

// Catalog model của 1 profile (CODEX_HOME), cache 10 phút theo thư mục.
export async function getCodexModels(opts: { home?: string; profile?: string; refresh?: boolean } = {}): Promise<CodexModel[]> {
  const home = opts.home ?? (await activeCodexHome(opts.profile));
  const cached = modelCache.get(home);
  if (!opts.refresh && cached && Date.now() - cached.at < MODELS_TTL_MS) return cached.models;
  const { stdout } = await runCli({ bin: codexBin(), args: ["debug", "models"], env: { CODEX_HOME: home }, timeoutMs: 30_000 });
  const models = parseCodexModels(stdout);
  modelCache.set(home, { at: Date.now(), models });
  return models;
}
