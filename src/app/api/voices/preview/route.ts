import { access } from "node:fs/promises";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";
import { storagePath } from "@/lib/storage";
import { EngineError } from "@/server/engines/types";
import { listVoices, MAX_PREVIEW_TEXT, previewVoice, SAMPLE_TEXT } from "@/server/engines/voice";
import { getActivePlan } from "@/server/services/plan";

const text = z.string().trim().min(1, "Câu nghe thử không được trống").max(MAX_PREVIEW_TEXT, `Câu nghe thử tối đa ${MAX_PREVIEW_TEXT} ký tự`);
const bodySchema = z.union(
  [
    z.object({ preset: z.string().trim().min(1).max(100), text: text.optional() }).strict(),
    z.object({ refUrl: z.string().min(1).max(500), text: text.optional() }).strict(),
  ],
  { message: "Cần chọn giọng có sẵn hoặc audio mẫu" },
);

// Mỗi user tối đa 1 lần nghe thử đang chạy (VieNeu chạy CPU, mỗi lần vài chục giây).
const globalForPreview = globalThis as unknown as { voicePreviewBusy?: Set<string> };
const busy = (globalForPreview.voicePreviewBusy ??= new Set<string>());

// Chỉ nhận file upload của chính user: /media/uploads/{userId}/{tên file}.
async function ownUploadPath(userId: string, refUrl: string): Promise<string> {
  const prefix = `/media/uploads/${userId}/`;
  const name = refUrl.startsWith(prefix) ? refUrl.slice(prefix.length) : "";
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new AppError("VALIDATION", "Audio mẫu không hợp lệ");
  }
  const file = storagePath(`uploads/${userId}/${name}`);
  await access(file).catch(() => {
    throw new AppError("VALIDATION", "Không tìm thấy audio mẫu, vui lòng tải lên lại");
  });
  return file;
}

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const body = bodySchema.parse(await readJson(req));
    if (busy.has(user.id)) throw new AppError("CONCURRENCY_LIMIT", "Đang tạo bản nghe thử, vui lòng chờ xong");
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
      return { url: await previewVoice(voice, body.text ?? SAMPLE_TEXT) };
    } catch (err) {
      if (err instanceof EngineError) {
        console.error(`[voices/preview] ${err.code}: ${err.message}`);
        throw new AppError("ENGINE", "Chưa tạo được bản nghe thử, vui lòng thử lại");
      }
      throw err;
    } finally {
      busy.delete(user.id);
    }
  });
}
