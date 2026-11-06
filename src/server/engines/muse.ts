import fs from "node:fs/promises";
import path from "node:path";
import { EngineError, type MediaRequest } from "@/server/engines/types";

export type MuseTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type MuseTask = {
  id?: string;
  status?: MuseTaskStatus;
  result?: { data?: { url?: string }[]; url?: string } | null;
  error?: { message?: string; code?: string } | null;
};

const REQUEST_TIMEOUT_MS = 30_000;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

async function toDataUrl(filePath: string): Promise<string> {
  const mime = IMAGE_MIME[path.extname(filePath).toLowerCase()];
  if (!mime) throw new EngineError("BAD_INPUT", "Ảnh tham chiếu phải là PNG, JPEG hoặc WebP");
  const data = await fs.readFile(filePath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") throw new EngineError("BAD_INPUT", "Ảnh tham chiếu không còn tồn tại", false);
    throw err;
  });
  return `data:${mime};base64,${data.toString("base64")}`;
}

export class HttpMuseClient {
  readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    baseUrl: string = process.env.MUSE_API_URL || "http://127.0.0.1:18610",
    apiKey: string = process.env.MUSE_API_KEY ?? "",
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  // Header gửi kèm khi tải file kết quả từ muse2api.
  get authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async request<T>(method: "GET" | "POST", urlPath: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${urlPath}`, {
        method,
        headers: { ...this.authHeaders, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new EngineError("MUSE_UNREACHABLE", `Không kết nối được muse2api: ${(err as Error).message}`, true);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const detail = (json as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 300);
      const message = `muse2api HTTP ${res.status}: ${detail}`;
      if (res.status === 429) throw new EngineError("MUSE_BUSY", message, true);
      if (res.status >= 500) throw new EngineError("MUSE_ERROR", message, true);
      if (res.status === 401 || res.status === 403) throw new EngineError("MUSE_AUTH", message);
      if (res.status === 404) throw new EngineError("MUSE_NOT_FOUND", message);
      throw new EngineError("MUSE_REJECTED", message);
    }
    if (json === null || typeof json !== "object") {
      throw new EngineError("MUSE_BAD_RESPONSE", "muse2api trả dữ liệu không hợp lệ", true);
    }
    return json as T;
  }

  async submit(req: MediaRequest): Promise<{ taskId: string }> {
    // muse2api chặn URL nội bộ: gửi ảnh tham chiếu dạng data URL.
    const image = req.inputPath ? await toDataUrl(req.inputPath) : req.inputUrl;
    const task =
      req.kind === "image"
        ? await this.request<MuseTask>("POST", "/v1/images/generations", {
            model: req.engineModel,
            prompt: req.prompt,
            size: req.aspectRatio,
            n: req.imageCount ?? 1,
            image,
            async: true,
            response_format: "url",
          })
        : await this.request<MuseTask>("POST", "/v1/videos", {
            model: req.engineModel,
            prompt: req.prompt,
            size: req.aspectRatio,
            duration: req.durationSec ?? 5,
            image,
          });
    if (!task.id) throw new EngineError("MUSE_BAD_RESPONSE", "muse2api không trả mã tác vụ");
    return { taskId: task.id };
  }

  async getTask(
    kind: "image" | "video",
    taskId: string,
  ): Promise<{ status: MuseTaskStatus; urls: string[]; error?: string }> {
    const base = kind === "image" ? "/v1/images/generations" : "/v1/videos";
    const task = await this.request<MuseTask>("GET", `${base}/${encodeURIComponent(taskId)}`);
    const urls =
      kind === "image"
        ? (task.result?.data ?? []).map((d) => d.url).filter((u): u is string => Boolean(u))
        : task.result?.url
          ? [task.result.url]
          : [];
    const error = task.error ? task.error.message || task.error.code : undefined;
    return { status: task.status ?? "queued", urls, ...(error ? { error } : {}) };
  }

  async health(): Promise<{ ok: boolean; accounts?: number; driver?: string }> {
    try {
      const body = await this.request<{ ready?: boolean; driver?: { driver?: string }; accounts?: { available?: number } }>(
        "GET",
        "/readyz",
      );
      return { ok: Boolean(body.ready), accounts: body.accounts?.available, driver: body.driver?.driver };
    } catch {
      return { ok: false };
    }
  }
}
