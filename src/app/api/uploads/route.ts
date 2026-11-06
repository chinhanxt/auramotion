import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { MAX_UPLOAD_BYTES, saveUpload } from "@/lib/storage";

// Chừa chỗ cho phần đầu multipart; route handler không có giới hạn body nên chặn trước khi đọc.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

const kindSchema = z.enum(["image", "audio"], { message: "Loại file không hợp lệ" });

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const length = Number(req.headers.get("content-length"));
    if (!length || length > MAX_BODY_BYTES) throw new AppError("VALIDATION", "File vượt quá 10 MB");
    const form = await req.formData().catch(() => {
      throw new AppError("VALIDATION", "Dữ liệu tải lên không hợp lệ");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Chưa chọn file");
    const kind = kindSchema.parse(form.get("kind"));
    return saveUpload(user.id, file, kind);
  });
}
