import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { MAX_MUSIC_BYTES, saveMusicUpload } from "@/server/services/admin";

// multipart: field `file` (.mp3 / .m4a / .wav, tối đa 25 MB). Trả đường dẫn để đặt tên và thêm vào danh sách nhạc.
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const length = Number(req.headers.get("content-length"));
    if (!length || length > MAX_MUSIC_BYTES + 64 * 1024) throw new AppError("VALIDATION", "File nhạc tối đa 25 MB");
    const form = await req.formData().catch(() => {
      throw new AppError("VALIDATION", "Dữ liệu tải lên không hợp lệ");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Chưa chọn file");
    return saveMusicUpload(file);
  });
}
