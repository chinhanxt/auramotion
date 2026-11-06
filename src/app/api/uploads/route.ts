import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { saveUpload } from "@/lib/storage";

const kindSchema = z.enum(["image", "audio"], { message: "Loại file không hợp lệ" });

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const form = await req.formData().catch(() => {
      throw new AppError("VALIDATION", "Dữ liệu tải lên không hợp lệ");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Chưa chọn file");
    const kind = kindSchema.parse(form.get("kind"));
    return saveUpload(user.id, file, kind);
  });
}
