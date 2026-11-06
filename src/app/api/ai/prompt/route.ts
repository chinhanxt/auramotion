import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";
import { writePrompt } from "@/server/engines/prompt-writer";
import { EngineError } from "@/server/engines/types";

const bodySchema = z.object({
  idea: z.string().trim().min(1, "Hãy nhập ý tưởng").max(2000, "Ý tưởng tối đa 2000 ký tự"),
  kind: z.enum(["image", "video", "script"], { message: "Loại không hợp lệ" }),
  aspect: z.enum(["1:1", "9:16", "16:9", "4:5"], { message: "Tỷ lệ khung không hợp lệ" }).optional(),
  durationSec: z.number().int().min(1).max(120).optional(),
});

// Mỗi user tối đa 1 yêu cầu viết prompt đang chạy (app chạy 1 tiến trình trên 1 máy).
const globalForPrompt = globalThis as unknown as { promptWriterBusy?: Set<string> };
const busy = (globalForPrompt.promptWriterBusy ??= new Set<string>());

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const input = bodySchema.parse(await readJson(req));
    if (busy.has(user.id)) throw new AppError("CONCURRENCY_LIMIT", "AI đang viết cho bạn, vui lòng chờ xong");
    busy.add(user.id);
    try {
      return await writePrompt(input);
    } catch (err) {
      if (err instanceof EngineError) {
        console.error(`[ai/prompt] ${err.code}: ${err.message}`);
        throw new AppError("ENGINE", "AI chưa viết được, vui lòng thử lại");
      }
      throw err;
    } finally {
      busy.delete(user.id);
    }
  });
}
