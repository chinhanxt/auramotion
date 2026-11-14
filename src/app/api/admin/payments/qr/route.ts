import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { getPaymentQr, MAX_QR_BYTES, removePaymentQr, savePaymentQr } from "@/server/services/payment-qr";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return { qr: await getPaymentQr() };
  });
}

// multipart: `file` (ảnh QR) + `note` tùy chọn (hướng dẫn hiện dưới mã).
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const length = Number(req.headers.get("content-length"));
    if (!length || length > MAX_QR_BYTES + 64 * 1024) throw new AppError("VALIDATION", "Ảnh QR tối đa 4 MB");
    const form = await req.formData().catch(() => {
      throw new AppError("VALIDATION", "Dữ liệu tải lên không hợp lệ");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Chưa chọn ảnh");
    const note = form.get("note");
    return { qr: await savePaymentQr(file, typeof note === "string" ? note : undefined) };
  });
}

export function DELETE(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    await removePaymentQr();
    return { ok: true };
  });
}
