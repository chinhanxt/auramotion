import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { EngineError } from "@/server/engines/types";
import { listVoices } from "@/server/engines/voice";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireUser();
    try {
      return await listVoices();
    } catch (err) {
      if (err instanceof EngineError) {
        console.error(`[voices] ${err.code}: ${err.message}`);
        throw new AppError("ENGINE", "Chưa tải được danh sách giọng, vui lòng thử lại");
      }
      throw err;
    }
  });
}
