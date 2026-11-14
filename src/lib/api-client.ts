// Kiểu dữ liệu và hàm gọi API dùng ở phía trình duyệt.

export type GenKind = "image" | "video" | "assemble";
export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export type ModelOptions = { aspectRatios?: string[]; counts?: number[]; durations?: number[]; maxRefs?: number };

export type CatalogModel = {
  id: string;
  name: string;
  provider: "MUSE" | "AGY" | "CODEX" | "LOCAL";
  engineModel?: string;
  kind: "IMAGE" | "VIDEO" | "ASSEMBLE";
  minPlanRank: number;
  baseCost: string;
  options: ModelOptions;
  locked: boolean;
  // Model catalog v2 (docs/v2-model-catalog.md) — backend cũ có thể chưa trả.
  vendor?: ModelVendor | string;
  displayName?: string;
  badge?: string;
  description?: string;
  etaSec?: number | null;
  verified?: { ok: boolean } | null;
};

// ───────── Model catalog v2: hãng, tên hiển thị, kết quả test ─────────

export type ModelVendor = "muse" | "google" | "anthropic" | "openai" | "local";
export const VENDOR_ORDER: string[] = ["muse", "google", "anthropic", "openai", "local"];
export const VENDOR_LABEL: Record<string, string> = { muse: "Muse", google: "Google", anthropic: "Anthropic", openai: "OpenAI", local: "Máy chủ" };
export const MODEL_BADGES = ["Nhanh", "Cân bằng", "Kỹ", "Đẹp", "Mới", "Cao cấp"] as const;

// `{ ok, testedAt, ms, error?, sampleUrl? }` — test vẽ thật bằng đúng model.
export type ModelVerified = { ok: boolean; testedAt?: string | number | null; ms?: number | null; error?: string | null; sampleUrl?: string | null };
export type ModelCatalogFields = {
  vendor?: string;
  displayName?: string;
  badge?: string;
  description?: string;
  etaSec?: number | null;
  verified?: ModelVerified | null;
  source?: "manual" | "synced" | string;
};
export type ModelSyncResult = { created: number; existing: number };
export type ModelVerifyResult = ModelVerified & { model?: unknown };

type VendorSource = { vendor?: string | null; provider?: string | null; engineModel?: string | null; name?: string | null };

// Hãng của model: `vendor` từ backend; chưa có thì suy từ provider + engineModel + tên.
export function vendorOf(m: VendorSource): string {
  const v = (m.vendor ?? "").trim().toLowerCase();
  if (v) return v;
  const p = (m.provider ?? "").toUpperCase();
  const hay = `${m.engineModel ?? ""} ${m.name ?? ""}`.toLowerCase();
  if (p === "MUSE" || /muse/.test(hay)) return "muse";
  if (p === "LOCAL") return "local";
  if (/claude|anthropic|opus|sonnet|haiku/.test(hay)) return "anthropic";
  if (/gpt|openai|codex|dall-e/.test(hay) || p === "CODEX") return "openai";
  if (/gemini|imagen|veo|google/.test(hay) || p === "AGY") return "google";
  return "other";
}

export function modelLabel(m: { displayName?: string | null; name: string }): string {
  return m.displayName?.trim() || m.name;
}

// Thời gian ước tính: `etaSec`; chưa có thì agy/codex (CLI vẽ ảnh) ~1–4 phút.
export function etaLabel(m: { etaSec?: number | null; provider?: string }): string | null {
  const s = m.etaSec;
  if (typeof s === "number" && s > 0) return s < 90 ? `~${Math.round(s)} s` : `~${Math.round(s / 60)} phút`;
  if (m.provider === "AGY" || m.provider === "CODEX") return "1–4 phút";
  return null;
}

// Gom theo hãng (Muse, Google, Anthropic, OpenAI, rồi hãng khác), giữ thứ tự gốc trong nhóm.
export function groupByVendor<T extends VendorSource>(list: T[]): [string, T[]][] {
  const g = new Map<string, T[]>();
  for (const m of list) {
    const v = vendorOf(m);
    g.set(v, [...(g.get(v) ?? []), m]);
  }
  const rank = (v: string) => (VENDOR_ORDER.includes(v) ? VENDOR_ORDER.indexOf(v) : VENDOR_ORDER.length);
  return [...g.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

// ───────── Quota agy / codex (`/api/admin/ai`) ─────────

// Cửa sổ quota codex (primary = 5 giờ, secondary = tuần).
export type QuotaWindow = { usedPercent?: number | null; windowMinutes?: number | null; resetsAt?: string | number | null };
export type CodexQuota = { primary?: QuotaWindow | null; secondary?: QuotaWindow | null; source?: "app-server" | "session-log" | string; checkedAt?: string | number | null };
// agy: % còn lại theo nhóm model (Gemini | Claude), mỗi nhóm 5 giờ + tuần.
export type QuotaRemain = { pct?: number | null; remainingPercent?: number | null; usedPercent?: number | null; resetAt?: string | number | null; resetsAt?: string | number | null };
export type AgyQuotaGroup = {
  fiveHour?: number | QuotaRemain | null;
  weekly?: number | QuotaRemain | null;
  resetAt?: string | number | null;
  fiveHourResetAt?: string | number | null;
  weeklyResetAt?: string | number | null;
};
export type AgyQuotaGroups = { gemini?: AgyQuotaGroup | null; claude?: AgyQuotaGroup | null };

// Trường mới của v2 (slug, category, description, cover, palette) có thể chưa có khi backend cũ.
export type CatalogPreset = {
  id: string;
  kind: "STYLE" | "CAMERA";
  name: string;
  promptSuffix: string;
  thumbnailUrl: string | null;
  slug?: string | null;
  category?: string;
  description?: string;
  cover?: string | null;
  palette?: string[];
  featured?: boolean;
};

export type SkillKind = "IMAGE" | "VIDEO" | "STORY" | "SCRIPT";
export type CatalogSkill = {
  id: string;
  slug: string;
  name: string;
  kind: SkillKind;
  description: string;
  locked: boolean;
  // Nhóm hiển thị ("Review sản phẩm", "Bán hàng", "Thời trang"…) + từ khóa tìm.
  category?: string;
  tags?: string[];
};

export type CatalogPlan = { code: "free" | "pro" | "ultra"; name: string; rank: number; maxDurationSec: number; maxConcurrent: number };

export type Catalog = {
  models: CatalogModel[];
  presets: CatalogPreset[];
  plan: CatalogPlan;
  music?: { id: string; name: string; file: string }[];
  skills?: CatalogSkill[];
  // Tài khoản Muse bị chặn tạo video (khu vực): khóa nút tạo video / quay story.
  videoUnavailable?: boolean;
  // Bước đầu chuỗi AI viết prompt: hãng theo model (Claude qua agy → anthropic).
  writer?: CatalogWriter;
};

export type CatalogWriter = { provider: string; model?: string | null; vendor: string };

// AI Gateway viết prompt cho job (autoWrite): ai viết, skill nào, mất bao lâu.
export type WriterProvider = "agy" | "codex" | "muse";
export type WrittenInfo = { provider: WriterProvider; model?: string; skillSlug: string; skillName: string; ms: number };
export type JobStage = "writing" | "rendering";
// Phần params liên quan AI viết: `idea` = ý tưởng gốc, `prompt` của job = prompt đã viết (hoặc ý tưởng khi chưa viết).
// `skillName` chỉ là gợi ý phía trình duyệt khi vừa gửi (skill đã chọn) để ô hiện tên trong lúc viết.
export type WriteParams = { idea?: string; autoWrite?: boolean; written?: WrittenInfo; skillName?: string };

export type JobItem = {
  id: string;
  kind: "IMAGE" | "VIDEO" | "ASSEMBLE";
  prompt: string;
  status: JobStatus;
  cost: string;
  resultUrls: string[];
  error: string | null;
  createdAt: string;
  // v2: tiến độ 0–100, thuộc story nào, cảnh số mấy, tham số tạo.
  progress?: number;
  storyId?: string | null;
  shotIndex?: number | null;
  params?: Record<string, unknown>;
  inputUrl?: string | null;
  finishedAt?: string | null;
  // Giai đoạn job autoWrite (từ SSE); không có thì suy từ params.
  stage?: JobStage;
};

// Sự kiện SSE `job` (hợp đồng v2 §3).
export type JobEvent = {
  id: string;
  status: JobStatus;
  progress?: number;
  resultUrls?: string[];
  error?: string | null;
  storyId?: string | null;
  shotIndex?: number | null;
  kind?: JobItem["kind"];
  stage?: JobStage;
  prompt?: string;
  written?: WrittenInfo;
  trace?: JobTrace;
};

// ───────── Trace job (`params.trace`, ms epoch — docs/v2-ai-runtime.md) ─────────

export type JobTrace = {
  createdAt?: number;
  queuedAt?: number;
  writeStart?: number;
  writeEnd?: number;
  writer?: { provider: string; model?: string | null; skill?: string | null; cache?: boolean };
  slotAt?: number;
  submitAt?: number;
  engine?: { provider: string; model?: string | null; account?: string | null };
  // Chọn skill 2 bước: lọc luật (~10 ứng viên) → AI router chọn 1.
  router?: { method: "rule" | "ai"; candidates?: string[]; chosen?: string; ms?: number };
  // Kiểm prompt sau khi viết: lint luật + tự sửa.
  guard?: { fixes?: string[] };
  doneAt?: number;
  failedAt?: number;
  error?: string | null;
};

export type TraceStageKey = "queue" | "write" | "slot" | "gap" | "engine";
export type TraceStage = { key: TraceStageKey; label: string; start: number; end: number; ms: number };

const ms = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
};

// Chuẩn hóa trace từ API (`{trace}` hoặc trace trần; mốc có thể là ISO string).
export function toTrace(raw: unknown): JobTrace | null {
  if (!raw || typeof raw !== "object") return null;
  const r = ("trace" in raw ? (raw as { trace: unknown }).trace : raw) as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const t: JobTrace = {
    createdAt: ms(r.createdAt),
    queuedAt: ms(r.queuedAt),
    writeStart: ms(r.writeStart),
    writeEnd: ms(r.writeEnd),
    slotAt: ms(r.slotAt),
    submitAt: ms(r.submitAt),
    doneAt: ms(r.doneAt),
    failedAt: ms(r.failedAt),
    writer: (r.writer as JobTrace["writer"]) ?? undefined,
    engine: (r.engine as JobTrace["engine"]) ?? undefined,
    router: (r.router as JobTrace["router"]) ?? undefined,
    guard: (r.guard as JobTrace["guard"]) ?? undefined,
    error: typeof r.error === "string" ? r.error : null,
  };
  return t.createdAt || t.writeStart || t.submitAt || t.doneAt ? t : null;
}

// Các chặng có thời lượng: xếp hàng → AI viết → chờ slot → giãn cách gửi → engine.
export function traceStages(t: JobTrace): TraceStage[] {
  const end = t.doneAt ?? t.failedAt;
  const out: TraceStage[] = [];
  const push = (key: TraceStageKey, label: string, a?: number, b?: number) => {
    if (a === undefined || b === undefined || b < a) return;
    out.push({ key, label, start: a, end: b, ms: b - a });
  };
  const start = t.createdAt ?? t.queuedAt;
  push("queue", "Xếp hàng", start, t.writeStart ?? t.slotAt ?? t.submitAt);
  push("write", "AI viết", t.writeStart, t.writeEnd);
  push("slot", "Chờ slot", t.writeEnd ?? t.queuedAt ?? start, t.slotAt);
  push("gap", "Giãn cách", t.slotAt, t.submitAt);
  push("engine", "Engine", t.submitAt ?? t.slotAt, end);
  return out;
}

export function traceTotal(t: JobTrace): number | null {
  const a = t.createdAt ?? t.queuedAt ?? t.writeStart;
  const b = t.doneAt ?? t.failedAt;
  return a !== undefined && b !== undefined ? Math.max(0, b - a) : null;
}

// ───────── Viết trước (prewrite) ─────────

export type PrewriteRequest = {
  idea: string;
  kind: "image" | "video";
  skillId?: string;
  styleId?: string;
  cameraId?: string;
  aspect: string;
  durationSec?: number;
  hasRef?: boolean;
};
export type PrewriteResult = {
  key: string;
  status: "ready" | "pending";
  prompt?: string;
  skill?: string | { slug?: string; name?: string } | null;
  provider?: string;
};

export function prewriteSkillName(r: Pick<PrewriteResult, "skill"> | null | undefined): string | undefined {
  const s = r?.skill;
  return typeof s === "string" ? s : (s?.name ?? s?.slug ?? undefined);
}

export type StoryStatus = "PLANNING" | "READY" | "RENDERING" | "ASSEMBLING" | "DONE" | "FAILED" | "CANCELED";
export type StoryShot = { index: number; title: string; prompt: string; camera?: string; durationSec: number };
export type StoryItem = {
  id: string;
  title: string;
  idea: string;
  status: StoryStatus;
  aspect: string;
  shotCount: number;
  shotDurationSec: number;
  mode: "PARALLEL" | "CHAIN";
  autoAssemble: boolean;
  plan: { shots: StoryShot[] } | null;
  error: string | null;
  finalJobId: string | null;
  createdAt: string;
  cover?: string;
};
export type StoryDetail = StoryItem & { jobs: JobItem[] };
export type StoryEvent = { id: string; status: StoryStatus; plan?: StoryItem["plan"]; error?: string | null };

export const STORY_ACTIVE: StoryStatus[] = ["PLANNING", "RENDERING", "ASSEMBLING"];
export const STORY_STATUS_LABEL: Record<StoryStatus, string> = {
  PLANNING: "Đang lập kịch bản",
  READY: "Sẵn sàng quay",
  RENDERING: "Đang quay",
  ASSEMBLING: "Đang ghép",
  DONE: "Hoàn tất",
  FAILED: "Lỗi",
  CANCELED: "Đã hủy",
};

export function writeParams(job: Pick<JobItem, "params">): WriteParams {
  return (job.params ?? {}) as WriteParams;
}

// Job đang chờ AI Gateway viết prompt (ô hiện skeleton "AI đang viết prompt…").
export function isWriting(job: Pick<JobItem, "status" | "params" | "stage">): boolean {
  if (!ACTIVE_STATUSES.includes(job.status)) return false;
  if (job.stage) return job.stage === "writing";
  const p = writeParams(job);
  return Boolean(p.autoWrite && !p.written);
}

export type ExploreItem = { id: string; kind: JobItem["kind"]; prompt: string; resultUrls: string[]; presetName?: string | null };
export type ThemeItem = CatalogPreset;

export const ACTIVE_STATUSES: JobStatus[] = ["PENDING", "RUNNING"];

export const STATUS_LABEL: Record<JobStatus, string> = {
  PENDING: "Đang chờ",
  RUNNING: "Đang xử lý",
  SUCCEEDED: "Hoàn tất",
  FAILED: "Thất bại",
  CANCELED: "Đã hủy",
};

export const STATUS_COLOR: Record<JobStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  RUNNING: "bg-blue-100 text-blue-800",
  SUCCEEDED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-700",
  CANCELED: "bg-neutral-200 text-neutral-700",
};

// Tông màu trạng thái cho giao diện tối (STATUS_COLOR giữ cho trang admin sáng).
export const STATUS_TONE: Record<JobStatus, "warn" | "info" | "ok" | "danger" | "neutral"> = {
  PENDING: "warn",
  RUNNING: "info",
  SUCCEEDED: "ok",
  FAILED: "danger",
  CANCELED: "neutral",
};

// Mã lỗi job (cột `error`) → câu hiển thị; mã lạ thì hiện kèm mã để báo admin.
const JOB_ERROR_TEXT: Record<string, string> = {
  TIMEOUT: "quá thời gian xử lý",
  CANCELED: "tác vụ đã bị hủy",
  QUEUE_UNAVAILABLE: "hàng đợi đang lỗi",
  BAD_INPUT: "file đầu vào không còn",
  BAD_CLIP: "có clip không còn hoặc không hợp lệ",
  BAD_PARAMS: "tham số không hợp lệ",
  NO_RESULT: "engine không trả kết quả",
  NO_IMAGE: "engine không trả ảnh",
  NO_AUDIO: "không tạo được giọng đọc",
  REFUSED: "nội dung bị từ chối, hãy đổi prompt",
  QUOTA: "engine tạm hết lượt",
  ASSEMBLE_FAILED: "ghép video lỗi",
  REGION_BLOCKED: "tài khoản Muse không được tạo video ở khu vực này",
  MUSE_VIDEO_UNAVAILABLE: "video Muse tạm không khả dụng",
  BAD_MEDIA: "file kết quả hỏng, đang thử lại",
  WRITE_FAILED: "AI chưa viết được prompt, đã hoàn Credit",
};

export function jobErrorText(code: string): string {
  return JOB_ERROR_TEXT[code] ?? `mã lỗi ${code}`;
}

const KIND_PATH: Record<JobItem["kind"], string> = { IMAGE: "image", VIDEO: "video", ASSEMBLE: "edit" };

export function remakeHref(job: { id: string; kind: JobItem["kind"] }): string {
  return `/studio/${KIND_PATH[job.kind]}?from=${job.id}`;
}

// Tỷ lệ khung của job (lưu trong params) → "w / h" cho CSS aspect-ratio.
export function jobAspect(job: Pick<JobItem, "kind" | "params">): string {
  const p = (job.params ?? {}) as { aspectRatio?: string; aspect?: string };
  return p.aspectRatio ?? p.aspect ?? (job.kind === "IMAGE" ? "1:1" : "9:16");
}

export function ratioCss(ratio: string): string {
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0 ? `${w} / ${h}` : "1 / 1";
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405);
}

// Gói tối thiểu theo rank (seed: 0 Free, 1 Pro, 2 Ultra).
export function planLabel(rank: number): string {
  return rank >= 2 ? "Ultra" : "Pro";
}

export function formatCredit(value: number | string): string {
  return Number(value).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("NETWORK", "Không kết nối được máy chủ", 0);
  }
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiError(body?.error?.code ?? "INTERNAL", body?.error?.message ?? "Có lỗi xảy ra, vui lòng thử lại", res.status);
  }
  return body as T;
}

// GET có nhớ tạm trong trình duyệt (catalog, chủ đề…): chuyển tab / quay lại studio không phải chờ mạng lại.
// Hết hạn sau ttl; lỗi thì bỏ khỏi bộ nhớ để lần sau thử lại. Gọi invalidateApiCache() sau khi đổi gói / mua Credit.
const apiCache = new Map<string, { at: number; p: Promise<unknown> }>();
export function apiCached<T>(url: string, ttlMs = 60_000): Promise<T> {
  const hit = apiCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = api<T>(url);
  apiCache.set(url, { at: Date.now(), p });
  p.catch(() => apiCache.delete(url));
  return p;
}
export function invalidateApiCache(prefix = ""): void {
  for (const k of apiCache.keys()) if (k.startsWith(prefix)) apiCache.delete(k);
}

export function postJson<T>(url: string, data: unknown, signal?: AbortSignal): Promise<T> {
  return api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal });
}

export function patchJson<T>(url: string, data: unknown): Promise<T> {
  return api<T>(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
