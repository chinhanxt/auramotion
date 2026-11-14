import { access } from "node:fs/promises";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";
import { storagePath } from "@/lib/storage";
import { EngineError } from "@/server/engines/types";
import { listVoices, MAX_SCRIPT_LINES, previewScript } from "@/server/engines/voice";
import { getActivePlan } from "@/server/services/plan";

const lines = z.array(z.string().trim().min(1).max(200)).min(1, "Chưa có lời để đọc").max(MAX_SCRIPT_LINES, `Tối đa ${MAX_SCRIPT_LINES} câu`);
const bodySchema = z.union(
  [
    z.object({ preset: z.string().trim().min(1).max(100), lines }).strict(),
    z.object({ refUrl: z.string().min(1).max(500), lines }).strict(),
  ],
  { message: "Cần chọn giọng có sẵn hoặc audio mẫu" },
);

// Mỗi user 1 lần tạo giọng xem thử đang chạy (VieNeu chạy CPU, cả kịch bản mất cả phút).
const g = globalThis as unknown as { scriptPreviewBusy?: Set<string> };
const busy = (g.scriptPreviewBusy ??= new Set<string>());

async function ownUploadPath(userId: string, refUrl: string): Promise<string> {
  const prefix = `/media/uploads/${userId}/`;
  const name = refUrl.startsWith(prefix) ? refUrl.slice(prefix.length) : "";
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new AppError("VALIDATION", "Audio mẫu không hợp lệ");
  const file = storagePath(`uploads/${userId}/${name}`);
  await access(file).catch(() => {
    throw new AppError("VALIDATION", "Không tìm thấy audio mẫu, vui lòng tải lên lại");
  });
  return file;
}

// Giọng đọc cả kịch bản để xem thử khớp bản xuất (kèm mốc giờ từng câu cho phụ đề).
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const body = bodySchema.parse(await readJson(req));
    if (busy.has(user.id)) throw new AppError("CONCURRENCY_LIMIT", "Đang tạo giọng xem thử, vui lòng chờ xong");
    busy.add(user.id);
    try {
      let voice: { preset?: string; refPath?: string };
      if ("refUrl" in body) {
        const { plan } = await getActivePlan(user.id);
        if (plan.rank < 1) throw new AppError("PLAN_MODEL", "Giọng của tôi chỉ dành cho gói Pro trở lên");
        voice = { refPath: await ownUploadPath(user.id, body.refUrl) };
      } else {
        const voices = await listVoices();
        if (!voices.some((v) => v.id === body.preset)) throw new AppError("VALIDATION", "Giọng không có trong danh sách");
        voice = { preset: body.preset };
      }
      return await previewScript(voice, body.lines);
    } catch (err) {
      if (err instanceof EngineError) {
        console.error(`[voices/script] ${err.code}: ${err.message}`);
        throw new AppError("ENGINE", "Chưa tạo được giọng xem thử, vui lòng thử lại");
      }
      throw err;
    } finally {
      busy.delete(user.id);
    }
  });
}
