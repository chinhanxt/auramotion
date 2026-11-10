export type MediaRequest = {
  kind: "image" | "video";
  engineModel: string;
  prompt: string;
  aspectRatio: string;
  imageCount?: number;
  durationSec?: number;
  inputPath?: string;
  inputUrl?: string;
  // Muse video: không gửi `size`.
  omitSize?: boolean;
};

export class EngineError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.retryable = retryable;
  }
}

// agy, codex: engine chạy trên máy, trả đường dẫn file kết quả.
export interface FileEngine {
  generate(req: MediaRequest, signal?: AbortSignal): Promise<{ files: string[] }>;
}
