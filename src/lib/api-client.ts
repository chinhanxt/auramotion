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

export type CatalogPreset = { id: string; kind: "STYLE" | "CAMERA"; name: string; promptSuffix: string; thumbnailUrl: string | null };

export type CatalogPlan = { code: "free" | "pro" | "ultra"; name: string; rank: number; maxDurationSec: number; maxConcurrent: number };

export type Catalog = {
  models: CatalogModel[];
  presets: CatalogPreset[];
  plan: CatalogPlan;
  music?: { id: string; name: string; file: string }[];
};

export type JobItem = {
  id: string;
  kind: "IMAGE" | "VIDEO" | "ASSEMBLE";
  prompt: string;
  status: JobStatus;
  cost: string;
  resultUrls: string[];
  error: string | null;
  createdAt: string;
};

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
};

export function jobErrorText(code: string): string {
  return JOB_ERROR_TEXT[code] ?? `mã lỗi ${code}`;
}

const KIND_PATH: Record<JobItem["kind"], string> = { IMAGE: "image", VIDEO: "video", ASSEMBLE: "edit" };

export function remakeHref(job: { id: string; kind: JobItem["kind"] }): string {
  return `/studio/${KIND_PATH[job.kind]}?from=${job.id}`;
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
