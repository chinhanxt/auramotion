import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { fulfillPayment } from "@/server/services/payment";

export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    if (await fulfillPayment(id, { confirmedBy: admin.id })) return { ok: true };
    const exists = await db.payment.count({ where: { id } });
    if (!exists) throw new AppError("NOT_FOUND", "Không tìm thấy đơn thanh toán");
    throw new AppError("CONFLICT", "Đơn đã được xử lý trước đó");
  });
}
