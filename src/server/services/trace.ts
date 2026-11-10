import { db } from "@/lib/db";

// Dấu thời gian từng chặng của job trong `params.trace` (ms epoch). Ghi bằng jsonb merge nguyên tử để các mốc
// ghi từ nơi khác nhau không đè nhau.

export type JobTrace = {
  createdAt?: number;
  queuedAt?: number;
  writeStart?: number;
  writeEnd?: number;
  writer?: { provider: string; model?: string; skill?: string; cache: boolean; ms?: number };
  // Bộ chọn skill 2 tầng (src/server/ai/router.ts) và bộ sửa prompt (src/server/ai/guard.ts) ghi vào đây.
  // method: rule | ai (thêm fixed = ảnh khung đầu video, fallback = AI chọn lỗi, dùng luật).
  router?: { method: "rule" | "ai" | "fixed" | "fallback"; candidates: string[]; chosen: string; ms: number };
  guard?: { fixes: string[] };
  slotAt?: number;
  submitAt?: number;
  engine?: { provider: string; model: string; account?: string };
  doneAt?: number;
  failedAt?: number;
  error?: string;
};

export function traceOf(params: unknown): JobTrace | undefined {
  const t = (params as { trace?: unknown } | null)?.trace;
  return t && typeof t === "object" ? (t as JobTrace) : undefined;
}

export async function markTrace(jobId: string, patch: JobTrace): Promise<void> {
  try {
    await db.$executeRaw`
      UPDATE "jobs"
      SET params = jsonb_set(
        CASE WHEN jsonb_typeof(params) = 'object' THEN params ELSE '{}'::jsonb END,
        '{trace}',
        COALESCE(CASE WHEN jsonb_typeof(params->'trace') = 'object' THEN params->'trace' END, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
        true
      )
      WHERE id = ${jobId}`;
  } catch (err) {
    // Trace chỉ để theo dõi: lỗi ghi không được làm hỏng job.
    console.warn(`[trace] không ghi được trace job ${jobId}: ${(err as Error).message.slice(0, 200)}`);
  }
}
