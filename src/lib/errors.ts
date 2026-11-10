export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "INSUFFICIENT_CREDIT"
  | "CONCURRENCY_LIMIT"
  | "PLAN_DURATION"
  | "PLAN_MODEL"
  | "MAINTENANCE"
  | "ACCOUNT_LOCKED"
  | "CONFLICT"
  | "ENGINE"
  | "MUSE_VIDEO_UNAVAILABLE"
  | "INTERNAL";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  INSUFFICIENT_CREDIT: 402,
  CONCURRENCY_LIMIT: 429,
  PLAN_DURATION: 403,
  PLAN_MODEL: 403,
  MAINTENANCE: 503,
  ACCOUNT_LOCKED: 423,
  CONFLICT: 409,
  ENGINE: 502,
  MUSE_VIDEO_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number = DEFAULT_STATUS[code]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}
