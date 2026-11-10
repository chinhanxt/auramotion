import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { childEnv } from "@/server/ai/acp/agent";
import { JsonRpcPeer, RpcError } from "@/server/ai/acp/rpc";
import { runtimeDir } from "@/server/ai/roles";
import { codexBin } from "@/server/engines/codex";
import { EngineError } from "@/server/engines/types";

// `codex app-server`: JSON-RPC qua stdio (mỗi dòng 1 thông điệp), chạy thường trực theo CODEX_HOME.
// Một lượt viết chữ = thread tạm (ephemeral, read-only, không duyệt lệnh) + 1 turn; gom chữ agentMessage tới
// khi `turn/completed`. Tiến trình chết thì mọi lượt đang chờ lỗi; bộ quản lý (runtime bên dưới) bật lại lần sau.

export type AppServerOptions = {
  command: string;
  args?: string[];
  home: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  startTimeoutMs?: number;
};

export type AppTextResult = { text: string; model: string; breakdown: { sessionMs: number; modelMs: number } };

type RawWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown };
export type RawRateLimits = {
  rateLimits?: { primary?: RawWindow | null; secondary?: RawWindow | null; planType?: unknown } | null;
  rateLimitsByLimitId?: Record<string, { primary?: RawWindow | null; secondary?: RawWindow | null; planType?: unknown } | undefined> | null;
};

type Turn = { id?: string; status?: string; error?: { message?: string } | null; items?: { type?: string; text?: unknown; phase?: unknown }[] };

type Collector = {
  turnId?: string;
  deltas: Map<string, string>;
  finals: { text: string; final: boolean }[];
  error?: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
};

const DEV_INSTRUCTIONS =
  "You are a text-only writer. Answer directly with text. Never run shell commands, never read or write files, never use any tool.";

export class CodexAppServer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private peer: JsonRpcPeer | null = null;
  private up = false;
  private readonly threads = new Map<string, Collector>();
  private stderrTail = "";
  lastUsed = Date.now();

  constructor(readonly opts: AppServerOptions) {}

  get alive(): boolean {
    return this.up;
  }

  get activeTurns(): number {
    return this.threads.size;
  }

  stderr(): string {
    return this.stderrTail.trim().slice(-500);
  }

  async start(): Promise<void> {
    mkdirSync(this.opts.cwd, { recursive: true });
    const proc = spawn(this.opts.command, this.opts.args ?? ["app-server"], {
      cwd: this.opts.cwd,
      env: childEnv({ ...this.opts.env, CODEX_HOME: this.opts.home }),
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    this.proc = proc;
    const peer = new JsonRpcPeer(proc.stdout, proc.stdin);
    this.peer = peer;
    proc.stderr.setEncoding("utf8").on("data", (d: string) => {
      this.stderrTail = (this.stderrTail + d).slice(-4000);
    });
    const died = new Promise<never>((_, reject) => {
      proc.on("error", (e) => reject(new EngineError("CODEX_APPSERVER", `Không chạy được OpenAI app-server: ${e.message}`)));
      proc.on("exit", (code, sig) => {
        const err = new EngineError("CODEX_APPSERVER", `OpenAI app-server thoát (${code ?? sig})${this.stderr() ? `: ${this.stderr()}` : ""}`);
        this.onDeath(err);
        reject(err);
      });
    });
    died.catch(() => undefined);
    peer.onNotification((method, params) => this.onNotification(method, params));
    peer.onRequest((method) => this.onServerRequest(method));
    try {
      await Promise.race([
        peer.request(
          "initialize",
          { clientInfo: { name: "auramotion", title: "AuraMotion", version: "2" }, capabilities: { experimentalApi: false, requestAttestation: false } },
          this.opts.startTimeoutMs ?? 30_000,
        ),
        died,
      ]);
      peer.notify("initialized", undefined);
      this.up = true;
    } catch (err) {
      await this.stop();
      throw err instanceof EngineError ? err : new EngineError("CODEX_APPSERVER", `OpenAI app-server không khởi động được: ${(err as Error).message}`);
    }
  }

  private onDeath(err: Error): void {
    this.up = false;
    this.peer?.close(err);
    for (const c of this.threads.values()) c.reject(err);
    this.threads.clear();
  }

  // Không bao giờ cho chạy lệnh / sửa file.
  private onServerRequest(method: string): unknown {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") return { decision: "decline" };
    if (method === "execCommandApproval" || method === "applyPatchApproval") return { decision: "denied" };
    throw new RpcError(-32601, `AuraMotion không hỗ trợ ${method}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onNotification(method: string, p: any): void {
    const c = typeof p?.threadId === "string" ? this.threads.get(p.threadId) : undefined;
    if (!c) return;
    if (method === "item/agentMessage/delta" && typeof p.itemId === "string") {
      c.deltas.set(p.itemId, (c.deltas.get(p.itemId) ?? "") + String(p.delta ?? ""));
    } else if (method === "item/completed" && p.item?.type === "agentMessage") {
      c.finals.push({ text: String(p.item.text ?? ""), final: p.item.phase === "final_answer" });
    } else if (method === "error" && p.willRetry === false) {
      c.error = String(p.error?.message ?? "lỗi không rõ");
    } else if (method === "turn/completed") {
      const turn = (p.turn ?? {}) as Turn;
      if (turn.status === "failed" || turn.status === "interrupted") {
        c.reject(new EngineError("CODEX_FAILED", `OpenAI: ${turn.error?.message || c.error || `lượt ${turn.status}`}`));
        return;
      }
      for (const it of turn.items ?? []) {
        if (it.type === "agentMessage" && !c.finals.some((f) => f.text === it.text)) c.finals.push({ text: String(it.text ?? ""), final: it.phase === "final_answer" });
      }
      const finals = c.finals.filter((f) => f.final && f.text.trim());
      const text = (finals.length ? finals : c.finals.filter((f) => f.text.trim())).map((f) => f.text).at(-1) ?? [...c.deltas.values()].join("");
      if (!text.trim()) c.reject(new EngineError("CODEX_FAILED", `OpenAI không trả câu trả lời${c.error ? `: ${c.error}` : ""}`));
      else c.resolve(text);
    }
  }

  private request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (!this.peer || !this.up) return Promise.reject(new EngineError("CODEX_APPSERVER", "OpenAI app-server chưa chạy"));
    return this.peer.request<T>(method, params, timeoutMs);
  }

  async text(args: { prompt: string; model?: string; effort?: string; timeoutMs: number; signal?: AbortSignal }): Promise<AppTextResult> {
    if (args.signal?.aborted) throw new EngineError("CANCELED", "Đã hủy");
    this.lastUsed = Date.now();
    const t0 = Date.now();
    const started = await this.request<{ thread?: { id?: string }; model?: string }>(
      "thread/start",
      {
        ...(args.model ? { model: args.model } : {}),
        cwd: this.opts.cwd,
        sandbox: "read-only",
        approvalPolicy: "never",
        ephemeral: true,
        developerInstructions: DEV_INSTRUCTIONS,
      },
      Math.min(args.timeoutMs, 30_000),
    ).catch((err: unknown) => {
      throw toEngineError(err);
    });
    const threadId = started?.thread?.id;
    if (!threadId) throw new EngineError("CODEX_FAILED", "OpenAI app-server không trả thread");
    const t1 = Date.now();
    let collector!: Collector;
    const done = new Promise<string>((resolve, reject) => {
      collector = { deltas: new Map(), finals: [], resolve, reject };
    });
    // Lỗi trước khi kịp chờ (turn/start hỏng) không thành unhandledRejection; `await done` vẫn nhận lỗi.
    done.catch(() => undefined);
    this.threads.set(threadId, collector);
    const interrupt = () => {
      if (collector.turnId) void this.request("turn/interrupt", { threadId, turnId: collector.turnId }, 5000).catch(() => undefined);
    };
    const timer = setTimeout(() => {
      interrupt();
      collector.reject(new EngineError("TIMEOUT", `OpenAI app-server quá ${Math.round(args.timeoutMs / 1000)} giây`));
    }, args.timeoutMs);
    const onAbort = () => {
      interrupt();
      collector.reject(new EngineError("CANCELED", "Đã hủy"));
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const turn = await this.request<{ turn?: Turn }>(
        "turn/start",
        { threadId, input: [{ type: "text", text: args.prompt, text_elements: [] }], ...(args.effort ? { effort: args.effort } : {}) },
        Math.min(args.timeoutMs, 30_000),
      ).catch((err: unknown) => {
        throw toEngineError(err);
      });
      collector.turnId = turn?.turn?.id;
      const text = await done;
      return { text, model: started.model || args.model || "", breakdown: { sessionMs: t1 - t0, modelMs: Date.now() - t1 } };
    } finally {
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onAbort);
      this.threads.delete(threadId);
      this.lastUsed = Date.now();
      void this.request("thread/unsubscribe", { threadId }, 5000).catch(() => undefined);
    }
  }

  async rateLimits(timeoutMs = 20_000): Promise<RawRateLimits> {
    return this.request<RawRateLimits>("account/rateLimits/read", {}, timeoutMs);
  }

  // Tắt ngay (đồng bộ) khi tiến trình Node thoát.
  killNow(): void {
    const pid = this.proc?.pid;
    if (!pid || this.proc?.exitCode !== null) return;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // đã thoát
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    this.onDeath(new EngineError("CODEX_APPSERVER", "OpenAI app-server đã tắt"));
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const kill = (sig: NodeJS.Signals) => {
        try {
          process.kill(-proc.pid!, sig);
        } catch {
          proc.kill(sig);
        }
      };
      const timer = setTimeout(() => {
        kill("SIGKILL");
        resolve();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      proc.stdin.end();
      kill("SIGTERM");
    });
  }
}

function toEngineError(err: unknown): Error {
  if (err instanceof EngineError) return err;
  if (err instanceof RpcError) {
    if (err.code === -32010) return new EngineError("TIMEOUT", `OpenAI app-server: ${err.message}`);
    return new EngineError("CODEX_FAILED", `OpenAI app-server: ${err.message}`);
  }
  return new EngineError("CODEX_APPSERVER", `OpenAI app-server: ${(err as Error).message ?? String(err)}`);
}

// ---------- Bộ quản lý: 1 tiến trình thường trực / CODEX_HOME ----------

const DOWN_MS = 30_000;
const IDLE_MS = 30 * 60_000;

export class CodexAppServerUnavailable extends EngineError {
  constructor(message: string) {
    super("CODEX_APPSERVER", message, true);
  }
}

type Entry = { server: CodexAppServer | null; starting: Promise<CodexAppServer> | null; downUntil: number; lastError: string | null };
type Runtime = { entries: Map<string, Entry>; sweeper: NodeJS.Timeout | null; exitHook: boolean; factory?: (home: string) => CodexAppServer };

const g = globalThis as unknown as { auraCodexAs?: Runtime };
const rt: Runtime = (g.auraCodexAs ??= { entries: new Map(), sweeper: null, exitHook: false });

// App Next / worker thoát (kể cả không gọi stopCodexAppServers): tắt cả nhóm tiến trình app-server.
function ensureExitHook(): void {
  if (rt.exitHook) return;
  rt.exitHook = true;
  process.once("exit", () => {
    for (const e of rt.entries.values()) e.server?.killNow();
  });
}

export function appServerOptions(home: string): AppServerOptions {
  return { command: codexBin(), args: ["app-server"], home, cwd: path.join(runtimeDir("codex-app"), "cwd"), startTimeoutMs: 30_000 };
}

export function newCodexAppServer(home: string): CodexAppServer {
  return rt.factory ? rt.factory(home) : new CodexAppServer(appServerOptions(home));
}

// Test thay tiến trình thật bằng app-server giả.
export function setCodexAppServerFactory(factory: ((home: string) => CodexAppServer) | undefined): void {
  rt.factory = factory;
}

// Tiến trình không dùng quá 30 phút thì tắt (lần gọi sau bật lại).
function ensureSweeper(): void {
  if (rt.sweeper) return;
  rt.sweeper = setInterval(() => {
    for (const [home, e] of rt.entries) {
      if (e.server && e.server.activeTurns === 0 && Date.now() - e.server.lastUsed > IDLE_MS) {
        const s = e.server;
        e.server = null;
        void s.stop();
        rt.entries.delete(home);
      }
    }
  }, 60_000);
  rt.sweeper.unref();
}

// Lấy (khởi động lười) tiến trình của CODEX_HOME. Lỗi khởi động → CodexAppServerUnavailable, 30 s sau mới thử lại.
export async function getCodexAppServer(home: string): Promise<CodexAppServer> {
  let e = rt.entries.get(home);
  if (!e) rt.entries.set(home, (e = { server: null, starting: null, downUntil: 0, lastError: null }));
  if (e.server?.alive) return e.server;
  if (e.starting) return e.starting;
  if (Date.now() < e.downUntil) throw new CodexAppServerUnavailable(`OpenAI app-server chưa khởi động được: ${e.lastError ?? ""}`);
  const entry = e;
  if (entry.server) void entry.server.stop();
  entry.server = null;
  const server = newCodexAppServer(home);
  const starting = server.start().then(
    () => {
      entry.server = server;
      entry.lastError = null;
      entry.downUntil = 0;
      ensureSweeper();
      ensureExitHook();
      return server;
    },
    (err: unknown) => {
      entry.lastError = ((err as Error).message ?? String(err)).slice(0, 300);
      entry.downUntil = Date.now() + DOWN_MS;
      throw new CodexAppServerUnavailable(`OpenAI app-server không khởi động được: ${entry.lastError}`);
    },
  );
  entry.starting = starting;
  try {
    return await starting;
  } finally {
    if (entry.starting === starting) entry.starting = null;
  }
}

export async function codexAppText(args: {
  home: string;
  prompt: string;
  model?: string;
  effort?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<AppTextResult & { breakdown: { startMs: number } }> {
  const t0 = Date.now();
  const server = await getCodexAppServer(args.home);
  const startMs = Date.now() - t0;
  const r = await server.text(args);
  return { ...r, breakdown: { startMs, ...r.breakdown } };
}

export function codexAppServerStatus(): { home: string; alive: boolean; activeTurns: number; lastError: string | null }[] {
  return [...rt.entries].map(([home, e]) => ({ home, alive: Boolean(e.server?.alive), activeTurns: e.server?.activeTurns ?? 0, lastError: e.lastError }));
}

// Tắt mọi tiến trình (worker / app dừng).
export async function stopCodexAppServers(): Promise<void> {
  const entries = [...rt.entries.values()];
  rt.entries.clear();
  if (rt.sweeper) clearInterval(rt.sweeper);
  rt.sweeper = null;
  await Promise.all(
    entries.map(async (e) => {
      const starting = e.starting;
      e.starting = null;
      if (e.server) await e.server.stop().catch(() => undefined);
      if (starting) await starting.then((s) => s.stop()).catch(() => undefined);
    }),
  );
}
