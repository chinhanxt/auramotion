import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ALL_QUEUE_NAMES, anyQueue } from "@/lib/queue";
import { acpModels, acpStatus, getAcpPool } from "@/server/ai/acp/runtime";
import { getAgyAccounts, type AgyAccount } from "@/server/ai/agy/accounts";
import { getProxyStatus } from "@/server/ai/agy/proxy";
import { listCodexProfiles, unionModels } from "@/server/ai/codex-profiles";
import { agyTransport, aiText, getCooldowns, getGatewayHealth, type GatewayDeps } from "@/server/ai/gateway";
import { AI_PROVIDERS, CODEX_PROFILE_NAME_RE, getAiRoles, saveAiRoles, type AiRoles } from "@/server/ai/roles";
import { getMuse } from "@/server/engines";
import { checkCli } from "@/server/engines/cli";
import { getMuseSlots, getScheduler } from "@/server/engines/muse-scheduler";
import { buildWriterPrompt } from "@/server/engines/prompt-writer";
import { EngineError } from "@/server/engines/types";
import { museAccountOf } from "@/server/services/job";
import { traceOf } from "@/server/services/trace";

// Admin AI runtime: trạng thái provider (agy ACP / tài khoản / proxy, codex profile / model, Muse), lưu ai_roles,
// chạy thử có đo thời gian, sơ đồ luồng dựng từ cấu hình thật, trace job.

// Model agy luôn hiện trong danh sách (ACP chưa chạy / kho tạm thiếu biến thể).
export const KNOWN_AGY_MODELS = [
  "gemini-3.8-flash-low",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-high",
  "claude-sonnet-5-5-low",
  "claude-sonnet-5-5-medium",
  "claude-sonnet-5-5-high",
  "claude-opus-5-5-low",
  "claude-opus-5-5-medium",
  "claude-opus-5-5-high",
];

export function mergeAgyModels(live: { id: string; name: string }[]): { id: string; name: string; live: boolean }[] {
  const out = live.map((m) => ({ ...m, live: true }));
  const have = new Set(out.map((m) => m.id));
  for (const id of KNOWN_AGY_MODELS) if (!have.has(id)) out.push({ id, name: id, live: false });
  return out;
}

type MuseAccountView = { id: string; label: string; enabled: boolean; status: string; kinds: string[] };

async function museAccounts(): Promise<MuseAccountView[]> {
  const r = await getMuse().admin<{ data?: Record<string, unknown>[] }>("GET", "/admin/accounts");
  return (r.data ?? []).map((a) => {
    const meta = (a.meta ?? {}) as { kinds?: unknown };
    return {
      id: String(a.id ?? ""),
      label: typeof a.label === "string" ? a.label : "",
      enabled: a.enabled !== false,
      status: typeof a.status === "string" ? a.status : "active",
      kinds: Array.isArray(meta.kinds) ? meta.kinds.filter((k): k is string => typeof k === "string") : [],
    };
  });
}

export async function getAiAdmin(opts: { refresh?: boolean } = {}) {
  const roles = await getAiRoles();
  const transport = agyTransport(roles);
  if (transport === "acp") await getAcpPool().catch(() => undefined);
  const [cli, health, cooldowns, accounts, proxy, profiles, muse, museAccs] = await Promise.all([
    checkCli(),
    getGatewayHealth(),
    getCooldowns(),
    getAgyAccounts({ refresh: opts.refresh }).then(
      (list) => ({ list, error: null as string | null }),
      (err: Error) => ({ list: [] as AgyAccount[], error: err.message.slice(0, 300) }),
    ),
    getProxyStatus(),
    listCodexProfiles({ refresh: opts.refresh }).catch(() => []),
    getMuse().health(),
    museAccounts().catch(() => null),
  ]);
  const acp = acpStatus();
  return {
    roles,
    providers: {
      agy: {
        installed: cli.agy.ok,
        version: cli.agy.version ?? null,
        transport,
        acp: { alive: acp.alive, processes: acp.processes, sessions: acp.sessions, active: acp.active, restarts: acp.restarts, lastError: acp.lastError },
        accounts: accounts.list,
        ...(accounts.error ? { accountsError: accounts.error } : {}),
        proxy: { enabled: roles.agy.proxy, port: proxy.port, running: proxy.running },
        models: mergeAgyModels(acpModels()),
      },
      codex: {
        installed: cli.codex.ok,
        version: cli.codex.version ?? null,
        profiles,
        models: unionModels(profiles),
      },
      muse: { ok: muse.ok, accounts: museAccs ?? muse.accounts ?? null },
    },
    health,
    cooldowns,
  };
}

export async function putAiRoles(input: unknown): Promise<{ roles: AiRoles }> {
  const before = await getAiRoles();
  const roles = await saveAiRoles(input);
  if (before.agy.proxy !== roles.agy.proxy) {
    // Bật/tắt proxy đi qua đúng luồng (bật proxy, đổi CLOUD_CODE_URL, khởi động lại ACP).
    const { setAgyProxy } = await import("@/server/ai/agy/accounts");
    await setAgyProxy(roles.agy.proxy);
  } else if (before.agy.transport !== roles.agy.transport) {
    const { restartAcp } = await import("@/server/ai/acp/runtime");
    await restartAcp();
  }
  return { roles: await getAiRoles() };
}

// ---------- Chạy thử ----------

export const aiTestSchema = z.object({
  provider: z.enum(AI_PROVIDERS, { message: "Provider chỉ gồm agy, codex, muse" }),
  model: z.string().trim().max(200).optional(),
  effort: z.string().trim().regex(/^[a-z]{0,12}$/).optional(),
  profile: z.string().trim().regex(CODEX_PROFILE_NAME_RE, { message: "Tên profile codex không hợp lệ" }).optional(),
  skillId: z.string().min(1).max(100).optional(),
  kind: z.enum(["image", "video", "script"]).default("image"),
  idea: z.string().trim().min(1, { message: "Hãy nhập ý tưởng" }).max(2000),
});

// Viết thử 1 lần bằng đúng 1 provider/model (không rơi sang provider khác) + thời gian từng chặng.
export async function testAi(input: unknown, deps: GatewayDeps = {}) {
  const p = aiTestSchema.parse(input);
  let skill = null;
  if (p.skillId) {
    skill = await db.promptSkill.findUnique({ where: { id: p.skillId } });
    if (!skill) throw new AppError("NOT_FOUND", "Không tìm thấy skill");
  }
  const built = await buildWriterPrompt({ idea: p.idea, kind: p.kind, aspect: "9:16", durationSec: 5 }, skill);
  const started = Date.now();
  try {
    const res = await aiText(
      { prompt: built.prompt, system: built.system, json: true },
      {
        ...deps,
        setting: undefined,
        role: { chain: [{ provider: p.provider, model: p.model || undefined, effort: p.effort || undefined, profile: p.profile || undefined }], strategy: "fallback" },
      },
    );
    return {
      text: res.text,
      prompt: built.prompt,
      ms: Date.now() - started,
      breakdown: res.breakdown ?? {},
      provider: res.provider,
      model: res.model ?? p.model ?? null,
    };
  } catch (err) {
    if (err instanceof EngineError) throw new AppError("ENGINE", `AI chưa trả lời được: ${err.message.slice(0, 300)}`);
    throw err;
  }
}

// ---------- Sơ đồ luồng ----------

type FlowNode = {
  id: string;
  kind: "user" | "api" | "queue" | "worker" | "gateway" | "skill" | "writer" | "executor" | "muse2api" | "muse-tab" | "validate" | "storage" | "realtime";
  title: string;
  subtitle: string;
  ai?: { provider: string; model?: string; account?: string };
  stats?: Record<string, unknown>;
};
type FlowEdge = { from: string; to: string; label?: string };

const COUNT_TYPES = ["waiting", "active", "delayed", "failed", "prioritized"] as const;

export function jobStage(job: { status: string; queuedAt: Date | null; museTaskId: string | null; params: unknown }): string {
  const params = (job.params ?? {}) as { autoWrite?: unknown; written?: unknown };
  const trace = traceOf(job.params);
  if (job.status === "PENDING") {
    if (!job.queuedAt) return "waiting";
    if (params.autoWrite && !params.written && trace?.writeStart) return "writing";
    return "queue";
  }
  if (params.autoWrite && !params.written) return "writing";
  if (job.museTaskId || trace?.submitAt) return "rendering";
  return "slot";
}

export async function getFlow() {
  const roles = await getAiRoles();
  const [models, skills, queueStats, slots, slotCounts, museHealth, museAccs, active] = await Promise.all([
    db.aiModel.findMany({ where: { enabled: true }, orderBy: [{ kind: "asc" }, { sort: "asc" }, { name: "asc" }] }),
    db.promptSkill.groupBy({ by: ["kind"], where: { enabled: true }, _count: { _all: true } }),
    Promise.all(
      ALL_QUEUE_NAMES.map(async (name) => {
        const q = anyQueue(name);
        const [counts, paused] = await Promise.all([q.getJobCounts(...COUNT_TYPES).catch(() => ({})), q.isPaused().catch(() => false)]);
        return [name, { ...counts, paused }] as const;
      }),
    ),
    getMuseSlots(),
    getScheduler()
      .counts()
      .catch(() => ({ image: 0, video: 0, chat: 0 })),
    getMuse().health(),
    museAccounts().catch(() => [] as MuseAccountView[]),
    db.job.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] }, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id: true, kind: true, status: true, queuedAt: true, museTaskId: true, params: true, modelId: true },
    }),
  ]);
  const acp = acpStatus();
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const queues = Object.fromEntries(queueStats);

  nodes.push({ id: "user", kind: "user", title: "Người dùng", subtitle: "Studio / Story" });
  nodes.push({ id: "api", kind: "api", title: "Next API", subtitle: "/api/jobs · /api/ai/prewrite · /api/stories" });
  edges.push({ from: "user", to: "api", label: "Tạo" });
  for (const name of ALL_QUEUE_NAMES) {
    nodes.push({ id: `queue:${name}`, kind: "queue", title: `Hàng đợi ${name}`, subtitle: "BullMQ", stats: queues[name] });
    edges.push({ from: "api", to: `queue:${name}`, label: name === "story" ? "kịch bản" : name });
    edges.push({ from: `queue:${name}`, to: "worker" });
  }
  nodes.push({ id: "worker", kind: "worker", title: "Worker", subtitle: "BullMQ worker", stats: { activeJobs: active.length } });

  const writerSub = `${roles.writer.strategy === "race" ? "race 2 đầu" : "lần lượt"} · ${roles.writer.timeoutSec}s · prewrite ${roles.prewrite ? "bật" : "tắt"} · cache ${roles.cacheHours}h`;
  nodes.push({
    id: "gateway",
    kind: "gateway",
    title: "AI Gateway",
    subtitle: writerSub,
    stats: { agyTransport: agyTransport(roles), agyProxy: roles.agy.proxy, acp: { alive: acp.alive, processes: acp.processes, sessions: acp.sessions }, codexProfile: roles.codex.profile },
  });
  edges.push({ from: "worker", to: "gateway", label: "autoWrite" });
  edges.push({ from: "api", to: "gateway", label: "prewrite" });
  nodes.push({
    id: "skill",
    kind: "skill",
    title: "Chọn skill",
    subtitle: skills.map((s) => `${s.kind} ${s._count._all}`).join(" · ") || "không có skill",
    stats: Object.fromEntries(skills.map((s) => [s.kind, s._count._all])),
  });
  edges.push({ from: "gateway", to: "skill" });

  const TITLE = { writer: "Viết prompt", story: "Kịch bản", router: "Chọn skill AI" } as const;
  const chainNodes = (prefix: "writer" | "story" | "router", role: AiRoles["writer"], from: string) => {
    role.chain.forEach((step, i) => {
      const id = `${prefix}:${i}`;
      const profile = step.provider === "codex" ? step.profile || roles.codex.profile : undefined;
      nodes.push({
        id,
        kind: "writer",
        title: `${TITLE[prefix]} #${i + 1}`,
        subtitle: [step.provider, step.model, step.effort].filter(Boolean).join(" · "),
        ai: { provider: step.provider, ...(step.model ? { model: step.model } : {}), ...(profile ? { account: profile } : {}) },
      });
      const raced = role.strategy === "race" && i < 2;
      if (i === 0 || raced) edges.push({ from, to: id, label: raced ? "race" : `#${i + 1}` });
      else edges.push({ from: `${prefix}:${i - 1}`, to: id, label: "lỗi → kế" });
      if (step.provider === "muse") edges.push({ from: id, to: "muse2api", label: "chat" });
    });
  };
  chainNodes("writer", roles.writer, "skill");
  chainNodes("story", roles.story, "gateway");
  // Bộ chọn skill 2 tầng: luật lọc 10 ứng viên, chưa rõ thì hỏi chuỗi `router`.
  chainNodes("router", roles.router, "skill");

  for (const m of models) {
    const account = museAccountOf(m.options);
    const id = `exec:${m.id}`;
    nodes.push({
      id,
      kind: "executor",
      title: m.name,
      subtitle: `${m.provider} · ${m.kind}`,
      ai: { provider: m.provider.toLowerCase(), model: m.engineModel, ...(account ? { account } : {}) },
      stats: { activeJobs: active.filter((j) => j.modelId === m.id).length },
    });
    const queue = m.provider === "MUSE" ? "muse" : m.provider === "LOCAL" ? "post" : "cli";
    edges.push({ from: "worker", to: id, label: queue });
    if (m.provider === "MUSE") {
      edges.push({ from: id, to: account ? `muse-tab:${account}` : "muse2api", label: account ? "ghim tài khoản" : m.kind.toLowerCase() });
    }
    edges.push({ from: id, to: "validate" });
  }

  nodes.push({
    id: "muse2api",
    kind: "muse2api",
    title: "muse2api",
    subtitle: museHealth.ok ? `sẵn sàng · ${museHealth.accounts ?? museAccs.length} tài khoản` : "không kết nối",
    stats: { ok: museHealth.ok, driver: museHealth.driver ?? null, accounts: museAccs.length },
  });
  const tabsPerAccount = Number.parseInt(process.env.MUSE2API_ACCOUNT_MAX_CONCURRENCY ?? "", 10) || null;
  for (const acc of museAccs) {
    const id = `muse-tab:${acc.id}`;
    nodes.push({
      id,
      kind: "muse-tab",
      title: acc.label || acc.id,
      subtitle: `${acc.kinds.length ? acc.kinds.join(", ") : "mọi loại"} · ${acc.enabled ? acc.status : "tắt"}`,
      ai: { provider: "muse", account: acc.id },
      stats: { enabled: acc.enabled, status: acc.status, kinds: acc.kinds, tabs: tabsPerAccount },
    });
    edges.push({ from: "muse2api", to: id });
  }
  // Model ghim tài khoản không có trong muse2api: vẫn có nút để thấy cấu hình sai.
  for (const m of models) {
    const account = museAccountOf(m.options);
    if (account && !museAccs.some((a) => a.id === account)) {
      nodes.push({ id: `muse-tab:${account}`, kind: "muse-tab", title: account, subtitle: "không thấy trong muse2api", ai: { provider: "muse", account } });
      edges.push({ from: "muse2api", to: `muse-tab:${account}` });
    }
  }

  nodes.push({ id: "validate", kind: "validate", title: "Kiểm file", subtitle: "ffprobe kích thước / thời lượng" });
  nodes.push({ id: "storage", kind: "storage", title: "Lưu trữ", subtitle: "/media/results" });
  nodes.push({ id: "realtime", kind: "realtime", title: "Realtime", subtitle: "Redis pub/sub → SSE /api/events" });
  edges.push({ from: "validate", to: "storage" }, { from: "storage", to: "realtime" }, { from: "realtime", to: "user", label: "SSE" });

  return {
    nodes,
    edges,
    live: {
      queues,
      slots: { limits: slots, used: slotCounts },
      activeJobs: active.map((j) => ({ id: j.id, kind: j.kind, stage: jobStage(j), modelId: j.modelId })),
    },
  };
}

export async function listFlowJobs(limitRaw: unknown) {
  const limit = z.coerce.number().int().min(1).max(100).catch(20).parse(limitRaw ?? 20);
  const rows = await db.job.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit * 3,
    select: {
      id: true,
      kind: true,
      status: true,
      error: true,
      createdAt: true,
      params: true,
      model: { select: { name: true, provider: true, engineModel: true } },
      user: { select: { email: true } },
    },
  });
  return {
    items: rows
      .filter((r) => traceOf(r.params))
      .slice(0, limit)
      .map(({ params, ...r }) => ({ ...r, trace: traceOf(params), written: (params as { written?: unknown }).written ?? null })),
  };
}

// Trace 1 job (userId: chỉ job của người này).
export async function getJobTrace(jobId: string, userId?: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, kind: true, status: true, error: true, deletedAt: true, params: true, model: { select: { name: true, provider: true, engineModel: true } } },
  });
  if (!job || (userId && (job.userId !== userId || job.deletedAt))) throw new AppError("NOT_FOUND", "Không tìm thấy tác vụ");
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    error: job.error,
    model: job.model,
    trace: traceOf(job.params) ?? {},
    written: (job.params as { written?: unknown }).written ?? null,
  };
}
