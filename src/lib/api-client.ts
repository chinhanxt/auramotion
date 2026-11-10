// Kiểu dữ liệu và hàm gọi API dùng ở phía trình duyệt.

export type GenKind = "image" | "video" | "assemble";
export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export type ModelOptions = { aspectRatios?: string[]; counts?: number[]; durations?: number[]; maxRefs?: number };

export type CatalogModel = {
  id: string;
  name: string;
  provider: "MUSE" | "AGY" | "CODEX" | "LOCAL";
  kind: "IMAGE" | "VIDEO" | "ASSEMBLE";
  minPlanRank: number;
  baseCost: string;
  options: ModelOptions;
  locked: boolean;
};

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
export type CatalogSkill = { id: string; slug: string; name: string; kind: SkillKind; description: string; locked: boolean };

export type CatalogPlan = { code: "free" | "pro" | "ultra"; name: string; rank: number; maxDurationSec: number; maxConcurrent: number };

export type Catalog = {
  models: CatalogModel[];
  presets: CatalogPreset[];
  plan: CatalogPlan;
  music?: { id: string; name: string; file: string }[];
  skills?: CatalogSkill[];
  // Tài khoản Muse bị chặn tạo video (khu vực): khóa nút tạo video / quay story.
  videoUnavailable?: boolean;
};

// AI Gateway viết prompt cho job (autoWrite): ai viết, skill nào, mất bao lâu.
export type WriterProvider = "agy" | "codex" | "muse";
export type WrittenInfo = { provider: WriterProvider; skillSlug: string; skillName: string; ms: number };
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
};

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

export const WRITER_LABEL: Record<WriterProvider, string> = { agy: "agy", codex: "Codex", muse: "Muse" };

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

export function postJson<T>(url: string, data: unknown, signal?: AbortSignal): Promise<T> {
  return api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal });
}

export function patchJson<T>(url: string, data: unknown): Promise<T> {
  return api<T>(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
